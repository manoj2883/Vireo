/**
 * Decides when to nudge.
 *
 * The visual nudge (warm frame, ringed dot) shows as soon as pace leaves the zone.
 * In "Coach me out loud" mode a spoken nudge becomes due after pace has stayed out of the zone
 * for SPOKEN_AFTER_MS of speaking. It then waits for a pause of at least PAUSE_TO_SPEAK_MS, so
 * it never talks over you; if no pause comes within WAIT_FOR_PAUSE_MS it is skipped. Once per
 * excursion, with a cooldown. Silence never counts as "too slow".
 */
import type { PaceState } from './pace';

export type CoachMode = 'watch' | 'coach';
export type NudgeKind = 'fast' | 'slow';

export const SPOKEN_AFTER_MS = 5000;
export const PAUSE_TO_SPEAK_MS = 600;
export const WAIT_FOR_PAUSE_MS = 6000;
export const SPOKEN_COOLDOWN_MS = 20_000;

export const SPOKEN_NUDGES: Record<NudgeKind, string> = {
  fast: 'Slow down. Let the result land.',
  slow: 'Pick it up a little.',
};

export interface NudgeState {
  /** Shown on screen now. */
  visual: NudgeKind | null;
  /** Say this now (once). */
  speak: NudgeKind | null;
  /** A spoken nudge is due and waiting for a pause. */
  waitingForPause: boolean;
  /** How long pace has been out of the zone while speaking. */
  outOfZoneMs: number;
}

export class NudgeController {
  private excursionKind: NudgeKind | null = null;
  private outMs = 0;
  private spokenThisExcursion = false;
  private lastSpokenAt = -Infinity;
  private lastTick: number | null = null;
  private pending: { kind: NudgeKind; since: number } | null = null;

  constructor(private mode: CoachMode) {}

  setMode(mode: CoachMode): void {
    this.mode = mode;
    if (mode === 'watch') this.pending = null;
  }

  /**
   * @param state pace against the zone (null when unknown)
   * @param speaking the voice detector hears speech (including its hangover)
   * @param pauseMs length of the pause in progress, 0 while speaking
   */
  tick(state: PaceState | null, speaking: boolean, nowMs: number, pauseMs = 0): NudgeState {
    const dt = this.lastTick === null ? 0 : Math.max(0, nowMs - this.lastTick);
    this.lastTick = nowMs;
    const out: NudgeKind | null = state === 'fast' || state === 'slow' ? state : null;

    if (state === 'in') {
      // Back in the zone: the excursion is over, and so is any nudge waiting for a pause.
      this.excursionKind = null;
      this.outMs = 0;
      this.spokenThisExcursion = false;
      this.pending = null;
    } else if (out) {
      if (out !== this.excursionKind) {
        this.excursionKind = out;
        this.outMs = 0;
        this.spokenThisExcursion = false;
        this.pending = null;
      } else if (speaking) {
        this.outMs += dt;
      }
    }

    // Due: long enough out of the zone, coach mode, not yet said, not in the cooldown.
    if (
      this.mode === 'coach' &&
      !this.pending &&
      out &&
      !this.spokenThisExcursion &&
      this.outMs > SPOKEN_AFTER_MS &&
      nowMs - this.lastSpokenAt >= SPOKEN_COOLDOWN_MS
    ) {
      this.pending = { kind: out, since: nowMs };
    }

    let speak: NudgeKind | null = null;
    if (this.pending) {
      if (nowMs - this.pending.since > WAIT_FOR_PAUSE_MS) {
        // No pause came: skip it rather than interrupt.
        this.pending = null;
        this.spokenThisExcursion = true;
      } else if (!speaking && pauseMs >= PAUSE_TO_SPEAK_MS) {
        speak = this.pending.kind;
        this.pending = null;
        this.spokenThisExcursion = true;
        this.lastSpokenAt = nowMs;
      }
    }

    // While silent, slow isn't a problem worth showing.
    const visual = !out || (out === 'slow' && !speaking) ? null : out;
    return { visual, speak, waitingForPause: this.pending !== null, outOfZoneMs: this.outMs };
  }
}
