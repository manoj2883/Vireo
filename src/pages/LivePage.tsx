import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clock } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sonogram } from '@/components/sonogram';
import { PaceBand } from '@/components/hud/PaceBand';
import { PauseRing } from '@/components/hud/PauseRing';
import { FillerTicker } from '@/components/hud/FillerTicker';
import { LiveSessionEngine } from '@/live/LiveSessionEngine';
import { useLiveSnapshot } from '@/live/useLiveSession';
import { getGhost, putGhost, saveSession, sessionFromResult, getStory, saveStory, newId } from '@/storage/localDb';
import { loadConfig, saveConfig, type SessionConfig } from '@/session/config';

const CAPTION_WORDS = 12;

/** Live session (`/session`): camera frame, scrolling sonogram ribbon and glanceable cues. */
export function LivePage() {
  const config = loadConfig();
  if (!config || !config.prompt.trim()) return <Navigate to="/warm-up" replace />;
  return <LiveSession config={config} />;
}

function LiveSession({ config }: { config: SessionConfig }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [engine, setEngine] = useState<LiveSessionEngine | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Shown until the real engine exists, so the view (and its <video>) mounts once.
  const idle = useMemo(
    () => new LiveSessionEngine({ mode: config.mode, talkType: config.talkType, prompt: config.prompt }),
    [config.mode, config.talkType, config.prompt]
  );

  useEffect(() => {
    const e = new LiveSessionEngine(
      { mode: config.mode, talkType: config.talkType, prompt: config.prompt, storyId: config.storyId },
      { ghostStore: { get: getGhost, put: putGhost } }
    );
    setEngine(e);
    e.start(videoRef.current ?? undefined).catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      setStartError(
        name === 'NotAllowedError'
          ? 'Vireo needs your microphone to listen. Allow it in your browser’s site settings, then try again.'
          : `Vireo couldn’t start the session: ${err instanceof Error ? err.message : String(err)}`
      );
    });
    return () => {
      if (!e.isEnded) void e.abort();
    };
    // One engine per mount; the config is read once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <LiveView engine={engine ?? idle} ready={engine !== null} config={config} videoRef={videoRef} startError={startError} />
    </div>
  );
}

