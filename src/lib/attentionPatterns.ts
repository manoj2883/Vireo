/**
 * Phrases that re-engage a listener, for the attention timeline and lightness cues. Matched against
 * the lower-cased transcript with word boundaries. One file, so the lists are tested in one place.
 */

/** Signposts: the speaker tells the listener where they are. */
export const SIGNPOST_PATTERNS: RegExp[] = [
  /\bhere'?s the (part|thing|key|catch|twist)\b/,
  /\b(first|firstly|second|secondly|third|thirdly|finally|lastly)\b/,
  /\bthe reason (is|was)\b/,
  /\bthe (key|main|big) (point|thing|idea|question)\b/,
  /\bthe point is\b/,
  /\bso what\b/,
  /\bwhat (this|that) means\b/,
  /\b(in short|to sum up|in summary|bottom line)\b/,
  /\blet me (show|tell|explain|walk)\b/,
  /\b(now|next),? (let'?s|i'?ll|we)\b/,
];

/** A concrete example or scene. */
export const EXAMPLE_PATTERNS: RegExp[] = [
  /\bfor (example|instance)\b/,
  /\bsuch as\b/,
  /\bimagine\b/,
  /\bpicture (this|a|the)\b/,
  /\b(say|suppose) you\b/,
  /\bone (day|time|morning|night|evening)\b/,
  /\bthere was (a|this|one)\b/,
  /\bin one case\b/,
];

/** A lighter beat: a funny or human moment that lets the room breathe. */
export const LIGHT_PATTERNS: RegExp[] = [
  /\b(funny|laughed|laugh|laughing|joke|joking|hilarious|embarrassing|awkward)\b/,
  /\b(spoiler|plot twist)\b/,
  /\bturns out\b/,
  /\byou can imagine how\b/,
  /\b(i|we) (still )?(can'?t|couldn'?t) believe\b/,
];

/** Numbers make an idea concrete: digits, or common number words. */
export const NUMBER_PATTERN =
  /\b(\d+([.,]\d+)?%?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|millions|billion|percent|half|dozen)\b/;

/** Capitalised words that aren't names even mid-sentence. */
const NOT_NAMES = new Set(['i', "i'm", "i've", "i'll", "i'd", 'ok', 'okay', 'ai', 'tv']);

/** A named person or place: a capitalised word that doesn't start a sentence. */
export function isNamedWord(word: string, previous: string | undefined): boolean {
  const clean = word.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '');
  if (!clean || !/^\p{Lu}/u.test(clean) || NOT_NAMES.has(clean.toLowerCase())) return false;
  return previous !== undefined && !/[.!?]["'”’)]*$/.test(previous.trim());
}

/** A question to the audience: a sentence that ends in "?". */
export function isQuestion(word: string): boolean {
  return /\?["'”’)]*$/.test(word.trim());
}
