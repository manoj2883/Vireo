import { describe, expect, it } from 'vitest';
import { wordDiff } from './wordDiff';

describe('wordDiff', () => {
  it('strikes removed fillers and keeps the speaker’s words', () => {
    const d = wordDiff('Um so basically the answers it refused were right', 'The answers it refused were right');
    expect(d.filter((t) => t.op === 'removed').map((t) => t.text)).toEqual(['Um', 'so', 'basically']);
    expect(d.filter((t) => t.op === 'keep').map((t) => t.text)).toEqual(['The', 'answers', 'it', 'refused', 'were', 'right']);
    expect(d.some((t) => t.op === 'added')).toBe(false);
  });

  it('keeps pause marks from the script in place', () => {
    const d = wordDiff('the result was better', 'The result / was better');
    expect(d.map((t) => (t.op === 'pause' ? '/' : t.text))).toEqual(['The', 'result', '/', 'was', 'better']);
  });

  it('shows a moved main point as removed in one place and added in another', () => {
    const d = wordDiff('first some context then the result', 'the result. first some context');
    expect(d.some((t) => t.op === 'added')).toBe(true);
    expect(d.some((t) => t.op === 'removed')).toBe(true);
  });

  it('ignores case and punctuation when matching', () => {
    expect(wordDiff('Say, no.', 'say no').every((t) => t.op === 'keep')).toBe(true);
  });
});