function LiveView({
  engine,
  ready,
  config,
  videoRef,
  startError,
}: {
  engine: LiveSessionEngine;
  ready: boolean;
  config: SessionConfig;
  videoRef: React.RefObject<HTMLVideoElement>;
  startError: string | null;
}) {
  const navigate = useNavigate();
  const snap = useLiveSnapshot(engine);
  const [hideFace, setHideFace] = useState(config.hideFace);
  const [captions, setCaptions] = useState(true);
  const [ending, setEnding] = useState(false);
  const faceId = useId();
  const capId = useId();

  const rushing = snap.nudge === 'fast';
  const failed = startError ?? (snap.status === 'failed' ? snap.statusMessage ?? 'The live connection failed.' : null);
  const captionWords = snap.segments.slice(-CAPTION_WORDS);
  const sinceFiller = snap.lastFiller ? snap.elapsedMs - snap.lastFiller.atMs : null;

  async function endSession() {
    setEnding(true);
    const id = newId('sess');
    const result = await engine.end(id);
    const stored = sessionFromResult(result, { ...config, hideFace }, id);
    await saveSession(stored);
    if (config.storyId) {
      const story = await getStory(config.storyId);
      if (story) await saveStory({ ...story, lastSessionId: stored.id, updatedAt: new Date().toISOString() });
    }
    saveConfig({ ...config, hideFace });
    navigate(`/notes/${stored.id}`, { replace: true });
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-[18px] sm:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <span className="inline-flex h-9 items-center gap-2.5 rounded-pill bg-surface-100 px-3.5">
            <span className="h-[9px] w-[9px] rounded-pill bg-alert" aria-hidden="true" />
            <span className="text-label tabular-nums" aria-label={`Recording, ${clock(snap.elapsedMs)}`}>
              {clock(snap.elapsedMs)}
            </span>
          </span>
          <h1 className="m-0 min-w-0 font-display text-[22px] font-normal">{config.prompt}</h1>
        </div>
        <span className="inline-flex h-9 items-center rounded-pill px-3.5 text-small font-semibold text-ink-muted shadow-[inset_0_0_0_1px_rgb(var(--line))]">
          {config.mode === 'coach' ? 'Coaching out loud' : 'Watching silently'}
          {snap.status === 'connecting' || snap.status === 'reconnecting' ? ', connecting' : ''}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6 sm:px-8">
        {failed && (
          <div role="alert" className="paper-scope flex flex-wrap items-center justify-between gap-4 rounded-md bg-paper px-6 py-4 text-paper-foreground">
            <p className="m-0 max-w-[720px] text-body">
              {failed} Pauses are still measured on this device, but pace, fillers and field notes need the live transcript.
            </p>
            <Button asChild variant="outline" className="text-paper-foreground">
              <Link to="/warm-up">Back to warm-up</Link>
            </Button>
          </div>
        )}

        <div
          data-testid="live-frame"
          data-rushing={rushing}
          className={cn(
            'relative min-h-[520px] flex-1 overflow-hidden rounded-lg bg-surface-100 transition-shadow duration-500 sm:min-h-[600px]',
            rushing
              ? 'shadow-[inset_0_0_0_3px_rgb(var(--amber)),inset_0_0_140px_rgb(var(--amber)/0.2)]'
              : 'shadow-[inset_0_0_0_1px_rgb(var(--line)/0.6)]'
          )}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Your camera"
            className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover', hideFace && 'invisible')}
          />
          {hideFace && (
            <div className="absolute inset-x-0 top-0 bottom-[260px] flex items-center justify-center px-6 text-center">
              <p className="m-0 font-display text-[26px] italic text-ink-muted">Your face is hidden. Vireo still sees you.</p>
            </div>
          )}

          {snap.coachSays && (
            <div
              role="status"
              className="paper-scope absolute left-1/2 top-7 flex max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-3.5 rounded-pill bg-paper px-[22px] py-3.5 text-paper-foreground shadow-lift"
            >
              <Volume2 className="h-[22px] w-[22px] shrink-0 text-amber" aria-hidden="true" />
              <span className="font-display text-[22px]">{snap.coachSays}</span>
            </div>
          )}

          <FillerTicker
            className="absolute right-4 top-4 sm:right-7 sm:top-7"
            count={snap.fillerCount}
            sinceLastMs={sinceFiller}
            lastFiller={snap.lastFiller?.text}
          />

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[18px] bg-gradient-to-b from-surface-100/0 via-surface-100/95 to-surface-100 px-4 pb-6 pt-16 sm:px-8 sm:pb-7">
            {captions && (
              <p className="m-0 max-w-[900px] font-display text-[22px] leading-[30px] sm:text-[26px] sm:leading-[34px]" aria-live="off">
                {captionWords.length === 0 ? (
                  <span className="text-ink-muted">{snap.status === 'connected' ? 'Start speaking when you’re ready.' : 'Getting ready'}</span>
                ) : (
                  captionWords.map((w, i) => (
                    <span key={`${w.startMs}-${i}`} className={w.kind === 'filler' ? 'italic text-amber' : undefined}>
                      {w.text}{' '}
                    </span>
                  ))
                )}
              </p>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
              <div className="flex min-w-0 flex-1 flex-col gap-3.5">
                <div className="h-[96px] sm:h-[120px]">
                  <Sonogram mode="scrolling" segments={snap.segments} pauses={snap.pauses} nowMs={snap.elapsedMs} label="Your speech in the last six seconds" />
                </div>
                <PaceBand wpm={snap.wpm} zone={snap.zone} ghostWpm={snap.ghostWpm} rushing={rushing} />
              </div>
              <PauseRing pausingMs={snap.pausingMs} className="self-center sm:self-auto" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2.5">
            <label htmlFor={faceId} className="inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-pill bg-surface-100 px-[18px] text-label">
              <Switch id={faceId} checked={hideFace} onCheckedChange={setHideFace} />
              Hide my face
            </label>
            <label htmlFor={capId} className="inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-pill bg-surface-100 px-[18px] text-label">
              <Switch id={capId} checked={captions} onCheckedChange={setCaptions} />
              Live captions
            </label>
          </div>
          <Button variant="end" size="lg" onClick={endSession} disabled={ending || !ready}>
            <span className="h-3 w-3 rounded-[3px] bg-surface-000" aria-hidden="true" />
            {ending ? 'Saving your session' : 'End and see field notes'}
          </Button>
        </div>
      </main>
    </>
  );
}
