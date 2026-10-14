import { describe, expect, it, vi } from 'vitest';
import { LiveSessionEngine, countFillers, toTranscriptLines, type MediaStartArgs } from './LiveSessionEngine';
import type { LiveWord, SttCallbacks } from './deepgramLiveClient';
import type { PaceTake } from './metrics/ghost';

const FRAME_MS = 20;

/** Words spread evenly over [fromMs, toMs], as Deepgram times them. */
function timed(text: string, fromMs: number, toMs: number): LiveWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const step = (toMs - fromMs) / parts.length;
  return parts.map((t, i) => ({ text: t, startMs: fromMs + i * step, endMs: fromMs + (i + 1) * step - 20 }));
}

function harness(mode: 'watch' | 'coach' = 'coach', ghost?: PaceTake) {
  let clock = 0;
  let media!: MediaStartArgs;
  let sttCb!: SttCallbacks;
  let keytermsSeen: readonly string[] = [];
  const client = { connect: vi.fn(async () => sttCb.onStatus('connected')), sendAudio: vi.fn(), close: vi.fn() };
  // A fake coach voice that plays until stopped.
  let playing = false;
  const voice = { play: vi.fn((kind: string) => void (playing = Boolean(kind))), stop: vi.fn(() => void (playing = false)), isPlaying: () => playing };
  const saved: PaceTake[] = [];
  const cameraResult = {
    events: [{ id: 'cam-1', kind: 'look-away' as const, startMs: 1000, endMs: 4000, value: 30 }],
    summary: { eyeContactPct: 70, longestLookAwayMs: 3000, postureAlerts: 0, gestureRate: 4, smilePct: 10, trackedMs: 10_000 },
  };
  const vision = { live: vi.fn(() => ({ looking: false, awayMs: 3500, dim: true })), result: vi.fn(() => cameraResult), stop: vi.fn() };
  const engine = new LiveSessionEngine(
    { mode, talkType: 'interview', prompt: 'Tell me about your research.', keyterms: ['DiabEvidence', 'claim-checking judge'] },
    {
      now: () => clock,
      autoTick: false,
      voice,
      createClient: (keyterms, cb) => {
        keytermsSeen = keyterms;
        sttCb = cb;
        return client;
      },
      startMedia: async (args) => {
        media = args;
        return {
          pitchAvailable: true,
          pitchForWord: () => [140, 150, 160],
          micLevel: () => 42,
          stop: vi.fn(async () => {}),
        };
      },
      ghostStore: { get: async () => ghost, put: async (t) => void saved.push(t) },
      startVision: async () => vision,
    }
  );

  /** Advance the clock with speech or silence frames, ticking every 100 ms. */
  const advance = (ms: number, speech: boolean) => {
    for (let t = 0; t < ms; t += FRAME_MS) {
      media.onAudioFrame({ timeMs: clock, durationMs: FRAME_MS, rms: speech ? 0.15 : 0.001, hz: speech ? 150 : null });
      clock += FRAME_MS;
      if (clock % 100 === 0) engine.tick(clock);
    }
  };
  /** Deepgram final words for text spoken between fromMs and toMs (default: just now). */
  const say = (text: string, fromMs = clock - 240, toMs = clock - 10) => sttCb.onWords(timed(text, fromMs, toMs), true);
  /** Deepgram interim words. */
  const hear = (text: string, fromMs: number, toMs: number) => sttCb.onWords(timed(text, fromMs, toMs), false);

  return { engine, client, voice, vision, cameraResult, saved, advance, say, hear, start: () => engine.start(), keyterms: () => keytermsSeen };
}

