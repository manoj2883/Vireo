import { describe, expect, it } from 'vitest';
import { keyPointResults } from './storyPoints';
import type { StoredSession, StoredStory } from '@/storage/localDb';
import type { StorySection } from '@/types/fieldNotes';

const story: StoredStory = {
  id: 'st',
  kind: 'story',
  title: 'The judge that learned to say no',
  tag: 'Research',
  length: '2 minutes',
  gist: '',
  keyPoints: ['Similarity thresholds failed', 'The two-stage judge', 'What we measure next'],
  createdAt: '',
  updatedAt: '',
};

function sessionWith(sections: StorySection[]): StoredSession {
  return {
    notes: {
      verdict: '',
      summary: '',
      scores: { structure: 0, delivery: 0, clarity: 0 },
      storyMap: { sections },
      notes: [],
      audienceFollowUp: { question: '', reason: '' },
      drills: [],
    },
  } as unknown as StoredSession;
}

describe('keyPointResults', () => {
  it('counts a key point as hit when the model paraphrased it, matching by its number', () => {
    const session = sessionWith([
      { title: 'Why cosine cut-offs broke', startMs: 0, endMs: 4000, outlinePoint: 'The similarity cut-offs stopped working', outlineIndex: 1, status: 'hit' },
      { title: 'A judge that checks claims', startMs: 4000, endMs: 9000, outlinePoint: 'A two-step judge', outlineIndex: 2, status: 'hit' },
      { title: 'Next steps', startMs: null, endMs: null, outlinePoint: 'What we measure next', outlineIndex: 3, status: 'missed' },
    ]);
    expect(keyPointResults(story, session)).toEqual([
      { label: 'Similarity thresholds failed', hit: true },
      { label: 'The two-stage judge', hit: true },
      { label: 'What we measure next', hit: false },
    ]);
  });

  it('counts a point hit if any of its sections hit', () => {
    const session = sessionWith([
      { title: 'a', startMs: 0, endMs: 1, outlinePoint: 'x', outlineIndex: 2, status: 'missed' },
      { title: 'b', startMs: 1, endMs: 2, outlinePoint: 'y', outlineIndex: 2, status: 'hit' },
    ]);
    expect(keyPointResults(story, session)[1].hit).toBe(true);
  });

  it('still matches notes written before outlineIndex existed, by text', () => {
    const session = sessionWith([{ title: 'a', startMs: 0, endMs: 1, outlinePoint: 'the two-stage judge', status: 'hit' }]);
    expect(keyPointResults(story, session).map((r) => r.hit)).toEqual([false, true, false]);
  });

  it('says nothing yet for a story never rehearsed', () => {
    expect(keyPointResults(story).map((r) => r.hit)).toEqual([null, null, null]);
  });
});
