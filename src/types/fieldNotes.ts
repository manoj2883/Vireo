/** Field notes as returned by POST /api/field-notes (mirrors server/llm/schema.js). */
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

export interface NaturalPhrasing {
  /** Verbatim from the transcript. */
  original: string;
  /** How a native American English speaker would say it. */
  natural: string;
  why: string;
}

export interface FieldNotes {
  verdict: string;
  /** The single most important change, as an instruction for the next take. Absent in older notes. */
  oneFix?: { instruction: string; why: string };
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
  /** "Say it more naturally": up to three lines, each quoted from the transcript. Absent in older notes. */
  naturalPhrasing?: NaturalPhrasing[];
  provider?: string;
  model?: string;
  /** Notes dropped because their quote wasn't in the transcript. */
  droppedNotes?: number;
}
