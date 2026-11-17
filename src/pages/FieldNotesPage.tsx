import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Mic, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clock, durationWords, longDate, signed } from '@/lib/format';
import { bestScoresFor, personalBaseline } from '@/lib/personalBest';
import { masteredSkills } from '@/lib/skills';
import { Button } from '@/components/ui/button';
import { Sonogram, type WordSegment } from '@/components/sonogram';
import { TALK_TYPES } from '@/live/metrics/pace';
import { requestFieldNotesWithRetry } from '@/session/fieldNotesApi';
import { requestTightened } from '@/session/tightenApi';
import { TightenedAnswer } from '@/components/notes/TightenedAnswer';
import { NaturalPhrasing } from '@/components/notes/NaturalPhrasing';
import { BeforeAfter } from '@/components/notes/BeforeAfter';
import { TakeItWithYou } from '@/components/notes/TakeItWithYou';
import { previousTake } from '@/lib/compare';
import { saveConfig, type SessionConfig } from '@/session/config';
import { deleteSession, getSession, getStory, listSessions, newId, saveStory, updateSession, type StoredSession } from '@/storage/localDb';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { HowScored } from '@/components/HowScored';
import { StoryBeats } from '@/components/notes/StoryBeats';
import { BEAT_LABELS } from '@/lib/storyBeats';
import { LandingLine } from '@/components/notes/LandingLine';
import { attentionDrift, LIGHT_TECHNIQUES, lightnessCues } from '@/lib/attention';
import type { FieldNote, FieldNotes } from '@/types/fieldNotes';

const MIN_WORDS = 20;
/** Requests in flight, so a remount doesn't ask twice. */
const inFlight = new Set<string>();
const tightenInFlight = new Set<string>();

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; session: StoredSession; best: ReturnType<typeof bestScoresFor>; previous: StoredSession | null };

