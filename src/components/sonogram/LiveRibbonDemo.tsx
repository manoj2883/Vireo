import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { Sonogram } from './Sonogram';
import { DEMO_PAUSES, DEMO_SEGMENTS } from './demo';

const LOOP_MS = DEMO_SEGMENTS[DEMO_SEGMENTS.length - 1].endMs + 2000;

/** Plays the demo sentence through the scrolling ribbon on a loop (foundations check only). */
export function LiveRibbonDemo() {
  const reduce = usePrefersReducedMotion();
  const [now, setNow] = useState(reduce ? LOOP_MS - 2000 : 0);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      setNow((t - start) % LOOP_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce]);

  // Treat the pause as open while the clock is inside it, the way it arrives live.
  const pauses = DEMO_PAUSES.map((p) => (now >= p.startMs && now < (p.endMs ?? Infinity) ? { startMs: p.startMs } : p));

  return (
    <div className="h-[120px] rounded-md bg-surface-100 px-4 py-2">
      <Sonogram mode="scrolling" segments={DEMO_SEGMENTS} pauses={pauses} nowMs={now} label="Live sonogram ribbon demo" />
    </div>
  );
}
