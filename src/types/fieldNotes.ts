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
  status: 'hit' | 'missed' | null;
}

export interface Drill {
  title: string;
  instructions: string;
  minutes: number;
}

export interface FieldNotes {
  verdict: string;
  summary: string;
  scores: { structure: number; delivery: number; clarity: number };
  storyMap: { sections: StorySection[] };
  notes: FieldNote[];
  audienceFollowUp: { question: string; reason: string };
  drills: Drill[];
  provider?: string;
  model?: string;
  /** Notes dropped because their quote wasn't in the transcript. */
  droppedNotes?: number;
}
