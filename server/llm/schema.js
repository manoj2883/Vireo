// Field notes schema. zod/v4 so the same schema drives validation, Claude structured
// outputs (the Anthropic SDK's helpers import zod/v4) and JSON Schema for other providers.
import { z } from 'zod/v4';

const ms = z.number().int().min(0);
const score = z.number().int().min(0).max(100);

export const NoteSchema = z.object({
  kind: z.enum(['keep', 'fix']),
  title: z.string().min(1),
  body: z.string().min(1),
  /** Exact words from the transcript that back the note. May be empty for a camera note. */
  quote: z.string(),
  /** For a note about the camera (eye contact, posture, gestures, expression): the event id it is about. */
  cameraEventId: z.string().nullable(),
  startMs: ms,
});

export const StorySectionSchema = z.object({
  title: z.string().min(1),
  /** Null for an outline point the speaker never reached. */
  startMs: ms.nullable(),
  endMs: ms.nullable(),
  /** The Story Bank key point this section maps to, when an outline was chosen. */
  outlinePoint: z.string().nullable(),
  /** That key point's number in the outline (1 = first), or null. Matching uses this, not the text. */
  outlineIndex: z.number().int().min(1).nullable(),
  /** hit or missed against the outline; null when no outline was chosen. */
  status: z.enum(['hit', 'missed']).nullable(),
});

export const DrillSchema = z.object({
  title: z.string().min(1),
  instructions: z.string().min(1),
  minutes: z.number().int().min(1).max(30),
});

/** "Say it more naturally": a line whose phrasing would sound non-native or unclear, and how to say it. */
export const NaturalPhrasingSchema = z.object({
  /** Verbatim from the transcript; checked like a note's quote. */
  original: z.string().min(1),
  /** How a native American English speaker would say it in this situation. */
  natural: z.string().min(1),
  /** One plain sentence. */
  why: z.string().min(1),
});

/**
 * The measure a one fix should move, so the next take can show whether it was adopted.
 * Mirrors TARGET_METRICS in src/lib/fixAdoption.ts, which owns thresholds and directions.
 */
export const FIX_TARGET_METRICS = ['fillers_per_min', 'time_in_zone_pct', 'time_to_main_point_s', 'sentence_end_pauses_pct', 'eye_contact_pct', 'not_measurable'];

/** The canonical direction of each target. The model's direction is replaced with this. */
export const FIX_DIRECTIONS = {
  fillers_per_min: 'lower',
  time_in_zone_pct: 'higher',
  time_to_main_point_s: 'lower',
  sentence_end_pauses_pct: 'higher',
  eye_contact_pct: 'higher',
  not_measurable: null,
};

export const FieldNotesSchema = z.object({
  verdict: z.string().min(1),
  /** The single most important change, as an instruction for the next take. */
  oneFix: z.object({
    instruction: z.string().min(1),
    why: z.string().min(1),
    /** The measure this fix should move on the next take, or "not_measurable". */
    targetMetric: z.enum(FIX_TARGET_METRICS),
    /** Lower or higher is better for that measure; null when not measurable. Normalised on the server. */
    direction: z.enum(['lower', 'higher']).nullable(),
  }),
  /** When the main point was first stated, in ms; null if it never was. */
  mainPointMs: ms.nullable(),
  /** On a retake: whether the previous take's one fix was achieved, with an exact quote as evidence. */
  previousFix: z
    .object({
      achieved: z.boolean(),
      evidence: z.string(),
      startMs: ms.nullable(),
    })
    .nullable(),
  summary: z.string().min(1),
  scores: z.object({
    structure: score,
    delivery: score,
    clarity: score,
  }),
  storyMap: z.object({
    sections: z.array(StorySectionSchema),
  }),
  notes: z.array(NoteSchema).min(1),
  audienceFollowUp: z.object({
    question: z.string().min(1),
    reason: z.string().min(1),
  }),
  drills: z.array(DrillSchema).min(1),
  /** Up to three lines to say more naturally; empty when none qualify. */
  naturalPhrasing: z.array(NaturalPhrasingSchema).max(3).optional(),
});

