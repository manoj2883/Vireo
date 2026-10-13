import { cn } from '@/lib/utils';

/** A pause this long fills the ring: about one full breath. */
export const RING_FULL_MS = 1400;
const CIRC = 2 * Math.PI * 36;

/** Fills in teal while you hold a pause, so silence feels like something you're building. */
export function PauseRing({ pausingMs, size = 112, className }: { pausingMs: number; size?: number; className?: string }) {
  const pausing = pausingMs > 0;
  const fill = Math.min(1, pausingMs / RING_FULL_MS);
  return (
    <div className={cn('flex shrink-0 flex-col items-center gap-2', className)}>
      <svg width={size} height={size} viewBox="0 0 88 88" role="img" aria-label={pausing ? `Pausing, ${(pausingMs / 1000).toFixed(1)} seconds` : 'Speaking'}>
        <circle cx="44" cy="44" r="36" fill="none" className="stroke-surface-200" strokeWidth="6" />
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          className="stroke-sky"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - fill)}
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dashoffset 120ms linear' }}
        />
        <circle cx="44" cy="44" r={pausing ? 6 + 9 * fill : 0} className="fill-sky" opacity="0.75" />
      </svg>
      <span className="text-small tabular-nums text-ink-muted" aria-hidden="true">
        {pausing ? `Pausing ${(pausingMs / 1000).toFixed(1)} s` : 'Pause'}
      </span>
    </div>
  );
}
