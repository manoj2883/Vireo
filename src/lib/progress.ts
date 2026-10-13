/**
 * Turns stored sessions into Home's headline and numbers. Pure, so it can be tested with
 * fixed sessions.
 */
import type { StoredSession } from '@/storage/localDb';
import { oneDecimal } from './format';

const DAY = 86_400_000;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive days with a session, counting back from today (or yesterday, if not yet today). */
export function streakDays(sessions: readonly StoredSession[], now = new Date()): number {
  const days = new Set(sessions.map((s) => dayKey(new Date(s.createdAt))));
  let cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY);
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor = new Date(cursor.getTime() - DAY);
  }
  return n;
}

function partOfDay(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export function kicker(sessions: readonly StoredSession[], now = new Date()): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const streak = streakDays(sessions, now);
  const base = `${day} ${partOfDay(now)}`;
  if (streak >= 2) return `${base}, and a ${streak}-day streak`;
  return base;
}

export interface Headline {
  title: string;
  detail: string;
}

/**
 * Headline built from real progress, newest session first in `sessions`.
 * Compares the first and latest sessions on fillers, then on time in the pace zone.
 */
export function progressHeadline(sessions: readonly StoredSession[]): Headline {
  if (sessions.length === 0) {
    return {
      title: 'Your first session starts here.',
      detail: 'Pick something you need to say well, speak for a minute or two, and Vireo will draw it back to you.',
    };
  }
  const latest = sessions[0];
  const nextFix = latest.notes?.notes.find((n) => n.kind === 'fix')?.title.replace(/\.$/, '');
  const nextLine = nextFix ? ` The next thing to work on: ${nextFix.charAt(0).toLowerCase()}${nextFix.slice(1)}.` : '';

  if (sessions.length === 1) {
    return {
      title: 'One session in. Here’s where you start.',
      detail: `${oneDecimal(latest.metrics.fillersPerMin)} fillers a minute and ${latest.metrics.timeInZonePct}% of the time in your pace zone.${nextLine}`,
    };
  }

  const first = sessions[sessions.length - 1];
  const f0 = first.metrics.fillersPerMin;
  const f1 = latest.metrics.fillersPerMin;
  if (f0 > 0 && f1 <= f0 / 2) {
    return {
      title: 'Your fillers are down by more than half.',
      detail: `From ${oneDecimal(f0)} a minute in your first session to ${oneDecimal(f1)} in your latest.${nextLine}`,
    };
  }
  if (f0 > 0 && f1 < f0) {
    return {
      title: 'Your fillers are coming down.',
      detail: `From ${oneDecimal(f0)} a minute in your first session to ${oneDecimal(f1)} in your latest.${nextLine}`,
    };
  }
  const z0 = first.metrics.timeInZonePct;
  const z1 = latest.metrics.timeInZonePct;
  if (z1 > z0) {
    return {
      title: 'You’re in your pace zone more often.',
      detail: `${z1}% of your latest session, up from ${z0}% in your first.${nextLine}`,
    };
  }
  return {
    title: `${sessions.length} sessions in. Keep the reps coming.`,
    detail: `Your latest: ${oneDecimal(f1)} fillers a minute and ${z1}% in your pace zone.${nextLine}`,
  };
}

export interface HomeNumbers {
  timeInZonePct: number | null;
  timeInZoneChange: number | null;
  pausesPerMin: number | null;
  minutesThisWeek: number;
  sessionsThisWeek: number;
  followUpsWaiting: StoredSession[];
}

export function homeNumbers(sessions: readonly StoredSession[], now = new Date()): HomeNumbers {
  const latest = sessions[0];
  const twoWeeksAgo = sessions.find((s) => now.getTime() - new Date(s.createdAt).getTime() >= 14 * DAY);
  const weekAgo = now.getTime() - 7 * DAY;
  const thisWeek = sessions.filter((s) => new Date(s.createdAt).getTime() >= weekAgo);
  const answered = new Set(sessions.map((s) => s.config.parentSessionId).filter(Boolean));
  return {
    timeInZonePct: latest ? latest.metrics.timeInZonePct : null,
    timeInZoneChange: latest && twoWeeksAgo ? latest.metrics.timeInZonePct - twoWeeksAgo.metrics.timeInZonePct : null,
    pausesPerMin: latest ? latest.metrics.pausesPerMin : null,
    minutesThisWeek: Math.round(thisWeek.reduce((m, s) => m + s.metrics.durationMs, 0) / 60_000),
    sessionsThisWeek: thisWeek.length,
    followUpsWaiting: sessions.filter((s) => s.config.audience && s.notes?.audienceFollowUp && !answered.has(s.id)),
  };
}

/** Best previous score for each dimension, excluding the session itself. */
export function bestScores(sessions: readonly StoredSession[], excludeId: string): { structure: number; delivery: number; clarity: number } | null {
  const scored = sessions.filter((s) => s.id !== excludeId && s.notes);
  if (!scored.length) return null;
  return {
    structure: Math.max(...scored.map((s) => s.notes!.scores.structure)),
    delivery: Math.max(...scored.map((s) => s.notes!.scores.delivery)),
    clarity: Math.max(...scored.map((s) => s.notes!.scores.clarity)),
  };
}
