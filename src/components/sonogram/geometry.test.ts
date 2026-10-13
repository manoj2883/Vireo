import { describe, expect, it } from 'vitest';
import {
  HARMONIC_OPACITY,
  VARIANTS,
  bracketPath,
  defaultWindow,
  describeSonogram,
  layoutSonogram,
  pathFromPoints,
  referencePitch,
  simplifySegments,
} from './geometry';
import { DEMO_ANNOTATIONS, DEMO_PAUSES, DEMO_SEGMENTS } from './demo';
import type { WordSegment } from './types';

const word = (text: string, startMs: number, endMs: number, kind: WordSegment['kind'] = 'speech', pitch?: number[]): WordSegment => ({
  text,
  startMs,
  endMs,
  kind,
  pitch,
});

const hero = VARIANTS.hero;
const innerW = hero.width - 2 * hero.padX;

describe('layoutSonogram: time mapping', () => {
  it('maps the window linearly onto the drawing width', () => {
    const layout = layoutSonogram({ segments: [word('a', 0, 1000), word('b', 1000, 2000)], window: { startMs: 0, endMs: 2000 } });
    const [a, b] = layout.words;
    expect(a.xa).toBeCloseTo(hero.padX + hero.wordInset);
    expect(a.xb).toBeCloseTo(hero.padX + innerW / 2 - hero.wordInset);
    expect(b.xb).toBeCloseTo(hero.width - hero.padX - hero.wordInset);
  });

  it('defaults the window to the span of segments and pauses', () => {
    expect(defaultWindow([word('a', 500, 900)], [{ startMs: 900, endMs: 2500 }])).toEqual({ startMs: 500, endMs: 2500 });
    expect(defaultWindow([], [])).toEqual({ startMs: 0, endMs: 1000 });
  });

  it('widens long answers when a minimum density is set', () => {
    const layout = layoutSonogram({ segments: [word('a', 0, 60_000)], minPxPerSecond: 100 });
    expect(layout.width).toBe(2 * hero.padX + 6000);
    const short = layoutSonogram({ segments: [word('a', 0, 1000)], minPxPerSecond: 100 });
    expect(short.width).toBe(hero.width);
  });
});

describe('layoutSonogram: harmonic strokes', () => {
  const layout = layoutSonogram({ segments: [word('hello', 0, 500)] });

  it('draws each word as three stacked harmonics with falling weight and opacity', () => {
    expect(layout.strokes).toHaveLength(3);
    expect(layout.strokes.map((s) => s.harmonic)).toEqual([0, 1, 2]);
    expect(layout.strokes.map((s) => s.strokeWidth)).toEqual([...hero.strokeWidths]);
    expect(layout.strokes.map((s) => s.opacity)).toEqual([...HARMONIC_OPACITY]);
    expect(HARMONIC_OPACITY).toEqual([1, 0.6, 0.32]);
  });

  it('stacks the harmonics above the fundamental', () => {
    const meanY = (i: number) => layout.strokes[i].points.reduce((s, [, y]) => s + y, 0) / layout.strokes[i].points.length;
    expect(meanY(1)).toBeLessThan(meanY(0));
    expect(meanY(2)).toBeLessThan(meanY(1));
  });

  it('samples each stroke at the variant resolution', () => {
    expect(layout.strokes[0].points).toHaveLength(hero.samplesPerWord + 1);
  });

  it('is deterministic for the same input', () => {
    expect(layoutSonogram({ segments: [word('hello', 0, 500)] }).strokes).toEqual(layout.strokes);
  });
});

describe('layoutSonogram: word kinds', () => {
  it('draws fillers perfectly flat and lower than speech', () => {
    const layout = layoutSonogram({ segments: [word('um', 0, 500, 'filler')] });
    for (const s of layout.strokes) {
      const ys = new Set(s.points.map(([, y]) => y));
      expect(ys.size).toBe(1);
    }
    expect(layout.strokes[0].points[0][1]).toBeCloseTo(hero.fundamentalY + 1.2 * hero.amp);
  });

  it('keeps fillers flat even when pitch is available', () => {
    const layout = layoutSonogram({ segments: [word('um', 0, 500, 'filler', [120, 180, 240])], referenceHz: 150 });
    expect(new Set(layout.strokes[0].points.map(([, y]) => y)).size).toBe(1);
  });

  it('spaces rushed words more tightly than normal speech', () => {
    const normal = layoutSonogram({ segments: [word('a', 0, 500)], window: { startMs: 0, endMs: 500 } }).words[0];
    const rushed = layoutSonogram({ segments: [word('a', 0, 500, 'rushed')], window: { startMs: 0, endMs: 500 } }).words[0];
    expect(rushed.xb - rushed.xa).toBeGreaterThan(normal.xb - normal.xa);
    expect(normal.xa - rushed.xa).toBeCloseTo(hero.wordInset - hero.rushedInset);
  });

  it('gives rushed words a busier contour than speech', () => {
    const turns = (seg: WordSegment) => {
      const ys = layoutSonogram({ segments: [seg] }).strokes[0].points.map(([, y]) => y);
      let n = 0;
      for (let i = 1; i < ys.length - 1; i++) if ((ys[i] - ys[i - 1]) * (ys[i + 1] - ys[i]) < 0) n++;
      return n;
    };
    expect(turns(word('a', 0, 500, 'rushed'))).toBeGreaterThan(turns(word('a', 0, 500)));
  });
});

