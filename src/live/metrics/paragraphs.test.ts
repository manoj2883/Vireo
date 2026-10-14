import { describe, expect, it } from 'vitest';
import { CAPTION_WORDS, PARAGRAPH_PAUSE_MS, captionView, likelyFillerBursts, splitParagraphs, type CaptionWord } from './paragraphs';
import { TranscriptTimeline } from './timeline';
import { layoutSonogram } from '@/components/sonogram/geometry';

const w = (text: string, startMs: number, endMs = startMs + 250) => ({ text, startMs, endMs });
const cw = (text: string, startMs: number, interim = false): CaptionWord => ({ text, startMs, endMs: startMs + 250, kind: 'speech', interim });

describe('splitParagraphs', () => {
  it('starts a new paragraph only after a 1.2 s pause', () => {
    expect(PARAGRAPH_PAUSE_MS).toBe(1200);
    const words = [w('a', 0, 300), w('b', 1400, 1600), w('c', 2900, 3100)]; // gaps of 1100 and 1300 ms
    expect(splitParagraphs(words).map((p) => p.map((x) => x.text).join(' '))).toEqual(['a b', 'c']);
  });

  it('breaks at a detected pause of 1.2 s even if word timings overlap it', () => {
    const words = [w('a', 0, 900), w('b', 1500, 1700)];
    expect(splitParagraphs(words, { pauses: [{ startMs: 300, endMs: 1500 }] })).toHaveLength(2);
    expect(splitParagraphs(words, { pauses: [{ startMs: 900, endMs: 1500 }] })).toHaveLength(1);
  });

  it('breaks at a Deepgram utterance end', () => {
    const words = [w('a', 0, 300), w('b', 1300, 1500)];
    expect(splitParagraphs(words, { utteranceEnds: [300] })).toHaveLength(2);
  });

  it('never breaks on word count alone', () => {
    const words = Array.from({ length: 80 }, (_, i) => w(`w${i}`, i * 300));
    expect(splitParagraphs(words)).toHaveLength(1);
  });
});

describe('captionView', () => {
  it('shows the growing paragraph with interim words, and the previous one', () => {
    const view = captionView([cw('one', 0), cw('two', 300), cw('three', 2000), cw('four', 2300, true)]);
    expect(view.previous?.map((x) => x.text)).toEqual(['one', 'two']);
    expect(view.current.map((x) => [x.text, x.interim])).toEqual([
      ['three', false],
      ['four', true],
    ]);
  });

  it('keeps about 60 words on screen, trimming the previous paragraph first', () => {
    expect(CAPTION_WORDS).toBe(60);
    const prev = Array.from({ length: 50 }, (_, i) => cw(`p${i}`, i * 300));
    const cur = Array.from({ length: 30 }, (_, i) => cw(`c${i}`, 20_000 + i * 300));
    const view = captionView([...prev, ...cur]);
    expect(view.current).toHaveLength(30);
    expect(view.previous).toHaveLength(30);
    expect(view.previous?.[0].text).toBe('p20');
    const long = captionView(Array.from({ length: 90 }, (_, i) => cw(`x${i}`, i * 300)));
    expect(long.current).toHaveLength(60);
    expect(long.previous).toBeNull();
  });

  it('is empty before anything is said', () => {
    expect(captionView([])).toEqual({ previous: null, current: [] });
  });
});

describe('likely fillers', () => {
  const voiced = [
    { startMs: 0, endMs: 2000 }, // covered by words
    { startMs: 2600, endMs: 2950 }, // short burst, no word: likely a filler
    { startMs: 3600, endMs: 5200 }, // long, no word: not a filler
    { startMs: 9000, endMs: 9300 }, // too recent to judge
  ];
  const words = [w('our', 100, 600), w('results', 700, 1900)];

  it('flags short voiced bursts with no transcribed word, once the transcript has caught up', () => {
    expect(likelyFillerBursts(voiced, words, { nowMs: 10_000 })).toEqual([{ startMs: 2600, endMs: 2950 }]);
  });

  it('does not flag a burst that a word covers', () => {
    expect(likelyFillerBursts(voiced, [...words, w('um', 2620, 2900)], { nowMs: 10_000 })).toEqual([]);
  });

  it('draws likely fillers as faint flat strokes that are not words', () => {
    const layout = layoutSonogram({
      segments: [w('a', 0, 500)].map((x) => ({ ...x, kind: 'speech' as const })),
      tentativeFillers: [{ startMs: 600, endMs: 900 }],
      window: { startMs: 0, endMs: 1000 },
    });
    const faint = layout.strokes.filter((s) => s.tentative);
    expect(faint).toHaveLength(3);
    expect(faint.every((s) => s.kind === 'filler' && new Set(s.points.map(([, y]) => y)).size === 1)).toBe(true);
    expect(faint[0].opacity).toBeCloseTo(0.4);
    expect(layout.words).toHaveLength(1);
  });
});

describe('filler rescue', () => {
  it('keeps an "um" that appeared in an interim result but not in the final', () => {
    const tl = new TranscriptTimeline({ latencyMs: 0 });
    tl.setInterim([w('so', 0, 200), w('um', 300, 600), w('I', 700, 800)]);
    tl.appendTimed([w('So', 0, 200), w('I', 700, 800), w('think', 850, 1100)]);
    const segs = tl.toSegments();
    expect(segs.map((s) => s.text)).toEqual(['So', 'um', 'I', 'think']);
    expect(segs[1].kind).toBe('filler');
    expect(tl.getWords()[1].rescued).toBe(true);
  });

  it('does not duplicate a filler the final kept', () => {
    const tl = new TranscriptTimeline({ latencyMs: 0 });
    tl.setInterim([w('um', 300, 600)]);
    tl.appendTimed([w('So', 0, 200), w('um', 310, 590), w('yes', 700, 900)]);
    expect(tl.toSegments().map((s) => s.text)).toEqual(['So', 'um', 'yes']);
  });

  it('ignores interim fillers outside the final’s span', () => {
    const tl = new TranscriptTimeline({ latencyMs: 0 });
    tl.setInterim([w('uh', 5000, 5200)]);
    tl.appendTimed([w('So', 0, 200), w('yes', 300, 500)]);
    expect(tl.toSegments().map((s) => s.text)).toEqual(['So', 'yes']);
  });
});
