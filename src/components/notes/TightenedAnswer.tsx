import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { wordDiff } from '@/lib/wordDiff';

interface TightenedAnswerProps {
  original: string;
  tightened?: { script: string; mainPoint: string; status: 'ready' | 'failed'; error?: string };
  pending: boolean;
  onRetry: () => void;
}

/** A script with pause marks drawn in sky, so it reads aloud the way it should be said. */
export function Script({ script, className }: { script: string; className?: string }) {
  return (
    <p className={cn('m-0 font-display', className)}>
      {script.split(/(\s*\/\s*)/).map((part, i) =>
        part.trim() === '/' ? (
          <span key={i}>
            {' '}
            <span className="mx-0.5 font-sans text-sky" aria-label="pause">
              /
            </span>{' '}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

/** "Your answer, tightened": what you said, cut and reordered, to read aloud on the next take. */
export function TightenedAnswer({ original, tightened, pending, onRetry }: TightenedAnswerProps) {
  const [showChanges, setShowChanges] = useState(false);
  const toggleId = useId();
  return (
    <section aria-labelledby="tight-h" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="tight-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
          Your answer, tightened
        </h2>
        {tightened?.status === 'ready' && (
          <label htmlFor={toggleId} className="inline-flex cursor-pointer items-center gap-2.5 text-label">
            <Switch id={toggleId} checked={showChanges} onCheckedChange={setShowChanges} />
            Show changes
          </label>
        )}
      </div>
      {pending && !tightened && <p className="m-0 text-ink-muted">Tightening your answer, using only your words</p>}
      {tightened?.status === 'failed' && (
        <div role="alert" className="flex flex-wrap items-center gap-4">
          <p className="m-0 text-body text-ink-muted">{tightened.error ?? 'Couldn’t tighten this answer.'}</p>
          <Button variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {tightened?.status === 'ready' &&
        (showChanges ? (
          <p data-testid="tightened-changes" className="m-0 max-w-[900px] text-[19px] leading-[32px]">
            {wordDiff(original, tightened.script).map((t, i) =>
              t.op === 'pause' ? (
                <span key={i} className="mx-1 text-sky" aria-label="pause">
                  /{' '}
                </span>
              ) : t.op === 'removed' ? (
                <del key={i} className="text-ink-muted decoration-amber decoration-2">
                  {t.text}{' '}
                </del>
              ) : t.op === 'added' ? (
                <ins key={i} className="decoration-olive decoration-2 underline-offset-4">
                  {t.text}{' '}
                </ins>
              ) : (
                <span key={i}>{t.text} </span>
              )
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg bg-surface-100 p-6 sm:p-8">
            <Script script={tightened.script} className="max-w-[900px] text-[clamp(22px,2.4vw,30px)] leading-[1.45]" />
            <p className="m-0 text-small text-ink-muted">
              Read it aloud on your next take. The <span className="text-sky">/</span> marks are pauses. Every word is one you said; only small linking words are added.
            </p>
          </div>
        ))}
    </section>
  );
}
