// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { indexTranscript, normalizeForQuote, verifyNotes } from './evidence.js';

const LINES = [
  { speaker: 'user', text: 'So my research is about teaching AI systems to say no', startMs: 400 },
  { speaker: 'user', text: 'when they don’t have the evidence. Um, so basically,', startMs: 4300 },
  { speaker: 'coach', text: 'Slow down. Let the result land.', startMs: 6000 },
  { speaker: 'user', text: 'the answers it refused were the right ones to refuse.', startMs: 7200 },
];

const note = (quote, startMs = 0) => ({ kind: 'fix', title: 't', body: 'b', quote, startMs });

describe('normalizeForQuote', () => {
  it('normalises whitespace and punctuation, and nothing else', () => {
    expect(normalizeForQuote('  Um,   so basically, ')).toBe('Um so basically');
    expect(normalizeForQuote('don’t—stop')).toBe('don t stop');
    expect(normalizeForQuote('Say "No"!')).toBe('Say No');
  });
});

describe('verifyNotes', () => {
  it('keeps exact quotes, ignoring differences in punctuation and spacing', () => {
    const { notes, dropped } = verifyNotes([note('teaching AI systems to say no', 400), note('Um so basically', 4300)], LINES);
    expect(notes).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('finds a quote that runs across two transcript lines', () => {
    const { notes } = verifyNotes([note('Um, so basically, the answers it refused', 4300)], LINES);
    expect(notes).toHaveLength(1);
  });

  it('drops reworded and invented quotes', () => {
    const { notes, dropped } = verifyNotes(
      [note('teaching AI to say no'), note('the answers it rejected were right'), note('I am very confident')],
      LINES
    );
    expect(notes).toEqual([]);
    expect(dropped).toHaveLength(3);
  });

  it('keeps case: a quote must match what was said', () => {
    expect(verifyNotes([note('So My Research')], LINES).notes).toHaveLength(0);
    expect(verifyNotes([note('So my research')], LINES).notes).toHaveLength(1);
  });

  it('never accepts the coach’s words as evidence', () => {
    expect(verifyNotes([note('Let the result land')], LINES).notes).toEqual([]);
  });

  it('matches whole words only', () => {
    expect(verifyNotes([note('each AI')], LINES).notes).toEqual([]); // "teaching AI" contains "each" mid-word
    expect(verifyNotes([note('refuse')], LINES).notes).toHaveLength(1);
  });

  it('moves a note to the line where its quote begins when its time is off', () => {
    const { notes } = verifyNotes([note('the right ones to refuse', 1000), note('the right ones to refuse', 9000)], LINES);
    expect(notes.map((n) => n.startMs)).toEqual([7200, 9000]);
  });

  it('drops empty quotes', () => {
    expect(verifyNotes([note('  ,  ')], LINES).dropped).toHaveLength(1);
  });
});

describe('indexTranscript', () => {
  it('joins only the speaker’s lines and records where each starts', () => {
    const { text, offsets } = indexTranscript(LINES);
    expect(text.startsWith('So my research')).toBe(true);
    expect(text).not.toContain('Slow down');
    expect(offsets.map((o) => o.startMs)).toEqual([400, 4300, 7200]);
  });
});