describe('layoutSonogram: pitch', () => {
  it('uses the median of all voiced samples as the reference', () => {
    expect(referencePitch([word('a', 0, 1, 'speech', [100, 0, 200]), word('b', 1, 2, 'speech', [300])])).toBe(200);
    expect(referencePitch([word('a', 0, 1)])).toBeNull();
  });

  it('draws a rising pitch as a line climbing up the screen', () => {
    const layout = layoutSonogram({ segments: [word('up', 0, 500, 'speech', [120, 150, 180])], referenceHz: 150 });
    const pts = layout.strokes[0].points;
    expect(pts[pts.length - 1][1]).toBeLessThan(pts[0][1]);
    expect(layout.words[0].usesPitch).toBe(true);
  });

  it('puts a word spoken at the reference pitch on the resting line', () => {
    const layout = layoutSonogram({ segments: [word('flat', 0, 500, 'speech', [150, 150])], referenceHz: 150 });
    for (const [, y] of layout.strokes[0].points) expect(y).toBeCloseTo(hero.fundamentalY);
  });

  it('falls back to the synthetic contour with fewer than two voiced samples', () => {
    const withGap = layoutSonogram({ segments: [word('a', 0, 500, 'speech', [0, 140, 0])], referenceHz: 150 });
    const none = layoutSonogram({ segments: [word('a', 0, 500)] });
    expect(withGap.words[0].usesPitch).toBe(false);
    expect(withGap.strokes[0].points).toEqual(none.strokes[0].points);
  });

  it('caps extreme pitch so a squeak cannot leave the panel', () => {
    const layout = layoutSonogram({ segments: [word('eek', 0, 500, 'speech', [2000, 2000])], referenceHz: 100 });
    for (const [, y] of layout.strokes[2].points) expect(y).toBeGreaterThan(0);
  });
});

describe('layoutSonogram: pauses and the live window', () => {
  it('leaves pauses as real gaps with no strokes inside them', () => {
    const layout = layoutSonogram({ segments: DEMO_SEGMENTS, pauses: DEMO_PAUSES });
    const [p] = layout.pauses;
    expect(p.durationMs).toBe(1200);
    for (const s of layout.strokes) for (const [x] of s.points) expect(x <= p.xa || x >= p.xb).toBe(true);
  });

  it('shows only the last six seconds when scrolling', () => {
    const segs = [word('old', 0, 400), word('recent', 5000, 5600), word('now', 9000, 9500)];
    const layout = layoutSonogram({ segments: segs, variant: 'ribbon', window: { startMs: 4000, endMs: 10_000 }, nowMs: 10_000 });
    expect(layout.words.map((w) => w.text)).toEqual(['recent', 'now']);
  });

  it('clips a word still being spoken at the live clock', () => {
    const layout = layoutSonogram({
      segments: [word('speaking', 9000, 11_000)],
      variant: 'ribbon',
      window: { startMs: 4000, endMs: 10_000 },
      nowMs: 10_000,
    });
    expect(layout.words[0].clipped).toBe(true);
    expect(layout.words[0].xb).toBeCloseTo(VARIANTS.ribbon.width);
  });

  it('keeps a word’s contour stable as the window scrolls past it', () => {
    const seg = word('steady', 5000, 5600);
    const at = (now: number) =>
      layoutSonogram({ segments: [seg], variant: 'ribbon', window: { startMs: now - 6000, endMs: now }, nowMs: now }).strokes[0].points.map(([, y]) => y);
    expect(at(8000)).toEqual(at(9000));
  });

  it('marks an open pause as in progress up to now', () => {
    const layout = layoutSonogram({ segments: [], pauses: [{ startMs: 8000 }], variant: 'ribbon', window: { startMs: 4000, endMs: 10_000 }, nowMs: 10_000 });
    expect(layout.pauses[0]).toMatchObject({ inProgress: true, durationMs: 2000, xb: VARIANTS.ribbon.width });
  });
});

