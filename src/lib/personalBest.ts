/**
 * "Your own best as the bar": comparisons use the speaker's best earlier take on the same question
 * (or story), and failing that the same situation, never a generic ideal. Pure.
 */
import type { StoredSession } from '@/storage/localDb';
import { ghostKey } from '@/live/metrics/ghost';

export type BestScope = 'question' | 'situation';

/** Earlier sessions on the same question or story; failing that, the same situation. */
export function comparableSessions(session: StoredSession, all: readonly StoredSession[]): { scope: BestScope; sessions: StoredSession[] } | null {
  const earlier = all.filter((s) => s.id !== session.id && s.createdAt < session.createdAt);
  const key = ghostKey(session.config.storyId ?? session.config.prompt);
  const same = earlier.filter((s) => ghostKey(s.config.storyId ?? s.config.prompt) === key);
  if (same.length) return { scope: 'question', sessions: same };
  const situation = session.config.situationId;
  const sameSituation = situation ? earlier.filter((s) => s.config.situationId === situation) : [];
  return sameSituation.length ? { scope: 'situation', sessions: sameSituation } : null;
}

/** Best = most time in the pace zone; ties go to fewer fillers (the same rule as ghost pace). */
export function bestTake(sessions: readonly StoredSession[]): StoredSession | null {
  let best: StoredSession | null = null;
  for (const s of sessions) {
    if (!best || s.metrics.timeInZonePct > best.metrics.timeInZonePct || (s.metrics.timeInZonePct === best.metrics.timeInZonePct && s.metrics.fillersPerMin < best.metrics.fillersPerMin)) best = s;
  }
  return best;
}

export interface PersonalBaseline {
  scope: BestScope;
  sessionId: string;
  fillersPerMin: number;
  timeInZonePct: number;
  pausesPerMin: number;
  avgWpm: number;
}

/** The numbers field notes are told to compare against. */
export function personalBaseline(session: StoredSession, all: readonly StoredSession[]): PersonalBaseline | null {
  const c = comparableSessions(session, all);
  const best = c && bestTake(c.sessions);
  if (!c || !best) return null;
  const m = best.metrics;
  return { scope: c.scope, sessionId: best.id, fillersPerMin: m.fillersPerMin, timeInZonePct: m.timeInZonePct, pausesPerMin: m.pausesPerMin, avgWpm: m.avgWpm };
}

/** Best earlier score in each dimension on this question or situation, with its scope. */
export function bestScoresFor(session: StoredSession, all: readonly StoredSession[]): ({ structure: number; delivery: number; clarity: number } & { scope: BestScope }) | null {
  const c = comparableSessions(session, all);
  const scored = c?.sessions.filter((s) => s.notes) ?? [];
  if (!c || !scored.length) return null;
  return {
    scope: c.scope,
    structure: Math.max(...scored.map((s) => s.notes!.scores.structure)),
    delivery: Math.max(...scored.map((s) => s.notes!.scores.delivery)),
    clarity: Math.max(...scored.map((s) => s.notes!.scores.clarity)),
  };
}
