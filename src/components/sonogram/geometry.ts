/**
 * Pure sonogram geometry. Given word segments, pauses and annotations, works out every
 * stroke, label, pause mark and annotation bracket in SVG user units. No DOM, no React,
 * so it can be unit-tested with fixed inputs.
 *
 * Each word is three stacked harmonic strokes (fundamental thick and opaque, second
 * medium at 0.6, third thin at 0.32). Fillers are drawn flat. Rushed words keep the
 * speech colour but sit closer together with a busier contour. Pauses are real gaps.
 */
import type { AnnotationTone, PauseSpan, SonogramAnnotation, SonogramVariant, WordKind, WordSegment } from './types';

export const HARMONIC_OPACITY = [1, 0.6, 0.32] as const;

/** Silence shorter than this is a breath between words, not a pause worth marking. */
export const MIN_MARKED_PAUSE_MS = 300;

export interface VariantSpec {
  width: number;
  height: number;
  padX: number;
  /** y of the fundamental's resting line. */
  fundamentalY: number;
  /** How far above the fundamental each harmonic sits. */
  harmonicGaps: readonly [number, number, number];
  strokeWidths: readonly [number, number, number];
  /** Contour amplitude for normal speech. */
  amp: number;
  /** Gap trimmed from each end of a word so neighbours read as separate. */
  wordInset: number;
  rushedInset: number;
  samplesPerWord: number;
  /** Word labels under the trace; null hides them. */
  labelY: number | null;
  labelFontSize: number;
  /** Annotation text baseline for the first row; null hides annotations. */
  annotationY: number | null;
  annotationFontSize: number;
  annotationRowGap: number;
  /** The bracket's top line; its ticks drop by bracketTick. */
  bracketY: number;
  bracketTick: number;
  /** Baseline and pitch axis (hero only). */
  axis: { baselineY: number; top: number } | null;
}

export const VARIANTS: Record<SonogramVariant, VariantSpec> = {
  hero: {
    width: 1200,
    height: 380,
    padX: 48,
    fundamentalY: 240,
    harmonicGaps: [0, 58, 112],
    strokeWidths: [8, 5, 3],
    amp: 10,
    wordInset: 3,
    rushedInset: 1,
    samplesPerWord: 14,
    labelY: 334,
    labelFontSize: 17,
    annotationY: 44,
    annotationFontSize: 22,
    annotationRowGap: 28,
    bracketY: 58,
    bracketTick: 8,
    axis: { baselineY: 300, top: 78 },
  },
  ribbon: {
    width: 1000,
    height: 120,
    padX: 0,
    fundamentalY: 86,
    harmonicGaps: [0, 34, 62],
    strokeWidths: [6, 3.5, 2],
    amp: 7,
    wordInset: 2,
    rushedInset: 0.5,
    samplesPerWord: 8,
    labelY: null,
    labelFontSize: 0,
    annotationY: null,
    annotationFontSize: 0,
    annotationRowGap: 0,
    bracketY: 0,
    bracketTick: 0,
    axis: null,
  },
  mini: {
    width: 200,
    height: 64,
    padX: 6,
    fundamentalY: 50,
    harmonicGaps: [0, 16, 30],
    strokeWidths: [3, 2, 1.2],
    amp: 4,
    wordInset: 1.5,
    rushedInset: 0.5,
    samplesPerWord: 6,
    labelY: null,
    labelFontSize: 0,
    annotationY: null,
    annotationFontSize: 0,
    annotationRowGap: 0,
    bracketY: 0,
    bracketTick: 0,
    axis: null,
  },
};

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export interface LayoutInput {
  segments: readonly WordSegment[];
  pauses?: readonly PauseSpan[];
  annotations?: readonly SonogramAnnotation[];
  variant?: SonogramVariant;
  /** Time range to draw. Defaults to the span of all segments and pauses. */
  window?: TimeWindow;
  /** Live clock: anything after this hasn't happened yet and is clipped. */
  nowMs?: number;
  /** Widen the drawing so long answers stay legible; the caller scrolls it. */
  minPxPerSecond?: number;
  /** Speaker's reference pitch; defaults to the median of all pitch samples. */
  referenceHz?: number;
  /** Mark pauses in the annotation band (hero only). */
  labelPauses?: boolean;
}

export type Point = readonly [number, number];

export interface Stroke {
  key: string;
  wordIndex: number;
  harmonic: 0 | 1 | 2;
  kind: WordKind;
  points: Point[];
  d: string;
  strokeWidth: number;
  opacity: number;
}

