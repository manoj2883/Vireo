import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector, frameRms, MIN_PAUSE_MS } from './vad';
import { DEFAULT_FILLERS, findFillers, fillerMask, normalizeWord } from './fillers';
import { longPauses, nextPaceState, NUDGE_PACE_WINDOW_MS, PaceMeter, paceState, windowWpm, TALK_TYPES } from './pace';
import { TranscriptTimeline, placeWords } from './timeline';
import { ghostKey, ghostWpmAt, isBetterTake, summariseTake } from './ghost';
import { NudgeController, OPPOSITE_BLOCK_MS, SPOKEN_NUDGES } from './nudges';

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

  it('leaves long pauses out of pace, so pausing does not read as slow', () => {
    // 150 wpm for about 3 s, a 1.8 s gap between words, then 150 wpm again.
    const words = [0, 400, 800, 1200, 1600, 2000, 2400, 4500, 4900, 5300, 5700, 6100, 6500, 6900].map((s) => ({ startMs: s, endMs: s + 300 }));
    const starts = words.map((w) => w.startMs);
    const pauses = longPauses(words);
    expect(pauses).toEqual([{ startMs: 2700, endMs: 4500 }]);
    expect(windowWpm(starts, 7200, 12_000)).toBeLessThan(120); // pause counted: reads slow
    expect(windowWpm(starts, 7200, 12_000, pauses)).toBeGreaterThan(140); // articulation rate
  });

  it('applies hysteresis at the zone edges', () => {
    const zone = TALK_TYPES.interview.zone; // 130-160
    expect(nextPaceState('in', 162, zone)).toBe('in');
    expect(nextPaceState('in', 171, zone)).toBe('fast');
    expect(nextPaceState('fast', 162, zone)).toBe('fast'); // stays until below max
    expect(nextPaceState('fast', 159, zone)).toBe('in');
    expect(nextPaceState('in', 125, zone)).toBe('in');
    expect(nextPaceState('in', 119, zone)).toBe('slow');
    expect(nextPaceState('slow', 128, zone)).toBe('slow'); // stays until above min
    expect(nextPaceState('slow', 131, zone)).toBe('in');
    expect(nextPaceState(null, 171, zone)).toBe('fast');
    expect(nextPaceState('in', null, zone)).toBeNull();
  });
});

// ---------- pace into nudges, end to end ----------

