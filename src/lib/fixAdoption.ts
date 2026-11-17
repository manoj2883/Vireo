/**
 * Fix adoption, Vireo's north-star metric: on a retake, did the speaker actually do the one fix?
 * Every fix names the measure it should move (`targetMetric`). The fix counts as adopted when that
 * measure improves by at least its threshold and no core measure gets clearly worse. Pure, and
 * computed only from sessions stored on this device.
 */
import type { StoredSession } from '@/storage/localDb';
import type { WordSegment } from '@/components/sonogram/types';
import type { FixDirection, FixTargetMetric } from '@/types/fieldNotes';
import { previousTake } from './compare';

/** A pause this long at the end of a sentence lets the point land; shorter ones read as a breath. */
export const SENTENCE_END_PAUSE_MS = 600;
/** Fewer sentence ends than this and the share is too noisy to judge a fix on. */
export const MIN_SENTENCE_ENDS = 3;
/** Fewer measured retakes than this and Home asks for more instead of showing a rate. */
export const MIN_RETAKES_FOR_RATE = 3;

export interface TargetMetricSpec {
  id: Exclude<FixTargetMetric, 'not_measurable'>;
  label: string;
  direction: FixDirection;
  /** The smallest improvement that counts as adopting the fix, in the metric's own unit. */
  threshold: number;
  thresholdReason: string;
  /** The number alone, and its unit, so a change reads "3.8 → 1.2 a minute". */
  value: (n: number) => string;
  unit: string;
  /** This take's value, or null when it can't be measured. */
  measure: (s: StoredSession) => number | null;
}

const oneDp = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Share of sentence ends (not the last) followed by a silence of at least SENTENCE_END_PAUSE_MS, in %. */
export function sentenceEndPausePct(segments: readonly WordSegment[]): number | null {
  let ends = 0;
  let held = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!/[.!?]["'”’)]*$/.test(segments[i].text.trim())) continue;
    ends++;
    if (segments[i + 1].startMs - segments[i].endMs >= SENTENCE_END_PAUSE_MS) held++;
  }
  return ends >= MIN_SENTENCE_ENDS ? Math.round((held / ends) * 100) : null;
}

export const TARGET_METRICS: Record<TargetMetricSpec['id'], TargetMetricSpec> = {
  fillers_per_min: {
    id: 'fillers_per_min',
    label: 'Fillers',
    direction: 'lower',
    threshold: 0.5,
    thresholdReason: 'One filler fewer every two minutes; smaller changes are within the wobble between two takes of the same answer.',
    value: oneDp,
    unit: ' a minute',
    measure: (s) => s.metrics.fillersPerMin,
  },
  time_in_zone_pct: {
    id: 'time_in_zone_pct',
    label: 'Time in your pace zone',
    direction: 'higher',
    threshold: 5,
    thresholdReason: 'Five points is about three seconds of a one-minute answer: enough to be a real change in pace, not a rounding difference.',
    value: (n) => String(Math.round(n)),
    unit: '%',
    measure: (s) => s.metrics.timeInZonePct,
  },
  time_to_main_point_s: {
    id: 'time_to_main_point_s',
    label: 'Time to your main point',
    direction: 'lower',
    threshold: 3,
    thresholdReason: 'Three seconds is roughly one sentence sooner, which a listener notices.',
    value: oneDp,
    unit: ' s',
    measure: (s) => (typeof s.notes?.mainPointMs === 'number' ? s.notes.mainPointMs / 1000 : null),
  },
  sentence_end_pauses_pct: {
    id: 'sentence_end_pauses_pct',
    label: `Sentence ends with a ${SENTENCE_END_PAUSE_MS} ms pause`,
    direction: 'higher',
    threshold: 10,
    thresholdReason: 'Ten points is about one more held pause in a ten-sentence answer.',
    value: (n) => String(Math.round(n)),
    unit: '%',
    measure: (s) => sentenceEndPausePct(s.segments),
  },
  eye_contact_pct: {
    id: 'eye_contact_pct',
    label: 'Eye contact',
    direction: 'higher',
    threshold: 10,
    thresholdReason: 'Ten points is six seconds of a one-minute answer; less is within how the camera estimate varies between takes.',
    value: (n) => String(Math.round(n)),
    unit: '%',
    measure: (s) => s.camera?.summary.eyeContactPct ?? null,
  },
};

