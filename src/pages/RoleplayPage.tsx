import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Headphones, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiveCaptions } from '@/components/hud/LiveCaptions';
import { PauseRing } from '@/components/hud/PauseRing';
import { LiveSessionEngine } from '@/live/LiveSessionEngine';
import { useLiveSnapshot } from '@/live/useLiveSession';
import { buildKeyterms, mergeKeyterms } from '@/live/keyterms';
import { summariseTake } from '@/live/metrics/ghost';
import { TALK_TYPES } from '@/live/metrics/pace';
import { situationById } from '@/session/situations';
import { loadConfig, type SessionConfig } from '@/session/config';
import { getCustomTerms, newId, saveSession, type StoredSession } from '@/storage/localDb';
import { answerText, buildConversation, ROLE_LABELS, type PartnerSetup, type PartnerTurn } from '@/roleplay/conversation';
import { requestNextQuestion, speakQuestion } from '@/roleplay/partner';

/** Final words arrive a moment after you stop; wait this long before reading the answer. */
const ANSWER_SETTLE_MS = 1200;

type Phase = 'starting' | 'thinking' | 'asking' | 'answering' | 'ending';

/** Practise with a partner (`/roleplay`): a spoken, turn-by-turn conversation, then field notes on all of it. */
export function RoleplayPage() {
  const config = loadConfig();
  if (!config?.partner || !config.prompt.trim()) return <Navigate to="/warm-up" replace />;
  return <Roleplay config={config} partner={config.partner} />;
}

