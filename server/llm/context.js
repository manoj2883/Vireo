/**
 * The speaker's stated context (audience, goal, stakes), re-checked on the server and turned
 * into prompt lines. Mirrors src/session/speakingContext.ts.
 */

const GOALS = { inform: 'inform', persuade: 'persuade', inspire: 'inspire', get_hired: 'get hired' };
const STAKES = { practice: 'practice (low stakes)', important: 'important', critical: 'critical (a big moment)' };
const MAX_AUDIENCE_CHARS = 120;

/** Only valid, trimmed fields; null when nothing usable was sent. */
export function sanitizeSpeakingContext(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const audience = typeof raw.audience === 'string' ? raw.audience.replace(/\s+/g, ' ').trim().slice(0, MAX_AUDIENCE_CHARS) : '';
  if (audience) out.audience = audience;
  if (Object.hasOwn(GOALS, raw.goal)) out.goal = raw.goal;
  if (Object.hasOwn(STAKES, raw.stakes)) out.stakes = raw.stakes;
  return Object.keys(out).length ? out : null;
}

/** One prompt line, or null when no context was given. */
export function describeSpeakingContext(raw) {
  const c = sanitizeSpeakingContext(raw);
  if (!c) return null;
  const parts = [];
  if (c.audience) parts.push(`audience: ${c.audience}`);
  if (c.goal) parts.push(`goal: to ${GOALS[c.goal]}`);
  if (c.stakes) parts.push(`stakes: ${STAKES[c.stakes]}`);
  return `The speaker's stated context (${parts.join('; ')}). Every note, the one fix and the drills must fit it and never contradict it.`;
}

/** Added to every system prompt that gives feedback. */
export const CONTEXT_RULE = `Respect the speaker's stated context. Fit feedback to their audience, goal and stakes, and never contradict them: for a serious or critical-stakes talk, never suggest smiling more, adding jokes or lightening the mood; for a formal audience, never suggest casual phrasing. Judge an "inform" talk on clarity, "persuade" on whether it moves the listener to act, "inspire" on story and landing, and "get hired" on evidence of fit for the role.`;