/** Core measures that must not get clearly worse while adopting a fix, and by how much is too much. */
export const CORE_TOLERANCE: { id: 'fillers_per_min' | 'time_in_zone_pct'; worseBy: number; reason: string }[] = [
  { id: 'fillers_per_min', worseBy: 1, reason: 'One more filler a minute is a noticeable step back.' },
  { id: 'time_in_zone_pct', worseBy: 10, reason: 'Ten points out of the zone means the pace clearly slipped.' },
];

/** The canonical direction for a target; the model's own `direction` is never trusted over this. */
export function directionOf(metric: FixTargetMetric): FixDirection | null {
  return metric === 'not_measurable' ? null : TARGET_METRICS[metric].direction;
}

export type FixAdoption =
  | { status: 'adopted'; metric: TargetMetricSpec['id']; instruction: string; before: number; after: number }
  | { status: 'not_yet'; metric: TargetMetricSpec['id']; instruction: string; before: number; after: number; worsened?: TargetMetricSpec['id'] }
  | { status: 'not_measurable'; instruction: string; reason: 'not_measurable' | 'older_notes' | 'no_value' };

/** Whether `after` adopted the one fix from `before` (the previous take of the same question). */
export function fixAdoption(before: StoredSession, after: StoredSession): FixAdoption | null {
  const fix = before.notes?.oneFix;
  if (!fix) return null;
  const instruction = fix.instruction;
  if (!fix.targetMetric) return { status: 'not_measurable', instruction, reason: 'older_notes' };
  if (fix.targetMetric === 'not_measurable') return { status: 'not_measurable', instruction, reason: 'not_measurable' };
  const spec = TARGET_METRICS[fix.targetMetric];
  if (!spec) return { status: 'not_measurable', instruction, reason: 'older_notes' };
  const b = spec.measure(before);
  const a = spec.measure(after);
  if (b === null || a === null) return { status: 'not_measurable', instruction, reason: 'no_value' };
  const gain = spec.direction === 'lower' ? b - a : a - b;
  const base = { metric: spec.id, instruction, before: b, after: a };
  if (gain < spec.threshold) return { status: 'not_yet', ...base };
  for (const core of CORE_TOLERANCE) {
    if (core.id === spec.id) continue;
    const c = TARGET_METRICS[core.id];
    const cb = c.measure(before);
    const ca = c.measure(after);
    if (cb === null || ca === null) continue;
    const worse = c.direction === 'lower' ? ca - cb : cb - ca;
    if (worse > core.worseBy) return { status: 'not_yet', ...base, worsened: core.id };
  }
  return { status: 'adopted', ...base };
}

/** "Fix adopted ✓ — fillers 3.8 → 1.2 a minute" */
export function describeAdoption(a: FixAdoption): string {
  if (a.status === 'not_measurable') {
    return a.reason === 'not_measurable'
      ? 'This fix isn’t something Vireo can measure, so it isn’t counted.'
      : a.reason === 'older_notes'
        ? 'Not measured yet: these notes were written before Vireo tracked fixes.'
        : 'Not measured yet: one of the takes has no reading for this.';
  }
  const spec = TARGET_METRICS[a.metric];
  const change = `${spec.label.charAt(0).toLowerCase()}${spec.label.slice(1)} ${spec.value(a.before)} → ${spec.value(a.after)}${spec.unit}`;
  if (a.status === 'adopted') return `Fix adopted ✓ — ${change}`;
  if (a.worsened) return `Not yet — ${change}, but ${TARGET_METRICS[a.worsened].label.toLowerCase()} slipped`;
  return `Not yet — ${change}`;
}

export interface AdoptionRate {
  adopted: number;
  measured: number;
  /** Below MIN_RETAKES_FOR_RATE measured retakes, no rate is shown. */
  enough: boolean;
}

/** Across every retake on this device: how many adopted their fix, of those that could be measured. */
export function adoptionRate(all: readonly StoredSession[]): AdoptionRate {
  let adopted = 0;
  let measured = 0;
  for (const s of all) {
    if (!s.retakeOf || !s.notes) continue;
    const prev = previousTake(s, all);
    if (!prev) continue;
    const a = fixAdoption(prev, s);
    if (!a || a.status === 'not_measurable') continue;
    measured++;
    if (a.status === 'adopted') adopted++;
  }
  return { adopted, measured, enough: measured >= MIN_RETAKES_FOR_RATE };
}

export function describeRate(r: AdoptionRate): string {
  return r.enough ? `${r.adopted} of ${r.measured} retakes` : 'Do a few retakes to see this';
}