describe('pace nudges over a whole take', () => {
  type Block = { ms: number; wpm: number }; // wpm 0 = silence

  /**
   * Speak a scripted take through the same pipeline the live engine uses: the long nudge window
   * with long pauses left out, hysteresis, then the nudge controller. Words are transcribed as
   * soon as they end. Returns each spoken nudge with its time.
   */
  function speak(blocks: Block[], zone = TALK_TYPES.interview.zone) {
    const words: { startMs: number; endMs: number }[] = [];
    const speech: { startMs: number; endMs: number }[] = [];
    let t0 = 0;
    for (const b of blocks) {
      if (b.wpm > 0) {
        const every = 60_000 / b.wpm;
        for (let s = t0; s < t0 + b.ms; s += every) words.push({ startMs: s, endMs: s + every * 0.7 });
        speech.push({ startMs: t0, endMs: t0 + b.ms });
      }
      t0 += b.ms;
    }
    const meter = new PaceMeter(NUDGE_PACE_WINDOW_MS);
    const ctrl = new NudgeController('coach');
    let state: ReturnType<typeof nextPaceState> = null;
    const spoken: { kind: string; atMs: number }[] = [];
    for (let t = 0; t <= t0 + 8000; t += 100) {
      const heard = words.filter((w) => w.endMs <= t);
      const speaking = speech.some((s) => t >= s.startMs && t < s.endMs);
      const lastEnd = Math.max(0, ...speech.filter((s) => s.endMs <= t).map((s) => s.endMs));
      const starts = heard.map((w) => w.startMs);
      const frontier = heard.length ? heard[heard.length - 1].endMs : t;
      const wpm = meter.update(starts, t, Math.min(t, frontier), longPauses(heard));
      state = starts.length ? nextPaceState(state, Math.round(wpm), zone) : null;
      const n = ctrl.tick(state, speaking, t, speaking ? 0 : t - lastEnd);
      if (n.speak) spoken.push({ kind: n.speak, atMs: t });
    }
    return spoken;
  }

  const repeat = (block: Block[], times: number) => Array.from({ length: times }, () => block).flat();

  it('a steady 145 wpm with a 1.5 s pause every 3 s gives no spoken nudges', () => {
    expect(speak(repeat([{ ms: 3000, wpm: 145 }, { ms: 1500, wpm: 0 }], 20))).toEqual([]);
  });

  it('15 s at 185 wpm gives exactly one "fast" nudge', () => {
    const spoken = speak([{ ms: 15_000, wpm: 185 }, { ms: 5000, wpm: 0 }]);
    expect(spoken.map((s) => s.kind)).toEqual(['fast']);
  });

  it('15 s fast and 15 s slow, alternating for 2 minutes, never gives opposite nudges within 60 s', () => {
    const spoken = speak(repeat([{ ms: 14_000, wpm: 185 }, { ms: 1000, wpm: 0 }, { ms: 14_000, wpm: 100 }, { ms: 1000, wpm: 0 }], 4));
    expect(spoken.length).toBeGreaterThan(0);
    for (let i = 1; i < spoken.length; i++) {
      if (spoken[i].kind !== spoken[i - 1].kind) expect(spoken[i].atMs - spoken[i - 1].atMs).toBeGreaterThanOrEqual(OPPOSITE_BLOCK_MS);
    }
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
    const { spoken, last } = run(ctrl, 'fast', 0, 10_900);
    expect(spoken).toEqual([]);
    expect(last.waitingForPause).toBe(true);
  });

  it('speaks once a pause of 600 ms arrives after ten seconds out of the zone', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200);
    expect(run(ctrl, 'fast', 10_300, 10_800, false, 10_300).spoken).toEqual([]); // 500 ms: not yet
    expect(run(ctrl, 'fast', 10_900, 11_000, false, 10_300).spoken).toEqual([SPOKEN_NUDGES.fast]);
  });

  it('does not count a short breath as a pause to speak in', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200);
    expect(run(ctrl, 'fast', 10_300, 10_700, false, 10_300).spoken).toEqual([]);
    expect(run(ctrl, 'fast', 10_800, 12_000).spoken).toEqual([]);
  });

  it('skips the nudge if no pause comes within six seconds', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200); // due at about 10.1 s
    run(ctrl, 'fast', 10_300, 16_500); // talking straight through
    const late = run(ctrl, 'fast', 16_600, 18_000, false, 16_600);
    expect(late.spoken).toEqual([]);
    expect(late.last.waitingForPause).toBe(false);
  });

  it('cancels a waiting nudge when you come back into the zone', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200);
    run(ctrl, 'in', 10_300, 10_500);
    expect(run(ctrl, 'fast', 10_600, 11_600, false, 10_600).spoken).toEqual([]);
  });

  it('never speaks when watching silently', () => {
    const ctrl = new NudgeController('watch');
    run(ctrl, 'fast', 0, 11_000);
    const { spoken, last } = run(ctrl, 'fast', 11_100, 13_000, false, 11_100);
    expect(spoken).toEqual([]);
    expect(last.waitingForPause).toBe(false);
  });

  it('speaks once per excursion and respects the 45 s cooldown', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200);
    expect(run(ctrl, 'fast', 10_300, 11_000, false, 10_300).spoken).toHaveLength(1); // at 10.9 s
    run(ctrl, 'in', 11_100, 11_500);
    run(ctrl, 'fast', 11_600, 22_000);
    expect(run(ctrl, 'fast', 22_100, 23_000, false, 22_100).spoken).toEqual([]); // inside the cooldown
    run(ctrl, 'in', 23_100, 23_500);
    run(ctrl, 'fast', 56_000, 66_500);
    expect(run(ctrl, 'fast', 66_600, 67_300, false, 66_600).spoken).toHaveLength(1); // 56 s later
  });

  it('blocks the opposite nudge for 60 s after the last one, even past the cooldown', () => {
    const ctrl = new NudgeController('coach');
    run(ctrl, 'fast', 0, 10_200);
    expect(run(ctrl, 'fast', 10_300, 11_000, false, 10_300).spoken).toEqual([SPOKEN_NUDGES.fast]); // at 10.9 s
    run(ctrl, 'in', 11_100, 40_000);
    run(ctrl, 'slow', 40_100, 56_000); // due from ~50 s, but "slow" is blocked until 70.9 s
    expect(run(ctrl, 'slow', 56_100, 57_000, false, 56_100).spoken).toEqual([]);
    run(ctrl, 'in', 57_100, 60_000);
    run(ctrl, 'slow', 60_100, 72_000);
    expect(run(ctrl, 'slow', 72_100, 73_000, false, 72_100).spoken).toEqual([SPOKEN_NUDGES.slow]);
  });

  it('does not count silence towards too slow', () => {
    const ctrl = new NudgeController('coach');
    const { spoken, last } = run(ctrl, 'slow', 0, 10_000, false, 0);
    expect(spoken).toEqual([]);
    expect(last.visual).toBeNull();
    expect(last.outOfZoneMs).toBe(0);
  });
});
