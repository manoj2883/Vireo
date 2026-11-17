// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { prf } from './lib/scoring';
import {
  bootstrap,
  buildAccuracyReport,
  MIN_PUBLISHED_RECORDINGS,
  pool,
  README_END,
  README_START,
  renderAccuracyMarkdown,
  renderReadmeTable,
  replaceBetween,
  seededRandom,
  type RecordingResult,
} from './lib/report';

function rec(name: string, over: Partial<RecordingResult> = {}): RecordingResult {
  return { name, durationMs: 60_000, synthetic: false, fillers: prf(4, 1, 1), pauses: prf(5, 1, 0), paceErrors: [4, 8, 12, 20], ...over };
}

const meta = { generatedAt: '2026-11-17T00:00:00.000Z', commit: 'abc1234' };

describe('accuracy report', () => {
  it('pools counts across recordings and measures pace error and share within ±10 wpm', () => {
    const p = pool([rec('a'), rec('b', { fillers: prf(0, 0, 2), paceErrors: [2] })]);
    expect(p.fillers).toMatchObject({ truePositives: 4, falsePositives: 1, falseNegatives: 3 });
    expect(p.paceMae).toBeCloseTo((4 + 8 + 12 + 20 + 2) / 5);
    expect(p.paceWithin).toBeCloseTo(3 / 5);
    expect(p.pacePoints).toBe(5);
  });

  it('gives the same bootstrap interval for the same seed, and the interval brackets the estimate', () => {
    const rs = Array.from({ length: 12 }, (_, i) => rec(`r${i}`, { fillers: prf(3 + (i % 3), i % 2, 1), paceErrors: [i, i + 3] }));
    const a = bootstrap(rs, { iterations: 300, seed: 7 });
    const b = bootstrap(rs, { iterations: 300, seed: 7 });
    expect(a).toEqual(b);
    const est = pool(rs);
    expect(a.fillerPrecision[0]).toBeLessThanOrEqual(est.fillers.precision);
    expect(a.fillerPrecision[1]).toBeGreaterThanOrEqual(est.fillers.precision);
    expect(a.paceMae[0]).toBeLessThanOrEqual(a.paceMae[1]);
  });

  it('seeded random is deterministic and in [0, 1)', () => {
    const r1 = seededRandom(1);
    const r2 = seededRandom(1);
    const xs = Array.from({ length: 50 }, () => r1());
    expect(xs).toEqual(Array.from({ length: 50 }, () => r2()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('never publishes the synthetic example, and publishes nothing under the minimum', () => {
    const report = buildAccuracyReport([rec('synthetic', { synthetic: true }), ...Array.from({ length: MIN_PUBLISHED_RECORDINGS - 1 }, (_, i) => rec(`r${i}`))], meta);
    expect(report.published).toBe(false);
    expect(report.metrics).toBeNull();
    expect(report.recordings).toBe(MIN_PUBLISHED_RECORDINGS - 1);
    expect(report.syntheticSkipped).toBe(1);
    expect(report.perRecording.map((r) => r.name)).not.toContain('synthetic');
    expect(renderReadmeTable(report)).toContain(`Needs at least ${MIN_PUBLISHED_RECORDINGS} labelled recordings`);
    expect(renderAccuracyMarkdown(report)).toContain('Not published yet');
  });

  it('publishes every metric with an interval once there are enough real recordings', () => {
    const report = buildAccuracyReport(Array.from({ length: MIN_PUBLISHED_RECORDINGS }, (_, i) => rec(`r${i}`)), meta);
    expect(report.published).toBe(true);
    expect(Object.keys(report.metrics!)).toEqual(['fillerPrecision', 'fillerRecall', 'fillerF1', 'paceMae', 'paceWithin10', 'pausePrecision', 'pauseRecall', 'pauseF1']);
    const md = renderAccuracyMarkdown(report);
    expect(md).toContain('abc1234');
    expect(md).toContain('| Filler precision | 80.0% |');
    expect(md).toContain('## Per recording');
    expect(renderReadmeTable(report)).toContain('Pace within ±10 wpm');
  });

  it('replaces only the text between the markers', () => {
    const doc = `a\n${README_START}\nold\n${README_END}\nb`;
    expect(replaceBetween(doc, README_START, README_END, 'new')).toBe(`a\n${README_START}\nnew\n${README_END}\nb`);
    expect(() => replaceBetween('nothing', README_START, README_END, 'x')).toThrow();
  });

  it('the README has the eval markers and the app has a generated accuracy file', () => {
    const root = path.resolve(__dirname, '..');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme.indexOf(README_START)).toBeGreaterThan(-1);
    expect(readme.indexOf(README_END)).toBeGreaterThan(readme.indexOf(README_START));
    const json = JSON.parse(fs.readFileSync(path.join(root, 'src/data/accuracy.json'), 'utf8'));
    expect(json).toHaveProperty('published');
    expect(json).toHaveProperty('minRecordings', MIN_PUBLISHED_RECORDINGS);
  });
});