describe('LiveSessionEngine', () => {
  it('uses the transcriber’s word timings, so gaps fall where the pauses were', async () => {
    const h = harness();
    await h.start();
    h.advance(400, false); // calibration and room noise
    h.advance(1200, true);
    h.say('Um, so basically our results', 400, 1600);
    h.advance(1200, false); // a pause that landed
    h.advance(900, true);
    h.say('were better than expected.', 2800, 3700);
    h.advance(100, true);

    const snap = h.engine.getSnapshot();
    expect(snap.status).toBe('connected');
    expect(snap.segments.map((s) => s.text)).toEqual(['Um,', 'so', 'basically', 'our', 'results', 'were', 'better', 'than', 'expected.']);
    expect(snap.segments.slice(0, 3).every((s) => s.kind === 'filler')).toBe(true);
    expect(snap.fillerCount).toBe(2); // "um" and "so basically"
    expect(snap.lastFiller).toEqual({ text: 'basically', atMs: expect.any(Number) });
    expect(snap.pauses).toEqual([{ startMs: 1600, endMs: 2800 }]);
    expect(snap.segments[0].startMs).toBe(400);
    expect(snap.segments[5].startMs).toBe(2800);
    expect(snap.micLevel).toBe(42);
  });

  it('builds live captions as paragraphs that break at long pauses and utterance ends', async () => {
    const h = harness();
    await h.start();
    h.advance(400, false);
    h.advance(1200, true);
    h.say('So my research is about', 400, 1600);
    h.advance(1300, false);
    h.advance(800, true);
    h.say('teaching systems to', 2900, 3700);
    h.hear('say no', 3700, 3900);
    h.advance(100, true);
    const { captions } = h.engine.getSnapshot();
    expect(captions.previous?.map((x) => x.text).join(' ')).toBe('So my research is about');
    expect(captions.current.map((x) => `${x.text}${x.interim ? '*' : ''}`).join(' ')).toBe('teaching systems to say* no*');
  });

  it('shows eye contact live and saves the camera events with the session', async () => {
    const h = harness();
    await h.start();
    await Promise.resolve();
    h.advance(200, false);
    expect(h.engine.getSnapshot().eyeContact).toEqual({ looking: false, awayMs: 3500, dim: true });
    const result = await h.engine.end();
    expect(result.camera).toEqual(h.cameraResult);
    expect(h.vision.stop).toHaveBeenCalled();
  });

  it('works without camera feedback', async () => {
    const h = harness();
    (h.engine as unknown as { deps: { startVision: () => Promise<null> } }).deps.startVision = async () => null;
    await h.start();
    await Promise.resolve();
    h.advance(200, false);
    expect(h.engine.getSnapshot().eyeContact).toBeNull();
    expect((await h.engine.end()).camera).toBeNull();
  });

  it('passes the keyterms to the transcriber', async () => {
    const h = harness();
    await h.start();
    expect(h.keyterms()).toEqual(['DiabEvidence', 'claim-checking judge']);
  });

  it('shows interim words until the final replaces them, and never counts them', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(800, true);
    h.hear('our resolves', 200, 900);
    h.advance(100, true);
    let snap = h.engine.getSnapshot();
    expect(snap.interim.map((w) => w.text)).toEqual(['our', 'resolves']);
    expect(snap.segments).toEqual([]);
    h.say('our results', 200, 900);
    h.advance(100, true);
    snap = h.engine.getSnapshot();
    expect(snap.interim).toEqual([]);
    expect(snap.segments.map((w) => w.text)).toEqual(['our', 'results']);
  });

  it('ignores a repeated final for words it already has', async () => {
    const h = harness();
    await h.start();
    h.say('our results', 200, 900);
    h.say('our results', 200, 900);
    h.advance(100, false);
    expect(h.engine.getSnapshot().segments).toHaveLength(2);
  });

  it('falls back to placing words when a stream has no timings', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(1000, true);
    h.engine.ingestWords([{ text: 'hello there', startMs: NaN, endMs: NaN }], true);
    h.advance(100, true);
    expect(h.engine.getSnapshot().segments.map((w) => w.text)).toEqual(['hello', 'there']);
  });

  it('shows the open pause while it is happening and hides pace during it', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(1000, true);
    h.say('one two three four five', 200, 1200);
    h.advance(700, false);
    const snap = h.engine.getSnapshot();
    expect(snap.pausingMs).toBeGreaterThan(300);
    expect(snap.wpm).toBeNull();
  });

  /** Rush for ten seconds: 240 words a minute. */
  function rush(h: ReturnType<typeof harness>) {
    h.advance(200, false);
    for (let i = 0; i < 40; i++) {
      h.advance(250, true);
      h.say('quick');
    }
  }

  it('never speaks a nudge while you are talking', async () => {
    const h = harness('coach');
    await h.start();
    rush(h);
    expect(h.engine.getSnapshot().nudge).toBe('fast');
    expect(h.voice.play).not.toHaveBeenCalled();
  });

  it('speaks the nudge in the next pause of 600 ms, in coach mode only', async () => {
    for (const mode of ['coach', 'watch'] as const) {
      const h = harness(mode);
      await h.start();
      rush(h);
      h.advance(500, false); // hangover plus a short pause: not yet
      if (mode === 'coach') expect(h.voice.play).not.toHaveBeenCalled();
      h.advance(500, false);
      if (mode === 'coach') {
        expect(h.voice.play).toHaveBeenCalledWith('fast');
        expect(h.voice.play).toHaveBeenCalledTimes(1);
        expect(h.engine.getSnapshot().coachSays).toBe('Slow down. Let the result land.');
      } else {
        expect(h.voice.play).not.toHaveBeenCalled();
      }
    }
  });

  it('stops the nudge the moment you start talking again', async () => {
    const h = harness('coach');
    await h.start();
    rush(h);
    h.advance(1000, false);
    expect(h.voice.isPlaying()).toBe(true);
    h.advance(100, true);
    expect(h.voice.stop).toHaveBeenCalled();
    expect(h.voice.isPlaying()).toBe(false);
    expect(h.engine.getSnapshot().coachSays).toBeNull();
  });

  it('skips the nudge if you talk straight through for six seconds', async () => {
    const h = harness('coach');
    await h.start();
    rush(h); // due at about 5 s of rushing
    for (let i = 0; i < 28; i++) {
      h.advance(250, true);
      h.say('quick');
    }
    h.advance(1500, false);
    expect(h.voice.play).not.toHaveBeenCalled();
  });

  it('attaches pitch to words once they have finished', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(800, true);
    h.say('our results', 200, 900);
    h.advance(400, true);
    expect(h.engine.getSnapshot().segments[0].pitch).toEqual([140, 150, 160]);
  });

  it('shows the ghost of the best take at the same second', async () => {
    const ghost: PaceTake = { key: 'k', takeId: 'g', createdAt: '', trace: [150, 150, 150], avgWpm: 150, inZoneRatio: 1, fillersPerMin: 0 };
    const h = harness('watch', ghost);
    await h.start();
    await Promise.resolve();
    h.advance(1000, false);
    expect(h.engine.getSnapshot().ghostWpm).toBe(150);
  });

  it('ends with transcript lines, metrics and a saved best take', async () => {
    const h = harness('watch');
    await h.start();
    h.advance(200, false);
    for (let i = 0; i < 24; i++) {
      h.advance(400, true);
      h.say(i === 3 ? 'um' : 'word', h.engine.elapsed() - 390, h.engine.elapsed() - 20);
    }
    h.advance(1300, false); // a paragraph break needs a pause of 1.2 s
    h.advance(800, true);
    h.say('after the pause', h.engine.elapsed() - 790, h.engine.elapsed() - 20);
    const result = await h.engine.end();
    expect(h.client.close).toHaveBeenCalled();
    expect(result.transcript.length).toBeGreaterThanOrEqual(2);
    expect(result.transcript[result.transcript.length - 1].text).toBe('after the pause');
    expect(result.metrics).toMatchObject({ fillerCount: 1, pauseCount: 1, wordCount: 27 });
    expect(result.metrics.avgWpm).toBeGreaterThan(100);
    expect(result.newBest).toBe(true);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].key).toBe('tell me about your research');
  });
});

describe('transcript helpers', () => {
  it('counts a multi-word filler once', () => {
    const seg = (text: string, startMs: number, kind: 'filler' | 'speech') => ({ text, startMs, endMs: startMs + 200, kind });
    expect(countFillers([seg('you', 0, 'filler'), seg('know', 210, 'filler'), seg('it', 500, 'speech'), seg('um', 800, 'filler')])).toBe(2);
  });

  it('breaks lines at pauses', () => {
    const seg = (text: string, startMs: number) => ({ text, startMs, endMs: startMs + 200, kind: 'speech' as const });
    expect(toTranscriptLines([seg('a', 0), seg('b', 300), seg('c', 2000)], [{ startMs: 500, endMs: 2000 }])).toEqual([
      { speaker: 'user', text: 'a b', startMs: 0 },
      { speaker: 'user', text: 'c', startMs: 2000 },
    ]);
  });
});
