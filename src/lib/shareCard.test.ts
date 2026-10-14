import { describe, expect, it } from 'vitest';
import { buildShareCard, drawShareCard, CARD_HEIGHT, CARD_WIDTH, type CardContext } from './shareCard';
import type { StoredSession } from '@/storage/localDb';

const SAID = ['my', 'research', 'teaches', 'models', 'to', 'say', 'um', 'no'];

function take(id: string, fillersPerMin: number, extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id,
    createdAt: '2026-10-12T10:00:00.000Z',
    config: { prompt: 'Tell me about your research.', talkType: 'interview', situationId: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: SAID.map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 300, kind: text === 'um' ? 'filler' : 'speech' })),
    pauses: [{ startMs: 3300, endMs: 4200 }],
    transcript: [{ speaker: 'user', text: SAID.join(' '), startMs: 0 }],
    metrics: { durationMs: 4000, wordCount: 8, avgWpm: 120, timeInZonePct: 50, fillerCount: 1, fillersPerMin, pauseCount: 1, pausesPerMin: 2, longestPauseMs: 900 },
    take: { avgWpm: 120, inZoneRatio: 0.5, fillersPerMin },
    newBest: false,
    notesStatus: 'ready',
    ...extra,
  };
}

/** Records every string drawn, and nothing else. */
function recorder() {
  const texts: string[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic',
    fillRect: noop,
    fillText: (t: string) => texts.push(t),
    measureText: (t: string) => ({ width: t.length * 16 }) as TextMetrics,
    beginPath: noop,
    moveTo: noop,
    bezierCurveTo: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
    roundRect: noop,
  } as unknown as CardContext;
  return { ctx, texts };
}

const before = take('a', 6, { pauses: [] });
const after = take('b', 2, {
  retakeOf: 'a',
  config: { ...take('x', 0).config, retake: { fromSessionId: 'a', oneFix: 'Lead with your result.' } },
  notes: { previousFix: { achieved: true, evidence: 'say no', startMs: 2000 } } as StoredSession['notes'],
  metrics: { ...take('x', 2).metrics, timeInZonePct: 72, pausesPerMin: 4 },
});

describe('share card', () => {
  it('is 1080 by 1350', () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1080, 1350]);
  });

  it('carries no transcript by default: not in the spec, not on the canvas', () => {
    const spec = buildShareCard(before, after);
    expect(spec.words).toBeNull();
    expect(JSON.stringify(spec)).not.toMatch(/research|teaches|models/);
    const { ctx, texts } = recorder();
    drawShareCard(ctx, spec);
    const drawn = texts.join(' ');
    for (const w of ['research', 'teaches', 'models']) expect(drawn).not.toContain(w);
    expect(drawn).toContain('Vireo');
  });

  it('includes the words only when asked', () => {
    const spec = buildShareCard(before, after, { includeWords: true });
    expect(spec.words).toBe('my research teaches models to say um no');
    const { ctx, texts } = recorder();
    drawShareCard(ctx, spec);
    expect(texts.join(' ')).toContain('research');
  });

  it('shows three changed numbers, best improvements first, and the fix', () => {
    const spec = buildShareCard(before, after);
    expect(spec.numbers).toHaveLength(3);
    expect(spec.numbers.map((n) => n.label)).toEqual(['Pauses', 'Fillers', 'Time in your pace zone']);
    expect(spec.numbers[1]).toEqual({ label: 'Fillers', before: '6.0 a minute', after: '2.0 a minute' });
    expect(spec.fix).toBe('Fixed: Lead with your result.');
    expect(spec.context).toBe('Job interview');
  });

  it('draws both sonograms on one time scale, from timings only', () => {
    const spec = buildShareCard(before, take('c', 2, { metrics: { ...take('x', 2).metrics, durationMs: 8000 } }));
    expect(spec.windowMs).toBe(8000);
    expect(spec.tracks.map((t) => t.label)).toEqual(['Before', 'After']);
    expect(spec.tracks[1].bars.filter((b) => b.filler)).toHaveLength(1);
    expect(Object.keys(spec.tracks[0].bars[0])).toEqual(['startMs', 'endMs', 'filler']);
  });
});
