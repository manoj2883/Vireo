/** Fillers Vireo listens for by default. Phrases match as whole words, longest first. */
export const DEFAULT_FILLERS = ['um', 'uh', 'like', 'you know', 'so basically', 'kind of', 'sort of'] as const;

/** Lower-case and strip punctuation so "Um," matches "um". Keeps inner apostrophes. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

export interface FillerMatch {
  /** Index of the first word of the match. */
  start: number;
  /** Number of words in the match. */
  length: number;
  filler: string;
}

/**
 * Find fillers in a list of words. Each word belongs to at most one match; multi-word
 * phrases win over the single words inside them ("so basically" beats nothing, "kind of"
 * beats "kind").
 */
export function findFillers(words: readonly string[], fillers: readonly string[] = DEFAULT_FILLERS): FillerMatch[] {
  const phrases = [...new Set(fillers.map((f) => f.trim().toLowerCase()).filter(Boolean))]
    .map((f) => ({ filler: f, parts: f.split(/\s+/).map(normalizeWord) }))
    .sort((a, b) => b.parts.length - a.parts.length);
  const norm = words.map(normalizeWord);
  const matches: FillerMatch[] = [];
  let i = 0;
  while (i < norm.length) {
    const hit = phrases.find((p) => p.parts.every((part, k) => norm[i + k] === part));
    if (hit) {
      matches.push({ start: i, length: hit.parts.length, filler: hit.filler });
      i += hit.parts.length;
    } else {
      i++;
    }
  }
  return matches;
}

/** Per-word flags: true where the word is part of a filler. */
export function fillerMask(words: readonly string[], fillers?: readonly string[]): boolean[] {
  const mask = new Array<boolean>(words.length).fill(false);
  for (const m of findFillers(words, fillers)) for (let k = 0; k < m.length; k++) mask[m.start + k] = true;
  return mask;
}
