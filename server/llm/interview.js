/**
 * Story Bank interviewer: one question at a time, pushing for the scene rather than the summary,
 * until seven story slots are filled from the speaker's own answers. Then a 30-second version in
 * their voice. Every slot must quote the speaker exactly, and the script may use only their words.
 */
import { z } from 'zod/v4';
import { extractJson } from './json.js';
import { verifyNotes } from './evidence.js';
import { unsupportedWords } from './tighten.js';

export const INTERVIEW_SLOTS = ['hook', 'stakes', 'turn', 'payoff', 'image', 'lesson', 'landing'];
/** About 30 seconds at a comfortable 150 wpm, with a little room. */
export const MAX_SCRIPT_WORDS = 90;
/** Longest interview kept: enough for a full story, short enough to bound the prompt. */
export const MAX_TURNS = 30;
export const MAX_TURN_CHARS = 1500;

const slot = z.string().nullable();

export const InterviewSchema = z.object({
  /** Each slot: words copied exactly from the speaker's answers, or null if not yet given. */
  filled: z.object({ hook: slot, stakes: slot, turn: slot, payoff: slot, image: slot, lesson: slot, landing: slot }),
  done: z.boolean(),
  /** The next single question, when not done. */
  question: z.string().nullable(),
  /** When done: the 30-second version. */
  story: z
    .object({
      title: z.string().min(1),
      script: z.string().min(1),
      keyPoints: z.array(z.string().min(1)).min(2).max(5),
    })
    .nullable(),
});

export const INTERVIEW_SYSTEM = `You are Vireo's story interviewer. You help a speaker turn something that happened to them into a short story they can tell out loud.

Ask one question at a time, never two. Keep each question under 25 words, warm and plain. Push for the scene, not the summary: when and where it happened, the exact words someone said, what was at risk, what they saw. If an answer is vague ("it was a big project"), ask for one concrete detail.

Track seven slots: hook (an opening moment that makes a listener lean in), stakes (what was at risk), turn (the moment things changed), payoff (how it ended), image (one concrete thing a listener could picture), lesson (what they learned, in one sentence), landing (a closing line). Fill a slot only with words copied character for character from the speaker's answers; otherwise leave it null. Never invent a fact, name or number.

While any slot is empty: done is false, story is null, and question asks for the most important empty slot.
When all seven are filled: done is true, question is null, and story holds a title, a script of about 30 seconds (${MAX_SCRIPT_WORDS} words at most) in the speaker's own voice using only their words plus small linking words (and, but, so, the, a, to, then), and 2 to 5 keyPoints in story order.

Never label the speaker's emotions. Return only JSON matching the schema.`;

/** @param {{ title?: string, turns: { role: 'coach' | 'speaker', text: string }[] }} input */
export function buildInterviewPrompt({ title, turns }) {
  const log = turns.map((t) => `${t.role === 'coach' ? 'Vireo' : 'Speaker'}: ${t.text}`).join('\n');
  return `${title ? `Working title: ${title}\n\n` : ''}Interview so far:\n${log}`;
}

/** Keep only well-formed turns, trimmed and bounded. */
export function sanitizeTurns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role === 'coach' ? 'coach' : 'speaker', text: t.text.trim().slice(0, MAX_TURN_CHARS) }));
}

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * Parse, check the shape, then the evidence. Slots that don't quote the speaker are emptied (and
 * counted). A reply that claims done with empty slots, asks nothing, or writes a script with words
 * the speaker never said is unusable and gets one repair round.
 */
export function validateInterview(text, turns) {
  let json;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { problem: `it was not valid JSON (${err.message}).` };
  }
  const parsed = InterviewSchema.safeParse(json);
  if (!parsed.success) return { problem: `it did not match the schema (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}).` };
  const data = parsed.data;
  const lines = turns.filter((t) => t.role === 'speaker').map((t, i) => ({ speaker: 'user', text: t.text, startMs: i }));
  const said = lines.map((l) => l.text).join(' ');
  const filled = {};
  let dropped = 0;
  for (const k of INTERVIEW_SLOTS) {
    const q = data.filled[k];
    if (q && verifyNotes([{ quote: q, startMs: 0 }], lines).notes.length) filled[k] = q;
    else {
      if (q) dropped++;
      filled[k] = null;
    }
  }
  const missing = INTERVIEW_SLOTS.filter((k) => !filled[k]);
  if (missing.length) {
    if (!data.question) return { problem: `slots ${missing.join(', ')} are still empty (or didn't quote the speaker exactly), so ask one question about ${missing[0]}.` };
    return { data: { filled, done: false, question: data.question, story: null, droppedQuotes: dropped } };
  }
  if (!data.story) return { problem: 'every slot is filled, so set done to true and write the story.' };
  const extra = unsupportedWords(data.story.script, said);
  if (extra.length) return { problem: `the script uses words the speaker never said: ${extra.slice(0, 12).join(', ')}. Use only their words, plus small linking words.` };
  if (words(data.story.script) > MAX_SCRIPT_WORDS) return { problem: `the script is ${words(data.story.script)} words; keep it to ${MAX_SCRIPT_WORDS} or fewer.` };
  return { data: { filled, done: true, question: null, story: data.story, droppedQuotes: dropped } };
}
