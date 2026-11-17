import { describe, expect, it } from 'vitest';
import { ATTENTION_GAP_MS, attentionDrift, engagementMoments, LIGHT_BEAT_DUE_MS, lightnessCues } from './attention';
import { EXAMPLE_PATTERNS, isNamedWord, isQuestion, LIGHT_PATTERNS, NUMBER_PATTERN, SIGNPOST_PATTERNS } from './attentionPatterns';
import type { WordSegment } from '@/components/sonogram/types';

/** Words spaced `gapMs` apart from `startMs`. */
function speak(text: string, startMs = 0, gapMs = 400): WordSegment[] {
  return text.split(' ').map((t, i) => ({ text: t, startMs: startMs + i * gapMs, endMs: startMs + i * gapMs + 300, kind: 'speech' }));
}

/** Plain explanation with no engagement markers at all, `n` words long. */
const plain = (n: number, startMs = 0) => speak(Array.from({ length: n }, (_, i) => (i % 7 === 6 ? 'process.' : 'the method uses the data')).join(' ').split(' ').slice(0, n).join(' '), startMs);

const any = (patterns: RegExp[], s: string) => patterns.some((p) => p.test(s));

describe('attention patterns', () => {
  it('finds signposts, examples, light beats and numbers', () => {
    expect(any(SIGNPOST_PATTERNS, "here's the part that matters")).toBe(true);
    expect(any(SIGNPOST_PATTERNS, 'first we looked')).toBe(true);
    expect(any(SIGNPOST_PATTERNS, 'the reason is simple')).toBe(true);
    expect(any(SIGNPOST_PATTERNS, 'the method uses the data')).toBe(false);
    expect(any(EXAMPLE_PATTERNS, 'for example the lab')).toBe(true);
    expect(any(EXAMPLE_PATTERNS, 'imagine a hospital')).toBe(true);
    expect(any(LIGHT_PATTERNS, 'we all laughed about it')).toBe(true);
    expect(any(LIGHT_PATTERNS, 'turns out it was the cable')).toBe(true);
    expect(NUMBER_PATTERN.test('42% of users')).toBe(true);
    expect(NUMBER_PATTERN.test('three weeks')).toBe(true);
    expect(NUMBER_PATTERN.test('the data')).toBe(false);
  });

  it('spots names mid-sentence but not sentence starts or "I"', () => {
    expect(isNamedWord('Priya', 'asked')).toBe(true);
    expect(isNamedWord('Boston.', 'in')).toBe(true);
    expect(isNamedWord('The', 'done.')).toBe(false);
    expect(isNamedWord('I', 'then')).toBe(false);
    expect(isNamedWord('Priya', undefined)).toBe(false);
    expect(isQuestion('right?')).toBe(true);
    expect(isQuestion('right.')).toBe(false);
  });
});

describe('attention timeline', () => {
  it('shows nothing for a session shorter than the gap', () => {
    expect(attentionDrift(plain(100))).toEqual([]); // 40 s
  });

  it('marks a stretch of 90 s or more with nothing that re-engages the listener', () => {
    const words = plain(300); // 120 s of plain explanation
    const bands = attentionDrift(words);
    expect(bands).toHaveLength(1);
    expect(bands[0].endMs - bands[0].startMs).toBeGreaterThanOrEqual(ATTENTION_GAP_MS);
  });

  it('a question, number or name inside the stretch breaks it up', () => {
    const words = plain(300);
    words[150] = { ...words[150], text: 'right?' };
    expect(attentionDrift(words)).toEqual([]);
    const withNumber = plain(300);
    withNumber[150] = { ...withNumber[150], text: 'seventeen' };
    expect(attentionDrift(withNumber)).toEqual([]);
  });

  it('counts story beats from the notes as engagement', () => {
    const words = plain(300);
    expect(attentionDrift(words, [60_000])).toEqual([]);
  });

  it('is deterministic', () => {
    const words = plain(400);
    expect(attentionDrift(words)).toEqual(attentionDrift(words));
    expect(engagementMoments(speak('First imagine Priya asked why?'))).toHaveLength(4);
  });
});

describe('lightness cues', () => {
  it('marks where a lighter beat was due in long heavy explanation, rotating techniques', () => {
    const words = plain(600); // 240 s
    const cues = lightnessCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0].atMs).toBeGreaterThanOrEqual(LIGHT_BEAT_DUE_MS);
    expect(cues.map((c) => c.technique)).toEqual(['callback', 'rule-of-three']);
  });

  it('a lighter moment resets the clock', () => {
    const words = plain(600);
    words[200] = { ...words[200], text: 'laughed' };
    words[400] = { ...words[400], text: 'laughed' };
    expect(lightnessCues(words)).toEqual([]);
  });

  it('nothing in a short answer', () => {
    expect(lightnessCues(plain(150))).toEqual([]);
  });

  it('snaps a cue to the next sentence end nearby', () => {
    const cues = lightnessCues(plain(600));
    const words = plain(600);
    expect(words.some((w) => w.endMs === cues[0].atMs && w.text.endsWith('.'))).toBe(true);
  });
});
