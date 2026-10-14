import { describe, expect, it } from 'vitest';
import { bestImprovementThisWeek, compareTakes, describeChange, previousTake, relativeImprovement, seriesOf, topImprovements } from './compare';
import type { StoredSession } from '@/storage/localDb';

const NOW = new Date('2026-10-14T12:00:00Z');

function take(id: string, daysAgo: number, m: Partial<StoredSession['metrics']>, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    config: { prompt: 'p', talkType: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [],
    metrics: { durationMs: 60_000, wordCount: 150, avgWpm: 150, timeInZonePct: 50, fillerCount: 5, fillersPerMin: 5, pauseCount: 3, pausesPerMin: 3, longestPauseMs: 900, ...m },
    take: { avgWpm: 150, inZoneRatio: 0.5, fillersPerMin: 5 },
    newBest: false,
    notesStatus: 'ready',
    ...extra,
  };
}

describe('series', () => {
  const first = take('a', 3, {});
  const second = take('b', 2, {}, { retakeOf: 'a' });
  const third = take('c', 1, {}, { retakeOf: 'a' });
  const other = take('x', 1, {});

  it('groups takes of the same question, oldest first', () => {
    expect(seriesOf(third, [third, other, first, second]).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(seriesOf(other, [third, other, first, second]).map((s) => s.id)).toEqual(['x']);
  });

  it('finds the take right before', () => {
    expect(previousTake(third, [first, second, third])?.id).toBe('b');
    expect(previousTake(first, [first, second, third])).toBeNull();
  });
});

describe('compareTakes', () => {
  const before = take('a', 2, { fillersPerMin: 5.4, timeInZonePct: 52, pausesPerMin: 2 }, {
    camera: { events: [], summary: { eyeContactPct: 60, longestLookAwayMs: 4000, postureAlerts: 1, gestureRate: 3, smilePct: 10, trackedMs: 60_000 } },
    notes: { mainPointMs: 21_000 } as StoredSession['notes'],
  });
  const after = take('b', 1, { fillersPerMin: 2.1, timeInZonePct: 71, pausesPerMin: 3.4 }, {
    retakeOf: 'a',
    config: { prompt: 'p', talkType: 'interview', mode: 'watch', audience: false, hideFace: false, retake: { fromSessionId: 'a', oneFix: 'Lead with your result.' } },
    camera: { events: [], summary: { eyeContactPct: 78, longestLookAwayMs: 2000, postureAlerts: 0, gestureRate: 4, smilePct: 20, trackedMs: 60_000 } },
    notes: { mainPointMs: 6000, previousFix: { achieved: true, evidence: 'The result was', startMs: 6000 } } as StoredSession['notes'],
  });

  it('computes each change with the right direction', () => {
    const { changes } = compareTakes(before, after);
    const by = Object.fromEntries(changes.map((c) => [c.key, c]));
    expect(by.fillersPerMin.improvement).toBeCloseTo(3.3);
    expect(by.timeInZonePct.improvement).toBe(19);
    expect(by.pausesPerMin.improvement).toBeCloseTo(1.4);
    expect(by.eyeContactPct.improvement).toBe(18);
    expect(by.timeToMainPointMs.improvement).toBe(15_000);
  });

  it('reports whether the fix was achieved, with its evidence', () => {
    expect(compareTakes(before, after).fix).toEqual({ instruction: 'Lead with your result.', achieved: true, evidence: 'The result was', startMs: 6000 });
    expect(compareTakes(before, take('c', 0, {})).fix).toBeNull();
  });

  it('leaves out measures one take lacks', () => {
    const keys = compareTakes(take('a', 2, {}), take('b', 1, {})).changes.map((c) => c.key);
    expect(keys).toEqual(['fillersPerMin', 'timeInZonePct', 'pausesPerMin']);
  });

  it('ranks improvements on a shared scale and drops regressions', () => {
    const worse = take('w', 1, { fillersPerMin: 8, timeInZonePct: 60, pausesPerMin: 3 });
    const top = topImprovements(compareTakes(take('a', 2, { fillersPerMin: 5, timeInZonePct: 50, pausesPerMin: 3 }), worse));
    expect(top.map((c) => c.key)).toEqual(['timeInZonePct']);
    expect(relativeImprovement({ key: 'fillersPerMin', label: '', before: 4, after: 2, improvement: 2, format: String })).toBe(0.5);
  });

  it('describes a change in plain words', () => {
    const [fillers] = compareTakes(before, after).changes;
    expect(describeChange(fillers)).toBe('Fillers down from 5.4 a minute to 2.1 a minute.');
    const zone = compareTakes(before, after).changes.find((c) => c.key === 'timeInZonePct')!;
    expect(describeChange(zone)).toBe('Time in your pace zone up from 52% to 71%.');
  });
});

describe('bestImprovementThisWeek', () => {
  it('picks the biggest improvement between consecutive takes in the last seven days', () => {
    const a = take('a', 5, { fillersPerMin: 6 });
    const b = take('b', 4, { fillersPerMin: 3 }, { retakeOf: 'a' });
    const c = take('c', 3, { timeInZonePct: 40 });
    const d = take('d', 2, { timeInZonePct: 45 }, { retakeOf: 'c' });
    const best = bestImprovementThisWeek([a, b, c, d], NOW)!;
    expect(best.session.id).toBe('b');
    expect(best.change.key).toBe('fillersPerMin');
  });

  it('ignores retakes older than a week', () => {
    const a = take('a', 12, { fillersPerMin: 6 });
    const b = take('b', 10, { fillersPerMin: 1 }, { retakeOf: 'a' });
    expect(bestImprovementThisWeek([a, b], NOW)).toBeNull();
  });
});
