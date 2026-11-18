/**
 * Roleplay partner and the hostile Q&A drill: one question per turn from an interviewer, investor,
 * customer or tough audience member. Each follow-up must build on words the speaker actually said
 * (`basedOn`, checked against their last answer, or against their talk for Q&A), so the partner
 * can't invent a claim and then question it.
 */
import { z } from 'zod/v4';
import { extractJson } from './json.js';
import { verifyNotes } from './evidence.js';
import { CONTEXT_RULE, describeSpeakingContext } from './context.js';

export const ROLES = {
  interviewer: 'a hiring manager interviewing them for a role',
  investor: 'an investor hearing their pitch',
  customer: 'a potential customer weighing whether to buy',
  tough_audience: 'a sharp, sceptical member of the audience',
};
export const MIN_TURNS = 3;
export const MAX_TURNS = 6;
/** Q&A after a talk: three questions, as the spec asks. */
export const QA_TURNS = 3;
/** A spoken question longer than this is hard to hold in your head. */
export const MAX_QUESTION_WORDS = 40;
const MAX_ANSWER_CHARS = 4000;
const MAX_SOURCE_CHARS = 20_000;

export const RoleplayTurnSchema = z.object({
  /** The next question, spoken aloud by the partner. */
  question: z.string().min(1),
  /** Exact words from the speaker that the question follows up; null only for an opening question. */
  basedOn: z.string().nullable(),
});

export const ROLEPLAY_SYSTEM = `You play a conversation partner so a speaker can rehearse a real conversation out loud. You ask exactly one question per turn, never two.

Be tough but fair: probe vague claims, ask for evidence, numbers or a concrete example, and follow up on what they actually said. Never insult the speaker, never mock their ability or their accent, and never label their emotions. Keep each question under ${MAX_QUESTION_WORDS} words, plain and natural to say aloud.

Ground every follow-up in the speaker's own words: basedOn must copy, character for character, a short phrase from their most recent answer (or, in a Q&A after a talk, from the talk) that your question follows up. Never question a claim they didn't make. Only the opening question of a roleplay may have basedOn null.

${CONTEXT_RULE}

Return only JSON: {"question": "...", "basedOn": "..." | null}.`;

const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

/** Only well-formed input, bounded. */
export function sanitizeRoleplay(body) {
  const mode = body?.mode === 'qa' ? 'qa' : 'roleplay';
  const role = Object.hasOwn(ROLES, body?.role) ? body.role : mode === 'qa' ? 'tough_audience' : 'interviewer';
  const maxTurns = mode === 'qa' ? QA_TURNS : Math.min(MAX_TURNS, Math.max(MIN_TURNS, Number.parseInt(body?.maxTurns, 10) || 4));
  const turns = (Array.isArray(body?.turns) ? body.turns : [])
    .filter((t) => t && typeof t.question === 'string')
    .slice(0, MAX_TURNS)
    .map((t) => ({ question: clean(t.question, 400), answer: clean(t.answer, MAX_ANSWER_CHARS) }));
  return {
    mode,
    role,
    maxTurns,
    prompt: clean(body?.prompt, 500),
    situation: clean(body?.situation, 120),
    speakingContext: body?.speakingContext,
    source: mode === 'qa' ? clean(body?.source, MAX_SOURCE_CHARS) : '',
    turns,
  };
}

export function buildRoleplayPrompt(r) {
  const parts = [`You are ${ROLES[r.role]}.`];
  if (r.situation) parts.push(`Situation: ${r.situation}.`);
  if (r.prompt) parts.push(`${r.mode === 'qa' ? 'Their talk was about' : 'The conversation is about'}: ${r.prompt}`);
  const stated = describeSpeakingContext(r.speakingContext);
  if (stated) parts.push(stated);
  if (r.mode === 'qa') parts.push(`This is the Q&A after their talk: ${QA_TURNS} tough but fair questions drawn from what they said.\nTheir talk:\n${r.source}`);
  parts.push(`This is question ${r.turns.length + 1} of ${r.maxTurns}.`);
  if (r.turns.length) {
    parts.push(`So far:\n${r.turns.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer || '(no answer heard)'}`).join('\n')}`);
  } else if (r.mode === 'roleplay') {
    parts.push('Open the conversation with your first question.');
  }
  return parts.join('\n\n');
}

/** The text a question's basedOn must come from: the last answer, or the talk for Q&A. */
function groundingFor(r) {
  const last = r.turns[r.turns.length - 1]?.answer ?? '';
  return r.mode === 'qa' ? [r.source, ...r.turns.map((t) => t.answer)].join('\n') : last;
}

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

export function validateRoleplay(text, r) {
  let json;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { problem: `it was not valid JSON (${err.message}).` };
  }
  const parsed = RoleplayTurnSchema.safeParse(json);
  if (!parsed.success) return { problem: `it did not match the schema (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}).` };
  const { question, basedOn } = parsed.data;
  if (words(question) > MAX_QUESTION_WORDS) return { problem: `the question is ${words(question)} words; keep it under ${MAX_QUESTION_WORDS}.` };
  const opening = r.mode === 'roleplay' && r.turns.length === 0;
  if (opening && !basedOn) return { data: { question, basedOn: null } };
  const grounding = groundingFor(r);
  if (!grounding.trim()) return { data: { question, basedOn: null } };
  const ok = basedOn && verifyNotes([{ quote: basedOn, startMs: 0 }], [{ speaker: 'user', text: grounding, startMs: 0 }]).notes.length > 0;
  if (!ok) return { problem: `basedOn must copy exact words the speaker said${r.mode === 'qa' ? ' in their talk or answers' : ' in their last answer'}, and the question must follow up on them.` };
  return { data: { question, basedOn } };
}

/**
 * Per-answer notes after a roleplay: keep an entry only when its quote is the speaker's exact words
 * (an empty quote is dropped too), one per question, in order.
 */
export function verifyAnswers(answers, lines) {
  const raw = Array.isArray(answers) ? answers : [];
  const kept = [];
  for (const a of raw) {
    if (!a || kept.some((k) => k.questionIndex === a.questionIndex)) continue;
    const { notes } = verifyNotes([{ quote: a.quote, startMs: 0 }], lines);
    if (notes.length) kept.push(a);
  }
  return { answers: kept.sort((x, y) => x.questionIndex - y.questionIndex), dropped: raw.length - kept.length };
}
