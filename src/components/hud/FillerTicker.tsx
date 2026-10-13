import { cn } from '@/lib/utils';

/** How long the last filler word stays on screen. */
export const LAST_FILLER_MS = 1600;

interface FillerTickerProps {
  count: number;
  /** ms since the last filler, or null if none yet. */
  sinceLastMs: number | null;
  lastFiller?: string | null;
  className?: string;
}

/** Running filler count with triangle ticks that fade. No buzzing, no red. */
export function FillerTicker({ count, sinceLastMs, lastFiller, className }: FillerTickerProps) {
  const fresh = sinceLastMs === null ? 0 : Math.max(0.25, 1 - sinceLastMs / 2500);
  const ticks = [0, 1, 2].map((i) => (count > i ? (i === 0 ? fresh : i === 1 ? 0.45 : 0.2) : 0.12));
  const showWord = lastFiller && sinceLastMs !== null && sinceLastMs < LAST_FILLER_MS;
  return (
    <div
      className={cn('flex h-[52px] items-center gap-3.5 rounded-pill bg-surface-100/90 px-5', className)}
      role="status"
      aria-label={`${count} ${count === 1 ? 'filler' : 'fillers'} so far`}
    >
      <span className="text-small text-ink-muted" aria-hidden="true">
        Fillers
      </span>
      <span className="font-display text-[30px] leading-none" aria-hidden="true">
        {count}
      </span>
      <span className="flex items-end gap-1.5" aria-hidden="true">
        {ticks.map((o, i) => (
          <span
            key={i}
            className="h-0 w-0 border-x-[7px] border-b-[12px] border-x-transparent border-b-amber transition-opacity duration-300"
            style={{ opacity: o }}
          />
        ))}
      </span>
      <span className="min-w-[108px] font-display text-lg italic text-amber" aria-hidden="true">
        {showWord ? `“${lastFiller}”` : ''}
      </span>
    </div>
  );
}
