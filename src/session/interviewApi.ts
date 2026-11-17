/** Story Bank interviewer: one turn at a time against POST /api/story-interview. */
export type InterviewSlot = 'hook' | 'stakes' | 'turn' | 'payoff' | 'image' | 'lesson' | 'landing';

export interface InterviewTurn {
  role: 'coach' | 'speaker';
  text: string;
}

export interface InterviewReply {
  filled: Record<InterviewSlot, string | null>;
  done: boolean;
  question: string | null;
  story: { title: string; script: string; keyPoints: string[] } | null;
  droppedQuotes?: number;
}

export const SLOT_LABELS: Record<InterviewSlot, string> = {
  hook: 'Hook',
  stakes: 'Stakes',
  turn: 'Turn',
  payoff: 'Payoff',
  image: 'One concrete image',
  lesson: 'The lesson',
  landing: 'Landing line',
};

export const SLOTS = Object.keys(SLOT_LABELS) as InterviewSlot[];

/** Asked locally, so the first question costs nothing. */
export const FIRST_QUESTION = 'Think of the moment this story is about. When was it, and where were you?';

export async function requestInterviewTurn(input: { title?: string; turns: InterviewTurn[] }, fetchImpl: typeof fetch = fetch): Promise<InterviewReply> {
  const res = await fetchImpl('/api/story-interview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The interviewer couldn’t reply (${res.status}).`);
  return body as InterviewReply;
}
