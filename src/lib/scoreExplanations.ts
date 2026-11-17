/**
 * "How this was scored": one explanation for every score and headline number Vireo shows,
 * used by the app, the PDF report and docs/scoring.md. Each says what it measures, the formula,
 * this session's real inputs, the target and where that target comes from, and how accurate the
 * measurement is (or that accuracy isn't published yet). Nothing here may invent a number.
 */
import accuracyJson from '@/data/accuracy.json';
import type { StoredSession } from '@/storage/localDb';
import { TALK_TYPES } from '@/live/metrics/pace';
import { MIN_PAUSE_MS } from '@/live/metrics/vad';
import { situationById } from '@/session/situations';
import { adoptionRate, CORE_TOLERANCE, SENTENCE_END_PAUSE_MS, TARGET_METRICS, MIN_RETAKES_FOR_RATE } from './fixAdoption';
import { oneDecimal } from './format';

export type ScoreId =
  | 'structure'
  | 'delivery'
  | 'clarity'
  | 'fillersPerMin'
  | 'timeInZonePct'
  | 'pausesPerMin'
  | 'eyeContactPct'
  | 'timeToMainPointMs'
  | 'fixAdoption'
  | 'fixAdoptionRate'
  | 'minutesThisWeek'
  | 'followUpsWaiting';

/** Which published accuracy metrics back a measurement. */
type AccuracySource = { kind: 'measured'; metrics: AccuracyMetricKey[] } | { kind: 'model' } | { kind: 'camera' } | { kind: 'count' };

type AccuracyMetricKey = 'fillerPrecision' | 'fillerRecall' | 'fillerF1' | 'paceMae' | 'paceWithin10' | 'pausePrecision' | 'pauseRecall' | 'pauseF1';

export interface ExplainContext {
  /** The session the number is about, when there is one. */
  session?: StoredSession;
  /** Every session on this device (Home numbers and fix adoption). */
  sessions?: readonly StoredSession[];
  /** For before and after: the previous take. */
  previous?: StoredSession | null;
}

export interface ScoreExplanation {
  id: ScoreId;
  title: string;
  measures: string;
  formula: string;
  /** This session's real inputs. Empty when there is no session to describe. */
  inputs: (ctx: ExplainContext) => { label: string; value: string }[];
  /** The target and its source, or null when there is no target. */
  target: (ctx: ExplainContext) => { text: string; source: string } | null;
  accuracy: AccuracySource;
}

export interface AccuracyFile {
  published: boolean;
  recordings: number;
  minRecordings: number;
  commit: string;
  generatedAt: string;
  metrics: Partial<Record<AccuracyMetricKey, { value: number; ci: [number, number] }>> | null;
}

export const ACCURACY: AccuracyFile = accuracyJson as AccuracyFile;
export const ACCURACY_REPORT_URL = 'https://github.com/manoj2883/Vireo/blob/main/docs/accuracy.md';

const PACE_ZONE_SOURCE = 'Vireo’s design target for this kind of talk, set when the situations were designed. It isn’t taken from a published study.';
const minutesOf = (s: StoredSession) => `${oneDecimal(s.metrics.durationMs / 60_000)} min`;

function zoneOf(s: StoredSession | undefined) {
  return s ? TALK_TYPES[s.config.talkType]?.zone : undefined;
}