/** Field notes (`/notes/:id`): verdict, scores, the whole answer drawn, notes beside the transcript. */
export function FieldNotesPage() {
  const { id = '' } = useParams();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  /** Set while waiting for the automatic second try. */
  const [retrying, setRetrying] = useState(false);
  const [tightenPending, setTightenPending] = useState(false);

  const refresh = useCallback(async () => {
    const [session, all] = await Promise.all([getSession(id), listSessions()]);
    setLoad(session ? { status: 'ready', session, best: bestScoresFor(session, all), previous: previousTake(session, all) } : { status: 'missing' });
    return session;
  }, [id]);

  /** "Your answer, tightened", once the notes (and their one fix) exist. */
  const tighten = useCallback(
    async (session: StoredSession) => {
      if (tightenInFlight.has(session.id)) return;
      tightenInFlight.add(session.id);
      setTightenPending(true);
      try {
        const t = await requestTightened(session);
        await updateSession(session.id, { tightened: { ...t, status: 'ready' } });
      } catch (err) {
        await updateSession(session.id, { tightened: { script: '', mainPoint: '', status: 'failed', error: err instanceof Error ? err.message : String(err) } });
      } finally {
        tightenInFlight.delete(session.id);
        setTightenPending(false);
        await refresh();
      }
    },
    [refresh]
  );

  const write = useCallback(
    async (session: StoredSession) => {
      if (inFlight.has(session.id)) return;
      const words = session.segments.length;
      if (words < MIN_WORDS) {
        await updateSession(session.id, {
          notesStatus: 'failed',
          notesError: `Field notes need at least ${MIN_WORDS} words, and Vireo heard ${words}. Try a longer answer.`,
        });
        await refresh();
        return;
      }
      inFlight.add(session.id);
      try {
        await updateSession(session.id, { notesStatus: 'pending', notesError: undefined });
        await refresh();
        const story = session.config.storyId ? await getStory(session.config.storyId) : undefined;
        const all = await listSessions().catch(() => []);
        const notes = await requestFieldNotesWithRetry(session, story, () => setRetrying(true), undefined, {
          masteredSkills: masteredSkills(all),
          personalBest: personalBaseline(session, all),
        });
        const updated = await updateSession(session.id, { notesStatus: 'ready', notes });
        if (updated && updated.segments.length >= MIN_WORDS) void tighten(updated);
      } catch (err) {
        await updateSession(session.id, { notesStatus: 'failed', notesError: err instanceof Error ? err.message : String(err) });
      } finally {
        inFlight.delete(session.id);
        setRetrying(false);
        await refresh();
      }
    },
    [refresh, tighten]
  );

  useEffect(() => {
    refresh().then((s) => {
      if (s && s.notesStatus === 'pending') void write(s);
      else if (s && s.notesStatus === 'ready' && !s.tightened && s.segments.length >= MIN_WORDS) void tighten(s);
    });
  }, [refresh, write, tighten]);

  if (load.status === 'loading') return <p className="text-ink-muted">Opening your field notes</p>;
  if (load.status === 'missing') {
    return (
      <div className="flex max-w-[640px] flex-col gap-6">
        <h1 className="font-display text-display-l font-normal">No field notes for this session.</h1>
        <p className="text-body text-ink-muted">It may have been deleted. Sessions are kept only on this device.</p>
        <div>
          <Button asChild variant="outline">
            <Link to="/app">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <FieldNotesView
      session={load.session}
      best={load.best}
      previous={load.previous}
      retrying={retrying}
      onRetry={() => write(load.session)}
      tightenPending={tightenPending}
      onRetryTighten={() => {
        void updateSession(load.session.id, { tightened: undefined }).then((s) => s && tighten(s));
      }}
      onChange={refresh}
    />
  );
}

function FieldNotesView({
  session,
  best,
  previous,
  retrying,
  tightenPending,
  onRetryTighten,
  onRetry,
  onChange,
}: {
  session: StoredSession;
  best: ReturnType<typeof bestScoresFor>;
  previous: StoredSession | null;
  retrying: boolean;
  tightenPending: boolean;
  onRetryTighten: () => void;
  onRetry: () => void;
  onChange: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const notes = session.notes;
  const talk = TALK_TYPES[session.config.talkType];
  const [selected, setSelected] = useState(0);
  const [highlightMs, setHighlightMs] = useState<number | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const ordered = useMemo(() => (notes ? [...notes.notes].sort((a, b) => a.startMs - b.startMs) : []), [notes]);
  const selectedNote = ordered[selected];

  function practise(config: SessionConfig) {
    saveConfig(config);
    navigate('/warm-up', { state: { preset: config } });
  }

  /** Rerun the same question and situation, with the one fix (and tightened script) carried along. */
  function tryAgain() {
    if (!notes?.oneFix) return;
    const config: SessionConfig = {
      ...session.config,
      parentSessionId: undefined,
      retake: { fromSessionId: session.retakeOf ?? session.id, oneFix: notes.oneFix.instruction, script: session.tightened?.script },
    };
    saveConfig(config);
    navigate('/session');
  }

  function answerFollowUp() {
    if (!notes) return;
    const config: SessionConfig = {
      ...session.config,
      prompt: notes.audienceFollowUp.question,
      audience: false,
      storyId: undefined,
      parentSessionId: session.id,
    };
    saveConfig(config);
    navigate('/session');
  }

  async function saveToStoryBank() {
    if (session.config.storyId) {
      navigate('/stories');
      return;
    }
    const now = new Date().toISOString();
    const points = notes?.storyMap.sections.filter((s) => s.status !== 'missed').map((s) => s.title) ?? [];
    const story = {
      id: newId('story'),
      kind: 'story' as const,
      title: session.config.prompt.slice(0, 120),
      tag: talk.label.split(' ')[0],
      length: durationWords(Math.round(session.metrics.durationMs / 30_000) * 30_000 || 30_000),
      gist: notes?.summary.split(/(?<=[.!?])\s/)[0] ?? '',
      keyPoints: points,
      createdAt: now,
      updatedAt: now,
      lastSessionId: session.id,
    };
    await saveStory(story);
    await updateSession(session.id, { config: { ...session.config, storyId: story.id } });
    await onChange();
    setSavedMessage('Saved to your Story Bank.');
  }

  /** "Play this moment": seek the transcript to the note's time. */
  function playMoment(note: FieldNote) {
    playAt(note.startMs);
  }

  function playAt(ms: number) {
    setHighlightMs(ms);
    const lines = transcriptRef.current?.querySelectorAll<HTMLElement>('[data-start-ms]') ?? [];
    let target: HTMLElement | null = null;
    lines.forEach((el) => {
      if (Number(el.dataset.startMs) <= ms) target = el;
    });
    const el = (target ?? lines[0]) as HTMLElement | undefined;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  }

  const pins = ordered.map((n, i) => ({ key: `note-${i}`, atMs: n.startMs, tone: n.kind === 'keep' ? ('olive' as const) : ('amber' as const), selected: i === selected }));
  const beats = notes?.storyBeats;
  const drift = attentionDrift(session.segments, beats?.present.map((b) => b.startMs) ?? []);
  const cues = lightnessCues(session.segments);
  const bands = drift.map((d, i) => ({ key: `drift-${i}`, ...d, label: 'Attention may drift here', tone: 'amber' as const }));
  const markers = [
    ...(beats?.present ?? []).map((b) => ({ key: `beat-${b.kind}`, atMs: b.startMs, label: BEAT_LABELS[b.kind].label.toLowerCase(), tone: 'sky' as const })),
    ...cues.map((c, i) => ({ key: `light-${i}`, atMs: c.atMs, label: 'lighter beat?', tone: 'olive' as const })),
  ];

  return (
    <div className="flex flex-col gap-24">
      <div className="-mt-4 flex flex-wrap items-center justify-between gap-4">
        <Link to="/app" className="inline-flex h-11 items-center gap-2 rounded-sm text-label text-ink-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {savedMessage && (
            <span role="status" className="text-small text-ink-muted">
              {savedMessage}
            </span>
          )}
          <Button variant="outline" onClick={saveToStoryBank}>
            {session.config.storyId ? 'Open Story Bank' : 'Save to Story Bank'}
          </Button>
          <Button onClick={() => practise({ ...session.config, parentSessionId: undefined })}>Practise again</Button>
        </div>
      </div>

      <section className="flex flex-col gap-7">
        <p className="m-0 text-ink-muted">
          {session.source === 'recording' && (
            <span className="mr-3 inline-flex rounded-pill bg-sky/15 px-3 py-0.5 text-label text-sky" data-testid="from-recording">
              From a recording
            </span>
          )}
          Field notes for your {talk.label.toLowerCase()}, {session.source === 'recording' ? 'uploaded' : 'recorded'} {longDate(session.createdAt)}, {durationWords(session.metrics.durationMs)}
        </p>
        {notes ? (
          notes.oneFix ? (
            <>
              {session.config.confidenceMode && <WentWell notes={notes} />}
              <div className="paper-scope flex flex-col gap-4 rounded-lg bg-paper p-7 text-paper-foreground sm:p-10">
                <p className="m-0 text-label opacity-75">Your one fix for the next take</p>
                <h1 className="m-0 max-w-[900px] font-display text-[clamp(36px,5vw,64px)] font-normal leading-[1.02] tracking-[-0.03em]">{notes.oneFix.instruction}</h1>
                <p className="m-0 max-w-[720px] text-body opacity-85">{notes.oneFix.why}</p>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button size="lg" onClick={tryAgain} className="bg-paper-foreground text-paper hover:bg-paper-foreground/90">
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Try again with this fix
                  </Button>
                  <span className="text-small opacity-75">Same question{session.config.situationId ? ' and situation' : ''}. The fix stays on screen while you speak.</span>
                </div>
              </div>
              <h2 className="m-0 mt-6 max-w-[980px] font-display text-[clamp(40px,5.6vw,80px)] font-normal leading-[0.98] tracking-[-0.03em]">{notes.verdict}</h2>
              <p className="m-0 max-w-[760px] text-[19px] leading-[30px] text-ink-muted">{notes.summary}</p>
              <Scores notes={notes} best={best} session={session} />
            </>
          ) : (
            <>
              <h1 className="m-0 max-w-[980px] font-display text-[clamp(52px,8vw,112px)] font-normal leading-[0.95] tracking-[-0.035em]">{notes.verdict}</h1>
              <p className="m-0 max-w-[760px] text-[19px] leading-[30px] text-ink-muted">{notes.summary}</p>
              <Scores notes={notes} best={best} session={session} />
            </>
          )
        ) : (
          <NotesPending session={session} retrying={retrying} onRetry={onRetry} />
        )}
      </section>

      {previous && <BeforeAfter before={previous} after={session} />}

      {notes && session.segments.length >= MIN_WORDS && (
        <TightenedAnswer original={session.transcript.filter((l) => l.speaker !== 'coach').map((l) => l.text).join(' ')} tightened={session.tightened} pending={tightenPending} onRetry={onRetryTighten} />
      )}

      {notes && <LandingLine landing={notes.landing} />}

      {notes && <NaturalPhrasing items={notes.naturalPhrasing} open={session.config.situationId === 'english'} />}

      <section aria-labelledby="whole-h" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="whole-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
            The whole answer, drawn
          </h2>
          {notes && <span className="font-display text-lg italic text-ink-muted">Select a note to pin it to its moment</span>}
        </div>
        <div className="rounded-lg bg-surface-100 px-2 py-4 sm:px-6">
          <Sonogram
            segments={session.segments}
            pauses={session.pauses}
            tentativeFillers={session.likelyFillers}
            eyeContactStrip={
              session.camera
                ? {
                    tracked: { startMs: 0, endMs: session.metrics.durationMs },
                    away: session.camera.events.filter((e) => e.kind === 'look-away' || e.kind === 'out-of-frame'),
                  }
                : undefined
            }
            window={{ startMs: 0, endMs: Math.max(session.metrics.durationMs, 1000) }}
            pins={pins}
            bands={bands}
            markers={markers}
            selectedPinLabel={selectedNote?.title}
            showWordLabels={false}
            showTimeAxis
            labelPauses={false}
            label={`The whole answer as a sonogram: ${session.segments.length} words, ${session.metrics.fillerCount} fillers, ${session.metrics.pauseCount} pauses.${beats?.present.length ? ` Story beats: ${beats.present.map((b) => `${BEAT_LABELS[b.kind].label} at ${clock(b.startMs)}`).join(', ')}.` : ''}${drift.length ? ` Attention may drift ${drift.map((d) => `from ${clock(d.startMs)} to ${clock(d.endMs)}`).join(' and ')}.` : ''}${selectedNote ? ` Pinned: ${selectedNote.title}` : ''}`}
          />
        </div>
        {session.camera && (
          <p className="m-0 text-small text-ink-muted">
            Eye contact {session.camera.summary.eyeContactPct}% of the time, longest look-away {(session.camera.summary.longestLookAwayMs / 1000).toFixed(1)} s, smiling{' '}
            {session.camera.summary.smilePct}% of the time. The strip under the drawing is lit while you looked at the camera. Analysed on this device; no video was stored.
          </p>
        )}
        {drift.length > 0 && (
          <p className="m-0 text-small text-ink-muted" data-testid="attention-note">
            Soft amber bands mark {drift.length === 1 ? 'a stretch' : 'stretches'} of 90 seconds or more with no example, name, number, question, story beat or signpost:{' '}
            {drift.map((d) => `${clock(d.startMs)} to ${clock(d.endMs)}`).join(', ')}. Attention may drift there. Found by a fixed rule on your transcript, not by a model.
          </p>
        )}
        {cues.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-surface-100 p-5" data-testid="lightness-cues">
            <p className="m-0 text-label">Room for a lighter beat</p>
            <p className="m-0 text-small text-ink-muted">After a long stretch of explanation, listeners need a breather. These are places where one was due. Vireo marks the place; the moment is yours to write.</p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
              {cues.map((c) => (
                <li key={c.atMs}>
                  <span className="font-semibold">At {clock(c.atMs)}.</span> Try {LIGHT_TECHNIQUES[c.technique].name.toLowerCase()}: {LIGHT_TECHNIQUES[c.technique].example}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(session.likelyFillers?.length ?? 0) > 0 && (
          <p className="m-0 text-small text-ink-muted">
            Faint dashed strokes are sounds Vireo heard but the transcript has no word for, often an “um”. They aren’t counted as fillers.
          </p>
        )}
      </section>

      {beats && <StoryBeats beats={beats} dropped={notes?.droppedBeats} onPlay={playAt} />}

      {notes && notes.storyMap.sections.length > 0 && <StoryMap notes={notes} durationMs={session.metrics.durationMs} hasOutline={Boolean(session.config.storyId)} />}

      <section className="flex flex-wrap items-start gap-8">
        {notes && (
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
            <h2 className="m-0 mb-2 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">Notes</h2>
            {ordered.length === 0 && (
              <p className="m-0 text-body text-ink-muted">Vireo couldn’t back any notes with your exact words this time, so it left them out.</p>
            )}
            {ordered.map((n, i) => (
              <NoteCard key={i} note={n} selected={i === selected} onSelect={() => setSelected(i)} onPlay={() => playMoment(n)} segments={session.segments} />
            ))}
            <p className="m-0 text-small text-ink-muted">
              Every quote is checked word for word against your transcript before it appears. Anything Vireo can’t back up, it leaves out.
              {notes.droppedNotes ? ` ${notes.droppedNotes} ${notes.droppedNotes === 1 ? 'note was' : 'notes were'} left out this time.` : ''}
            </p>
          </div>
        )}
        <Transcript session={session} containerRef={transcriptRef} highlightMs={highlightMs ?? selectedNote?.startMs ?? null} />
      </section>

      {notes && session.roleplay && <PartnerAnswers session={session} notes={notes} />}

      {notes && !session.roleplay && session.segments.length >= MIN_WORDS && <TakeQuestions session={session} highlight={Boolean(session.config.takeQuestions)} />}

      {notes && session.config.audience && (
        <section aria-labelledby="aud-h" className="flex flex-col gap-6 rounded-[32px] bg-olive p-8 text-olive-foreground sm:p-14">
          <p id="aud-h" className="m-0 text-[17px] font-semibold">
            Audience mode: the follow-up a sharp listener would ask
          </p>
          <p className="m-0 font-display text-[clamp(32px,4vw,52px)] leading-[1.05] tracking-[-0.02em]">“{notes.audienceFollowUp.question}”</p>
          <div className="flex flex-wrap items-center gap-5">
            <Button onClick={answerFollowUp} size="lg" className="bg-surface-000 text-ink hover:bg-surface-000/90 dark:bg-surface-000">
              <Mic className="h-4 w-4" aria-hidden="true" />
              Answer it now
            </Button>
            <span className="max-w-[560px] text-[16px] leading-6">Chosen because {lowerFirst(notes.audienceFollowUp.reason)}</span>
          </div>
        </section>
      )}

      {notes && notes.drills.length > 0 && <Drills session={session} notes={notes} onChange={onChange} />}

      {notes && <TakeItWithYou session={session} previous={previous} />}

      <section aria-label="This session’s data" className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-8">
        <p className="m-0 max-w-[640px] text-small text-ink-muted">
          This session’s transcript, drawing and notes are stored only on this device. No video was recorded.
        </p>
        <ConfirmDelete
          label="Delete session"
          warning="This deletes the transcript, drawing and notes from this device."
          confirmLabel="Delete session"
          onConfirm={async () => {
            await deleteSession(session.id);
            navigate('/app', { replace: true });
          }}
        />
      </section>
    </div>
  );
}

/** Confidence mode: what went well comes before the one fix. */
function WentWell({ notes }: { notes: FieldNotes }) {
  const keeps = notes.notes.filter((n) => n.kind === 'keep').slice(0, 3);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-olive-soft p-7 sm:p-10" data-testid="went-well">
      <p className="m-0 text-label">What went well</p>
      {keeps.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {keeps.map((n) => (
            <li key={n.title} className="font-display text-[clamp(24px,2.6vw,32px)] leading-[1.2]">
              {n.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 font-display text-[clamp(24px,2.6vw,32px)] leading-[1.2]">You said it out loud, start to finish. That’s the hard part done.</p>
      )}
    </div>
  );
}

const ADDRESSED: Record<'fully' | 'partly' | 'not', { label: string; cls: string }> = {
  fully: { label: 'Answered it', cls: 'bg-paper-olive' },
  partly: { label: 'Partly answered', cls: 'bg-surface-200' },
  not: { label: 'Didn’t answer it yet', cls: 'bg-paper-amber' },
};

/** Roleplay and Q&A: each question, and how well the answer addressed it (quoted, evidence-checked). */
function PartnerAnswers({ session, notes }: { session: StoredSession; notes: FieldNotes }) {
  const rp = session.roleplay!;
  return (
    <section aria-labelledby="answers-h" className="flex flex-col gap-6">
      <h2 id="answers-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
        {rp.mode === 'qa' ? 'How you handled the questions' : 'How you answered each question'}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {rp.turns.map((t, i) => {
          const a = notes.answers?.find((x) => x.questionIndex === i + 1);
          return (
            <li key={t.askedAtMs} className="paper-scope flex flex-col gap-3 rounded-[24px] bg-paper p-[26px] text-paper-foreground" data-testid="partner-answer">
              <span className="text-small opacity-75">
                Question {i + 1}, at {clock(t.askedAtMs)}
              </span>
              <span className="font-display text-note-title">{t.question}</span>
              {a ? (
                <>
                  <span className={cn('self-start rounded-pill px-3 py-1 text-label', ADDRESSED[a.addressed].cls)}>{ADDRESSED[a.addressed].label}</span>
                  <span className="text-body">{a.note}</span>
                  {a.quote && <span className="rounded-md bg-surface-200/60 px-4 py-3 text-[16px] leading-[25px] dark:bg-surface-000/10">“{a.quote}”</span>}
                </>
              ) : (
                <span className="text-small opacity-75">No note for this answer: either too little was heard, or Vireo couldn’t back a note with your exact words.</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "Take questions": three tough but fair questions drawn from this talk, answered out loud. */
function TakeQuestions({ session, highlight }: { session: StoredSession; highlight: boolean }) {
  const navigate = useNavigate();
  function start() {
    const source = session.transcript
      .filter((l) => l.speaker !== 'coach')
      .map((l) => l.text)
      .join('\n');
    const config: SessionConfig = {
      ...session.config,
      parentSessionId: undefined,
      retake: undefined,
      takeQuestions: undefined,
      drill: undefined,
      partner: { mode: 'qa', role: 'tough_audience', turns: 3, source, sourceSessionId: session.id },
    };
    saveConfig(config);
    navigate('/roleplay');
  }
  return (
    <section aria-labelledby="qa-h" className={cn('flex flex-wrap items-center justify-between gap-6 rounded-lg p-7 sm:p-10', highlight ? 'paper-scope bg-paper text-paper-foreground' : 'bg-surface-100')}>
      <div className="flex max-w-[640px] flex-col gap-2">
        <h2 id="qa-h" className="m-0 font-display text-[clamp(28px,3vw,40px)] font-normal leading-tight">
          {highlight ? 'Now take questions, like the real thing' : 'Take questions'}
        </h2>
        <p className="m-0 text-body opacity-85">Three tough but fair questions drawn from what you just said, asked out loud one at a time. Then short notes on each answer.</p>
      </div>
      <Button size="lg" onClick={start} className={highlight ? 'bg-paper-foreground text-paper hover:bg-paper-foreground/90' : undefined}>
        Take questions
      </Button>
    </section>
  );
}

function lowerFirst(s: string) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function NotesPending({ session, retrying, onRetry }: { session: StoredSession; retrying: boolean; onRetry: () => void }) {
  if (session.notesStatus === 'failed') {
    return (
      <div role="alert" className="flex max-w-[760px] flex-col gap-4">
        <h1 className="m-0 font-display text-display-l font-normal">Your notes didn’t come through.</h1>
        <p className="m-0 text-body text-ink-muted">{session.notesError}</p>
        <p className="m-0 text-body text-ink-muted">Your drawing and transcript are saved on this device either way.</p>
        {session.segments.length >= MIN_WORDS && (
          <div>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-3">
      <h1 className="m-0 font-display text-display-l font-normal">{retrying ? 'Busy, trying again' : 'Writing your notes'}</h1>
      <p className="m-0 text-body text-ink-muted">
        {retrying
          ? 'The note writer is busy right now. Vireo will try again in a few seconds. Your drawing and transcript are already saved on this device.'
          : 'Reading your transcript and checking every quote. This takes a few seconds.'}
      </p>
    </div>
  );
}

function Scores({ notes, best, session }: { notes: FieldNotes; best: ReturnType<typeof bestScoresFor>; session: StoredSession }) {
  const hit = notes.storyMap.sections.filter((s) => s.status === 'hit').length;
  const outline = notes.storyMap.sections.filter((s) => s.status !== null).length;
  const items = [
    {
      key: 'structure' as const,
      label: 'Structure',
      caption: outline ? `${hit} of ${outline} key points from your outline.` : `${notes.storyMap.sections.length} parts, in the order you told them.`,
    },
    {
      key: 'delivery' as const,
      label: 'Delivery',
      caption: `${session.metrics.timeInZonePct}% of the time in your zone, ${session.metrics.fillersPerMin.toFixed(1)} fillers a minute.`,
    },
    { key: 'clarity' as const, label: 'Clarity', caption: 'How concrete, precise and easy to follow it was.' },
  ];
  return (
    <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-8 border-t border-line pt-8">
      {items.map((it) => {
        const score = notes.scores[it.key];
        const change = best ? score - best[it.key] : null;
        const down = change !== null && change < 0;
        return (
          <div key={it.key} data-score={it.key}>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className={cn('font-display text-metric', down && 'text-amber')}>{score}</span>
              {change !== null && (
                <span className={cn('text-[15px] font-semibold', down ? 'text-amber' : 'text-olive')}>{change === 0 ? `Matches your best on this ${best!.scope}` : `${signed(change)} on your best on this ${best!.scope}`}</span>
              )}
            </div>
            <p className="m-0 mt-2.5 text-lg font-semibold">{it.label}</p>
            <p className="m-0 mt-1 text-[15px] leading-[23px] text-ink-muted">{it.caption}</p>
            <HowScored id={it.key} session={session} />
          </div>
        );
      })}
    </div>
  );
}

function StoryMap({ notes, durationMs, hasOutline }: { notes: FieldNotes; durationMs: number; hasOutline: boolean }) {
  const spoken = notes.storyMap.sections.filter((s) => s.startMs !== null && s.endMs !== null);
  const missed = notes.storyMap.sections.filter((s) => s.status === 'missed');
  const total = Math.max(durationMs, ...spoken.map((s) => s.endMs!), 1);
  const statusText = (s: (typeof notes.storyMap.sections)[number]) =>
    s.status === 'hit' ? 'Hit.' : s.status === 'missed' ? 'Missed: you never reached this point.' : null;
  return (
    <section aria-labelledby="map-h" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="map-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
          How you built it
        </h2>
        <span className="font-display text-lg italic text-ink-muted">
          {hasOutline ? 'Compared with your Story Bank outline for this answer' : 'The parts of your answer, in order'}
        </span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {spoken.map((s, i) => (
          <div
            key={i}
            className="h-3.5 bg-olive first:rounded-l-pill last:rounded-r-pill"
            style={{ flex: `${Math.max(1, (s.endMs! - s.startMs!) / total)} 1 0`, opacity: 1 - (i % 3) * 0.25 }}
          />
        ))}
        {missed.map((s, i) => (
          <div key={`m${i}`} className="h-3.5 flex-[0_0_32px] rounded-pill shadow-[inset_0_0_0_1.5px_rgb(var(--amber))]" title={s.title} />
        ))}
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6 p-0">
        {notes.storyMap.sections.map((s, i) => (
          <li key={i}>
            <p className="m-0 text-small text-ink-muted">{s.startMs !== null && s.endMs !== null ? `${clock(s.startMs)} to ${clock(s.endMs)}` : 'Not reached'}</p>
            <p className="m-0 mt-1 font-display text-[26px] leading-8">{s.title}</p>
            {s.outlinePoint && s.outlinePoint !== s.title && <p className="m-0 mt-1 text-[15px] text-ink-muted">Outline: {s.outlinePoint}</p>}
            {statusText(s) && <p className={cn('m-0 mt-1 text-[15px]', s.status === 'missed' ? 'text-amber' : 'text-ink-muted')}>{statusText(s)}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Highlight filler words inside a quote, using the session's own filler marks. */
function QuoteText({ quote, segments }: { quote: string; segments: readonly WordSegment[] }) {
  const fillers = new Set(segments.filter((s) => s.kind === 'filler').map((s) => s.text.toLowerCase().replace(/[^\p{L}']/gu, '')));
  return (
    <>
      {quote.split(/(\s+)/).map((part, i) =>
        fillers.has(part.toLowerCase().replace(/[^\p{L}']/gu, '')) ? (
          <mark key={i} className="rounded-sm bg-paper-amber px-0.5 italic text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function NoteCard({
  note,
  selected,
  onSelect,
  onPlay,
  segments,
}: {
  note: FieldNote;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  segments: readonly WordSegment[];
}) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'paper-scope flex flex-col gap-3 rounded-[24px] bg-paper p-[26px] text-paper-foreground transition-[transform,box-shadow] duration-200',
        selected ? '-translate-y-0.5 shadow-[0_0_0_3px_rgb(var(--olive)),var(--shadow-lift)]' : 'opacity-90'
      )}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="flex flex-col gap-3 rounded-sm text-left">
        <span className="flex flex-wrap items-center gap-3">
          <span className={cn('rounded-pill px-3 py-1 text-label', note.kind === 'keep' ? 'bg-paper-olive' : 'bg-paper-amber')}>
            {note.kind === 'keep' ? 'Keep this' : 'Fix next'}
          </span>
          {note.cameraEventId && <span className="rounded-pill bg-surface-200 px-3 py-1 text-label">Camera</span>}
          <span className="text-small opacity-75">at {clock(note.startMs)}</span>
        </span>
        <span id={titleId} className="font-display text-note-title">
          {note.title}
        </span>
        <span className="text-body">{note.body}</span>
        {note.quote && (
          <span className="rounded-md bg-surface-200/60 px-4 py-3 text-[16px] leading-[25px] dark:bg-surface-000/10">
            “<QuoteText quote={note.quote} segments={segments} />”
          </span>
        )}
      </button>
      <span>
        <Button variant="link" className="h-auto px-0 text-paper-foreground underline" onClick={onPlay}>
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Play this moment
        </Button>
      </span>
    </article>
  );
}

interface TranscriptLineView {
  startMs: number;
  words: WordSegment[];
  pauseBeforeMs: number;
  /** A partner's question in a roleplay. */
  partner?: string;
}

function linesFor(session: StoredSession): TranscriptLineView[] {
  const starts = session.transcript.map((l) => l.startMs);
  const lines: TranscriptLineView[] = session.transcript.map((l) => ({ startMs: l.startMs, words: [], pauseBeforeMs: 0, partner: l.speaker === 'coach' ? l.text : undefined }));
  let li = 0;
  for (const w of session.segments) {
    while (li + 1 < starts.length && w.startMs >= starts[li + 1] - 1) li++;
    lines[li]?.words.push(w);
  }
  lines.forEach((line, i) => {
    if (i === 0) return;
    const prevWords = lines[i - 1].words;
    const prevEnd = prevWords.length ? prevWords[prevWords.length - 1].endMs : lines[i - 1].startMs;
    const pause = session.pauses.find((p) => p.endMs !== undefined && p.startMs >= prevEnd - 50 && p.startMs <= line.startMs);
    if (pause) line.pauseBeforeMs = (pause.endMs ?? pause.startMs) - pause.startMs;
  });
  return lines.filter((l) => l.words.length || l.partner);
}

function Transcript({
  session,
  highlightMs,
  containerRef,
}: {
  session: StoredSession;
  highlightMs: number | null;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  const lines = linesFor(session);
  let active = -1;
  if (highlightMs !== null) lines.forEach((l, i) => l.startMs <= highlightMs + 1 && (active = i));
  return (
    <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4">
      <h2 className="m-0 mb-2 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">Transcript</h2>
      <div ref={containerRef} className="flex max-h-[720px] flex-col overflow-y-auto pr-2">
        {lines.length === 0 && <p className="text-ink-muted">Vireo didn’t catch any words in this session.</p>}
        {lines.map((line, i) => (
          <div key={line.startMs}>
            {line.pauseBeforeMs >= 300 && (
              <div className="py-2 pl-[72px]">
                <span className="rounded-sm bg-sky/15 px-2 py-0.5 font-display text-[15px] italic text-sky">{(line.pauseBeforeMs / 1000).toFixed(1)} s pause</span>
              </div>
            )}
            <div
              data-start-ms={line.startMs}
              tabIndex={-1}
              aria-current={i === active ? 'true' : undefined}
              className={cn('grid grid-cols-[56px_1fr] gap-4 border-t border-line/60 px-2 py-3 transition-colors', i === active && 'rounded-md border-transparent bg-surface-100')}
            >
              <span className="pt-0.5 text-small text-ink-muted">{clock(line.startMs)}</span>
              {line.partner ? (
                <p className="m-0 font-display text-[19px] italic text-ink-muted">
                  <span className="sr-only">Partner asks: </span>
                  {line.partner}
                </p>
              ) : (
              <p className="m-0 text-body">
                {line.words.map((w, k) => (
                  <span key={k} className={w.kind === 'filler' ? 'italic text-amber' : undefined}>
                    {w.text}{' '}
                  </span>
                ))}
              </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Drills({ session, notes, onChange }: { session: StoredSession; notes: FieldNotes; onChange: () => Promise<unknown> }) {
  const done = new Set(session.drillsDone ?? []);
  async function toggle(title: string) {
    const next = new Set(done);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    await updateSession(session.id, { drillsDone: [...next] });
    await onChange();
  }
  return (
    <section aria-labelledby="drills-h" className="flex flex-col gap-6">
      <h2 id="drills-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
        Tomorrow’s drills
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-10">
        {notes.drills.map((d) => (
          <label key={d.title} className="flex cursor-pointer gap-4 border-t border-line py-6">
            <input type="checkbox" checked={done.has(d.title)} onChange={() => toggle(d.title)} className="mt-1 h-[22px] w-[22px] shrink-0 accent-[rgb(var(--olive))]" />
            <span className="flex flex-col gap-1.5">
              <span className="font-display text-[26px] leading-8">{d.title}</span>
              <span className="text-[16px] leading-[25px] text-ink-muted">
                {d.instructions} About {d.minutes} {d.minutes === 1 ? 'minute' : 'minutes'}.
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
