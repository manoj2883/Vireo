// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { accuracyText, explanationFor, SCORE_EXPLANATIONS, type AccuracyFile, type ScoreId } from './scoreExplanations';
import { generatedDocs } from './generatedDocs';
import type { CompareKey } from './compare';
import type { StoredSession } from '@/storage/localDb';

const session = {
  id: 's',
  createdAt: '2026-10-12T10:00:00.000Z',
  config: { prompt: 'p', talkType: 'interview', situationId: 'interview', mode: 'watch', audience: false, hideFace: false },
  segments: [],
  pauses: [],
  transcript: [],
  metrics: { durationMs: 90_000, wordCount: 200, avgWpm: 142, timeInZonePct: 64, fillerCount: 6, fillersPerMin: 4, pauseCount: 5, pausesPerMin: 3.3, longestPauseMs: 1400 },
  take: { avgWpm: 142, inZoneRatio: 0.64, fillersPerMin: 4 },
  newBest: false,
  notesStatus: 'ready',
  notes: {
    verdict: 'v',
    summary: 's',
    scores: { structure: 70, delivery: 60, clarity: 80 },
    storyMap: { sections: [] },
    notes: [],
    audienceFollowUp: { question: 'q', reason: 'r' },
    drills: [],
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    droppedNotes: 2,
  },
} as StoredSession;

const unpublished: AccuracyFile = { published: false, recordings: 4, minRecordings: 10, commit: 'x', generatedAt: '', metrics: null };
const published: AccuracyFile = {
  published: true,
  recordings: 12,
  minRecordings: 10,
  commit: 'x',
  generatedAt: '',
  metrics: { fillerPrecision: { value: 0.9, ci: [0.8, 0.95] }, fillerRecall: { value: 0.75, ci: [0.6, 0.85] }, fillerF1: { value: 0.82, ci: [0.7, 0.9] } },
};

describe('score explanations', () => {
  it('explains every displayed score completely', () => {
    for (const e of Object.values(SCORE_EXPLANATIONS)) {
      expect(e.title, e.id).toBeTruthy();
      expect(e.measures, e.id).toMatch(/\.$/);
      expect(e.formula, e.id).toMatch(/\.$/);
      expect(accuracyText(e), e.id).toBeTruthy();
    }
    // Every measure Before and after can show has an explanation.
    const compareKeys: CompareKey[] = ['fillersPerMin', 'timeInZonePct', 'pausesPerMin', 'eyeContactPct', 'timeToMainPointMs'];
    for (const k of compareKeys) expect(SCORE_EXPLANATIONS[k as ScoreId], k).toBeDefined();
  });

  it('shows this session’s real inputs', () => {
    expect(explanationFor('fillersPerMin').inputs({ session })).toEqual([
      { label: 'Fillers counted', value: '6' },
      { label: 'Session length', value: '1.5 min' },
    ]);
    expect(explanationFor('timeInZonePct').inputs({ session })[0]).toEqual({ label: 'Your zone', value: '130 to 160 wpm' });
    expect(explanationFor('fillersPerMin').inputs({})).toEqual([]);
  });

  it('names a source for every target and never claims a study it doesn’t have', () => {
    for (const e of Object.values(SCORE_EXPLANATIONS)) {
      const t = e.target({ session });
      if (t) expect(t.source, e.id).toBeTruthy();
    }
    expect(explanationFor('pausesPerMin').target({})?.source).toMatch(/not from a published study/);
  });

  it('never invents accuracy: says not yet published until there are enough recordings', () => {
    const e = explanationFor('fillersPerMin');
    expect(accuracyText(e, {}, unpublished)).toBe('Accuracy not yet published: it needs at least 10 hand-labelled recordings (4 so far).');
    expect(accuracyText(e, {}, unpublished)).not.toMatch(/\d+\.\d%/);
    expect(accuracyText(e, {}, published)).toBe('Against 12 hand-labelled recordings: precision 90.0%, recall 75.0%, F1 82.0%.');
  });

  it('names the provider and model for model scores, and how many notes the evidence check dropped', () => {
    expect(accuracyText(explanationFor('structure'), { session })).toBe(
      'Scored by gemini (gemini-3.6-flash). This is a model’s judgement, not a measurement, so it has no accuracy figure. The evidence check dropped 2 notes that didn’t quote your words.'
    );
  });

  it('keeps the generated docs in sync (run `npm run docs` if this fails)', () => {
    const root = path.resolve(__dirname, '../..');
    for (const [file, render] of Object.entries(generatedDocs)) {
      const current = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null;
      expect(current, `${file} is out of date: run npm run docs`).toBe(render(current));
    }
  });
});
