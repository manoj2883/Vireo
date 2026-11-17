import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FIRST_QUESTION, requestInterviewTurn, SLOT_LABELS, SLOTS, type InterviewReply, type InterviewTurn } from '@/session/interviewApi';
import { newId, saveStory, type StoredStory } from '@/storage/localDb';

const TAGS = ['Interview', 'Research', 'Pitch', 'Talk', 'Toast'];

/**
 * "Build a story with me": a text interview, one question at a time, until the seven story slots
 * are filled from the speaker's own answers. Then a 30-second version to save or rehearse.
 */
export function StoryInterviewer({ onClose, onSaved, onRehearse }: { onClose: () => void; onSaved: () => void; onRehearse: (story: StoredStory) => void }) {
  const ids = { title: useId(), answer: useId(), tag: useId(), heading: useId() };
  const [title, setTitle] = useState('');
  const [turns, setTurns] = useState<InterviewTurn[]>([{ role: 'coach', text: FIRST_QUESTION }]);
  const [answer, setAnswer] = useState('');
  const [reply, setReply] = useState<InterviewReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState('Interview');
  const [saved, setSaved] = useState<StoredStory | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy && !reply?.done) answerRef.current?.focus();
  }, [busy, reply?.done, turns.length]);

  async function send() {
    const text = answer.trim();
    if (!text || busy) return;
    const next: InterviewTurn[] = [...turns, { role: 'speaker', text }];
    setTurns(next);
    setAnswer('');
    setBusy(true);
    setError(null);
    try {
      const r = await requestInterviewTurn({ title: title.trim() || undefined, turns: next });
      setReply(r);
      if (!r.done && r.question) setTurns((t) => [...t, { role: 'coach', text: r.question! }]);
    } catch (err) {
      // Put the answer back so nothing typed is lost.
      setTurns(turns);
      setAnswer(text);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<StoredStory | null> {
    if (!reply?.story) return null;
    if (saved) return saved;
    const now = new Date().toISOString();
    const story: StoredStory = {
      id: newId('story'),
      kind: 'story',
      title: (title.trim() || reply.story.title).slice(0, 120),
      tag,
      length: '30 seconds',
      gist: reply.filled.lesson ?? '',
      keyPoints: reply.story.keyPoints,
      script: reply.story.script,
      createdAt: now,
      updatedAt: now,
    };
    await saveStory(story);
    setSaved(story);
    onSaved();
    return story;
  }

  const filled = reply?.filled;
  const count = filled ? SLOTS.filter((s) => filled[s]).length : 0;

  return (
    <section aria-labelledby={ids.heading} className="flex flex-col gap-6 rounded-lg bg-surface-100 p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={ids.heading} className="m-0 font-display text-[36px] font-normal leading-tight tracking-[-0.02em]">
          Build a story with me
        </h2>
        <Button variant="link" className="h-11 px-0" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="m-0 max-w-[720px] text-body text-ink-muted">
        Vireo asks one question at a time and pushes for the scene, not the summary. Every part of the story comes from your own answers. They go to the field notes model to pick the next question; the story is saved only on this device.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.title} className="text-[15px] text-ink-muted">
          Working title (optional)
        </label>
        <input id={ids.title} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="min-h-11 max-w-[520px] rounded-md border-0 bg-surface-000 px-4 text-[17px]" />
      </div>

      <ul aria-label="Story parts" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {SLOTS.map((s) => {
          const on = Boolean(filled?.[s]);
          return (
            <li key={s} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3.5 text-[14px]', on ? 'bg-olive text-olive-foreground' : 'bg-surface-000 text-ink-muted')}>
              {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {SLOT_LABELS[s]}
              <span className="sr-only">{on ? ': found in your answers' : ': not yet'}</span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 -mt-3 text-small text-ink-muted">
        {count} of {SLOTS.length} found in your answers.
      </p>

      <ol aria-label="Interview" aria-live="polite" className="m-0 flex list-none flex-col gap-3 p-0">
        {turns.map((t, i) => (
          <li key={i} className={cn('max-w-[680px] rounded-md px-4 py-3 text-body', t.role === 'coach' ? 'paper-scope bg-paper font-display text-[20px] text-paper-foreground' : 'self-end bg-surface-000')}>
            <span className="sr-only">{t.role === 'coach' ? 'Vireo asks: ' : 'You said: '}</span>
            {t.text}
          </li>
        ))}
        {busy && (
          <li role="status" className="text-small text-ink-muted">
            Thinking of the next question
          </li>
        )}
      </ol>

      {error && (
        <p role="alert" className="m-0 text-small text-amber">
          {error} Your answer is still in the box.
        </p>
      )}

      {!reply?.done && (
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.answer} className="text-[15px] text-ink-muted">
            Your answer
          </label>
          <textarea
            id={ids.answer}
            ref={answerRef}
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
            }}
            className="w-full max-w-[720px] resize-y rounded-md border-0 bg-surface-000 p-4 text-[17px]"
          />
          <div>
            <Button onClick={send} disabled={busy || !answer.trim()}>
              Answer
            </Button>
          </div>
        </div>
      )}

      {reply?.done && reply.story && (
        <div className="paper-scope flex flex-col gap-4 rounded-lg bg-paper p-6 text-paper-foreground sm:p-8" data-testid="interview-story">
          <p className="m-0 text-label opacity-75">Your 30-second version, in your words</p>
          <p className="m-0 font-display text-[clamp(24px,2.6vw,32px)] leading-[1.3]">{reply.story.script}</p>
          <p className="m-0 text-small opacity-75">Key points Vireo will check when you rehearse: {reply.story.keyPoints.join(', ')}.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor={ids.tag} className="flex flex-col gap-1 text-[15px] opacity-80">
              Tag
              <select id={ids.tag} value={tag} onChange={(e) => setTag(e.target.value)} className="min-h-11 rounded-md border-0 bg-surface-000 px-3 text-foreground">
                {TAGS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={() => void save()} disabled={Boolean(saved)}>
              {saved ? 'Saved to your Story Bank' : 'Save to Story Bank'}
            </Button>
            <Button
              onClick={async () => {
                const s = await save();
                if (s) onRehearse(s);
              }}
              className="bg-paper-foreground text-paper hover:bg-paper-foreground/90"
            >
              Rehearse this story
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
