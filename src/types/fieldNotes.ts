/** Field notes as returned by POST /api/field-notes (mirrors server/llm/schema.js). */

/** The measure a fix should move (mirrors FIX_TARGET_METRICS in server/llm/schema.js). */
export type FixTargetMetric = 'fillers_per_min' | 'time_in_zone_pct' | 'time_to_main_point_s' | 'sentence_end_pauses_pct' | 'eye_contact_pct' | 'not_measurable';
export type FixDirection = 'lower' | 'higher';

export interface FieldNote {
  kind: 'keep' | 'fix';
  title: string;
  body: string;
  quote: string;
  /** For a camera note: the camera event it is about. */
  cameraEventId?: string | null;
  startMs: number;
}

export interface StorySection {
  title: string;
  startMs: number | null;
  endMs: number | null;
  outlinePoint: string | null;
  /** The key point's number in the outline (1 = first). Absent in notes written before it existed. */
  outlineIndex?: number | null;
  status: 'hit' | 'missed' | null;
}

export interface Drill {
  title: string;
  instructions: string;
  minutes: number;
}

export type PhrasingCategory = 'tense' | 'article' | 'preposition' | 'word_order' | 'plural' | 'agreement' | 'word_choice' | 'idiom' | 'other';

export interface NaturalPhrasing {
  /** Verbatim from the transcript. */
  original: string;
  /** How a native American English speaker would say it. */
  natural: string;
  why: string;
  /** The model's label for the kind of change. Absent in older notes. */
  category?: PhrasingCategory;
}

export type BeatKind = 'hook' | 'stakes' | 'turn' | 'payoff' | 'landing';

/** Story beats: those present are quoted exactly; a missing one may carry a suggestion in the speaker's words. */
export interface StoryBeats {
  present: { kind: BeatKind; quote: string; startMs: number }[];
  missing: { kind: BeatKind; suggestion: string | null }[];
}

export interface FieldNotes {
  verdict: string;
  /** The single most important change, as an instruction for the next take. Absent in older notes. */
  oneFix?: {
    instruction: string;
    why: string;
    /** What the fix should move on the next take. Absent in notes written before fix adoption. */
    targetMetric?: FixTargetMetric;
    /** Set by the server from targetMetric; null when not measurable. */
    direction?: FixDirection | null;
  };
  /** When the main point was first stated (ms), or null. */
  mainPointMs?: number | null;
  /** On a retake: whether the previous fix was achieved, with quoted evidence. */
  previousFix?: { achieved: boolean; evidence: string; startMs: number | null } | null;
  summary: string;
  scores: { structure: number; delivery: number; clarity: number };
  storyMap: { sections: StorySection[] };
  notes: FieldNote[];
  audienceFollowUp: { question: string; reason: string };
  drills: Drill[];
  /** Absent in notes written before the story coach. */
  storyBeats?: StoryBeats;
  /** Whether the answer lands; if not, up to two closing lines of 12 words or fewer, from the speaker's words. */
  landing?: { hasClearClose: boolean; suggestions: string[] };
  droppedBeats?: number;
  droppedLandingLines?: number;
  /** "Say it more naturally": up to three lines, each quoted from the transcript. Absent in older notes. */
  naturalPhrasing?: NaturalPhrasing[];
  provider?: string;
  model?: string;
  /** Notes dropped because their quote wasn't in the transcript. */
  droppedNotes?: number;
}
