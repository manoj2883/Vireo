import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector, frameRms, MIN_PAUSE_MS } from './vad';
import { DEFAULT_FILLERS, findFillers, fillerMask, normalizeWord } from './fillers';
import { PaceMeter, paceState, windowWpm, TALK_TYPES } from './pace';
import { TranscriptTimeline, placeWords } from './timeline';
import { ghostKey, ghostWpmAt, isBetterTake, summariseTake } from './ghost';
import { NudgeController, SPOKEN_NUDGES } from './nudges';

// ---------- synthetic audio ----------

const SR = 16_000;
const FRAME_MS = 20;
const FRAME_LEN = (SR * FRAME_MS) / 1000;

/** A 20 ms frame: a voiced tone at `amp`, plus optional background noise. */
function frame(amp: number, noise = 0, seed = 1): Float32Array {
  const out = new Float32Array(FRAME_LEN);
  let s = seed;
  for (let i = 0; i < FRAME_LEN; i++) {
    s = (s * 16807) % 2147483647;
    out[i] = amp * Math.sin((2 * Math.PI * 150 * i) / SR) + noise * ((s / 2147483647) * 2 - 1);
  }
  return out;
}

/** Run a script of [ms, 'speech' | 'silence'] through the detector, continuing its clock. */
const clocks = new WeakMap<VoiceActivityDetector, number>();
function runScript(vad: VoiceActivityDetector, script: [number, 'speech' | 'silence'][], noise = 0.002) {
  let t = clocks.get(vad) ?? 0;
  let seed = t + 1;
  for (const [ms, kind] of script) {
    for (let k = 0; k < ms / FRAME_MS; k++) {
      vad.processFrame(frame(kind === 'speech' ? 0.2 : 0, noise, seed++), t, FRAME_MS);
      t += FRAME_MS;
    }
  }
  clocks.set(vad, t);
  return t;
}

