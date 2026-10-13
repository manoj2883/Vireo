import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TALK_TYPES, type TalkType } from '@/live/metrics/pace';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type SessionConfig, type WarmUpPreset } from '@/session/config';
import { listStories, type StoredStory } from '@/storage/localDb';
import { usePreviewMedia } from '@/components/hud/usePreviewMedia';

/** Warm-up (`/warm-up`): what you're saying, how Vireo should coach, and a camera check. */
export function WarmUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const preset = (location.state as { preset?: WarmUpPreset } | null)?.preset;
  const [config, setConfig] = useState<SessionConfig>(() => ({ ...DEFAULT_CONFIG, ...(loadConfig() ?? {}), ...(preset ?? {}) }));
  const [stories, setStories] = useState<StoredStory[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state: preview, levels } = usePreviewMedia(videoRef);
  const ids = { prompt: useId(), mode: useId(), audience: useId(), story: useId(), face: useId(), privacy: useId() };

  useEffect(() => {
    listStories('story').then(setStories).catch(() => setStories([]));
  }, []);

  // A story chosen from the bank fills an empty prompt with its title.
  useEffect(() => {
    if (!config.storyId || config.prompt.trim()) return;
    const story = stories.find((s) => s.id === config.storyId);
    if (story) setConfig((c) => ({ ...c, prompt: story.title }));
  }, [config.storyId, config.prompt, stories]);

  const set = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const talk = TALK_TYPES[config.talkType];
  const story = stories.find((s) => s.id === config.storyId);
  const canStart = config.prompt.trim().length > 0;

  function start() {
    if (!canStart) return;
    saveConfig({ ...config, prompt: config.prompt.trim() });
    navigate('/session');
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="-mt-4 flex flex-wrap items-center justify-between gap-4">
        <Link to="/app" className="inline-flex h-11 items-center gap-2 rounded-sm text-label text-ink-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
        <span className="text-label font-normal text-ink-muted">Warm-up, then you speak</span>
      </div>

      <div className="flex flex-wrap gap-12">
        <section className="flex min-w-0 flex-[999_1_540px] flex-col gap-10">
          <div className="flex flex-col gap-3.5">
            <label htmlFor={ids.prompt} className="text-ink-muted">
              What are you answering or presenting?
            </label>
            <textarea
              id={ids.prompt}
              rows={2}
              value={config.prompt}
              onChange={(e) => set('prompt', e.target.value)}
              placeholder="Tell me about your research and why it matters."
              className="w-full resize-none border-0 border-b-[1.5px] border-line bg-transparent pb-3 font-display text-[clamp(32px,4.2vw,56px)] leading-[1.06] tracking-[-0.02em] text-foreground placeholder:text-ink-muted/70 focus-visible:outline-offset-4"
            />
            <span className="text-[15px] text-ink-muted">Vireo uses this to check that your answer stays on point.</span>
          </div>

          <fieldset className="m-0 flex flex-col gap-3.5 border-0 p-0">
            <legend className="mb-3.5 p-0 text-ink-muted">Kind of talk</legend>
            <div className="flex flex-wrap gap-2.5">
              {(Object.keys(TALK_TYPES) as TalkType[]).map((key) => {
                const on = key === config.talkType;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('talkType', key)}
                    className={cn('min-h-[46px] rounded-pill px-5 text-[16px]', on ? 'bg-olive font-semibold text-olive-foreground' : 'bg-surface-100 text-ink-muted hover:text-ink')}
                  >
                    {TALK_TYPES[key].label}
                  </button>
                );
              })}
            </div>
            <p className="m-0 mt-1 text-[16px] leading-[25px] text-ink-muted">
              Pace zone{' '}
              <span className="font-semibold text-olive">
                {talk.zone.min} to {talk.zone.max} wpm
              </span>
              . Listening for {talk.focus}.
            </p>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3.5 border-0 p-0">
            <legend className="mb-3.5 p-0 text-ink-muted">How should Vireo coach you?</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              {(
                [
                  ['watch', 'Watch silently', 'Visual cues only. Best for real calls and recordings.'],
                  ['coach', 'Coach me out loud', 'A spoken nudge when you drift for more than a few seconds.'],
                ] as const
              ).map(([value, title, body]) => {
                const on = config.mode === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer flex-col gap-2 rounded-[22px] p-[22px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-olive',
                      on ? 'paper-scope bg-paper text-paper-foreground' : 'bg-surface-100'
                    )}
                  >
                    <input type="radio" name={ids.mode} value={value} checked={on} onChange={() => set('mode', value)} className="sr-only" />
                    <span className="font-display text-[26px] leading-[30px]">{title}</span>
                    <span className="text-[15px] leading-[23px] opacity-80">{body}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-4 border-y border-line py-5">
            <label htmlFor={ids.audience} className="flex cursor-pointer flex-col gap-1">
              <span className="text-lg font-semibold">Ask me a follow-up afterwards</span>
              <span className="text-[15px] text-ink-muted">Audience mode asks the question a sharp listener would, then coaches your reply.</span>
            </label>
            <Switch id={ids.audience} checked={config.audience} onCheckedChange={(v) => set('audience', v)} />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={ids.story} className="text-[15px] text-ink-muted">
                Story from your bank
              </label>
              {stories.length ? (
                <select
                  id={ids.story}
                  value={config.storyId ?? ''}
                  onChange={(e) => set('storyId', e.target.value || undefined)}
                  className="min-h-11 max-w-full rounded-md border-0 bg-surface-100 px-4 font-display text-[22px] text-foreground"
                >
                  <option value="">None, I’m answering freely</option>
                  {stories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              ) : (
                <span id={ids.story} className="font-display text-[22px] text-ink-muted">
                  No stories yet
                </span>
              )}
              {story && story.keyPoints.length > 0 && (
                <span className="text-[15px] text-ink-muted">Vireo will check you hit: {story.keyPoints.join(', ')}.</span>
              )}
            </div>
            <Link to="/stories" className="rounded-sm text-label text-olive">
              {stories.length ? 'Open Story Bank' : 'Add a story'}
            </Link>
          </div>
        </section>

        <aside aria-label="Camera and microphone check" className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-surface-100">
            <video ref={videoRef} muted playsInline autoPlay aria-label="Camera preview" className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover', config.hideFace && 'invisible')} />
            {config.hideFace && (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                <p className="m-0 font-display text-2xl italic text-ink-muted">Your face stays hidden while you speak. Vireo still sees you.</p>
              </div>
            )}
            <div className="absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-md bg-surface-000/85 px-4 py-3">
              <span className="text-small text-ink-muted">Mic</span>
              <div
                role="meter"
                aria-label="Microphone level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((levels[levels.length - 1] ?? 0) * 100)}
                className="grid h-[26px] flex-1 grid-cols-[repeat(18,minmax(0,1fr))] items-center gap-[3px]"
              >
                {levels.map((l, i) => (
                  <span key={i} className={cn('block rounded-[2px] transition-[height] duration-150', l > 0.08 ? 'bg-sky' : 'bg-line')} style={{ height: `${4 + l * 22}px` }} />
                ))}
              </div>
            </div>
          </div>

          <label htmlFor={ids.face} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-md bg-surface-100 px-[18px] text-[16px] font-semibold">
            Hide my face while I speak
            <Switch id={ids.face} checked={config.hideFace} onCheckedChange={(v) => set('hideFace', v)} />
          </label>

          <ul className="m-0 flex list-none flex-col gap-2.5 px-1 pt-1 text-[15px]" aria-live="polite">
            {preview.status === 'starting' && <li className="text-ink-muted">Checking your camera and microphone</li>}
            {preview.status === 'error' && (
              <li className="flex items-center gap-2.5">
                <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-amber" aria-hidden="true" />
                {preview.message}
              </li>
            )}
            {preview.status === 'ready' && (
              <>
                <li className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-pill bg-olive" aria-hidden="true" />
                  Camera and microphone ready
                </li>
                {preview.dark && (
                  <li className="flex items-center gap-2.5">
                    <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-amber" aria-hidden="true" />
                    A little dark. Face a window if you can.
                  </li>
                )}
              </>
            )}
          </ul>

          <Button size="lg" className="mt-2 h-[60px] w-full" onClick={start} disabled={!canStart} aria-describedby={ids.privacy}>
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            Start speaking
          </Button>
          {!canStart && <p className="m-0 text-small text-ink-muted">Write what you’re answering first.</p>}
          <p id={ids.privacy} className="m-0 text-small text-ink-muted">
            Video is analysed live and never stored. Transcripts and notes stay on this device until you delete them.
          </p>
        </aside>
      </div>
    </div>
  );
}
