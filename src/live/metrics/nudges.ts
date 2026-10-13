/**
 * Decides when to nudge. The visual nudge (warm frame, ringed dot) shows as soon as pace
 * leaves the zone. In "Coach me out loud" mode a spoken nudge follows only after pace has
 * stayed out of the zone for SPOKEN_AFTER_MS of speaking, once per excursion, with a cooldown.
 * Silence never counts as "too slow".
 */
import type { PaceState } from './pace';

export type CoachMode = 'watch' | 'coach';

export const SPOKEN_AFTER_MS = 5000;
export const SPOKEN_COOLDOWN_MS = 20_000;

export const SPOKEN_NUDGES: Record<'fast' | 'slow', string> = {
  fast: 'Slow down. Let the result land.',
  slow: 'Pick it up a little.',
};

export interface NudgeState {
  /** Shown on screen now. */
  visual: 'fast' | 'slow' | null;
  /** Say this now (once), then null until the next excursion. */
  speak: string | null;
  /** How long pace has been out of the zone while speaking. */
  outOfZoneMs: number;
}

export class NudgeController {
  private excursionKind: 'fast' | 'slow' | null = null;
  private outMs = 0;
  private spokenThisExcursion = false;
  private lastSpokenAt = -Infinity;
  private lastTick: number | null = null;

  constructor(private mode: CoachMode) {}

  setMode(mode: CoachMode): void {
    this.mode = mode;
  }

  tick(state: PaceState | null, speaking: boolean, nowMs: number): NudgeState {
    const dt = this.lastTick === null ? 0 : Math.max(0, nowMs - this.lastTick);
    this.lastTick = nowMs;

    const out = state === 'fast' || state === 'slow' ? state : null;
    if (!out) {
      this.excursionKind = null;
      this.outMs = 0;
      this.spokenThisExcursion = false;
      return { visual: null, speak: null, outOfZoneMs: 0 };
    }
    if (out !== this.excursionKind) {
      this.excursionKind = out;
      this.outMs = 0;
      this.spokenThisExcursion = false;
    } else if (speaking) {
      this.outMs += dt;
    }

    let speak: string | null = null;
    if (
      this.mode === 'coach' &&
      speaking &&
      !this.spokenThisExcursion &&
      this.outMs > SPOKEN_AFTER_MS &&
      nowMs - this.lastSpokenAt >= SPOKEN_COOLDOWN_MS
    ) {
      speak = SPOKEN_NUDGES[out];
      this.spokenThisExcursion = true;
      this.lastSpokenAt = nowMs;
    }
    // While silent, slow isn't a problem worth showing.
    const visual = out === 'slow' && !speaking ? null : out;
    return { visual, speak, outOfZoneMs: this.outMs };
  }
}