function Roleplay({ config, partner }: { config: SessionConfig; partner: PartnerSetup }) {
  const navigate = useNavigate();
  // Shown until the real engine (with the speaker's keyterms) exists. Watch mode: no spoken nudges.
  const idle = useMemo(() => new LiveSessionEngine({ mode: 'watch', talkType: config.talkType, prompt: config.prompt }), [config.talkType, config.prompt]);
  const [live, setLive] = useState<LiveSessionEngine | null>(null);
  const engineRef = useRef<LiveSessionEngine | null>(null);
  const snap = useLiveSnapshot(live ?? idle);
  const [phase, setPhase] = useState<Phase>('starting');
  const [turns, setTurns] = useState<PartnerTurn[]>([]);
  const [current, setCurrent] = useState<Omit<PartnerTurn, 'answerEndMs'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef(new AbortController());
  const situation = situationById(config.situationId);
  const role = ROLE_LABELS[partner.role];

  const ask = useCallback(
    async (done: PartnerTurn[]) => {
      const engine = engineRef.current;
      if (!engine) return;
      setPhase('thinking');
      setError(null);
      try {
        const segments = engine.getSnapshot().segments;
        const q = await requestNextQuestion({
          mode: partner.mode,
          role: partner.role,
          maxTurns: partner.turns,
          prompt: config.prompt,
          situation: situation?.label,
          speakingContext: config.context,
          source: partner.source,
          turns: done.map((t) => ({ question: t.question, answer: answerText(segments, t) })),
        });
        const askedAtMs = engine.elapsed();
        setCurrent({ question: q.question, basedOn: q.basedOn, askedAtMs, answerStartMs: askedAtMs });
        setPhase('asking');
        await speakQuestion(q, abort.current.signal);
        setCurrent({ question: q.question, basedOn: q.basedOn, askedAtMs, answerStartMs: engine.elapsed() });
        setPhase('answering');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('answering');
      }
    },
    [partner, config.prompt, config.context, situation?.label]
  );

  useEffect(() => {
    let cancelled = false;
    let e: LiveSessionEngine | null = null;
    (async () => {
      const custom = await getCustomTerms().catch(() => []);
      if (cancelled) return;
      const keyterms = mergeKeyterms(custom, buildKeyterms({ prompt: config.prompt }));
      e = new LiveSessionEngine({ mode: 'watch', talkType: config.talkType, prompt: config.prompt, situationId: config.situationId, keyterms });
      engineRef.current = e;
      setLive(e);
      // A voice conversation: no camera.
      await e.start(undefined);
      if (!cancelled) await ask([]);
    })().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      setError(name === 'NotAllowedError' ? 'Vireo needs your microphone to hear your answers. Allow it in your browser’s site settings, then try again.' : `Couldn’t start: ${err instanceof Error ? err.message : String(err)}`);
    });
    const ctl = abort.current;
    return () => {
      cancelled = true;
      ctl.abort();
      if (e && !e.isEnded) void e.abort();
    };
    // One conversation per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishAnswer(endNow: boolean) {
    const engine = engineRef.current;
    if (!current || !engine) return;
    const turn: PartnerTurn = { ...current, answerEndMs: engine.elapsed() };
    const done = [...turns, turn];
    setTurns(done);
    setCurrent(null);
    setPhase('thinking');
    await new Promise((r) => setTimeout(r, ANSWER_SETTLE_MS));
    if (endNow || done.length >= partner.turns) await finish(done);
    else await ask(done);
  }

  async function finish(done: PartnerTurn[]) {
    const engine = engineRef.current;
    if (!engine) return;
    setPhase('ending');
    abort.current.abort();
    if (!done.length) {
      await engine.abort();
      navigate('/warm-up', { replace: true });
      return;
    }
    const id = newId('sess');
    const result = await engine.end(id);
    const convo = buildConversation({ segments: result.segments, pauses: result.pauses, trace: result.take.trace }, done, config.talkType);
    const take = summariseTake(config.prompt, id, result.take.trace, TALK_TYPES[config.talkType].zone, convo.metrics.fillerCount, convo.metrics.durationMs);
    const session: StoredSession = {
      id,
      createdAt: result.startedAt || new Date().toISOString(),
      config,
      segments: convo.segments,
      pauses: convo.pauses,
      transcript: convo.transcript,
      metrics: convo.metrics,
      take: { avgWpm: take.avgWpm, inZoneRatio: take.inZoneRatio, fillersPerMin: take.fillersPerMin },
      newBest: false,
      notesStatus: 'pending',
      likelyFillers: result.likelyFillers,
      camera: null,
      roleplay: { mode: partner.mode, role: partner.role, turns: done, sourceSessionId: partner.sourceSessionId },
    };
    await saveSession(session);
    navigate(`/notes/${id}`, { replace: true });
  }

  const asked = turns.length + (current ? 1 : 0);
  const status =
    phase === 'starting'
      ? 'Getting the microphone ready'
      : phase === 'thinking'
        ? `Your ${role.toLowerCase()} is thinking`
        : phase === 'asking'
          ? `Your ${role.toLowerCase()} is asking`
          : phase === 'answering'
            ? 'Your turn. Take your time.'
            : 'Saving the conversation';

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-container flex-1 flex-col gap-8 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/warm-up" className="rounded-sm text-label text-ink-muted hover:text-ink">
            Leave without saving
          </Link>
          <span className="text-label text-ink-muted">
            {partner.mode === 'qa' ? 'Questions after your talk' : `Practising with a partner: ${role}`}, question {Math.max(1, asked)} of {partner.turns}
          </span>
        </div>

        <section aria-labelledby="partner-h" className="paper-scope flex flex-col gap-5 rounded-lg bg-paper p-7 text-paper-foreground sm:p-10">
          <p id="partner-h" className="m-0 text-label opacity-75">
            {role}
          </p>
          <p aria-live="polite" className="m-0 min-h-[2.4em] font-display text-[clamp(28px,3.6vw,48px)] leading-[1.12] tracking-[-0.02em]" data-testid="partner-question">
            {current?.question ?? (phase === 'thinking' || phase === 'starting' ? '…' : '')}
          </p>
          <p role="status" className="m-0 text-small opacity-75">
            {status}
          </p>
        </section>

        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-4 rounded-md bg-amber-soft p-5">
            <p className="m-0 text-body">{error}</p>
            {phase === 'answering' && !current && snap.status === 'connected' && (
              <Button variant="outline" onClick={() => void ask(turns)}>
                Ask again
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4 rounded-lg bg-surface-100 p-6 sm:flex-row sm:items-end sm:gap-8">
          <div className="min-w-0 flex-1">
            <LiveCaptions captions={snap.captions} placeholder={phase === 'answering' ? 'Answer out loud when you’re ready.' : 'Listen to the question.'} />
          </div>
          <PauseRing pausingMs={phase === 'answering' ? snap.pausingMs : 0} className="self-center sm:self-auto" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 inline-flex items-center gap-2 text-small text-ink-muted">
            <Headphones className="h-4 w-4" aria-hidden="true" />
            Headphones help: words heard while your partner speaks are never counted as yours.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void (current ? finishAnswer(true) : finish(turns))} disabled={phase === 'ending' || phase === 'starting' || (!current && !turns.length)}>
              End the conversation
            </Button>
            <Button size="lg" onClick={() => void finishAnswer(false)} disabled={phase !== 'answering' || !current}>
              <Mic className="h-4 w-4" aria-hidden="true" />
              {turns.length + 1 >= partner.turns ? 'Done, see field notes' : 'Done answering'}
            </Button>
          </div>
        </div>

        {turns.length > 0 && (
          <section aria-labelledby="so-far-h" className="flex flex-col gap-3">
            <h2 id="so-far-h" className="m-0 text-label text-ink-muted">
              So far
            </h2>
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-body">
              {turns.map((t) => (
                <li key={t.askedAtMs}>{t.question}</li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
