import { describe, expect, it, vi } from 'vitest';
import { LiveSessionEngine, countFillers, toTranscriptLines, type MediaStartArgs } from './LiveSessionEngine';
import { GeminiLiveClient, type LiveSocket } from './geminiLiveClient';
import type { GeminiLiveCallbacks } from './geminiLiveClient';
import type { PaceTake } from './metrics/ghost';

const FRAME_MS = 20;

function harness(mode: 'watch' | 'coach' = 'coach', ghost?: PaceTake) {
  let clock = 0;
  let media!: MediaStartArgs;
  let liveCb!: GeminiLiveCallbacks;
  const client = { connect: vi.fn(async () => liveCb.onStatus('connected')), sendAudio: vi.fn(), sendVideoFrame: vi.fn(), sendNudge: vi.fn(() => true), close: vi.fn() };
  const saved: PaceTake[] = [];
  const engine = new LiveSessionEngine(
    { mode, talkType: 'interview', prompt: 'Tell me about your research.' },
    {
      now: () => clock,
      autoTick: false,
      createClient: (_m, cb) => {
        liveCb = cb;
        return client;
      },
      startMedia: async (args) => {
        media = args;
        return {
          pitchAvailable: true,
          pitchForWord: () => [140, 150, 160],
          micLevel: () => 42,
          playCoachAudio: vi.fn(),
          stop: vi.fn(async () => {}),
        };
      },
      ghostStore: { get: async () => ghost, put: async (t) => void saved.push(t) },
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
  const say = (text: string) => liveCb.onTranscript(text);

  return { engine, client, saved, advance, say, start: () => engine.start(), get liveCb() { return liveCb; } };
}

describe('LiveSessionEngine', () => {
  it('turns audio frames and transcript chunks into a live snapshot', async () => {
    const h = harness();
    await h.start();
    h.advance(400, false); // calibration and room noise
    h.advance(1200, true);
    h.say('Um, so basically our results');
    h.advance(1200, false); // a pause that landed
    h.advance(900, true);
    h.say('were better than expected.');
    h.advance(100, true);

    const snap = h.engine.getSnapshot();
    expect(snap.status).toBe('connected');
    expect(snap.segments.map((s) => s.text)).toEqual(['Um,', 'so', 'basically', 'our', 'results', 'were', 'better', 'than', 'expected.']);
    expect(snap.segments.slice(0, 3).every((s) => s.kind === 'filler')).toBe(true);
    expect(snap.fillerCount).toBe(2); // "um" and "so basically"
    expect(snap.lastFiller).toEqual({ text: 'basically', atMs: expect.any(Number) });
    expect(snap.pauses).toEqual([{ startMs: 1600, endMs: 2800 }]);
    // Words after the pause sit after it: the sonogram's gap is where the pause was.
    expect(snap.segments[5].startMs).toBeGreaterThanOrEqual(2800);
    expect(snap.segments[4].endMs).toBeLessThanOrEqual(1600);
    expect(snap.micLevel).toBe(42);
  });

  it('shows the open pause while it is happening and hides pace during it', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(1000, true);
    h.say('one two three four five');
    h.advance(700, false);
    const snap = h.engine.getSnapshot();
    expect(snap.pausingMs).toBeGreaterThan(300);
    expect(snap.wpm).toBeNull();
  });

  it('sends a spoken nudge after five seconds too fast, in coach mode only', async () => {
    for (const mode of ['coach', 'watch'] as const) {
      const h = harness(mode);
      await h.start();
      h.advance(200, false);
      for (let i = 0; i < 40; i++) {
        h.advance(250, true);
        h.say('quick'); // 240 words a minute
      }
      const snap = h.engine.getSnapshot();
      expect(snap.nudge).toBe('fast');
      if (mode === 'coach') {
        expect(h.client.sendNudge).toHaveBeenCalledWith('Slow down. Let the result land.');
        expect(h.client.sendNudge).toHaveBeenCalledTimes(1);
      } else {
        expect(h.client.sendNudge).not.toHaveBeenCalled();
      }
    }
  });

  it('attaches pitch to words once they have finished', async () => {
    const h = harness();
    await h.start();
    h.advance(200, false);
    h.advance(800, true);
    h.say('our results');
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
      h.say(i === 3 ? 'um' : 'word');
    }
    h.advance(800, false);
    h.advance(800, true);
    h.say('after the pause');
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

describe('GeminiLiveClient', () => {
  function fakeSocket() {
    const sent: unknown[] = [];
    const ws: LiveSocket = {
      readyState: 1,
      send: (d) => void sent.push(JSON.parse(d)),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };
    return { ws, sent };
  }

  async function connected(mode: 'watch' | 'coach') {
    const { ws, sent } = fakeSocket();
    const cb = { onStatus: vi.fn(), onTranscript: vi.fn(), onCoachAudio: vi.fn() };
    let url = '';
    const client = new GeminiLiveClient(mode, cb, {
      fetchToken: async () => 'st_1',
      openSocket: (u) => {
        url = u;
        return ws;
      },
    });
    await client.connect();
    ws.onopen?.({});
    const receive = (msg: unknown) => ws.onmessage?.({ data: JSON.stringify(msg) });
    return { client, cb, sent, url, receive, ws };
  }

  it('connects with the token and the coaching mode', async () => {
    const { url, cb, client } = await connected('watch');
    expect(url).toMatch(/\/ws\/live\?token=st_1&mode=watch$/);
    expect(cb.onStatus).toHaveBeenLastCalledWith('connected');
    client.close();
  });

  it('passes input transcription through', async () => {
    const { receive, cb, client } = await connected('watch');
    receive({ serverContent: { inputTranscription: { text: ' our results' } } });
    expect(cb.onTranscript).toHaveBeenCalledWith(' our results');
    client.close();
  });

  it('plays coach audio only for a nudge it asked for', async () => {
    const { receive, cb, client, sent } = await connected('coach');
    const audio = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA' } }] } } };
    receive(audio);
    expect(cb.onCoachAudio).not.toHaveBeenCalled();

    expect(client.sendNudge('Slow down.')).toBe(true);
    expect(sent[sent.length - 1]).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[NUDGE] Slow down.' }] }], turnComplete: true } });
    receive(audio);
    receive({ serverContent: { turnComplete: true } });
    receive(audio);
    expect(cb.onCoachAudio).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('never sends nudges when watching silently', async () => {
    const { client, sent } = await connected('watch');
    expect(client.sendNudge('Slow down.')).toBe(false);
    expect(sent).toEqual([]);
    client.close();
  });

  it('reports a failed token request', async () => {
    const cb = { onStatus: vi.fn(), onTranscript: vi.fn(), onCoachAudio: vi.fn() };
    const client = new GeminiLiveClient('watch', cb, { fetchToken: async () => Promise.reject(new Error('GEMINI_API_KEY is not configured')) });
    await client.connect();
    expect(cb.onStatus).toHaveBeenLastCalledWith('failed', 'GEMINI_API_KEY is not configured');
  });
});
