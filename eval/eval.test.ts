// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { combine, iou, meanAbsoluteError, prf, scoreFillers, scorePauses } from './lib/scoring';
import { synthesise } from './lib/audio';
import { evaluateFile, transcriptChunks } from './lib/evaluate';
import { parseAudacityLabels } from './import-audacity';
import type { LabelFile } from './lib/types';

describe('scoring', () => {
  it('computes precision, recall and F1, with sensible empty cases', () => {
    expect(prf(3, 1, 2)).toMatchObject({ precision: 0.75, recall: 0.6 });
    expect(prf(3, 1, 2).f1).toBeCloseTo(2 / 3);
    expect(prf(0, 0, 0)).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(prf(0, 2, 0)).toMatchObject({ precision: 0, recall: 1 });
  });

  it('matches pauses one to one at IoU 0.5', () => {
    expect(iou({ startMs: 0, endMs: 100 }, { startMs: 50, endMs: 150 })).toBeCloseTo(1 / 3);
    const r = scorePauses(
      [{ startMs: 1000, endMs: 2200 }, { startMs: 5000, endMs: 5400 }, { startMs: 9000, endMs: 9500 }],
      [{ startMs: 1050, endMs: 2300 }, { startMs: 5300, endMs: 6400 }]
    );
    expect(r).toMatchObject({ truePositives: 1, falsePositives: 2, falseNegatives: 1 });
  });

  it('matches each filler once, by overlap', () => {
    const r = scoreFillers([{ startMs: 0, endMs: 300 }, { startMs: 250, endMs: 400 }], [{ startMs: 100, endMs: 350 }]);
    expect(r).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
  });

  it('averages absolute error where both series have a value', () => {
    expect(meanAbsoluteError([150, null, 170, 140], [140, 160, 150, null])).toEqual({ mae: 15, points: 2 });
  });

  it('combines counts across files', () => {
    expect(combine([prf(1, 0, 1), prf(2, 1, 0)])).toMatchObject({ truePositives: 3, falsePositives: 1, falseNegatives: 1 });
  });
});

describe('Audacity import', () => {
  it('reads tab-separated label tracks in seconds', () => {
    expect(parseAudacityLabels('0.500000\t0.720000\tSo\n1.1\t1.5\tyou know\n\\\t2000\t3000\n')).toEqual([
      { text: 'So', startMs: 500, endMs: 720 },
      { text: 'you know', startMs: 1100, endMs: 1500 },
    ]);
  });
});

describe('harness on the synthetic example', () => {
  const label = JSON.parse(fs.readFileSync(path.join(__dirname, 'labels/example-synthetic.json'), 'utf8')) as LabelFile;
  const result = evaluateFile(label, synthesise(label));

  it('simulates live transcript chunks after the words were spoken', () => {
    const chunks = transcriptChunks(label);
    expect(chunks[0]).toEqual({ atMs: label.words[3].endMs + 500, text: 'So my research is' });
  });

  it('finds every labelled pause and filler in clean synthetic audio', () => {
    expect(result.pauses.recall).toBe(1);
    expect(result.pauses.precision).toBe(1);
    expect(result.fillers.recall).toBe(1);
    expect(result.fillers.precision).toBe(1);
    expect(result.wpm.points).toBeGreaterThan(3);
  });
});
