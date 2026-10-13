/** Pace zones by kind of talk, from the warm-up design. */
export const TALK_TYPES = {
  interview: { label: 'Interview answer', zone: { min: 130, max: 160 }, focus: 'structure, fillers and getting to the point' },
  pitch: { label: 'Pitch', zone: { min: 140, max: 170 }, focus: 'energy, a clear ask and pace' },
  talk: { label: 'Talk or class', zone: { min: 120, max: 150 }, focus: 'signposting, pauses and pace' },
  toast: { label: 'Toast', zone: { min: 110, max: 140 }, focus: 'warmth, and pauses before the laughs' },
  free: { label: 'Just practise', zone: { min: 120, max: 160 }, focus: 'pace, fillers and pauses' },
} as const;

export type TalkType = keyof typeof TALK_TYPES;

export interface PaceZone {
  min: number;
  max: number;
}

export type PaceState = 'slow' | 'in' | 'fast';

export function paceState(wpm: number | null, zone: PaceZone): PaceState | null {
  if (wpm === null) return null;
  if (wpm < zone.min) return 'slow';
  if (wpm > zone.max) return 'fast';
  return 'in';
}

export const PACE_WINDOW_MS = 4000;

/** Shortest span pace is measured over, so the first word can't read as a spike. */
export const MIN_PACE_SPAN_MS = 1000;

/**
 * Raw words per minute over the rolling window ending at nowMs, from word start times.
 * Until the window fills, it measures from the first word instead, so a take doesn't
 * start out reading as slow.
 */
export function windowWpm(wordStartsMs: readonly number[], nowMs: number, windowMs = PACE_WINDOW_MS): number {
  if (wordStartsMs.length === 0) return 0;
  const first = Math.min(...wordStartsMs);
  const span = Math.max(MIN_PACE_SPAN_MS, Math.min(windowMs, nowMs - first));
  let n = 0;
  for (const t of wordStartsMs) if (t >= nowMs - span && t <= nowMs) n++;
  return (n * 60_000) / span;
}

/**
 * Smoothed live pace. Exponential smoothing with a time constant, so the dot glides instead
 * of jumping every time a few words land at once.
 */
export class PaceMeter {
  private value: number | null = null;
  private lastMs: number | null = null;

  constructor(
    private readonly windowMs = PACE_WINDOW_MS,
    private readonly tauMs = 1200
  ) {}

  /**
   * @param nowMs the clock, which drives the smoothing
   * @param windowEndMs where the pace window ends: the end of the latest transcribed word.
   *   Transcription lags speech, so a window ending at `nowMs` would always look too slow.
   */
  update(wordStartsMs: readonly number[], nowMs: number, windowEndMs = nowMs): number {
    // Nothing to measure yet: don't start smoothing from zero.
    if (wordStartsMs.length === 0) return this.value ?? 0;
    const raw = windowWpm(wordStartsMs, windowEndMs, this.windowMs);
    if (this.value === null || this.lastMs === null) {
      this.value = raw;
    } else {
      const dt = Math.max(0, nowMs - this.lastMs);
      const alpha = 1 - Math.exp(-dt / this.tauMs);
      this.value += (raw - this.value) * alpha;
    }
    this.lastMs = nowMs;
    return this.value;
  }

  get wpm(): number | null {
    return this.value === null ? null : Math.round(this.value);
  }

  reset(): void {
    this.value = null;
    this.lastMs = null;
  }
}
