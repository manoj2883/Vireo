import { describe, expect, it } from 'vitest';
import { adoptionRate, describeAdoption, describeRate, directionOf, fixAdoption, MIN_RETAKES_FOR_RATE, sentenceEndPausePct, TARGET_METRICS } from './fixAdoption';
import type { StoredSession } from '@/storage/localDb';
import type { FieldNotes, FixTargetMetric } from '@/types/fieldNotes';
import type { WordSegment } from '@/components/sonogram/types';

const NOW = new Date('2026-10-14T12:00:00Z');

function notes(targetMetric?: FixTargetMetric, extra: Partial<FieldNotes> = {}): FieldNotes {
  return {
    verdict: 'v',
    oneFix: { instruction: 'Cut the ums.', why: 'w', ...(targetMetric ? { targetMetric } : {}) },
    summary: 's',
    scores: { structure: 1, delivery: 1, clarity: 1 },
    storyMap: { sections: [] },
    notes: [],
    audienceFollowUp: { question: 'q', reason: 'r' },
    drills: [],
    ...extra,
  };
}

function take(id: string, minutesAgo: number, m: Partial<StoredSession['metrics']>, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    config: { prompt: 'p', talkType: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [],
    metrics: { durationMs: 60_000, wordCount: 150, avgWpm: 150, timeInZonePct: 50, fillerCount: 5, fillersPerMin: 3.8, pauseCount: 3, pausesPerMin: 3, longestPauseMs: 900, ...m },
    take: { avgWpm: 150, inZoneRatio: 0.5, fillersPerMin: 3.8 },
    newBest: false,
    notesStatus: 'ready',
    ...extra,
  };
}

const w = (text: string, startMs: number, endMs: number): WordSegment => ({ text, startMs, endMs, kind: 'speech' });

describe('sentence-end pauses', () => {
  it('counts sentence ends followed by a pause of at least 600 ms, ignoring the last word', () => {
    const segs = [w('One.', 0, 300), w('Two.', 1000, 1300), w('Three!', 1500, 1800), w('Four?', 2500, 2800), w('Five.', 3000, 3200)];
    // Ends: One.(700 gap) Two.(200) Three!(700) Four?(200) → 2 of 4.
    expect(sentenceEndPausePct(segs)).toBe(50);
  });

  it('is not measured with too few sentence ends', () => {
    expect(sentenceEndPausePct([w('One.', 0, 300), w('two', 1000, 1300)])).toBeNull();
  });
});

describe('fixAdoption', () => {
  it('adopts a fix whose target improves by the threshold without other measures slipping', () => {
    const before = take('a', 10, { fillersPerMin: 3.8 }, { notes: notes('fillers_per_min') });
    const after = take('b', 5, { fillersPerMin: 1.2 }, { retakeOf: 'a' });
    const a = fixAdoption(before, after)!;
    expect(a.status).toBe('adopted');
    expect(describeAdoption(a)).toBe('Fix adopted ✓ — fillers 3.8 → 1.2 a minute');
  });

  it('is not yet adopted when the change is under the threshold', () => {
    const before = take('a', 10, { fillersPerMin: 3.8 }, { notes: notes('fillers_per_min') });
    const after = take('b', 5, { fillersPerMin: 3.8 - TARGET_METRICS.fillers_per_min.threshold + 0.1 });
    expect(fixAdoption(before, after)!.status).toBe('not_yet');
  });

  it('is not yet adopted when a core measure clearly worsens', () => {
    const before = take('a', 10, { fillersPerMin: 4, timeInZonePct: 70 }, { notes: notes('fillers_per_min') });
    const after = take('b', 5, { fillersPerMin: 1, timeInZonePct: 40 });
    const a = fixAdoption(before, after)!;
    expect(a).toMatchObject({ status: 'not_yet', worsened: 'time_in_zone_pct' });
    expect(describeAdoption(a)).toContain('slipped');
  });

  it('handles higher-is-better targets', () => {
    const before = take('a', 10, { timeInZonePct: 40 }, { notes: notes('time_in_zone_pct') });
    expect(fixAdoption(before, take('b', 5, { timeInZonePct: 60 }))!.status).toBe('adopted');
    expect(fixAdoption(before, take('b', 5, { timeInZonePct: 30 }))!.status).toBe('not_yet');
  });

  it('measures time to the main point from the notes', () => {
    const before = take('a', 10, {}, { notes: notes('time_to_main_point_s', { mainPointMs: 25_000 }) });
    const after = take('b', 5, {}, { notes: notes(undefined, { mainPointMs: 6_000 }) });
    expect(fixAdoption(before, after)).toMatchObject({ status: 'adopted', before: 25, after: 6 });
    expect(fixAdoption(before, take('c', 5, {}, { notes: notes(undefined, { mainPointMs: null }) }))).toMatchObject({ status: 'not_measurable', reason: 'no_value' });
  });

  it('says so when a fix can’t be measured or predates tracking', () => {
    expect(fixAdoption(take('a', 10, {}, { notes: notes('not_measurable') }), take('b', 5, {}))).toMatchObject({ status: 'not_measurable', reason: 'not_measurable' });
    expect(fixAdoption(take('a', 10, {}, { notes: notes() }), take('b', 5, {}))).toMatchObject({ status: 'not_measurable', reason: 'older_notes' });
    expect(fixAdoption(take('a', 10, {}), take('b', 5, {}))).toBeNull();
  });

  it('never trusts a direction other than the target’s own', () => {
    expect(directionOf('fillers_per_min')).toBe('lower');
    expect(directionOf('sentence_end_pauses_pct')).toBe('higher');
    expect(directionOf('not_measurable')).toBeNull();
  });
});

describe('adoptionRate', () => {
  it('asks for more retakes below the minimum, then counts adopted of measured', () => {
    const first = take('a', 60, { fillersPerMin: 4 }, { notes: notes('fillers_per_min') });
    const r1 = take('b', 50, { fillersPerMin: 2 }, { retakeOf: 'a', notes: notes('fillers_per_min') });
    expect(adoptionRate([first, r1])).toEqual({ adopted: 1, measured: 1, enough: false });
    expect(describeRate(adoptionRate([first, r1]))).toBe('Do a few retakes to see this');

    const r2 = take('c', 40, { fillersPerMin: 1.9 }, { retakeOf: 'a', notes: notes('not_measurable') });
    const r3 = take('d', 30, { fillersPerMin: 1.8 }, { retakeOf: 'a', notes: notes('fillers_per_min') }); // after an unmeasurable fix: skipped
    const r4 = take('e', 20, { fillersPerMin: 0.5 }, { retakeOf: 'a', notes: notes('fillers_per_min') });
    const r5 = take('f', 10, { fillersPerMin: 0.4 }, { retakeOf: 'a', notes: notes('fillers_per_min') });
    const rate = adoptionRate([first, r1, r2, r3, r4, r5]);
    expect(rate.measured).toBeGreaterThanOrEqual(MIN_RETAKES_FOR_RATE);
    expect(rate).toEqual({ adopted: 2, measured: 4, enough: true });
    expect(describeRate(rate)).toBe('2 of 4 retakes');
  });
});
