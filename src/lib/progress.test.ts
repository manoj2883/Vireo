import { describe, expect, it } from 'vitest';
import { bestScores, homeNumbers, kicker, progressHeadline, streakDays } from './progress';
import { clock, durationWords, relativeDay, signed } from './format';
import type { StoredSession } from '@/storage/localDb';
import type { FieldNotes } from '@/types/fieldNotes';

const NOW = new Date(2026, 9, 13, 9, 30); // Tuesday morning

function session(daysAgo: number, over: Partial<StoredSession['metrics']> = {}, extra: Partial<StoredSession> = {}): StoredSession {
  const createdAt = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `s${daysAgo}`,
    createdAt,
    config: { prompt: 'p', talkType: 'interview', mode: 'coach', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [],
    metrics: { durationMs: 120_000, wordCount: 300, avgWpm: 150, timeInZonePct: 60, fillerCount: 6, fillersPerMin: 3, pauseCount: 6, pausesPerMin: 3, longestPauseMs: 1200, ...over },
    take: { avgWpm: 150, inZoneRatio: 0.6, fillersPerMin: 3 },
    newBest: false,
    notesStatus: 'ready',
    ...extra,
  };
}

const notes = (scores: FieldNotes['scores'], fixTitle = 'You rushed your result.'): FieldNotes => ({
  verdict: 'v',
  summary: 's',
  scores,
  storyMap: { sections: [] },
  notes: [{ kind: 'fix', title: fixTitle, body: 'b', quote: 'q', startMs: 0 }],
  audienceFollowUp: { question: 'Why?', reason: 'r' },
  drills: [{ title: 'd', instructions: 'i', minutes: 4 }],
});

describe('progressHeadline', () => {
  it('welcomes a first-time speaker', () => {
    expect(progressHeadline([]).title).toBe('Your first session starts here.');
  });

  it('celebrates fillers down by more than half, naming the next fix', () => {
    const h = progressHeadline([
      session(1, { fillersPerMin: 2.1 }, { notes: notes({ structure: 1, delivery: 1, clarity: 1 }) }),
      session(5, { fillersPerMin: 3.8 }),
      session(20, { fillersPerMin: 5.4 }),
    ]);
    expect(h.title).toBe('Your fillers are down by more than half.');
    expect(h.detail).toBe('From 5.4 a minute in your first session to 2.1 in your latest. The next thing to work on: you rushed your result.');
  });

  it('falls back to pace-zone progress when fillers did not improve', () => {
    const h = progressHeadline([session(1, { timeInZonePct: 71 }), session(14, { timeInZonePct: 52 })]);
    expect(h.title).toBe('You’re in your pace zone more often.');
    expect(h.detail).toContain('71% of your latest session, up from 52%');
  });
});

describe('streak and kicker', () => {
  it('counts consecutive days, allowing today to be empty so far', () => {
    expect(streakDays([session(1), session(2), session(3), session(5)], NOW)).toBe(3);
    expect(streakDays([session(0), session(1)], NOW)).toBe(2);
    expect(streakDays([session(3)], NOW)).toBe(0);
  });

  it('says the day, part of day and streak', () => {
    expect(kicker([session(1), session(2), session(3), session(4)], NOW)).toBe('Tuesday morning, and a 4-day streak');
    expect(kicker([], NOW)).toBe('Tuesday morning');
  });
});

describe('homeNumbers', () => {
  it('reports zone time, change over two weeks, practice this week and waiting follow-ups', () => {
    const asked = session(1, { timeInZonePct: 71, durationMs: 300_000 }, { id: 'asked', config: { prompt: 'p', talkType: 'interview', mode: 'coach', audience: true, hideFace: false }, notes: notes({ structure: 1, delivery: 1, clarity: 1 }) });
    const answeredParent = session(2, {}, { id: 'parent', config: { prompt: 'p', talkType: 'interview', mode: 'coach', audience: true, hideFace: false }, notes: notes({ structure: 1, delivery: 1, clarity: 1 }) });
    const answer = session(2, { durationMs: 60_000 }, { id: 'answer', config: { prompt: 'Why?', talkType: 'interview', mode: 'coach', audience: false, hideFace: false, parentSessionId: 'parent' } });
    const old = session(15, { timeInZonePct: 52 });
    const n = homeNumbers([asked, answer, answeredParent, old], NOW);
    expect(n).toMatchObject({ timeInZonePct: 71, timeInZoneChange: 19, minutesThisWeek: 8, sessionsThisWeek: 3 });
    expect(n.followUpsWaiting.map((s) => s.id)).toEqual(['asked']);
  });
});

describe('bestScores', () => {
  it('finds the best previous score per dimension, excluding the current session', () => {
    const a = session(1, {}, { id: 'a', notes: notes({ structure: 82, delivery: 64, clarity: 77 }) });
    const b = session(2, {}, { id: 'b', notes: notes({ structure: 76, delivery: 73, clarity: 74 }) });
    expect(bestScores([a, b], 'a')).toEqual({ structure: 76, delivery: 73, clarity: 74 });
    expect(bestScores([a], 'a')).toBeNull();
  });
});

describe('format', () => {
  it('formats clocks, durations, days and signed numbers', () => {
    expect(clock(134_000)).toBe('2:14');
    expect(durationWords(252_000)).toBe('4 minutes 12 seconds');
    expect(durationWords(60_000)).toBe('1 minute');
    expect(relativeDay(new Date(NOW.getTime() - 86_400_000).toISOString(), NOW)).toBe('Yesterday');
    expect(relativeDay(new Date(2026, 8, 22).toISOString(), NOW)).toBe('22 Sept');
    expect(signed(6)).toBe('+6');
    expect(signed(-9)).toBe('−9');
  });
});
