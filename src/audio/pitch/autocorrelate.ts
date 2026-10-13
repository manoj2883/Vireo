/**
 * Autocorrelation pitch estimate (a simplified McLeod pitch method).
 * Runs inside the pitch AudioWorklet, so it must stay dependency-free.
 */

export interface PitchOptions {
  minHz?: number;
  maxHz?: number;
  /** Frames quieter than this RMS are treated as silence. */
  rmsThreshold?: number;
  /** How clearly periodic a frame must be (0 to 1) to count as voiced. */
  clarityThreshold?: number;
}

/** Average groups of `factor` samples: a cheap low-pass and downsample. */
export function decimate(input: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return input;
  const out = new Float32Array(Math.floor(input.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += input[i * factor + k];
    out[i] = sum / factor;
  }
  return out;
}

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/**
 * Estimated fundamental in Hz, or null for silence and unvoiced frames.
 * Uses the normalised square difference function: nsdf(τ) = 2·r(τ) / m(τ).
 */
export function estimatePitch(buf: Float32Array, sampleRate: number, opts: PitchOptions = {}): number | null {
  const { minHz = 70, maxHz = 400, rmsThreshold = 0.01, clarityThreshold = 0.8 } = opts;
  if (rms(buf) < rmsThreshold) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(buf.length - 2, Math.ceil(sampleRate / minHz));
  if (maxLag <= minLag) return null;

  // nsdf over every lag from 0, so the first true period is found even when it is
  // shorter than minLag (a tone above maxHz must not be reported as a sub-harmonic).
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let r = 0;
    let m = 0;
    for (let i = 0; i + lag < buf.length; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      r += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * r) / m : 0;
  }

  // Key maxima: the highest point of each positive lobe after the first zero crossing.
  let lag = 1;
  while (lag <= maxLag && nsdf[lag] > 0) lag++;
  let globalMax = 0;
  const peaks: number[] = [];
  for (; lag <= maxLag; lag++) {
    if (nsdf[lag] > 0 && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] > nsdf[lag + 1]) {
      peaks.push(lag);
      globalMax = Math.max(globalMax, nsdf[lag]);
    }
  }
  if (globalMax < clarityThreshold) return null;

  // The first peak close to the best one is the fundamental, not an octave below.
  const chosen = peaks.find((p) => nsdf[p] >= 0.9 * globalMax);
  if (chosen === undefined || chosen < minLag) return null;

  // Parabolic interpolation for sub-sample accuracy.
  const a = nsdf[chosen - 1];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = chosen + shift;
  const hz = sampleRate / period;
  return hz >= minHz && hz <= maxHz ? hz : null;
}
