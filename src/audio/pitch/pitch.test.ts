import { describe, expect, it } from 'vitest';
import { decimate, estimatePitch, rms } from './autocorrelate';
import { pitchForWord } from './samples';

const SR = 48_000;

function sine(hz: number, ms = 43, amp = 0.3, sampleRate = SR, harmonics = false): Float32Array {
  const n = Math.round((ms / 1000) * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = amp * Math.sin(2 * Math.PI * hz * t);
    if (harmonics) out[i] += amp * 0.6 * Math.sin(4 * Math.PI * hz * t) + amp * 0.3 * Math.sin(6 * Math.PI * hz * t);
  }
  return out;
}

function noise(n: number, amp = 0.3, seed = 7): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amp * ((s / 0x7fffffff) * 2 - 1);
  }
  return out;
}

describe('estimatePitch', () => {
  it.each([90, 120, 165, 220, 310])('finds a %i Hz tone within 2%%', (hz) => {
    const est = estimatePitch(sine(hz), SR);
    expect(est).not.toBeNull();
    expect(Math.abs(est! - hz) / hz).toBeLessThan(0.02);
  });

  it('finds the fundamental of a voice-like tone with harmonics, not an octave off', () => {
    const est = estimatePitch(sine(140, 43, 0.3, SR, true), SR);
    expect(Math.abs(est! - 140) / 140).toBeLessThan(0.02);
  });

  it('works after downsampling to about 16 kHz, as the worklet does', () => {
    const est = estimatePitch(decimate(sine(200), 3), SR / 3);
    expect(Math.abs(est! - 200) / 200).toBeLessThan(0.03);
  });

  it('returns null for silence', () => {
    expect(estimatePitch(new Float32Array(2048), SR)).toBeNull();
  });

  it('returns null for unvoiced noise', () => {
    expect(estimatePitch(noise(2048), SR)).toBeNull();
  });

  it('ignores tones outside the speaking range', () => {
    expect(estimatePitch(sine(1200), SR)).toBeNull();
  });
});

describe('decimate and rms', () => {
  it('averages groups of samples', () => {
    expect(Array.from(decimate(new Float32Array([1, 3, 5, 7, 9, 11]), 2))).toEqual([2, 6, 10]);
    expect(decimate(new Float32Array([1, 2]), 1)).toHaveLength(2);
  });

  it('measures loudness', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe('pitchForWord', () => {
  const samples = [
    { timeMs: 0, hz: 120 },
    { timeMs: 20, hz: 130 },
    { timeMs: 40, hz: null },
    { timeMs: 60, hz: 150 },
    { timeMs: 80, hz: 160 },
    { timeMs: 200, hz: 300 },
  ];

  it('resamples the readings inside a word to evenly spaced points', () => {
    expect(pitchForWord(samples, 0, 80, 5)).toEqual([120, 130, 0, 150, 160]);
  });

  it('gives up when fewer than two readings are voiced', () => {
    expect(pitchForWord(samples, 30, 50)).toBeUndefined();
    expect(pitchForWord(samples, 500, 600)).toBeUndefined();
  });
});
