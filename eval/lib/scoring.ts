import type { Interval } from './types';

export interface PRF {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export function prf(tp: number, fp: number, fn: number): PRF {
  const precision = tp + fp ? tp / (tp + fp) : tp + fn ? 0 : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

export function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

export function iou(a: Interval, b: Interval): number {
  const inter = overlapMs(a, b);
  const union = Math.max(a.endMs, b.endMs) - Math.min(a.startMs, b.startMs);
  return union > 0 ? inter / union : 0;
}

/**
 * One-to-one greedy matching of predicted to labelled intervals, best score first.
 * `accept` decides whether a pair can match; `score` ranks candidate pairs.
 */
export function matchIntervals(
  predicted: readonly Interval[],
  truth: readonly Interval[],
  accept: (p: Interval, t: Interval) => boolean,
  score: (p: Interval, t: Interval) => number = iou
): PRF {
  const pairs: { p: number; t: number; s: number }[] = [];
  predicted.forEach((p, pi) =>
    truth.forEach((t, ti) => {
      if (accept(p, t)) pairs.push({ p: pi, t: ti, s: score(p, t) });
    })
  );
  pairs.sort((a, b) => b.s - a.s);
  const usedP = new Set<number>();
  const usedT = new Set<number>();
  for (const pair of pairs) {
    if (usedP.has(pair.p) || usedT.has(pair.t)) continue;
    usedP.add(pair.p);
    usedT.add(pair.t);
  }
  const tp = usedP.size;
  return prf(tp, predicted.length - tp, truth.length - tp);
}

/** Pauses match when they overlap by at least half their union (IoU ≥ 0.5). */
export function scorePauses(predicted: readonly Interval[], truth: readonly Interval[], minIou = 0.5): PRF {
  return matchIntervals(predicted, truth, (p, t) => iou(p, t) >= minIou);
}

/** Fillers match when the predicted filler overlaps the labelled one at all. */
export function scoreFillers(predicted: readonly Interval[], truth: readonly Interval[]): PRF {
  return matchIntervals(predicted, truth, (p, t) => overlapMs(p, t) > 0, overlapMs);
}

/** Mean absolute error between two series, over the points where both have a value. */
export function meanAbsoluteError(a: readonly (number | null)[], b: readonly (number | null)[]): { mae: number; points: number } {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === null || y === null) continue;
    sum += Math.abs(x - y);
    n++;
  }
  return { mae: n ? sum / n : 0, points: n };
}

/** Sum the counts of several results into one. */
export function combine(results: readonly PRF[]): PRF {
  const tp = results.reduce((s, r) => s + r.truePositives, 0);
  const fp = results.reduce((s, r) => s + r.falsePositives, 0);
  const fn = results.reduce((s, r) => s + r.falseNegatives, 0);
  return prf(tp, fp, fn);
}
