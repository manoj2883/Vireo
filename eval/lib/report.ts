/**
 * The published accuracy report: pooled precision, recall and F1, pace error, and seeded
 * bootstrap confidence intervals over recordings. Pure, so it is tested without audio.
 */
import { combine, type PRF } from './scoring';

/** Fewer real recordings than this and no numbers are published: a handful of clips can't support a claim. */
export const MIN_PUBLISHED_RECORDINGS = 10;
/** Bootstrap resamples. 2,000 keeps the 95% interval's ends stable to about a percentage point. */
export const BOOTSTRAP_ITERATIONS = 2000;
/** Fixed seed, so the same recordings always give the same intervals. */
export const BOOTSTRAP_SEED = 20_261_117;
/** "Within ±10 wpm": about one word in a six-second window, the smallest change a listener would notice. */
export const PACE_TOLERANCE_WPM = 10;

export interface RecordingResult {
  name: string;
  durationMs: number;
  /** Synthetic audio only proves the harness runs; it never counts toward published numbers. */
  synthetic: boolean;
  fillers: PRF;
  pauses: PRF;
  /** Absolute pace error, once a second while speaking. */
  paceErrors: number[];
}

export interface Pooled {
  fillers: PRF;
  pauses: PRF;
  paceMae: number;
  paceWithin: number;
  pacePoints: number;
}

export type MetricKey = 'fillerPrecision' | 'fillerRecall' | 'fillerF1' | 'paceMae' | 'paceWithin10' | 'pausePrecision' | 'pauseRecall' | 'pauseF1';

export interface MetricResult {
  value: number;
  /** 95% bootstrap interval over recordings. */
  ci: [number, number];
}

export interface AccuracyReport {
  /** True only with at least MIN_PUBLISHED_RECORDINGS real recordings. */
  published: boolean;
  generatedAt: string;
  commit: string;
  recordings: number;
  totalMs: number;
  minRecordings: number;
  syntheticSkipped: number;
  metrics: Record<MetricKey, MetricResult> | null;
  perRecording: { name: string; durationMs: number; fillerF1: number; pauseF1: number; paceMae: number | null }[];
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  fillerPrecision: 'Filler precision',
  fillerRecall: 'Filler recall',
  fillerF1: 'Filler F1',
  paceMae: 'Pace error (wpm, mean absolute)',
  paceWithin10: 'Pace within ±10 wpm',
  pausePrecision: 'Pause precision',
  pauseRecall: 'Pause recall',
  pauseF1: 'Pause F1',
};

/** Small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pool(rs: readonly RecordingResult[]): Pooled {
  const errors = rs.flatMap((r) => r.paceErrors);
  return {
    fillers: combine(rs.map((r) => r.fillers)),
    pauses: combine(rs.map((r) => r.pauses)),
    paceMae: errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : 0,
    paceWithin: errors.length ? errors.filter((e) => e <= PACE_TOLERANCE_WPM).length / errors.length : 0,
    pacePoints: errors.length,
  };
}

const STATS: Record<MetricKey, (p: Pooled) => number> = {
  fillerPrecision: (p) => p.fillers.precision,
  fillerRecall: (p) => p.fillers.recall,
  fillerF1: (p) => p.fillers.f1,
  paceMae: (p) => p.paceMae,
  paceWithin10: (p) => p.paceWithin,
  pausePrecision: (p) => p.pauses.precision,
  pauseRecall: (p) => p.pauses.recall,
  pauseF1: (p) => p.pauses.f1,
};

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Percentile bootstrap over recordings (each resample draws whole recordings with replacement,
 * since words in one recording aren't independent). Returns a 95% interval per metric.
 */
export function bootstrap(rs: readonly RecordingResult[], { iterations = BOOTSTRAP_ITERATIONS, seed = BOOTSTRAP_SEED } = {}): Record<MetricKey, [number, number]> {
  const rand = seededRandom(seed);
  const samples = Object.fromEntries(Object.keys(STATS).map((k) => [k, [] as number[]])) as Record<MetricKey, number[]>;
  for (let i = 0; i < iterations; i++) {
    const draw = Array.from({ length: rs.length }, () => rs[Math.floor(rand() * rs.length)]);
    const p = pool(draw);
    for (const k of Object.keys(STATS) as MetricKey[]) samples[k].push(STATS[k](p));
  }
  const out = {} as Record<MetricKey, [number, number]>;
  for (const k of Object.keys(STATS) as MetricKey[]) {
    const s = samples[k].sort((a, b) => a - b);
    out[k] = [quantile(s, 0.025), quantile(s, 0.975)];
  }
  return out;
}