export const SCORE_EXPLANATIONS: Record<ScoreId, ScoreExplanation> = {
  structure: {
    id: 'structure',
    title: 'Structure',
    measures: 'Whether the answer had a point, an order and a landing.',
    formula: 'A 0 to 100 judgement by the field notes model, reading your transcript against the situation’s criteria (and your Story Bank outline, if you chose one).',
    inputs: ({ session }) =>
      session?.notes
        ? [
            { label: 'Situation criteria', value: situationById(session.config.situationId)?.criteria.join(' ') ?? 'None (your own question)' },
            { label: 'Story Bank outline', value: session.config.storyId ? 'Yes' : 'None chosen' },
          ]
        : [],
    target: () => ({ text: 'Your best earlier structure score.', source: 'Your own sessions on this device.' }),
    accuracy: { kind: 'model' },
  },
  delivery: {
    id: 'delivery',
    title: 'Delivery',
    measures: 'Pace, fillers and pauses, as a listener would feel them.',
    formula: 'A 0 to 100 judgement by the field notes model, given the pace, filler and pause numbers measured on your device.',
    inputs: ({ session }) =>
      session
        ? [
            { label: 'Time in your pace zone', value: `${session.metrics.timeInZonePct}%` },
            { label: 'Fillers', value: `${oneDecimal(session.metrics.fillersPerMin)} a minute` },
            { label: 'Pauses', value: `${oneDecimal(session.metrics.pausesPerMin)} a minute` },
          ]
        : [],
    target: () => ({ text: 'Your best earlier delivery score.', source: 'Your own sessions on this device.' }),
    accuracy: { kind: 'model' },
  },
  clarity: {
    id: 'clarity',
    title: 'Clarity',
    measures: 'How concrete, precise and easy to follow the answer was.',
    formula: 'A 0 to 100 judgement by the field notes model, reading your transcript.',
    inputs: ({ session }) => (session ? [{ label: 'Words heard', value: String(session.metrics.wordCount) }] : []),
    target: () => ({ text: 'Your best earlier clarity score.', source: 'Your own sessions on this device.' }),
    accuracy: { kind: 'model' },
  },
  fillersPerMin: {
    id: 'fillersPerMin',
    title: 'Fillers a minute',
    measures: 'How often you said a filler such as “um”, “uh”, “like” or “you know”.',
    formula: 'Fillers in the transcript ÷ session length in minutes, to one decimal place. A phrase like “you know” counts once. Sounds with no transcribed word are shown faintly but never counted.',
    inputs: ({ session }) =>
      session
        ? [
            { label: 'Fillers counted', value: String(session.metrics.fillerCount) },
            { label: 'Session length', value: minutesOf(session) },
          ]
        : [],
    target: () => ({ text: 'No fixed target: fewer is better, and Vireo compares you with your own earlier takes.', source: 'Vireo doesn’t set a filler target, because a few fillers are normal in natural speech.' }),
    accuracy: { kind: 'measured', metrics: ['fillerPrecision', 'fillerRecall', 'fillerF1'] },
  },
  timeInZonePct: {
    id: 'timeInZonePct',
    title: 'Time in your pace zone',
    measures: 'The share of your speaking time spent at a comfortable pace for this kind of talk.',
    formula: 'Pace is read about once a second while you speak (words per minute over a rolling window, leaving out long pauses). Time in zone = readings inside the zone ÷ all readings, as a percentage.',
    inputs: ({ session }) => {
      const zone = zoneOf(session);
      return session && zone
        ? [
            { label: 'Your zone', value: `${zone.min} to ${zone.max} wpm` },
            { label: 'Average pace', value: `${session.metrics.avgWpm} wpm` },
            { label: 'Result', value: `${session.metrics.timeInZonePct}%` },
          ]
        : [];
    },
    target: ({ session }) => {
      const zone = zoneOf(session);
      return { text: zone ? `As much time as possible between ${zone.min} and ${zone.max} wpm.` : 'As much time as possible inside your zone.', source: PACE_ZONE_SOURCE };
    },
    accuracy: { kind: 'measured', metrics: ['paceMae', 'paceWithin10'] },
  },
  pausesPerMin: {
    id: 'pausesPerMin',
    title: 'Pauses a minute',
    measures: 'How often you held a deliberate silence.',
    formula: `Silences longer than ${MIN_PAUSE_MS} ms after you start speaking, found from the microphone’s loudness on your device, ÷ session length in minutes.`,
    inputs: ({ session }) =>
      session
        ? [
            { label: 'Pauses counted', value: String(session.metrics.pauseCount) },
            { label: 'Longest pause', value: `${oneDecimal(session.metrics.longestPauseMs / 1000)} s` },
            { label: 'Session length', value: minutesOf(session) },
          ]
        : [],
    target: () => ({ text: '3 to 5 a minute.', source: 'Vireo’s rule of thumb from its design, not from a published study.' }),
    accuracy: { kind: 'measured', metrics: ['pausePrecision', 'pauseRecall', 'pauseF1'] },
  },
  eyeContactPct: {
    id: 'eyeContactPct',
    title: 'Eye contact',
    measures: 'The share of the session you were looking at the camera.',
    formula: 'Face direction is estimated on your device about ten times a second with MediaPipe, against your two-second calibration. Eye contact = time facing the camera ÷ time your face was tracked.',
    inputs: ({ session }) =>
      session?.camera
        ? [
            { label: 'Eye contact', value: `${session.camera.summary.eyeContactPct}%` },
            { label: 'Longest look away', value: `${oneDecimal(session.camera.summary.longestLookAwayMs / 1000)} s` },
          ]
        : [],
    target: () => ({ text: 'No fixed target: more is usually better.', source: 'Vireo doesn’t set an eye-contact target.' }),
    accuracy: { kind: 'camera' },
  },
  timeToMainPointMs: {
    id: 'timeToMainPointMs',
    title: 'Time to your main point',
    measures: 'How long before you said the sentence that answers the question.',
    formula: 'The field notes model marks the moment you first state your main point; its time from the start of the session is shown. If you never stated it, nothing is shown.',
    inputs: ({ session }) =>
      session?.notes && typeof session.notes.mainPointMs === 'number' ? [{ label: 'Main point at', value: `${oneDecimal(session.notes.mainPointMs / 1000)} s` }] : [],
    target: ({ session }) =>
      session?.config.situationId === 'interview'
        ? { text: 'Within the first 20 seconds.', source: 'Vireo’s job interview criteria, a design choice rather than a published study.' }
        : { text: 'Sooner is usually better.', source: 'Vireo doesn’t set a target outside job interviews.' },
    accuracy: { kind: 'model' },
  },
  fixAdoption: {
    id: 'fixAdoption',
    title: 'Fix adopted',
    measures: 'Whether this retake actually did the one fix from the take before.',
    formula: `Each fix names one measure it should move. The fix counts as adopted when that measure improves by at least its threshold (${Object.values(TARGET_METRICS)
      .map((t) => `${t.label.toLowerCase()}: ${t.value(t.threshold)}${t.unit}`)
      .join('; ')}) and no core measure clearly gets worse (${CORE_TOLERANCE.map((c) => `${TARGET_METRICS[c.id].label.toLowerCase()} by more than ${TARGET_METRICS[c.id].value(c.worseBy)}${TARGET_METRICS[c.id].unit}`).join(', ')}). Sentence-end pauses count a pause of ${SENTENCE_END_PAUSE_MS} ms or more after a sentence.`,
    inputs: ({ session, previous }) => {
      const fix = previous?.notes?.oneFix;
      if (!session || !previous || !fix) return [];
      const spec = fix.targetMetric && fix.targetMetric !== 'not_measurable' ? TARGET_METRICS[fix.targetMetric] : null;
      if (!spec) return [{ label: 'Fix', value: `${fix.instruction} (not measurable)` }];
      const b = spec.measure(previous);
      const a = spec.measure(session);
      return [
        { label: 'Fix', value: fix.instruction },
        { label: 'Measured by', value: spec.label },
        { label: 'Before', value: b === null ? 'Not measured' : `${spec.value(b)}${spec.unit}` },
        { label: 'After', value: a === null ? 'Not measured' : `${spec.value(a)}${spec.unit}` },
        { label: 'Needed', value: `${spec.direction === 'lower' ? 'down' : 'up'} by ${spec.value(spec.threshold)}${spec.unit}` },
      ];
    },
    target: () => ({ text: 'Adopt the fix on the next take.', source: 'Vireo’s practice loop: one fix, then take it again.' }),
    accuracy: { kind: 'count' },
  },
  fixAdoptionRate: {
    id: 'fixAdoptionRate',
    title: 'Fixes adopted',
    measures: 'Of your retakes where the fix could be measured, how many adopted it.',
    formula: `Retakes whose fix was adopted ÷ retakes whose fix could be measured. Shown once there are at least ${MIN_RETAKES_FOR_RATE}. Worked out on this device from your sessions; nothing is sent anywhere.`,
    inputs: ({ sessions }) => {
      if (!sessions) return [];
      const r = adoptionRate(sessions);
      return [
        { label: 'Adopted', value: String(r.adopted) },
        { label: 'Measured retakes', value: String(r.measured) },
      ];
    },
    target: () => null,
    accuracy: { kind: 'count' },
  },
  minutesThisWeek: {
    id: 'minutesThisWeek',
    title: 'Practised this week',
    measures: 'Total speaking time in the last seven days.',
    formula: 'The lengths of every session in the last seven days, added up and rounded to the nearest minute.',
    inputs: () => [],
    target: () => null,
    accuracy: { kind: 'count' },
  },
  followUpsWaiting: {
    id: 'followUpsWaiting',
    title: 'Follow-up questions waiting',
    measures: 'Audience mode follow-up questions you haven’t answered yet.',
    formula: 'Sessions with Audience mode on whose follow-up hasn’t been answered in a later session.',
    inputs: () => [],
    target: () => null,
    accuracy: { kind: 'count' },
  },
};

