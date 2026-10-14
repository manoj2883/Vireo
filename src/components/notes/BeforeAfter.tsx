import { useId, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildShareCard, saveBlob, shareCardPng } from '@/lib/shareCard';
import { Sonogram } from '@/components/sonogram';
import { compareTakes, describeChange } from '@/lib/compare';
import { cn } from '@/lib/utils';
import type { StoredSession } from '@/storage/localDb';

/** Before and after: the previous take and this one, on the same time scale, with what changed. */
export function BeforeAfter({ before, after }: { before: StoredSession; after: StoredSession }) {
  const { changes, fix } = compareTakes(before, after);
  const [includeWords, setIncludeWords] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const wordsId = useId();

  async function saveCard() {
    setCardError(null);
    try {
      saveBlob(await shareCardPng(buildShareCard(before, after, { includeWords })), 'vireo-before-and-after.png');
    } catch (err) {
      setCardError(err instanceof Error ? err.message : String(err));
    }
  }
  // One shared window, so a shorter take really looks shorter.
  const window = { startMs: 0, endMs: Math.max(before.metrics.durationMs, after.metrics.durationMs, 1000) };
  const takes: [string, StoredSession][] = [
    ['Before', before],
    ['After', after],
  ];
  return (
    <section aria-labelledby="ba-h" className="flex flex-col gap-6">
      <h2 id="ba-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
        Before and after
      </h2>

      {fix && (
        <div data-testid="fix-result" className={cn('flex flex-col gap-2 rounded-lg p-6', fix.achieved ? 'bg-olive-soft' : 'bg-amber-soft')}>
          <p className="m-0 flex items-center gap-2 text-label">
            {fix.achieved ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
            Your fix: {fix.instruction} <span className="font-semibold">{fix.achieved ? 'Yes, you did it.' : 'Not yet.'}</span>
          </p>
          <blockquote className="m-0 font-display text-[22px] italic leading-[1.4]">“{fix.evidence}”</blockquote>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-surface-100 px-2 py-4 sm:px-6">
        {takes.map(([label, s]) => (
          <div key={label} className="flex flex-col gap-1">
            <p className="m-0 px-2 text-label text-ink-muted">{label}</p>
            <Sonogram
              segments={s.segments}
              pauses={s.pauses}
              window={window}
              showWordLabels={false}
              showTimeAxis={label === 'After'}
              labelPauses={false}
              label={`${label}: ${s.segments.length} words, ${s.metrics.fillerCount} fillers, ${s.metrics.pauseCount} pauses, over ${Math.round(s.metrics.durationMs / 1000)} seconds.`}
            />
          </div>
        ))}
      </div>

      {changes.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6 p-0" aria-label="What changed">
          {changes.map((c) => (
            <li key={c.key} className="flex flex-col gap-1 border-t border-line pt-3">
              <span className="text-label text-ink-muted">{c.label}</span>
              <span className="font-display text-[30px] leading-none tabular-nums">
                {c.format(c.before)} <span aria-hidden="true">→</span> {c.format(c.after)}
              </span>
              <span className={cn('text-small', c.improvement > 0 ? 'text-olive' : c.improvement < 0 ? 'text-amber' : 'text-ink-muted')}>
                {c.improvement > 0 ? 'Better. ' : c.improvement < 0 ? 'Worse. ' : ''}
                <span className="sr-only">{describeChange(c)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" size="lg" onClick={saveCard}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Save a share card
        </Button>
        <label htmlFor={wordsId} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-label">
          <input id={wordsId} type="checkbox" className="h-5 w-5 accent-[rgb(var(--olive))]" checked={includeWords} onChange={(e) => setIncludeWords(e.target.checked)} />
          Include my words
        </label>
        <span className="text-small text-ink-muted">A 1080×1350 image, made on this device. Your words stay off it unless you tick the box.</span>
        {cardError && (
          <p role="alert" className="m-0 w-full text-small text-amber">
            {cardError}
          </p>
        )}
      </div>
    </section>
  );
}
