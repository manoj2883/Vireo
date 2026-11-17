import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { BREATHING_MS, breathPhase, IN_MS, OUT_MS } from '@/lib/breathing';

/**
 * Confidence mode's guided breathing: a pacing circle that grows as you breathe in and shrinks as
 * you breathe out. With reduced motion the circle stays still and only the words change.
 */
const systemNow = () => Date.now();

export function BreathingWarmUp({ onDone, now = systemNow }: { onDone: () => void; now?: () => number }) {
  const reduce = usePrefersReducedMotion();
  const [start] = useState(now);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(now() - start), 250);
    return () => clearInterval(id);
  }, [now, start]);

  useEffect(() => {
    if (elapsed >= BREATHING_MS) onDone();
  }, [elapsed, onDone]);

  const phase = breathPhase(elapsed);
  const left = Math.max(0, Math.ceil((BREATHING_MS - elapsed) / 1000));

  return (
    <section aria-labelledby="breathe-h" className="flex min-h-[70vh] flex-col items-center justify-center gap-10 text-center">
      <div className="flex flex-col gap-3">
        <h1 id="breathe-h" className="m-0 font-display text-[clamp(36px,4.6vw,60px)] font-normal leading-tight tracking-[-0.02em]">
          A minute to settle in
        </h1>
        <p className="m-0 max-w-[520px] text-body text-ink-muted">Follow the circle. In through your nose while it grows, slowly out while it shrinks.</p>
      </div>
      <div className="flex h-[260px] w-[260px] items-center justify-center" aria-hidden="true">
        <div
          data-testid="breath-circle"
          data-phase={phase}
          className={cn('rounded-full bg-olive/25 shadow-[inset_0_0_0_2px_rgb(var(--olive))]', !reduce && 'transition-[width,height] ease-in-out')}
          style={{
            width: reduce ? 200 : phase === 'in' ? 240 : 110,
            height: reduce ? 200 : phase === 'in' ? 240 : 110,
            transitionDuration: reduce ? undefined : `${phase === 'in' ? IN_MS : OUT_MS}ms`,
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="m-0 font-display text-[32px]">
        {phase === 'in' ? 'Breathe in' : 'Breathe out'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <span className="text-small tabular-nums text-ink-muted">{left} seconds left</span>
        <Button variant="outline" onClick={onDone}>
          I’m ready, start speaking
        </Button>
      </div>
    </section>
  );
}
