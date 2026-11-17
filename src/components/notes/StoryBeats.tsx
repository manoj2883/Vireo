import { clock } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { StoryBeats as Beats } from '@/types/fieldNotes';
import { BEAT_LABELS, BEAT_ORDER } from '@/lib/storyBeats';

/** The story beat strip: which of the five beats are in the answer, and what to add for those missing. */
export function StoryBeats({ beats, dropped, onPlay }: { beats: Beats; dropped?: number; onPlay: (ms: number) => void }) {
  const present = new Map(beats.present.map((b) => [b.kind, b]));
  const missing = new Map(beats.missing.map((m) => [m.kind, m]));
  return (
    <section aria-labelledby="beats-h" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="beats-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
          Story beats
        </h2>
        <span className="font-display text-lg italic text-ink-muted">
          {present.size} of {BEAT_ORDER.length} in your answer. Each is pinned on the drawing above.
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 p-0">
        {BEAT_ORDER.map((kind) => {
          const p = present.get(kind);
          const m = missing.get(kind);
          return (
            <li key={kind} data-beat={kind} data-present={Boolean(p)} className={cn('flex flex-col gap-2 rounded-lg p-5', p ? 'bg-olive-soft' : 'shadow-[inset_0_0_0_1.5px_rgb(var(--amber))]')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-label">{BEAT_LABELS[kind].label}</span>
                <span className={cn('text-small', p ? 'text-ink-muted' : 'text-amber')}>{p ? `at ${clock(p.startMs)}` : 'Missing'}</span>
              </span>
              {p ? (
                <>
                  <q className="font-display text-[19px] italic leading-[1.35]">{p.quote}</q>
                  <button type="button" onClick={() => onPlay(p.startMs)} className="min-h-11 self-start rounded-sm text-small font-semibold text-olive underline-offset-4 hover:underline">
                    Show in transcript<span className="sr-only">: {BEAT_LABELS[kind].label}</span>
                  </button>
                </>
              ) : (
                <>
                  <span className="text-small text-ink-muted">{BEAT_LABELS[kind].meaning}</span>
                  {m?.suggestion && (
                    <span className="text-[15px] leading-[22px]">
                      <span className="font-semibold">Try: </span>
                      {m.suggestion}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {(dropped ?? 0) > 0 && (
        <p className="m-0 text-small text-ink-muted">
          {dropped} {dropped === 1 ? 'beat was' : 'beats were'} left out because the quote didn’t match your words.
        </p>
      )}
    </section>
  );
}
