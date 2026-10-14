/**
 * "Your answer, tightened": a rewrite of what the speaker actually said, short enough to read
 * aloud. It may cut and reorder, but every content word (names, numbers, claims) must come from
 * the transcript; only small linking words may be added.
 */
import { z } from 'zod/v4';
import { extractJson } from './json.js';

export const TightenSchema = z.object({
  /** The script, with " / " where to pause. */
  script: z.string().min(1),
  /** The sentence from the script that states the main point. */
  mainPoint: z.string().min(1),
});

export const TIGHTEN_SYSTEM = `You tighten a speaker's spoken answer into a short script they can read aloud on their next take.

Keep their words and their facts. Cut fillers (um, uh, like, you know, so basically), repetition and false starts. Move the main point to the front. Do not add facts, numbers, names, examples or claims that are not in the transcript; you may add only small linking words such as and, but, so, the, a, to, of, that, is.

Mark pauses with " / " where the speaker should breathe, especially just before and just after the main point. Keep it to what was said, usually shorter.

If a one fix is given, shape the script to make that fix easy (for example, a pause right before the result).

Return only JSON: {"script": "...", "mainPoint": "..."} where mainPoint is the sentence in the script that states the main point.`;

/** Linking and function words the rewrite may add without changing what was said. */
const LINKING = new Set(
  (
    'a an the and but or so then because to of in on at for with as by from that this these those it its is are was were be been being ' +
    'i me my we our you your he she they them their his her here there what which who when where how not no yes do does did ' +
    'have has had will would can could should just also first next finally key point main result one'
  ).split(/\s+/)
);

function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\//g, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** A light stem so "refused"/"refuse"/"refusing" or "answers"/"answer" count as the same word. */
export function stem(word) {
  if (/^\d/.test(word)) return word;
  return word.replace(/'s$/, '').replace(/(ing|ed|es|s)$/, '').replace(/e$/, '') || word;
}

/**
 * Content words in the script that are not in the transcript. Empty means the rewrite only
 * uses the speaker's own words (plus linking words).
 */
export function unsupportedWords(script, transcriptText) {
  const said = new Set(tokens(transcriptText).map(stem));
  const out = [];
  for (const w of tokens(script)) {
    if (LINKING.has(w)) continue;
    if (!said.has(stem(w)) && !out.includes(w)) out.push(w);
  }
  return out;
}

export function buildTightenPrompt(transcript, { prompt, oneFix } = {}) {
  const text = transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => t.text)
    .join('\n');
  return [prompt ? `What they were answering: ${prompt}` : '', oneFix ? `One fix for the next take: ${oneFix}` : '', `What they said:\n${text}`]
    .filter(Boolean)
    .join('\n\n');
}

/** Parse, check the shape, then the evidence: a rewrite that adds content words is rejected. */
export function validateTightened(text, transcriptText) {
  let json;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { problem: `it was not valid JSON (${err.message}).` };
  }
  const parsed = TightenSchema.safeParse(json);
  if (!parsed.success) return { problem: `it did not match the schema (${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}).` };
  const extra = unsupportedWords(parsed.data.script, transcriptText);
  if (extra.length) {
    return { problem: `the script uses words the speaker never said: ${extra.slice(0, 12).join(', ')}. Use only their words, plus small linking words.` };
  }
  return { data: parsed.data };
}
