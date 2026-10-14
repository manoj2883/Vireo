/**
 * Keyterms for Deepgram Nova-3: the distinctive words and phrases a speaker is likely to say,
 * taken from their prompt and Story Bank story. Deepgram advises proper nouns and domain terms,
 * not common words, and a focused list (https://developers.deepgram.com/docs/keyterm).
 */

const COMMON = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
    'tell talk about why matters matter really thing things something someone way ways time times make made get got want wanted need needed know knew think thought say said give gave take took like just much many well good great new first last next one two three year years day days people work worked working answer question story point points part show shows let lets'
  ).split(/\s+/)
);

const MAX_PHRASE_WORDS = 4;

function words(text: string): string[] {
  return text
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}'+#.-]+/u)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter(Boolean);
}

function isDistinctive(word: string): boolean {
  const lower = word.toLowerCase();
  if (COMMON.has(lower)) return false;
  if (/^[A-Z0-9][A-Z0-9+#.-]{1,}$/.test(word)) return true; // acronyms: AI, LLM, GPT-4
  if (/\d/.test(word)) return true;
  return lower.length >= 4;
}

/** A short phrase is kept whole when it has at least one distinctive word. */
function phrase(text: string): string | null {
  const w = words(text);
  if (w.length < 2 || w.length > MAX_PHRASE_WORDS) return null;
  return w.some(isDistinctive) ? w.join(' ') : null;
}

export interface KeytermSource {
  prompt?: string;
  storyTitle?: string;
  keyPoints?: readonly string[];
}

/**
 * Up to `max` keyterms: short key-point and title phrases first, then distinctive single
 * words (acronyms and capitalised names before the rest), without repeats.
 */
export function buildKeyterms({ prompt = '', storyTitle = '', keyPoints = [] }: KeytermSource, max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (term: string | null) => {
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(term);
  };

  for (const p of keyPoints) add(phrase(p));
  add(phrase(storyTitle));

  const singles = [...keyPoints, storyTitle, prompt].flatMap(words).filter(isDistinctive);
  const rank = (w: string) => (/^[A-Z0-9]{2,}/.test(w) ? 0 : /^[A-Z]/.test(w) ? 1 : 2);
  const ordered = singles.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i);
  for (const { w } of ordered) {
    // Skip words already covered by a phrase.
    if (out.some((t) => t.includes(' ') && t.toLowerCase().split(' ').includes(w.toLowerCase()))) continue;
    add(w);
  }
  return out;
}
