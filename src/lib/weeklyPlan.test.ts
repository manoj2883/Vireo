import { describe, expect, it } from 'vitest';
import { buildWeeklyPlan, DRILL_LIBRARY, isoWeek, PLAN_SIZE } from './weeklyPlan';
import type { StoredSession } from '@/storage/localDb';
import type { FixTargetMetric } from '@/types/fieldNotes';

function take(id: string, minute: number, fillers: number, target: FixTargetMetric, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    createdAt: new Date(Date.parse('2026-11-10T09:00:00Z') + minute * 60_000).toISOString(),
    config: { prompt: 'p', talkType: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [],
    metrics: { durationMs: 60_000, wordCount: 150, avgWpm: 150, timeInZonePct: 50, fillerCount: 3, fillersPerMin: fillers, pauseCount: 3, pausesPerMin: 3, longestPauseMs: 900 },
    take: { avgWpm: 150, inZoneRatio: 0.5, fillersPerMin: fillers },
    newBest: false,
    notesStatus: 'ready',
    notes: {
      verdict: 'v',
      oneFix: { instruction: 'i', why: 'w', targetMetric: target },
      summary: 's',
      scores: { structure: 1, delivery: 1, clarity: 1 },
      storyMap: { sections: [] },
      notes: [],
      audienceFollowUp: { question: 'q', reason: 'r' },
      drills: [],
    },
    ...extra,
  };
}

describe('weekly plan', () => {
  it('uses ISO weeks', () => {
    expect(isoWeek(new Date('2026-11-17T12:00:00'))).toBe('2026-W47');
    expect(isoWeek(new Date('2027-01-01T12:00:00'))).toBe('2026-W53');
  });

  it('has nothing to plan without sessions', () => {
    expect(buildWeeklyPlan([])).toBeNull();
  });

  it('picks the weakest practising skills first, then new ones, three drills', () => {
    // Fillers: chosen and adopted (5 → 2). Pace zone: chosen, never adopted. Main point: chosen once.
    const all = [
      take('a', 0, 5, 'fillers_per_min'),
      take('b', 1, 2, 'time_in_zone_pct', { retakeOf: 'a' }),
      take('c', 2, 2, 'time_to_main_point_s', { retakeOf: 'a' }),
    ];
    const plan = buildWeeklyPlan(all, new Date('2026-11-17T12:00:00'))!;
    expect(plan.week).toBe('2026-W47');
    expect(plan.drills).toHaveLength(PLAN_SIZE);
    // b retook a's fillers fix and adopted it; c retook b's pace-zone fix without improving it.
    expect(plan.drills.map((d) => d.skill)).toEqual(['time_in_zone_pct', 'time_to_main_point_s', 'fillers_per_min']);
    expect(DRILL_LIBRARY.time_in_zone_pct).toContainEqual(expect.objectContaining({ title: plan.drills[0].title }));
  });

  it('is the same all week and changes drills the next week', () => {
    const all = [take('a', 0, 5, 'fillers_per_min')];
    const mon = buildWeeklyPlan(all, new Date('2026-11-16T09:00:00'))!;
    const sun = buildWeeklyPlan(all, new Date('2026-11-22T21:00:00'))!;
    const next = buildWeeklyPlan(all, new Date('2026-11-23T09:00:00'))!;
    expect(sun).toEqual(mon);
    expect(next.drills[0].title).not.toBe(mon.drills[0].title);
  });

  it('leaves eye contact out unless the camera has been used', () => {
    const plan = buildWeeklyPlan([take('a', 0, 5, 'not_measurable')])!;
    expect(plan.drills.map((d) => d.skill)).not.toContain('eye_contact_pct');
  });
});