describe('VoiceActivityDetector', () => {
  it('finds a pause over 300 ms and measures it from the last speech', () => {
    const vad = new VoiceActivityDetector({ calibrationMs: 0 });
    runScript(vad, [[1000, 'speech'], [1200, 'silence'], [800, 'speech']]);
    expect(vad.getPauses()).toEqual([{ startMs: 1000, endMs: 2200 }]);
  });

  it('ignores silences shorter than 300 ms', () => {
    const vad = new VoiceActivityDetector({ calibrationMs: 0 });
    runScript(vad, [[600, 'speech'], [MIN_PAUSE_MS - 60, 'silence'], [600, 'speech'], [280, 'silence'], [400, 'speech']]);
    expect(vad.getPauses()).toEqual([]);
  });

  it('does not count the silence before the first word', () => {
    const vad = new VoiceActivityDetector({ calibrationMs: 0 });
    runScript(vad, [[1500, 'silence'], [500, 'speech']]);
    expect(vad.getPauses()).toEqual([]);
  });

  it('bridges dips shorter than the hangover so speech does not flicker', () => {
    const vad = new VoiceActivityDetector({ hangoverMs: 200, calibrationMs: 0 });
    runScript(vad, [[400, 'speech'], [100, 'silence']]);
    expect(vad.isSpeaking()).toBe(true);
    runScript(vad, [[200, 'silence']]);
    expect(vad.isSpeaking()).toBe(false);
  });

  it('reports an open pause only once it passes the minimum', () => {
    const vad = new VoiceActivityDetector({ calibrationMs: 0 });
    runScript(vad, [[500, 'speech'], [240, 'silence']]);
    expect(vad.getOpenPause(740)).toBeNull();
    runScript(vad, [[200, 'silence']]);
    expect(vad.getOpenPause(940)).toEqual({ startMs: 500 });
  });

  it('adapts to a noisy room: steady noise is not speech', () => {
    const vad = new VoiceActivityDetector();
    runScript(vad, [[600, 'silence'], [800, 'speech'], [600, 'silence'], [400, 'speech']], 0.04);
    expect(vad.getPauses()).toEqual([{ startMs: 1400, endMs: 2000 }]);
  });

  it('records the stretches of speech for word placement', () => {
    const vad = new VoiceActivityDetector({ calibrationMs: 0 });
    runScript(vad, [[400, 'speech'], [600, 'silence'], [300, 'speech']]);
    expect(vad.getVoicedIntervals()).toEqual([
      { startMs: 0, endMs: 400 },
      { startMs: 1000, endMs: 1300 },
    ]);
  });

  it('computes RMS of a frame', () => {
    expect(frameRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

// ---------- fillers ----------

describe('fillers', () => {
  it('matches single words regardless of case and punctuation', () => {
    expect(findFillers(['Um,', 'I', 'think', 'uh...']).map((m) => m.filler)).toEqual(['um', 'uh']);
  });

  it('matches phrases as whole words, preferring the longer phrase', () => {
    expect(findFillers('So basically it was kind of hard, you know?'.split(' '))).toEqual([
      { start: 0, length: 2, filler: 'so basically' },
      { start: 4, length: 2, filler: 'kind of' },
      { start: 7, length: 2, filler: 'you know' },
    ]);
  });

  it('never matches inside another word', () => {
    expect(findFillers(['likely', 'umbrella', 'unlike', 'sorting', 'kindof'])).toEqual([]);
  });

  it('does not treat "so" alone as a filler by default', () => {
    expect(findFillers(['so', 'I', 'left'])).toEqual([]);
  });

  it('takes a custom list', () => {
    expect(fillerMask(['Right,', 'actually', 'yes'], ['actually', 'right'])).toEqual([true, true, false]);
  });

  it('ships the configured default list', () => {
    expect([...DEFAULT_FILLERS]).toEqual(['um', 'uh', 'like', 'you know', 'so basically', 'kind of', 'sort of']);
  });

  it('normalises curly apostrophes', () => {
    expect(normalizeWord('Don’t!')).toBe("don't");
  });
});

// ---------- pace ----------

describe('pace', () => {
  it('counts words in the rolling four-second window', () => {
    const starts = Array.from({ length: 10 }, (_, i) => 100 + i * 400); // 2.5 words a second
    expect(windowWpm(starts, 4100)).toBe(150);
    expect(windowWpm(starts, 10_000)).toBe(0);
  });

  it('measures from the first word until the window fills', () => {
    const starts = [0, 400, 800, 1200, 1600]; // 150 wpm
    expect(windowWpm(starts, 2000)).toBe(150);
    expect(windowWpm([0], 100)).toBe(60); // one word reads as 60, not a spike
    expect(windowWpm([], 1000)).toBe(0);
  });

  it('smooths towards the raw pace instead of jumping', () => {
    const meter = new PaceMeter(4000, 1200);
    meter.update([], 0);
    const starts = Array.from({ length: 40 }, (_, i) => i * 300); // 200 wpm
    const early = meter.update(starts.filter((t) => t <= 500), 500);
    expect(early).toBeLessThan(200);
    let v = 0;
    for (let t = 500; t <= 12_000; t += 100) v = meter.update(starts.filter((s) => s <= t), t);
    expect(v).toBeGreaterThan(190);
    expect(meter.wpm).toBe(Math.round(v));
  });

  it('classifies pace against the zone for the kind of talk', () => {
    const zone = TALK_TYPES.interview.zone;
    expect(paceState(120, zone)).toBe('slow');
    expect(paceState(145, zone)).toBe('in');
    expect(paceState(184, zone)).toBe('fast');
    expect(paceState(null, zone)).toBeNull();
  });
});

// ---------- timeline ----------

describe('TranscriptTimeline', () => {
  it('places words inside the speech the detector heard, keeping pauses as gaps', () => {
    const tl = new TranscriptTimeline({ latencyMs: 0 });
    const voiced = [
      { startMs: 0, endMs: 1000 },
      { startMs: 2200, endMs: 3000 },
    ];
    tl.append('our results were', 1200, voiced.slice(0, 1));
    tl.append('a lot better', 3200, voiced);
    const words = tl.getWords();
    expect(words.slice(0, 3).every((w) => w.endMs <= 1000)).toBe(true);
    expect(words.slice(3).every((w) => w.startMs >= 2200 && w.endMs <= 3000)).toBe(true);
  });

  it('spreads words evenly when no speech was detected', () => {
    expect(placeWords([1, 1], 0, 1000, [])).toEqual([
      { startMs: expect.closeTo(0, 0), endMs: 500 },
      { startMs: expect.closeTo(500, 0), endMs: 1000 },
    ]);
  });

  it('keeps timing for revised interim words and adds only new ones', () => {
    const tl = new TranscriptTimeline();
    tl.updateUtterance('u1', 'so my', 500, [{ startMs: 0, endMs: 500 }]);
    const firstTimes = tl.getWords().map((w) => w.startMs);
    tl.updateUtterance('u1', 'so my research', 900, [{ startMs: 0, endMs: 900 }]);
    tl.updateUtterance('u1', 'So, my research', 950, [{ startMs: 0, endMs: 950 }]);
    expect(tl.text()).toBe('So, my research');
    expect(tl.getWords().slice(0, 2).map((w) => w.startMs)).toEqual(firstTimes);
  });

  it('drops words an interim result took back', () => {
    const tl = new TranscriptTimeline();
    tl.updateUtterance('u1', 'they do not have', 800);
    tl.updateUtterance('u1', 'they do', 900);
    expect(tl.text()).toBe('they do');
  });

  it('leaves the latest speech for words still being transcribed', () => {
    const tl = new TranscriptTimeline({ latencyMs: 500 });
    // "our results" was said from 0 to 800; "were" started at 900. The chunk arrives at 1300.
    tl.append('our results', 1300, [{ startMs: 0, endMs: 1300 }]);
    expect(tl.getWords().every((w) => w.endMs <= 800)).toBe(true);
  });

  it('marks fillers and rushed words for the sonogram', () => {
    const tl = new TranscriptTimeline({ rushedAboveWpm: 160 });
    tl.append('Um, so basically our results were', 2000, [], 140);
    tl.append('a lot better than we expected.', 3500, [], 184);
    expect(tl.toSegments().map((s) => s.kind)).toEqual([
      'filler', 'filler', 'filler', 'speech', 'speech', 'speech',
      'rushed', 'rushed', 'rushed', 'rushed', 'rushed', 'rushed',
    ]);
  });
});

// ---------- ghost pace ----------

describe('ghost pace', () => {
  const zone = { min: 130, max: 160 };
  const trace = (vals: (number | null)[]) => vals;

  it('normalises keys so small prompt edits find the same ghost', () => {
    expect(ghostKey('  Tell me about   your research. ')).toBe(ghostKey('tell me about your research'));
  });

  it('summarises a take', () => {
    const take = summariseTake('k', 't1', trace([140, 150, null, 170, 120]), zone, 3, 60_000, 'now');
    expect(take).toMatchObject({ avgWpm: 145, inZoneRatio: 0.5, fillersPerMin: 3 });
  });

  it('prefers more time in the zone, then fewer fillers, and ignores very short takes', () => {
    const long = (v: number) => Array.from({ length: 20 }, () => v);
    const good = summariseTake('k', 'a', long(145), zone, 4, 60_000);
    const fast = summariseTake('k', 'b', long(180), zone, 0, 60_000);
    const cleaner = summariseTake('k', 'c', long(150), zone, 1, 60_000);
    expect(isBetterTake(good, null)).toBe(true);
    expect(isBetterTake(fast, good)).toBe(false);
    expect(isBetterTake(cleaner, good)).toBe(true);
    expect(isBetterTake(summariseTake('k', 'd', [150, 150], zone, 0, 2000), null)).toBe(false);
  });

  it('replays the best take at the same second, then its average', () => {
    const take = summariseTake('k', 't', [140, null, 160], zone, 0, 3000);
    expect(ghostWpmAt(take, 500)).toBe(140);
    expect(ghostWpmAt(take, 1500)).toBe(150);
    expect(ghostWpmAt(take, 9000)).toBe(150);
    expect(ghostWpmAt(null, 0)).toBeNull();
  });
});

// ---------- nudges ----------

describe('NudgeController', () => {
  /** Run ticks every 100 ms; returns what was spoken and the last state. */
  function run(ctrl: NudgeController, state: 'fast' | 'slow' | 'in', fromMs: number, toMs: number, speaking = true, pauseFrom?: number) {
    const spoken: string[] = [];
    let last = ctrl.tick(state, speaking, fromMs, 0);
    for (let t = fromMs + 100; t <= toMs; t += 100) {
      const pauseMs = !speaking && pauseFrom !== undefined ? t - pauseFrom : 0;
      last = ctrl.tick(state, speaking, t, pauseMs);
      if (last.speak) spoken.push(SPOKEN_NUDGES[last.speak]);
    }
    return { spoken, last };
  }

  it('shows the visual nudge straight away', () => {
    const ctrl = new NudgeController('coach');
    expect(ctrl.tick('fast', true, 0)).toMatchObject({ visual: 'fast', speak: null });
  });

  it('never speaks while you are talking, however long you rush', () => {
    const ctrl = new NudgeController('coach');
    const { spoken, last } = run(ctrl, 'fast', 0, 5900);
    expect(spoken).toEqual([]);
    expect(last.waitingForPause).toBe(true);
  });

  it('speaks once a pause of 600 ms arrives after five seconds out of the zone', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 5200);
    expect(run(ctrl, 'fast', 5300, 5800, false, 5300).spoken).toEqual([]); // 500 ms: not yet
    expect(run(ctrl, 'fast', 5900, 6000, false, 5300).spoken).toEqual([SPOKEN_NUDGES.fast]);
  });

  it('does not count a short breath as a pause to speak in', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 5200);
    expect(run(ctrl, 'fast', 5300, 5700, false, 5300).spoken).toEqual([]);
    expect(run(ctrl, 'fast', 5800, 7000).spoken).toEqual([]);
  });

  it('skips the nudge if no pause comes within six seconds', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 5200); // due at about 5.1 s
    run(ctrl, 'fast', 5300, 11_500); // talking straight through
    const late = run(ctrl, 'fast', 11_600, 13_000, false, 11_600);
    expect(late.spoken).toEqual([]);
    expect(late.last.waitingForPause).toBe(false);
  });

  it('cancels a waiting nudge when you come back into the zone', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 5200);
    run(ctrl, 'in', 5300, 5500);
    expect(run(ctrl, 'fast', 5600, 6600, false, 5600).spoken).toEqual([]);
  });

  it('never speaks when watching silently', () => {
    const ctrl = new NudgeController('watch');
    run(ctrl, 'fast', 0, 6000);
    const { spoken, last } = run(ctrl, 'fast', 6100, 8000, false, 6100);
    expect(spoken).toEqual([]);
    expect(last.waitingForPause).toBe(false);
  });

  it('speaks once per excursion and respects the 20 s cooldown', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 5200);
    expect(run(ctrl, 'fast', 5300, 6000, false, 5300).spoken).toHaveLength(1);
    run(ctrl, 'in', 6100, 6500);
    run(ctrl, 'fast', 6600, 12_000);
    expect(run(ctrl, 'fast', 12_100, 13_000, false, 12_100).spoken).toEqual([]); // inside the cooldown
    run(ctrl, 'in', 13_100, 13_500);
    run(ctrl, 'fast', 30_000, 35_500);
    expect(run(ctrl, 'fast', 35_600, 36_300, false, 35_600).spoken).toHaveLength(1);
  });

  it('does not count silence towards too slow', () => {
    const ctrl = new NudgeController('coach');
    const { spoken, last } = run(ctrl, 'slow', 0, 10_000, false, 0);
    expect(spoken).toEqual([]);
    expect(last.visual).toBeNull();
    expect(last.outOfZoneMs).toBe(0);
  });
});
