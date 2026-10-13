import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { PaceZone } from '@/live/metrics/pace';
import { PACE_MAX, PACE_MIN, pacePercent } from './paceScale';

interface PaceBandProps {
  wpm: number | null;
  zone: PaceZone;
  ghostWpm?: number | null;
  /** Show the rushing state: apricot dot with a ring (shape, not just colour). */
  rushing?: boolean;
  showLegend?: boolean;
  className?: string;
}

/** Live pace as a dot drifting through the target zone, with the best take as a faint ghost. */
export function PaceBand({ wpm, zone, ghostWpm, rushing = false, showLegend = true, className }: PaceBandProps) {
  const zoneLeft = pacePercent(zone.min);
  const zoneWidth = pacePercent(zone.max) - zoneLeft;
  const dot = wpm === null ? null : pacePercent(wpm);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between text-small text-ink-muted">
        <span>Pace</span>
        <span>
          <span className="font-semibold text-ink">{wpm === null ? '—' : wpm}</span> wpm
        </span>
      </div>
      <div
        role="meter"
        aria-label="Speaking pace"
        aria-valuemin={PACE_MIN}
        aria-valuemax={PACE_MAX}
        aria-valuenow={wpm ?? undefined}
        aria-valuetext={wpm === null ? 'Not speaking' : `${wpm} words a minute, ${wpm > zone.max ? 'faster than' : wpm < zone.min ? 'slower than' : 'inside'} your zone`}
        className="relative h-5 rounded-pill bg-surface-200"
      >
        <div
          className="absolute inset-y-0 rounded-pill bg-olive/15 shadow-[inset_0_0_0_1.5px_rgb(var(--olive))]"
          style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}
        />
        {ghostWpm != null && (
          <div
            title="Your best take"
            data-testid="ghost-dot"
            className="absolute top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rounded-pill bg-ink opacity-35"
            style={{ left: `${pacePercent(ghostWpm)}%` }}
          />
        )}
        {dot !== null && (
          <motion.div
            data-testid="pace-dot"
            data-rushing={rushing}
            className={cn('absolute top-1/2 -ml-[13px] -mt-[13px] h-[26px] w-[26px] rounded-pill', rushing ? 'bg-amber' : 'bg-olive')}
            initial={false}
            animate={{
              left: `${dot}%`,
              boxShadow: rushing
                ? '0 0 0 7px rgb(var(--amber) / 0.2), 0 0 0 8.5px rgb(var(--amber))'
                : '0 0 0 6px rgb(var(--olive) / 0.14), 0 0 0 0px rgb(var(--olive) / 0)',
            }}
            transition={{ type: 'spring', stiffness: 170, damping: 24 }}
          />
        )}
      </div>
      {showLegend && (
        <div className="flex justify-between gap-2 text-[13px] text-ink-muted">
          <span>slower</span>
          <span className="text-center">
            {zone.min} to {zone.max}
            {ghostWpm != null ? ', the faint dot is your best take' : ''}
          </span>
          <span>faster</span>
        </div>
      )}
    </div>
  );
}
