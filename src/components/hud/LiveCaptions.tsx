import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { CaptionView, CaptionWord } from '@/live/metrics/paragraphs';

function Words({ words }: { words: readonly CaptionWord[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span
          key={`${Math.round(w.startMs)}-${i}`}
          data-interim={w.interim || undefined}
          className={cn(w.kind === 'filler' && 'italic text-amber', w.interim && 'text-ink-muted transition-colors duration-300')}
        >
          {w.text}{' '}
        </span>
      ))}
    </>
  );
}

/**
 * Live captions as paragraphs: the current one grows at the bottom (interim words lighter),
 * the previous one sits faded above. Older lines glide up as new ones arrive.
 */
export function LiveCaptions({ captions, placeholder, className }: { captions: CaptionView; placeholder: string; className?: string }) {
  const empty = !captions.previous && captions.current.length === 0;
  return (
    <div
      className={cn('relative flex max-h-[176px] flex-col justify-end overflow-hidden sm:max-h-[208px]', className)}
      // Fade the oldest line out at the top edge rather than cutting it.
      style={{ maskImage: 'linear-gradient(to bottom, transparent 0, black 40px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 40px)' }}
      aria-live="off"
    >
      <motion.div layout="position" transition={{ type: 'spring', stiffness: 260, damping: 32 }} className="flex flex-col gap-3">
        {empty ? (
          <p className="m-0 font-display text-[22px] leading-[30px] text-ink-muted sm:text-[26px] sm:leading-[34px]">{placeholder}</p>
        ) : (
          <>
            {captions.previous && (
              <p data-testid="caption-previous" className="m-0 max-w-[900px] font-display text-[18px] leading-[26px] opacity-45 sm:text-[20px] sm:leading-[28px]">
                <Words words={captions.previous} />
              </p>
            )}
            <p data-testid="caption-current" className="m-0 max-w-[900px] font-display text-[22px] leading-[30px] sm:text-[26px] sm:leading-[34px]">
              <Words words={captions.current} />
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
