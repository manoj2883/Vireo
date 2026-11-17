/**
 * Who the talk is for, what it should do, and how much rides on it: an optional warm-up step,
 * stored with the session and sent with every field notes, tightening and roleplay request.
 * Mirrors server/llm/context.js, which re-checks it.
 */
export type SpeakingGoal = 'inform' | 'persuade' | 'inspire' | 'get_hired';
export type Stakes = 'practice' | 'important' | 'critical';

export interface SpeakingContext {
  /** Free text, e.g. "a hiring manager at a hospital". */
  audience?: string;
  goal?: SpeakingGoal;
  stakes?: Stakes;
}

/** Longest audience description kept, so a pasted essay can't swamp the prompt. */
export const MAX_AUDIENCE_CHARS = 120;

export const AUDIENCE_SUGGESTIONS = ['A hiring manager', 'My class', 'Investors', 'My team', 'Wedding guests', 'A conference audience', 'A customer'];

export const GOALS: { id: SpeakingGoal; label: string }[] = [
  { id: 'inform', label: 'Inform' },
  { id: 'persuade', label: 'Persuade' },
  { id: 'inspire', label: 'Inspire' },
  { id: 'get_hired', label: 'Get hired' },
];

export const STAKES: { id: Stakes; label: string; hint: string }[] = [
  { id: 'practice', label: 'Just practice', hint: 'Low stakes, room to experiment.' },
  { id: 'important', label: 'Important', hint: 'It matters how this goes.' },
  { id: 'critical', label: 'Critical', hint: 'A big moment. Feedback stays focused and serious.' },
];

/** Keep only valid, trimmed fields; undefined when nothing was set. */
export function cleanContext(raw: SpeakingContext | null | undefined): SpeakingContext | undefined {
  if (!raw) return undefined;
  const out: SpeakingContext = {};
  const audience = typeof raw.audience === 'string' ? raw.audience.trim().slice(0, MAX_AUDIENCE_CHARS) : '';
  if (audience) out.audience = audience;
  if (GOALS.some((g) => g.id === raw.goal)) out.goal = raw.goal;
  if (STAKES.some((s) => s.id === raw.stakes)) out.stakes = raw.stakes;
  return Object.keys(out).length ? out : undefined;
}
