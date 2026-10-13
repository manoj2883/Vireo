/**
 * Ghost pace: the user's best take for a prompt or story, replayed as a faint dot so each
 * rehearsal is a race against yourself.
 */
import type { PaceZone } from './pace';

export interface PaceTake {
  /** Prompt text or Story Bank id the take belongs to. */
  key: string;
  takeId: string;
  createdAt: string;
  /** Smoothed pace sampled once a second while speaking; null while silent. */
  trace: (number | null)[];
  avgWpm: number;
  inZoneRatio: number;
  fillersPerMin: number;
}

/** Normalise a free-text prompt so small edits still find the same ghost. */
export function ghostKey(promptOrStoryId: string): string {
  return promptOrStoryId.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '');
}

export function summariseTake(
  key: string,
  takeId: string,
  trace: (number | null)[],
  zone: PaceZone,
  fillerCount: number,
  durationMs: number,
  createdAt = new Date().toISOString()
): PaceTake {
  const spoken = trace.filter((v): v is number => v !== null);
  const avgWpm = spoken.length ? Math.round(spoken.reduce((s, v) => s + v, 0) / spoken.length) : 0;
  const inZone = spoken.filter((v) => v >= zone.min && v <= zone.max).length;
  return {
    key,
    takeId,
    createdAt,
    trace,
    avgWpm,
    inZoneRatio: spoken.length ? inZone / spoken.length : 0,
    fillersPerMin: durationMs > 0 ? (fillerCount * 60_000) / durationMs : 0,
  };
}

/** Better = more time in the zone; ties go to fewer fillers. Takes under 10 spoken seconds don't count. */
export function isBetterTake(candidate: PaceTake, current: PaceTake | null | undefined): boolean {
  const spoken = candidate.trace.filter((v) => v !== null).length;
  if (spoken < 10) return false;
  if (!current) return true;
  if (candidate.inZoneRatio !== current.inZoneRatio) return candidate.inZoneRatio > current.inZoneRatio;
  return candidate.fillersPerMin < current.fillersPerMin;
}

/** The ghost's pace at the same point in the take, or its average once the trace runs out. */
export function ghostWpmAt(take: PaceTake | null | undefined, elapsedMs: number): number | null {
  if (!take) return null;
  const v = take.trace[Math.floor(elapsedMs / 1000)];
  return v ?? (take.avgWpm || null);
}
