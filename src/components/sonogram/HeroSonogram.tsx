import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sonogram } from './Sonogram';
import { DEMO_ANNOTATIONS, DEMO_LABEL, DEMO_PAUSES, DEMO_SEGMENTS } from './demo';

/** The launch page's signature moment: one sentence drawn the way field guides draw birdsong. */
export function HeroSonogram() {
  const [run, setRun] = useState(0);
  return (
    <figure className="m-0 rounded-lg bg-surface-100 px-3 pb-5 pt-6 sm:px-7 sm:pt-8">
      <Sonogram
        mode="reveal"
        revealKey={run}
        segments={DEMO_SEGMENTS}
        pauses={DEMO_PAUSES}
        annotations={DEMO_ANNOTATIONS}
        label={DEMO_LABEL}
      />
      <figcaption className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
        <span className="font-display text-lg italic text-ink-muted">
          One sentence, drawn the way field guides draw birdsong.
        </span>
        <Button variant="secondary" size="sm" className="min-h-11 bg-surface-200" onClick={() => setRun((r) => r + 1)}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Replay
        </Button>
      </figcaption>
    </figure>
  );
}
