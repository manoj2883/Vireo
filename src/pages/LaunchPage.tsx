import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { BookOpen, Cpu, Gauge, Lock, PlayCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VireoWordmark } from '@/components/brand/VireoMark';
import { ThemeToggle } from '@/theme/ThemeToggle';
import { HeroSonogram } from '@/components/sonogram/HeroSonogram';
import { PaceBand } from '@/components/hud/PaceBand';
import { PauseRing } from '@/components/hud/PauseRing';
import { FillerTicker } from '@/components/hud/FillerTicker';
import { DemoResting } from '@/components/DemoResting';
import { useDemoHealth } from '@/lib/health';

const REPO_URL = 'https://github.com/manoj2883/Vireo';

const FEATURES = [
  { icon: Users, tone: 'text-olive', title: 'Audience mode', body: 'After your answer, Vireo asks the follow-up a sharp listener would ask, then coaches how you handled it.' },
  { icon: BookOpen, tone: 'text-olive', title: 'Story Bank', body: 'Keep your best stories ready. Rehearse one and Vireo checks you hit its key points, not just how you sounded.' },
  { icon: Gauge, tone: 'text-sky', title: 'Ghost pace', body: 'A faint marker shows where you were on your best take, so every rehearsal is a race against yourself.' },
  { icon: PlayCircle, tone: 'text-sky', title: 'Notes on the moment', body: 'Every note is pinned to the second it’s about, with the exact words you said.' },
  { icon: Lock, tone: 'text-amber', title: 'Private by design', body: 'Video is analysed live and never stored. Sessions are saved only on your device; your transcript is sent to write the field notes.' },
  { icon: Cpu, tone: 'text-amber', title: 'Your choice of model', body: 'Deepgram for live transcription with real word timings, and Gemini, Claude or any OpenRouter model for your notes.' },
];

