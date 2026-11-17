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

const SKILLS = ['fillers_per_min', 'time_in_zone_pct', 'time_to_main_point_s', 'sentence_end_pauses_pct', 'eye_contact_pct'];

/** Only known, measurable skill ids, without repeats. */
export function sanitizeMastered(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter((s) => SKILLS.includes(s)))] : [];
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** The speaker's best earlier take on this question or situation, as plain numbers; null when none. */
export function sanitizeBaseline(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of ['fillersPerMin', 'timeInZonePct', 'pausesPerMin', 'avgWpm']) {
    const v = num(raw[k]);
    if (v !== null) out[k] = v;
  }
  if (raw.scope === 'question' || raw.scope === 'situation') out.scope = raw.scope;
  return Object.keys(out).length > 1 ? out : null;
}

/** Keep the speaker's own voice: progress is measured against their best, never a single ideal. */
export const PERSONAL_STYLE_RULE = "Keep the speaker's natural style. Measure progress against their own best take when one is given, not a generic ideal, and never push them toward a single 'correct' voice, accent or personality.";

/** Confidence mode: lead with what went well, keep it supportive and plain, never label feelings. */
export const CONFIDENCE_RULE = 'In confidence mode, order the notes so what went well comes first, write the one fix as a small, encouraging next step, and keep every word supportive and plain. Never mention nerves, anxiety or any feeling.';

/** Added to every system prompt that gives feedback. */
export const CONTEXT_RULE = `Respect the speaker's stated context. Fit feedback to their audience, goal and stakes, and never contradict them: for a serious or critical-stakes talk, never suggest smiling more, adding jokes or lightening the mood; for a formal audience, never suggest casual phrasing. Judge an "inform" talk on clarity, "persuade" on whether it moves the listener to act, "inspire" on story and landing, and "get hired" on evidence of fit for the role.`;