export interface WordBox {
  index: number;
  text: string;
  kind: WordKind;
  xa: number;
  xb: number;
  /** True when the word runs past the window or the live clock. */
  clipped: boolean;
  usesPitch: boolean;
}

export interface WordLabel {
  wordIndex: number;
  x: number;
  text: string;
  kind: WordKind;
}

export interface PauseMark {
  xa: number;
  xb: number;
  durationMs: number;
  inProgress: boolean;
}

export interface AnnotationMark {
  key: string;
  text: string;
  tone: AnnotationTone;
  xa: number;
  xb: number;
  textX: number;
  textY: number;
  row: number;
  bracket: string;
}

export interface TimeTick {
  x: number;
  label: string;
}

export interface SonogramLayout {
  width: number;
  height: number;
  window: TimeWindow;
  /** Maps a time on the session clock to x. */
  xAt: (ms: number) => number;
  /** Time-axis ticks under the baseline (variants with an axis). */
  ticks: TimeTick[];
  spec: VariantSpec;
  words: WordBox[];
  strokes: Stroke[];
  labels: WordLabel[];
  pauses: PauseMark[];
  annotations: AnnotationMark[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function pathFromPoints(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${round1(x)} ${round1(y)}`).join(' ');
}

function isVoiced(hz: number): boolean {
  return Number.isFinite(hz) && hz > 0;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median of every voiced pitch sample across the answer: the speaker's resting pitch. */
export function referencePitch(segments: readonly WordSegment[]): number | null {
  const all: number[] = [];
  for (const seg of segments) for (const hz of seg.pitch ?? []) if (isVoiced(hz)) all.push(hz);
  return median(all);
}

/** Linear interpolation over the voiced samples of a word, at position u in [0, 1]. */
function pitchAt(samples: readonly number[], u: number): number {
  const voiced = samples
    .map((hz, i) => ({ hz, u: samples.length === 1 ? 0 : i / (samples.length - 1) }))
    .filter((s) => isVoiced(s.hz));
  if (u <= voiced[0].u) return voiced[0].hz;
  for (let i = 1; i < voiced.length; i++) {
    if (u <= voiced[i].u) {
      const a = voiced[i - 1];
      const b = voiced[i];
      const f = (u - a.u) / (b.u - a.u || 1);
      return a.hz + f * (b.hz - a.hz);
    }
  }
  return voiced[voiced.length - 1].hz;
}

/** A word has usable pitch when at least two samples are voiced. */
export function hasUsablePitch(seg: WordSegment): boolean {
  return (seg.pitch ?? []).filter(isVoiced).length >= 2;
}

/**
 * Vertical offset (positive = higher on screen) of the fundamental at position u through
 * word `index`. Real pitch when available, else a gentle synthetic contour seeded by the
 * word's index so the same answer always draws the same way.
 */
export function contourOffset(
  seg: WordSegment,
  index: number,
  u: number,
  spec: VariantSpec,
  refHz: number | null
): number {
  if (seg.kind === 'filler') return 0;
  if (refHz && hasUsablePitch(seg)) {
    const semitones = 12 * Math.log2(pitchAt(seg.pitch!, u) / refHz);
    return clamp(semitones, -10, 10) * spec.amp * 0.35;
  }
  const env = Math.sin(Math.PI * Math.min(1, u * 1.05));
  if (seg.kind === 'rushed') {
    return spec.amp * 1.3 * Math.sin(index * 1.7 + u * 9) * env;
  }
  return spec.amp * Math.sin(index * 1.7 + u * 5) * env + spec.amp * 4 * u * (1 - u);
}

/** Resting line for a word's fundamental: fillers hum low, rushed words ride higher. */
export function baseY(seg: WordSegment, spec: VariantSpec, usesPitch: boolean): number {
  if (seg.kind === 'filler') return spec.fundamentalY + 1.2 * spec.amp;
  if (seg.kind === 'rushed' && !usesPitch) return spec.fundamentalY - 1.2 * spec.amp;
  return spec.fundamentalY;
}

export function defaultWindow(segments: readonly WordSegment[], pauses: readonly PauseSpan[]): TimeWindow {
  let start = Infinity;
  let end = -Infinity;
  for (const s of segments) {
    start = Math.min(start, s.startMs);
    end = Math.max(end, s.endMs);
  }
  for (const p of pauses) {
    start = Math.min(start, p.startMs);
    if (p.endMs !== undefined && Number.isFinite(p.endMs)) end = Math.max(end, p.endMs);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { startMs: 0, endMs: 1000 };
  return { startMs: start, endMs: end };
}

/** Rough text width for layout decisions; good enough to avoid overlaps. */
export function estimateTextWidth(text: string, fontSize: number, italic = false): number {
  return text.length * fontSize * (italic ? 0.45 : 0.52);
}

export function bracketPath(xa: number, xb: number, top: number, tick: number): string {
  return `M${round1(xa)} ${top + tick} L${round1(xa)} ${top} L${round1(xb)} ${top} L${round1(xb)} ${top + tick}`;
}

function overlapFraction(a: TimeWindow, b: TimeWindow): number {
  const inter = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  const len = Math.max(1, b.endMs - b.startMs);
  return Math.max(0, inter) / len;
}

export function formatPauseSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s pause`;
}

/**
 * For small drawings of long answers: merge runs of ordinary words into longer strokes so the
 * shape stays readable, while every filler keeps its own flat mark (so they can be counted).
 */
export function simplifySegments(segments: readonly WordSegment[], maxStrokes: number): WordSegment[] {
  const speechCount = segments.filter((s) => s.kind !== 'filler').length;
  const fillerCount = segments.length - speechCount;
  const budget = Math.max(1, maxStrokes - fillerCount);
  if (segments.length <= maxStrokes) return [...segments];
  const per = Math.max(1, Math.ceil(speechCount / budget));
  const out: WordSegment[] = [];
  let run: WordSegment[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push({
      text: run.map((r) => r.text).join(' '),
      startMs: run[0].startMs,
      endMs: run[run.length - 1].endMs,
      kind: run.some((r) => r.kind === 'rushed') ? 'rushed' : 'speech',
    });
    run = [];
  };
  for (const seg of segments) {
    if (seg.kind === 'filler') {
      flush();
      out.push(seg);
    } else {
      // Don't merge across a gap: pauses must stay visible.
      if (run.length && seg.startMs - run[run.length - 1].endMs > 250) flush();
      run.push(seg);
      if (run.length >= per) flush();
    }
  }
  flush();
  return out;
}

export function layoutSonogram(input: LayoutInput): SonogramLayout {
  const spec = VARIANTS[input.variant ?? 'hero'];
  const segments = input.variant === 'mini' ? simplifySegments(input.segments, 28) : input.segments;
  const pauses = input.pauses ?? [];
  const win = input.window ?? defaultWindow(segments, pauses);
  const span = Math.max(1, win.endMs - win.startMs);
  const width = input.minPxPerSecond
    ? Math.max(spec.width, Math.ceil(2 * spec.padX + (span / 1000) * input.minPxPerSecond))
    : spec.width;
  const height = spec.height;
  const innerW = width - 2 * spec.padX;
  const xAt = (ms: number) => spec.padX + ((ms - win.startMs) / span) * innerW;
  const limitMs = Math.min(win.endMs, input.nowMs ?? Infinity);
  const refHz = input.referenceHz ?? referencePitch(segments);

  const words: WordBox[] = [];
  const strokes: Stroke[] = [];

  segments.forEach((seg, index) => {
    const a = Math.max(seg.startMs, win.startMs);
    const b = Math.min(seg.endMs, limitMs);
    if (b <= a) return;
    const clippedStart = a > seg.startMs;
    const clippedEnd = b < seg.endMs;
    const inset = seg.kind === 'rushed' ? spec.rushedInset : spec.wordInset;
    let xa = xAt(a);
    let xb = xAt(b);
    if (xb - xa > 2 * inset + 1) {
      if (!clippedStart) xa += inset;
      if (!clippedEnd) xb -= inset;
    }
    const usesPitch = refHz !== null && seg.kind !== 'filler' && hasUsablePitch(seg);
    words.push({ index, text: seg.text, kind: seg.kind, xa, xb, clipped: clippedStart || clippedEnd, usesPitch });

    const dur = Math.max(1, seg.endMs - seg.startMs);
    const u0 = (a - seg.startMs) / dur;
    const u1 = (b - seg.startMs) / dur;
    const n = spec.samplesPerWord;
    const base = baseY(seg, spec, usesPitch);

    for (const h of [0, 1, 2] as const) {
      const points: Point[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = u0 + t * (u1 - u0);
        const y = base - spec.harmonicGaps[h] - contourOffset(seg, index, u, spec, refHz) * (1 + h * 0.45);
        points.push([xa + t * (xb - xa), y]);
      }
      strokes.push({
        key: `${index}-${h}`,
        wordIndex: index,
        harmonic: h,
        kind: seg.kind,
        points,
        d: pathFromPoints(points),
        strokeWidth: spec.strokeWidths[h],
        opacity: HARMONIC_OPACITY[h],
      });
    }
  });

  // Word labels under the trace, dropped where they would collide.
  const labels: WordLabel[] = [];
  if (spec.labelY !== null) {
    let lastRight = -Infinity;
    for (const w of words) {
      if (w.clipped) continue;
      const x = (w.xa + w.xb) / 2;
      const half = estimateTextWidth(w.text, spec.labelFontSize) / 2;
      if (x - half >= lastRight + 6) {
        labels.push({ wordIndex: w.index, x, text: w.text, kind: w.kind });
        lastRight = x + half;
      }
    }
  }

  // Pauses: real gaps, marked so they read as deliberate.
  const pauseMarks: PauseMark[] = [];
  for (const p of pauses) {
    const end = p.endMs ?? Infinity;
    const a = Math.max(p.startMs, win.startMs);
    const b = Math.min(end, limitMs);
    if (b <= a) continue;
    pauseMarks.push({
      xa: xAt(a),
      xb: xAt(b),
      durationMs: Math.min(end, limitMs) - p.startMs,
      inProgress: !Number.isFinite(end) || end > limitMs,
    });
  }

  // Annotations, plus automatic pause labels where no note already covers the pause.
  const annotations: AnnotationMark[] = [];
  if (spec.annotationY !== null) {
    const notes: (SonogramAnnotation & { key: string })[] = (input.annotations ?? []).map((n, i) => ({ ...n, key: `n${i}` }));
    if (input.labelPauses ?? true) {
      pauses.forEach((p, i) => {
        const end = p.endMs ?? Infinity;
        if (!Number.isFinite(end) || end - p.startMs < MIN_MARKED_PAUSE_MS) return;
        const span = { startMs: p.startMs, endMs: end };
        if (notes.some((n) => overlapFraction(n, span) >= 0.5)) return;
        notes.push({ ...span, text: formatPauseSeconds(end - p.startMs), tone: 'sky', key: `p${i}` });
      });
    }
    notes.sort((x, y) => x.startMs - y.startMs);

    const rowRight = [-Infinity, -Infinity];
    for (const n of notes) {
      const a = Math.max(n.startMs, win.startMs);
      const b = Math.min(n.endMs, limitMs);
      if (b <= a) continue;
      const xa = xAt(a);
      const xb = xAt(b);
      const w = estimateTextWidth(n.text, spec.annotationFontSize, true);
      const textX = clamp((xa + xb) / 2, w / 2 + 4, width - w / 2 - 4);
      const left = textX - w / 2;
      // First row that is free; if neither is, the one that frees up soonest.
      let row = rowRight.findIndex((r) => left >= r + 12);
      if (row === -1) row = rowRight[0] <= rowRight[1] ? 0 : 1;
      rowRight[row] = textX + w / 2;
      annotations.push({
        key: n.key,
        text: n.text,
        tone: n.tone ?? 'muted',
        xa,
        xb,
        textX,
        textY: spec.annotationY - row * spec.annotationRowGap,
        row,
        bracket: bracketPath(xa, xb, spec.bracketY, spec.bracketTick),
      });
    }
  }

  const ticks: TimeTick[] = [];
  if (spec.axis) {
    const step = span <= 60_000 ? 10_000 : span <= 180_000 ? 30_000 : 60_000;
    for (let t = Math.ceil(win.startMs / step) * step; t <= win.endMs; t += step) {
      const sec = Math.round(t / 1000);
      ticks.push({ x: xAt(t), label: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` });
    }
  }

  return { width, height, window: win, xAt, ticks, spec, words, strokes, labels, pauses: pauseMarks, annotations };
}

/** Plain-language summary for screen readers. */
export function describeSonogram(
  segments: readonly WordSegment[],
  pauses: readonly PauseSpan[] = [],
  annotations: readonly SonogramAnnotation[] = []
): string {
  const fillers = segments.filter((s) => s.kind === 'filler').length;
  const rushed = segments.filter((s) => s.kind === 'rushed').length;
  const marked = pauses.filter((p) => p.endMs === undefined || p.endMs - p.startMs >= MIN_MARKED_PAUSE_MS).length;
  const parts = [
    `Sonogram of ${segments.length} ${segments.length === 1 ? 'word' : 'words'}`,
    `${fillers} ${fillers === 1 ? 'filler' : 'fillers'}`,
    `${marked} ${marked === 1 ? 'pause' : 'pauses'}`,
  ];
  if (rushed) parts.push(`${rushed} rushed ${rushed === 1 ? 'word' : 'words'}`);
  let text = parts.join(', ') + '.';
  if (annotations.length) text += ' Notes: ' + annotations.map((a) => a.text).join('; ') + '.';
  return text;
}