export function explanationFor(id: ScoreId): ScoreExplanation {
  return SCORE_EXPLANATIONS[id];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const LABELS: Record<AccuracyMetricKey, string> = {
  fillerPrecision: 'precision',
  fillerRecall: 'recall',
  fillerF1: 'F1',
  paceMae: 'mean error',
  paceWithin10: 'within ±10 wpm',
  pausePrecision: 'precision',
  pauseRecall: 'recall',
  pauseF1: 'F1',
};

/** One plain sentence on how accurate this measurement is, never inventing a number. */
export function accuracyText(e: ScoreExplanation, ctx: ExplainContext = {}, accuracy: AccuracyFile = ACCURACY): string {
  switch (e.accuracy.kind) {
    case 'measured': {
      if (!accuracy.published || !accuracy.metrics) {
        return `Accuracy not yet published: it needs at least ${accuracy.minRecordings} hand-labelled recordings (${accuracy.recordings} so far).`;
      }
      const parts = e.accuracy.metrics
        .map((k) => {
          const m = accuracy.metrics?.[k];
          if (!m) return null;
          return k === 'paceMae' ? `${LABELS[k]} ${m.value.toFixed(1)} wpm` : `${LABELS[k]} ${pct(m.value)}`;
        })
        .filter(Boolean);
      return `Against ${accuracy.recordings} hand-labelled recordings: ${parts.join(', ')}.`;
    }
    case 'model': {
      const n = ctx.session?.notes;
      const who = n?.provider ? `Scored by ${n.provider}${n.model ? ` (${n.model})` : ''}.` : 'Scored by the field notes model.';
      const dropped = n ? ` The evidence check dropped ${n.droppedNotes ?? 0} ${(n.droppedNotes ?? 0) === 1 ? 'note' : 'notes'} that didn’t quote your words.` : '';
      return `${who} This is a model’s judgement, not a measurement, so it has no accuracy figure.${dropped}`;
    }
    case 'camera':
      return 'Accuracy not yet published: the camera estimate hasn’t been tested against labelled video.';
    case 'count':
      return 'Counted directly from your sessions, so there’s nothing to estimate.';
  }
}

/** docs/scoring.md, generated from the same explanations the app shows. */
export function renderScoringMarkdown(accuracy: AccuracyFile = ACCURACY): string {
  const lines = [
    '# How Vireo scores',
    '',
    '<!-- Generated from src/lib/scoreExplanations.ts by `npm run docs`. Do not edit by hand. -->',
    '',
    'Every score and headline number in Vireo has a “How this was scored” note under it. This page collects them. In the app, each note also shows that session’s real inputs.',
    '',
  ];
  for (const e of Object.values(SCORE_EXPLANATIONS)) {
    const target = e.target({});
    lines.push(`## ${e.title}`, '', `**What it measures.** ${e.measures}`, '', `**How.** ${e.formula}`, '');
    if (target) lines.push(`**Target.** ${target.text} *Source:* ${target.source}`, '');
    lines.push(`**Accuracy.** ${accuracyText(e, {}, accuracy)}`, '');
  }
  return lines.join('\n');
}