/** Launch page (`/`). */
export function LaunchPage() {
  const resting = useDemoHealth() === 'resting';
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-container items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <VireoWordmark />
        <nav aria-label="Site" className="flex items-center gap-2">
          <a href={REPO_URL} className="hidden rounded-sm px-3 py-2 text-label text-ink-muted hover:text-ink sm:inline">
            GitHub
          </a>
          <ThemeToggle />
          <Button asChild variant="outline">
            <Link to="/app">Open Vireo</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto flex max-w-container flex-col gap-24 px-4 pb-16 pt-12 sm:px-8 sm:pt-20">
        <section className="flex flex-col gap-10">
          {resting && <DemoResting className="max-w-[760px]" />}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            className="m-0 max-w-[1040px] font-display text-[clamp(52px,8.4vw,124px)] font-normal leading-[0.95] tracking-[-0.035em]"
          >
            See your voice the way your audience hears it.
          </motion.h1>
          <div className="flex flex-wrap items-end justify-between gap-8">
            <p className="m-0 max-w-[560px] text-[20px] leading-[31px] text-ink-muted">
              Vireo is a real-time speech coach. It listens while you practise, shows pace, fillers and pauses at a glance, and backs every note with the exact words you said.
            </p>
            <div className="flex flex-wrap gap-3">
              {resting ? (
                <Button size="lg" disabled>
                  Try a session
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link to="/warm-up">Try a session</Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <a href={REPO_URL}>View the code</a>
              </Button>
            </div>
          </div>
          <HeroSonogram />
        </section>

        <section aria-labelledby="cues-h" className="flex flex-col gap-12">
          <div className="flex max-w-[760px] flex-col gap-4">
            <h2 id="cues-h" className="m-0 font-display text-[clamp(40px,5vw,68px)] font-normal leading-none tracking-[-0.03em]">
              While you speak, glance. Don’t read.
            </h2>
            <p className="m-0 text-[19px] leading-[30px] text-ink-muted">
              Live cues use position, shape and colour, so you can see them from the corner of your eye without losing your thread.
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-10 gap-y-14">
            <Cue title="Pace you can feel" body="A dot drifts through your target zone. Rush and it grows a ring and turns apricot. The faint dot is your best previous take, so you can race yourself.">
              <PaceBand wpm={184} zone={{ min: 130, max: 160 }} ghostWpm={146} rushing showLegend={false} />
            </Cue>
            <Cue title="Pauses that count" body="A ring fills while you hold silence. It turns a pause from dead air into something you’re building, which is how good speakers use it.">
              <PauseRing pausingMs={1100} size={96} />
            </Cue>
            <Cue title="Fillers, quietly counted" body="Each “um”, “like” or “so basically” leaves a small mark that fades. No buzzing, no red. You notice, and you keep going.">
              <FillerTicker count={4} sinceLastMs={400} lastFiller="so basically" className="w-fit" />
            </Cue>
          </div>
        </section>

        <section aria-labelledby="moment-h" className="flex flex-col gap-12">
          <h2 id="moment-h" className="m-0 max-w-[900px] font-display text-[clamp(40px,5vw,68px)] font-normal leading-none tracking-[-0.03em]">
            Most coaches give you a score. Vireo gives you the moment.
          </h2>
          <div className="grid items-start gap-8 md:grid-cols-[2fr_3fr]">
            <div className="flex flex-col gap-4 rounded-lg p-7 shadow-[inset_0_0_0_1px_rgb(var(--line))]">
              <p className="m-0 text-label text-ink-muted">A typical report</p>
              <dl className="m-0 flex flex-col">
                {[
                  ['Pacing', '6 / 10'],
                  ['Filler words', '14'],
                  ['Clarity', 'Good'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line/60 py-3">
                    <dt>{k}</dt>
                    <dd className="m-0 font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 font-display text-lg italic text-ink-muted">Which part was too fast? Which fillers? You’ll have to guess.</p>
            </div>
            <article className="paper-scope flex flex-col gap-4 rounded-lg bg-paper p-7 text-paper-foreground shadow-lift sm:p-9">
              <p className="m-0 flex items-center gap-3">
                <span className="rounded-pill bg-paper-amber px-3 py-1 text-label">Fix next</span>
                <span className="text-small opacity-75">A Vireo field note</span>
              </p>
              <h3 className="m-0 font-display text-[34px] font-medium leading-[38px] tracking-[-0.01em]">You rushed your result.</h3>
              <p className="m-0 text-body opacity-85">
                Your pace climbed to 184 wpm the moment you reached the finding, when your listener most needed time to take it in.
              </p>
              <blockquote className="m-0 flex gap-4 rounded-md bg-surface-200/60 px-5 py-4 dark:bg-surface-000/10">
                <span className="text-small opacity-75">2:14</span>
                <span className="text-[17px] leading-[27px]">
                  “and <mark className="rounded-sm bg-paper-amber px-0.5 italic text-inherit">so basically</mark> the answers it refused were the right ones to refuse, and{' '}
                  <mark className="rounded-sm bg-paper-amber px-0.5 italic text-inherit">um</mark> that’s the main thing”
                </span>
              </blockquote>
              <p className="m-0 text-small opacity-75">Quote checked against your transcript</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="features-h" className="flex flex-col gap-14">
          <h2 id="features-h" className="m-0 max-w-[760px] font-display text-[clamp(40px,5vw,68px)] font-normal leading-none tracking-[-0.03em]">
            Built for the talks that matter to you.
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-16 p-0">
            {FEATURES.map((f) => (
              <li key={f.title} className="grid grid-cols-[44px_minmax(0,1fr)] gap-5 border-t border-line py-7">
                <f.icon className={`h-9 w-9 ${f.tone}`} strokeWidth={1.6} aria-hidden="true" />
                <div>
                  <h3 className="m-0 text-heading">{f.title}</h3>
                  <p className="m-0 mt-2 text-[16px] leading-[25px] text-ink-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-10 border-t border-line pt-16">
          <h2 className="m-0 font-display text-[clamp(56px,8vw,116px)] font-normal leading-[0.95] tracking-[-0.035em]">Practise once more.</h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/app">Start practising</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={REPO_URL}>Star on GitHub</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-container flex-wrap justify-between gap-4 border-t border-line px-4 py-8 text-small text-ink-muted sm:px-8">
        <span>Open source under the MIT licence.</span>
        <span className="flex gap-5">
          <a href="https://github.com/manoj2883" className="rounded-sm hover:text-ink">
            GitHub
          </a>
        </span>
      </footer>
    </div>
  );
}

function Cue({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-h-[112px] items-center" aria-hidden="true">
        <div className="w-full">{children}</div>
      </div>
      <h3 className="m-0 text-heading">{title}</h3>
      <p className="m-0 text-[16px] leading-[25px] text-ink-muted">{body}</p>
    </div>
  );
}