export function buildAccuracyReport(all: readonly RecordingResult[], meta: { generatedAt: string; commit: string }): AccuracyReport {
  const real = all.filter((r) => !r.synthetic);
  const published = real.length >= MIN_PUBLISHED_RECORDINGS;
  let metrics: AccuracyReport['metrics'] = null;
  if (published) {
    const p = pool(real);
    const ci = bootstrap(real);
    metrics = Object.fromEntries((Object.keys(STATS) as MetricKey[]).map((k) => [k, { value: STATS[k](p), ci: ci[k] }])) as Record<MetricKey, MetricResult>;
  }
  return {
    published,
    generatedAt: meta.generatedAt,
    commit: meta.commit,
    recordings: real.length,
    totalMs: real.reduce((s, r) => s + r.durationMs, 0),
    minRecordings: MIN_PUBLISHED_RECORDINGS,
    syntheticSkipped: all.length - real.length,
    metrics,
    perRecording: real.map((r) => ({
      name: r.name,
      durationMs: Math.round(r.durationMs),
      fillerF1: r.fillers.f1,
      pauseF1: r.pauses.f1,
      paceMae: r.paceErrors.length ? r.paceErrors.reduce((s, e) => s + e, 0) / r.paceErrors.length : null,
    })),
  };
}

const isRate = (k: MetricKey) => k !== 'paceMae';

/** "91.2%" for rates, "6.4" for wpm. */
export function formatMetric(k: MetricKey, v: number): string {
  return isRate(k) ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
}

function formatCi(k: MetricKey, m: MetricResult): string {
  return `${formatMetric(k, m.ci[0])} to ${formatMetric(k, m.ci[1])}`;
}

function minutes(ms: number): string {
  const m = ms / 60_000;
  return m >= 10 ? `${Math.round(m)} min` : `${m.toFixed(1)} min`;
}

export function needsMoreText(report: Pick<AccuracyReport, 'recordings' | 'minRecordings'>): string {
  return `Needs at least ${report.minRecordings} labelled recordings (${report.recordings} so far)`;
}

/** docs/accuracy.md */
export function renderAccuracyMarkdown(r: AccuracyReport): string {
  const lines: string[] = [
    '# Vireo metrics accuracy',
    '',
    '<!-- Generated by `npm run eval -- --report`. Do not edit by hand. -->',
    '',
    `Generated ${r.generatedAt.slice(0, 10)} at commit \`${r.commit}\`. ${r.recordings} real ${r.recordings === 1 ? 'recording' : 'recordings'}, ${minutes(r.totalMs)} in total.${r.syntheticSkipped ? ` ${r.syntheticSkipped} synthetic ${r.syntheticSkipped === 1 ? 'example was' : 'examples were'} left out: synthetic audio only checks the harness runs.` : ''}`,
    '',
    'How each number is measured is in [`eval/README.md`](../eval/README.md). Intervals are 95% percentile bootstrap intervals over recordings (' +
      `${BOOTSTRAP_ITERATIONS.toLocaleString('en-US')} resamples, seed ${BOOTSTRAP_SEED}), so they show how much the result depends on which recordings were labelled.`,
    '',
  ];
  if (!r.published || !r.metrics) {
    lines.push(`**Not published yet.** ${needsMoreText(r)}. Until then Vireo shows "not yet published" wherever accuracy would appear.`, '');
  } else {
    lines.push('| Metric | Result | 95% interval |', '| :--- | ---: | ---: |');
    for (const k of Object.keys(METRIC_LABELS) as MetricKey[]) {
      lines.push(`| ${METRIC_LABELS[k]} | ${formatMetric(k, r.metrics[k].value)} | ${formatCi(k, r.metrics[k])} |`);
    }
    lines.push('');
  }
  if (r.perRecording.length) {
    lines.push(r.published ? '## Per recording' : '## Per recording (work in progress, not published)', '', '| Recording | Length | Filler F1 | Pause F1 | Pace error (wpm) |', '| :--- | ---: | ---: | ---: | ---: |');
    for (const p of r.perRecording) {
      lines.push(`| ${p.name} | ${minutes(p.durationMs)} | ${(p.fillerF1 * 100).toFixed(1)}% | ${(p.pauseF1 * 100).toFixed(1)}% | ${p.paceMae === null ? 'Not measured' : p.paceMae.toFixed(1)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const README_START = '<!-- eval:start -->';
export const README_END = '<!-- eval:end -->';

/** The README's accuracy table (between the eval markers). */
export function renderReadmeTable(r: AccuracyReport): string {
  const rows = (Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => {
    const result = r.published && r.metrics ? `${formatMetric(k, r.metrics[k].value)} (${formatCi(k, r.metrics[k])})` : needsMoreText(r);
    return `| ${METRIC_LABELS[k]} | ${result} |`;
  });
  const footer = r.published
    ? `From ${r.recordings} labelled recordings, ${minutes(r.totalMs)} in total, at commit \`${r.commit}\`. Brackets are 95% bootstrap intervals. Full report: [docs/accuracy.md](docs/accuracy.md).`
    : `No numbers are published until ${r.minRecordings} real recordings are labelled. See [eval/README.md](eval/README.md) to help.`;
  return ['| Metric | Result |', '| :--- | :--- |', ...rows, '', footer].join('\n');
}

export { replaceBetween } from '@/lib/markers';
