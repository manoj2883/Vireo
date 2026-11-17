import { describe, expect, it } from 'vitest';
import { isMastered, masteredSkills, MASTERY_ADOPTED, MASTERY_WINDOW, skillModel, type Attempt } from './skills';
import { bestScoresFor, comparableSessions, personalBaseline } from './personalBest';
import type { StoredSession } from '@/storage/localDb';
import type { FieldNotes, FixTargetMetric } from '@/types/fieldNotes';

const T0 = Date.parse('2026-10-01T09:00:00Z');

function notes(targetMetric: FixTargetMetric = 'fillers_per_min', structure = 50): FieldNotes {
  return {
    verdict: 'v',
    oneFix: { instruction: 'i', why: 'w', targetMetric },
    summary: 's',
    scores: { structure, delivery: 50, clarity: 50 },
    storyMap: { sections: [] },
    notes: [],
    audienceFollowUp: { question: 'q', reason: 'r' },
    drills: [],
  };
}

function take(id: string, minute: number, fillers: number, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    createdAt: new Date(T0 + minute * 60_000).toISOString(),
    config: { prompt: 'Tell me about yourself.', situationId: 'interview', talkType: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [],
    metrics: { durationMs: 60_000, wordCount: 150, avgWpm: 150, timeInZonePct: 50, fillerCount: 3, fillersPerMin: fillers, pauseCount: 3, pausesPerMin: 3, longestPauseMs: 900 },
    take: { avgWpm: 150, inZoneRatio: 0.5, fillersPerMin: fillers },
    newBest: false,
    notesStatus: 'ready',
    notes: notes(),
    ...extra,
  };
}

const a = (adopted: boolean, seriesId: string): Attempt => ({ skill: 'fillers_per_min', adopted, sessionId: 'x', seriesId, createdAt: '' });

describe('skill memory', () => {
  it(`is mastered at ${MASTERY_ADOPTED} of the last ${MASTERY_WINDOW} attempts across 2 questions`, () => {
    expect(isMastered([a(true, 's1'), a(true, 's1'), a(true, 's2')])).toBe(true);
    expect(isMastered([a(true, 's1'), a(true, 's1'), a(true, 's1')])).toBe(false);
    expect(isMastered([a(true, 's1'), a(false, 's2'), a(true, 's2'), a(false, 's1')])).toBe(false);
    expect(isMastered([a(false, 's1'), a(false, 's1'), a(true, 's1'), a(true, 's2'), a(false, 's2'), a(true, 's2')])).toBe(true);
  });

  it('builds the model from sessions: new, practising, mastered', () => {
    const series = (root: string, start: number, values: number[]) =>
      values.map((f, i) => take(i === 0 ? root : `${root}-${i}`, start + i, f, i === 0 ? {} : { retakeOf: root }));
    const all = [...series('q1', 0, [5, 3, 2]), ...series('q2', 10, [6, 4, 3.8])];
    // q1: 5→3 adopted, 3→2 adopted; q2: 6→4 adopted, 4→3.8 not. Last 4: 3 adopted across 2 series.
    const model = skillModel(all);
    expect(model.find((s) => s.id === 'fillers_per_min')).toMatchObject({ status: 'mastered', recentAdopted: 3, recentAttempts: 4 });
    expect(model.find((s) => s.id === 'eye_contact_pct')?.status).toBe('new');
    expect(masteredSkills(all)).toEqual(['fillers_per_min']);
    const practising = [take('p', 0, 5, { notes: notes('time_in_zone_pct') })];
    expect(skillModel(practising).find((s) => s.id === 'time_in_zone_pct')?.status).toBe('practising');
  });
});

describe('personal best', () => {
  it('compares with earlier takes of the same question, else the same situation', () => {
    const now = take('now', 50, 3);
    const sameQ = take('q', 10, 4, { metrics: { ...now.metrics, timeInZonePct: 70, fillersPerMin: 4 } });
    const sameSit = take('s', 5, 1, { config: { ...now.config, prompt: 'Why this role?' } });
    const later = take('later', 60, 0);
    expect(comparableSessions(now, [now, sameQ, sameSit, later])).toMatchObject({ scope: 'question', sessions: [sameQ] });
    expect(comparableSessions(now, [now, sameSit])).toMatchObject({ scope: 'situation', sessions: [sameSit] });
    expect(comparableSessions(now, [now, later])).toBeNull();
    expect(personalBaseline(now, [now, sameQ])).toMatchObject({ scope: 'question', sessionId: 'q', timeInZonePct: 70, fillersPerMin: 4 });
  });

  it('scores against the best on this question', () => {
    const now = take('now', 50, 3);
    const earlier = [take('e1', 1, 3, { notes: notes('fillers_per_min', 80) }), take('e2', 2, 3, { notes: notes('fillers_per_min', 60) })];
    expect(bestScoresFor(now, [now, ...earlier])).toEqual({ scope: 'question', structure: 80, delivery: 50, clarity: 50 });
  });
});
