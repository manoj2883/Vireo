/** Pace zones by kind of talk, from the warm-up design. */
export const TALK_TYPES = {
  interview: { label: 'Interview answer', zone: { min: 130, max: 160 }, focus: 'structure, fillers and getting to the point' },
  pitch: { label: 'Pitch', zone: { min: 140, max: 170 }, focus: 'energy, a clear ask and pace' },
  talk: { label: 'Talk or class', zone: { min: 120, max: 150 }, focus: 'signposting, pauses and pace' },
  toast: { label: 'Toast', zone: { min: 110, max: 140 }, focus: 'warmth, and pauses before the laughs' },
  english: { label: 'Speaking English with confidence', zone: { min: 110, max: 150 }, focus: 'a steady pace, fewer fillers and complete sentences' },
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

/** Window for the visual pace dot only: short, so the dot reacts while you speak. */
export const PACE_WINDOW_MS = 4000;

/** Window for every nudge decision: long enough (~30 words) that one pause or burst can't flip it. */
export const NUDGE_PACE_WINDOW_MS = 12_000;

/** Silences longer than this are left out of pace (articulation rate); the pause ring coaches them. */
export const PAUSE_EXCLUDE_MS = 700;

/** How far past a zone edge pace must go to count as out, so it doesn't flicker at the edge. */
export const HYSTERESIS_WPM = 10;

/** Shortest span pace is measured over, so the first word can't read as a spike. */
export const MIN_PACE_SPAN_MS = 1000;

export interface Span {
  startMs: number;
  endMs: number;
}

/** Silences between consecutive words that are long enough to leave out of pace. */
export function longPauses(words: readonly Span[], minMs = PAUSE_EXCLUDE_MS): Span[] {
  const out: Span[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = { startMs: words[i - 1].endMs, endMs: words[i].startMs };
    if (gap.endMs - gap.startMs > minMs) out.push(gap);
  }
  return out;
}

/**
 * Raw words per minute over the rolling window ending at nowMs, from word start times.
 * Until the window fills, it measures from the first word instead, so a take doesn't
 * start out reading as slow. Time inside `pauses` is left out of the span, so pausing
 * doesn't make the speaker look slow.
 */
export function windowWpm(wordStartsMs: readonly number[], nowMs: number, windowMs = PACE_WINDOW_MS, pauses: readonly Span[] = []): number {
  if (wordStartsMs.length === 0) return 0;
  const first = Math.min(...wordStartsMs);
  const span = Math.min(windowMs, nowMs - first);
  const from = nowMs - Math.max(MIN_PACE_SPAN_MS, span);
  let paused = 0;
  for (const p of pauses) paused += Math.max(0, Math.min(p.endMs, nowMs) - Math.max(p.startMs, from));
  const speakingSpan = Math.max(MIN_PACE_SPAN_MS, span - paused);
  let n = 0;
  for (const t of wordStartsMs) if (t >= from && t <= nowMs) n++;
  return (n * 60_000) / speakingSpan;
}

/**
 * Pace state with hysteresis: enter `fast` above max + HYSTERESIS_WPM and stay until below max;
 * enter `slow` below min - HYSTERESIS_WPM and stay until above min.
 */
export function nextPaceState(prev: PaceState | null, wpm: number | null, zone: PaceZone, hysteresis = HYSTERESIS_WPM): PaceState | null {
  if (wpm === null) return null;
  if (prev === 'fast' && wpm >= zone.max) return 'fast';
  if (prev === 'slow' && wpm <= zone.min) return 'slow';
  if (wpm > zone.max + hysteresis) return 'fast';
  if (wpm < zone.min - hysteresis) return 'slow';
  return 'in';
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
   * @param pauses silences to leave out of the span (see `longPauses`)
   */
  update(wordStartsMs: readonly number[], nowMs: number, windowEndMs = nowMs, pauses: readonly Span[] = []): number {
    // Nothing to measure yet: don't start smoothing from zero.
    if (wordStartsMs.length === 0) return this.value ?? 0;
    const raw = windowWpm(wordStartsMs, windowEndMs, this.windowMs, pauses);
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
