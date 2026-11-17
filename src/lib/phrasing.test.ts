import { describe, expect, it } from 'vitest';
import { categoryOf, classifyPhrasing, phrasingTrends } from './phrasing';
import type { StoredSession } from '@/storage/localDb';
import type { NaturalPhrasing } from '@/types/fieldNotes';

describe('phrasing classifier', () => {
  it.each([
    ['I went to the university', 'I went to university', 'article'],
    ['I am working in this company', 'I am working at this company', 'preposition'],
    ['Yesterday I go to the office', 'Yesterday I went to the office', 'tense'],
    ['I have finish the project', 'I have finished the project', 'tense'],
    ['two project were late', 'two projects were late', 'plural'],
    ['always I am late', 'I am always late', 'word_order'],
  ] as const)('“%s” → “%s” is %s', (a, b, expected) => {
    expect(classifyPhrasing(a, b)).toBe(expected);
  });

  it('isn’t sure about word choice, so the model’s label is used', () => {
    expect(classifyPhrasing('so much joyful', 'really happy')).toBeNull();
    expect(categoryOf({ original: 'so much joyful', natural: 'really happy', why: 'w', category: 'word_choice' })).toBe('word_choice');
    expect(categoryOf({ original: 'so much joyful', natural: 'really happy', why: 'w' })).toBe('other');
  });

  it('overrides the model when the words make the kind of change clear', () => {
    expect(categoryOf({ original: 'in Monday', natural: 'on Monday', why: 'w', category: 'word_choice' })).toBe('preposition');
  });
});

describe('phrasing trends', () => {
  const s = (id: string, day: number, items: NaturalPhrasing[]) => ({ id, createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, notes: { naturalPhrasing: items } }) as unknown as StoredSession;
  const p = (o: string, n: string): NaturalPhrasing => ({ original: o, natural: n, why: 'w' });

  it('groups repeated patterns across sessions, top three, with the newest examples', () => {
    const all = [
      s('a', 1, [p('I went to the university', 'I went to university'), p('in Monday', 'on Monday')]),
      s('b', 2, [p('I like the music', 'I like music'), p('Yesterday I go', 'Yesterday I went')]),
      s('c', 3, [p('a advice', 'advice'), p('in the weekend', 'on the weekend')]),
      s('d', 4, [p('so much joyful', 'really happy')]),
    ];
    const trends = phrasingTrends(all);
    expect(trends.map((t) => [t.category, t.count])).toEqual([
      ['article', 3],
      ['preposition', 2],
    ]);
    expect(trends[0].examples.map((e) => e.sessionId)).toEqual(['c', 'b']);
    expect(trends[0].sessions).toBe(3);
  });

  it('is empty without repeats', () => {
    expect(phrasingTrends([s('a', 1, [p('in Monday', 'on Monday')])])).toEqual([]);
  });
});
