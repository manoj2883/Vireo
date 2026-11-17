// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidLandingLine, MAX_LANDING_WORDS, newVocabulary, verifyLanding, verifyStoryBeats } from './story.js';

const lines = [
  { speaker: 'user', text: 'Last spring our model refused half the questions.', startMs: 0 },
  { speaker: 'user', text: 'If we shipped it, students would get nothing.', startMs: 4000 },
  { speaker: 'user', text: 'Then we found the refusals were the right ones.', startMs: 9000 },
  { speaker: 'coach', text: 'Great, now land it.', startMs: 12000 },
];
const said = lines.filter((l) => l.speaker === 'user').map((l) => l.text).join(' ');

describe('story beats', () => {
  it('keeps beats quoted exactly, one per kind, in story order, and fixes their time', () => {
    const { storyBeats, dropped } = verifyStoryBeats(
      {
        present: [
          { kind: 'turn', quote: 'Then we found the refusals were the right ones', startMs: 50 },
          { kind: 'hook', quote: 'our model refused half the questions', startMs: 100 },
          { kind: 'stakes', quote: 'students would be devastated', startMs: 4000 },
          { kind: 'hook', quote: 'Last spring', startMs: 0 },
        ],
        missing: [],
      },
      lines
    );
    expect(storyBeats.present).toEqual([
      { kind: 'hook', quote: 'our model refused half the questions', startMs: 100 },
      { kind: 'turn', quote: 'Then we found the refusals were the right ones', startMs: 9000 },
    ]);
    expect(dropped).toBe(2);
    expect(storyBeats.missing.map((m) => m.kind)).toEqual(['stakes', 'payoff', 'landing']);
  });

  it('never quotes the coach as a beat', () => {
    expect(verifyStoryBeats({ present: [{ kind: 'landing', quote: 'now land it', startMs: 12000 }], missing: [] }, lines).storyBeats.present).toEqual([]);
  });

  it('keeps a missing beat’s suggestion only when it stays in the speaker’s vocabulary', () => {
    const { storyBeats } = verifyStoryBeats(
      {
        present: [],
        missing: [
          { kind: 'stakes', suggestion: 'Say why it mattered: "students would get nothing".' },
          { kind: 'payoff', suggestion: 'Mention the revolutionary blockchain partnership with Google and Microsoft.' },
        ],
      },
      lines
    );
    expect(storyBeats.missing.find((m) => m.kind === 'stakes')?.suggestion).toBe('Say why it mattered: "students would get nothing".');
    expect(storyBeats.missing.find((m) => m.kind === 'payoff')?.suggestion).toBeNull();
    expect(newVocabulary('Open with the moment our model refused.', said)).toEqual([]);
  });
});

describe('landing lines', () => {
  it(`rejects suggestions over ${MAX_LANDING_WORDS} words`, () => {
    const long = 'Then we found the refusals were the right ones and students would get nothing';
    expect(long.split(' ').length).toBeGreaterThan(MAX_LANDING_WORDS);
    expect(isValidLandingLine(long, said)).toBe(false);
    expect(isValidLandingLine('The refusals were the right ones.', said)).toBe(true);
  });

  it('rejects lines with words the speaker never said', () => {
    expect(isValidLandingLine('Refusals build trust.', said)).toBe(false);
  });

  it('offers at most two lines, and none when the answer already lands', () => {
    const ok = ['The refusals were the right ones.', 'Our model refused, and it was right.', 'Students would get nothing.'];
    const r = verifyLanding({ hasClearClose: false, suggestions: [...ok, 'A sentence with far too many words to ever be said in a single breath okay'] }, lines);
    expect(r.landing.suggestions).toEqual(ok.slice(0, 2));
    expect(verifyLanding({ hasClearClose: true, suggestions: ok }, lines).landing).toEqual({ hasClearClose: true, suggestions: [] });
    expect(verifyLanding(undefined, lines).landing).toEqual({ hasClearClose: false, suggestions: [] });
  });
});
