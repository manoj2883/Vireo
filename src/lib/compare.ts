/**
 * Before and after: takes of the same question form a series, and each retake is compared with
 * the take before it. Pure, so the maths is tested without a browser.
 */
import type { StoredSession } from '@/storage/localDb';

export type CompareKey = 'fillersPerMin' | 'timeInZonePct' | 'pausesPerMin' | 'eyeContactPct' | 'timeToMainPointMs';

export interface MetricChange {
  key: CompareKey;
  label: string;
  before: number;
  after: number;
  /** Positive when the change is an improvement. */
  improvement: number;
  /** How the number is written: "2.1 a minute", "71%", "4.2 s". */
  format: (n: number) => string;
}

export interface TakeComparison {
  changes: MetricChange[];
  /** Whether this take achieved the previous take's one fix, with quoted evidence; null if unknown. */
  fix: { instruction: string; achieved: boolean; evidence: string; startMs: number | null } | null;
}

/** The first take's id, which every retake points back to. */
export function seriesRoot(session: StoredSession): string {
  return session.retakeOf ?? session.id;
}

/** All takes of a question, oldest first. */
export function seriesOf(session: StoredSession, all: readonly StoredSession[]): StoredSession[] {
  const root = seriesRoot(session);
  return all.filter((s) => seriesRoot(s) === root).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The take right before this one in its series, if any. */
export function previousTake(session: StoredSession, all: readonly StoredSession[]): StoredSession | null {
  const series = seriesOf(session, all);
  const i = series.findIndex((s) => s.id === session.id);
  return i > 0 ? series[i - 1] : null;
}

const oneDp = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Compare two takes on the measures both have. Lower is better for fillers and time to the point. */
export function compareTakes(before: StoredSession, after: StoredSession): TakeComparison {
  const changes: MetricChange[] = [];
  const add = (key: CompareKey, label: string, b: number | null | undefined, a: number | null | undefined, higherIsBetter: boolean, format: (n: number) => string) => {
    if (b === null || b === undefined || a === null || a === undefined) return;
    changes.push({ key, label, before: b, after: a, improvement: higherIsBetter ? a - b : b - a, format });
  };
  add('fillersPerMin', 'Fillers', before.metrics.fillersPerMin, after.metrics.fillersPerMin, false, (n) => `${oneDp(n)} a minute`);
  add('timeInZonePct', 'Time in your pace zone', before.metrics.timeInZonePct, after.metrics.timeInZonePct, true, (n) => `${Math.round(n)}%`);
  add('pausesPerMin', 'Pauses', before.metrics.pausesPerMin, after.metrics.pausesPerMin, true, (n) => `${oneDp(n)} a minute`);
  add('eyeContactPct', 'Eye contact', before.camera?.summary.eyeContactPct, after.camera?.summary.eyeContactPct, true, (n) => `${Math.round(n)}%`);
  add('timeToMainPointMs', 'Time to the main point', before.notes?.mainPointMs, after.notes?.mainPointMs, false, (n) => `${oneDp(n / 1000)} s`);

  const verdict = after.notes?.previousFix;
  const instruction = after.config.retake?.oneFix;
  const fix = verdict && instruction ? { instruction, ...verdict } : null;
  return { changes, fix };
}

/**
 * Relative size of an improvement, so measures on different scales can be ranked: the share of
 * the starting value that was gained (capped), with a floor for small starting values.
 */
export function relativeImprovement(c: MetricChange): number {
  const scale = Math.max(Math.abs(c.before), c.key === 'timeInZonePct' || c.key === 'eyeContactPct' ? 10 : c.key === 'timeToMainPointMs' ? 2000 : 1);
  return Math.min(1, c.improvement / scale);
}

/** The biggest improvements first; only real improvements. */
export function topImprovements(cmp: TakeComparison, n = 3): MetricChange[] {
  return cmp.changes
    .filter((c) => c.improvement > 0)
    .sort((a, b) => relativeImprovement(b) - relativeImprovement(a))
    .slice(0, n);
}

export interface WeeklyBest {
  session: StoredSession;
  before: StoredSession;
  change: MetricChange;
}

/** The single biggest improvement between consecutive takes in the last seven days. */
export function bestImprovementThisWeek(all: readonly StoredSession[], now = new Date()): WeeklyBest | null {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  let best: WeeklyBest | null = null;
  for (const s of all) {
    if (!s.retakeOf || new Date(s.createdAt).getTime() < weekAgo) continue;
    const before = previousTake(s, all);
    if (!before) continue;
    const [top] = topImprovements(compareTakes(before, s), 1);
    if (top && (!best || relativeImprovement(top) > relativeImprovement(best.change))) best = { session: s, before, change: top };
  }
  return best;
}

/** "Fillers down from 5.4 a minute to 2.1 a minute." */
export function describeChange(c: MetricChange): string {
  const went = c.after < c.before ? 'down' : c.after > c.before ? 'up' : 'unchanged at';
  if (went === 'unchanged at') return `${c.label} unchanged at ${c.format(c.after)}.`;
  return `${c.label} ${went} from ${c.format(c.before)} to ${c.format(c.after)}.`;
}