describe('layoutSonogram: labels and annotations', () => {
  it('drops word labels that would collide', () => {
    const crowded = Array.from({ length: 40 }, (_, i) => word('extraordinary', i * 100, i * 100 + 90));
    const layout = layoutSonogram({ segments: crowded });
    expect(layout.labels.length).toBeGreaterThan(0);
    expect(layout.labels.length).toBeLessThan(40);
    for (let i = 1; i < layout.labels.length; i++) expect(layout.labels[i].x).toBeGreaterThan(layout.labels[i - 1].x);
  });

  it('places an annotation bracket over its span with italic text above', () => {
    const layout = layoutSonogram({ segments: DEMO_SEGMENTS, pauses: DEMO_PAUSES, annotations: DEMO_ANNOTATIONS });
    expect(layout.annotations.map((a) => a.text)).toEqual(DEMO_ANNOTATIONS.map((a) => a.text));
    const first = layout.annotations[0];
    expect(first.bracket).toBe(bracketPath(first.xa, first.xb, hero.bracketY, hero.bracketTick));
    expect(first.textY).toBeLessThan(hero.bracketY);
    expect(first.tone).toBe('amber');
  });

  it('labels a pause automatically when no note covers it', () => {
    const layout = layoutSonogram({ segments: DEMO_SEGMENTS, pauses: DEMO_PAUSES });
    expect(layout.annotations).toEqual([expect.objectContaining({ text: '1.2 s pause', tone: 'sky' })]);
  });

  it('skips the automatic label for breaths under 300 ms', () => {
    const layout = layoutSonogram({ segments: [word('a', 0, 100)], pauses: [{ startMs: 100, endMs: 350 }] });
    expect(layout.annotations).toHaveLength(0);
  });

  it('moves an overlapping note to a second row', () => {
    const notes = [
      { startMs: 0, endMs: 400, text: 'a very long note about this moment' },
      { startMs: 450, endMs: 800, text: 'another long note right beside it' },
    ];
    const layout = layoutSonogram({ segments: [word('a', 0, 400), word('b', 450, 800)], annotations: notes, window: { startMs: 0, endMs: 4000 } });
    expect(layout.annotations.map((a) => a.row)).toEqual([0, 1]);
    expect(layout.annotations[1].textY).toBe(hero.annotationY! - hero.annotationRowGap);
  });

  it('keeps annotation text inside the drawing', () => {
    const layout = layoutSonogram({ segments: [word('a', 0, 100)], annotations: [{ startMs: 0, endMs: 100, text: 'right at the very start of the answer' }] });
    const a = layout.annotations[0];
    expect(a.textX).toBeGreaterThan(0);
  });

  it('hides labels and annotations in the mini and ribbon variants', () => {
    for (const variant of ['mini', 'ribbon'] as const) {
      const layout = layoutSonogram({ segments: DEMO_SEGMENTS, pauses: DEMO_PAUSES, annotations: DEMO_ANNOTATIONS, variant });
      expect(layout.labels).toHaveLength(0);
      expect(layout.annotations).toHaveLength(0);
    }
  });
});

describe('helpers', () => {
  it('formats SVG paths compactly', () => {
    expect(pathFromPoints([[0, 0], [10.04, 5.06]])).toBe('M0 0 L10 5.1');
  });

  it('describes the drawing for screen readers', () => {
    expect(describeSonogram(DEMO_SEGMENTS, DEMO_PAUSES)).toBe('Sonogram of 12 words, 3 fillers, 1 pause, 6 rushed words.');
    expect(describeSonogram([word('a', 0, 1)], [], [{ startMs: 0, endMs: 1, text: 'nice' }])).toBe(
      'Sonogram of 1 word, 0 fillers, 0 pauses. Notes: nice.'
    );
  });
});

describe('simplifySegments', () => {
  const long = Array.from({ length: 90 }, (_, i) => word(i % 15 === 7 ? 'um' : `w${i}`, i * 300, i * 300 + 250, i % 15 === 7 ? 'filler' : 'speech'));

  it('merges ordinary words but keeps every filler on its own', () => {
    const out = simplifySegments(long, 28);
    expect(out.length).toBeLessThanOrEqual(28 + 6);
    expect(out.filter((s) => s.kind === 'filler')).toHaveLength(6);
    expect(out[0].startMs).toBe(0);
    expect(out[out.length - 1].endMs).toBe(long[long.length - 1].endMs);
  });

  it('never merges across a pause', () => {
    const segs = [word('a', 0, 200), word('b', 220, 400), word('c', 1400, 1600), ...Array.from({ length: 40 }, (_, i) => word('x', 2000 + i * 210, 2200 + i * 210))];
    const out = simplifySegments(segs, 10);
    expect(out.some((s) => s.startMs < 1000 && s.endMs > 1000)).toBe(false);
  });

  it('leaves short answers alone, and the mini variant uses it', () => {
    expect(simplifySegments(long.slice(0, 10), 28)).toHaveLength(10);
    expect(layoutSonogram({ segments: long, variant: 'mini' }).words.length).toBeLessThan(40);
  });
});
