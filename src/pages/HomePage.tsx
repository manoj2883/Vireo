import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/theme/ThemeProvider';
import { THEME_NAMES } from '@/theme/themes';
import { Sonogram } from '@/components/sonogram';
import { LiveRibbonDemo } from '@/components/sonogram/LiveRibbonDemo';
import { DEMO_ANNOTATIONS, DEMO_LABEL, DEMO_PAUSES, DEMO_SEGMENTS } from '@/components/sonogram/demo';

const SWATCHES: { token: string; className: string; means: string }[] = [
  { token: 'surface-000', className: 'bg-surface-000', means: 'Page ground' },
  { token: 'surface-100', className: 'bg-surface-100', means: 'Panels, camera frame' },
  { token: 'surface-200', className: 'bg-surface-200', means: 'Tracks and wells' },
  { token: 'line', className: 'bg-line', means: 'Hairlines' },
  { token: 'ink', className: 'bg-ink', means: 'Text, paper in dark' },
  { token: 'ink-muted', className: 'bg-ink-muted', means: 'Secondary text' },
  { token: 'olive', className: 'bg-olive', means: 'Speech, on target' },
  { token: 'amber', className: 'bg-amber', means: 'Fillers, rushing' },
  { token: 'amber-soft', className: 'bg-amber-soft', means: 'Filler highlight' },
  { token: 'sky', className: 'bg-sky', means: 'Pauses' },
  { token: 'alert', className: 'bg-alert', means: 'Recording dot only' },
];

/**
 * Home (`/app`). Until Phase 5 builds the real Home, this page doubles as the
 * foundations check: tokens, type and controls in the current theme.
 */
export function HomePage() {
  const { theme } = useTheme();
  const [demoOn, setDemoOn] = useState(true);
  const switchId = useId();

  return (
    <div className="flex flex-col gap-20">
      <section className="flex flex-col gap-6">
        <p className="text-ink-muted">Theme: {THEME_NAMES[theme]}</p>
        <h1 className="max-w-[16ch] font-display text-[clamp(44px,6.4vw,92px)] font-normal leading-[0.96] tracking-[-0.035em]">
          Your progress will be drawn here.
        </h1>
        <p className="max-w-[520px] text-[19px] leading-[30px] text-ink-muted">
          Home fills in once you have sessions. For now, start one, or open the existing session screen.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/warm-up">New session</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/session">Open the current session screen</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="tokens-h" className="flex flex-col gap-6 border-t border-line pt-10">
        <h2 id="tokens-h" className="font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
          Foundations check
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {SWATCHES.map((s) => (
            <li key={s.token} className="flex flex-col gap-2">
              <span className={`h-16 rounded-md shadow-[inset_0_0_0_1px_rgb(var(--line))] ${s.className}`} />
              <span className="text-label">{s.token}</span>
              <span className="text-small text-ink-muted">{s.means}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-6">
          <h3 className="text-heading">Sonogram</h3>
          <div className="rounded-lg bg-surface-100 p-4 sm:p-6">
            <Sonogram segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} annotations={DEMO_ANNOTATIONS} label={DEMO_LABEL} />
          </div>
          <LiveRibbonDemo />
          <div className="grid w-full max-w-[460px] grid-cols-2 gap-4">
            <div className="rounded-[20px] bg-surface-100 p-[18px]">
              <Sonogram variant="mini" segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} />
            </div>
            <div className="rounded-[20px] bg-surface-100 p-[18px]">
              <Sonogram variant="mini" segments={DEMO_SEGMENTS.filter((s) => s.kind !== 'filler')} />
            </div>
          </div>
        </div>

        <div className="grid gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <p className="font-display text-display-l">Clear story. Rushed ending.</p>
            <p className="font-display text-note-title">You rushed your result.</p>
            <p className="font-display text-annotation italic text-ink-muted">a pause that landed</p>
            <p className="font-display text-metric">82</p>
          </div>
          <div className="flex flex-col gap-4">
            <p className="text-heading">Pauses that count</p>
            <p className="text-body">
              Vireo listens while you practise and backs every note with the exact words you said.
            </p>
            <p className="text-small text-ink-muted">Rehearsed yesterday, 146 wpm</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="end">End and see field notes</Button>
            </div>
            <div className="flex items-center gap-3">
              <Switch id={switchId} checked={demoOn} onCheckedChange={setDemoOn} />
              <label htmlFor={switchId} className="text-label">
                Live captions
              </label>
            </div>
            <div className="rounded-lg bg-paper p-6 text-paper-foreground">
              <p className="text-label">Fix next</p>
              <p className="font-display text-note-title">You rushed your result.</p>
              <p className="mt-2 text-body">
                “the answers it refused were the{' '}
                <mark className="rounded-sm bg-amber-soft px-1 text-inherit">um</mark> right ones to refuse”
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
