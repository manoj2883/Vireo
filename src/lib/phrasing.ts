/**
 * "Say it more naturally" trends: a small, tested classifier for the kind of change (it wins when
 * it's sure), the model's category label otherwise, then the patterns that repeat across sessions.
 * Pure; reads only sessions stored on this device.
 */
import type { StoredSession } from '@/storage/localDb';
import type { NaturalPhrasing, PhrasingCategory } from '@/types/fieldNotes';

export const ARTICLES = new Set(['a', 'an', 'the']);
export const PREPOSITIONS = new Set(['in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'onto', 'since', 'during', 'over', 'under', 'between', 'through']);
const AUXILIARIES = new Set(['was', 'were', 'is', 'are', 'am', 'be', 'been', 'have', 'has', 'had', 'will', 'would', 'did', 'do', 'does']);
/** Common irregular past forms, so "go" → "went" reads as tense. */
const IRREGULAR_PAST: Record<string, string> = { go: 'went', come: 'came', see: 'saw', take: 'took', make: 'made', get: 'got', give: 'gave', say: 'said', tell: 'told', find: 'found', think: 'thought', buy: 'bought', bring: 'brought', leave: 'left', meet: 'met', run: 'ran', write: 'wrote', speak: 'spoke', begin: 'began', know: 'knew' };

/** A pattern needs to show up at least this often across sessions to count as recurring. */
export const MIN_RECURRENCES = 2;
export const TOP_PATTERNS = 3;

export const CATEGORY_LABELS: Record<PhrasingCategory, string> = {
  tense: 'Verb tense',
  article: 'Articles (a, an, the)',
  preposition: 'Prepositions (in, on, at…)',
  word_order: 'Word order',
  plural: 'Singular and plural',
  agreement: 'Subject and verb agreement',
  word_choice: 'Word choice',
  idiom: 'Idioms and set phrases',
  other: 'Other',
};

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);

/** Words removed and added, as multisets. */
function changes(original: string, natural: string): { removed: string[]; added: string[]; a: string[]; b: string[] } {
  const a = tokens(original);
  const b = tokens(natural);
  const left = [...b];
  const removed: string[] = [];
  for (const w of a) {
    const i = left.indexOf(w);
    if (i === -1) removed.push(w);
    else left.splice(i, 1);
  }
  return { removed, added: left, a, b };
}

const stemOf = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

function isVerbFormPair(r: string, x: string): boolean {
  if (IRREGULAR_PAST[r] === x || IRREGULAR_PAST[x] === r) return true;
  return stemOf(r) === stemOf(x) && (/(ed|ing)$/.test(r) || /(ed|ing)$/.test(x));
}

/** The kind of change when it's clear from the words alone; null when the classifier isn't sure. */
export function classifyPhrasing(original: string, natural: string): PhrasingCategory | null {
  const { removed, added, a, b } = changes(original, natural);
  const changed = [...removed, ...added];
  if (!changed.length) return a.join(' ') !== b.join(' ') ? 'word_order' : null;
  if (changed.every((w) => ARTICLES.has(w))) return 'article';
  if (changed.every((w) => PREPOSITIONS.has(w))) return 'preposition';
  if (removed.length === 1 && added.length === 1) {
    const [r] = removed;
    const [x] = added;
    if (isVerbFormPair(r, x)) return 'tense';
    if (r + 's' === x || x + 's' === r || r + 'es' === x || x + 'es' === r) return 'plural';
  }
  if (changed.length && changed.every((w) => AUXILIARIES.has(w))) return 'tense';
  return null;
}

/** The classifier when it's sure, else the model's label, else other. */
export function categoryOf(item: NaturalPhrasing): PhrasingCategory {
  return classifyPhrasing(item.original, item.natural) ?? item.category ?? 'other';
}

export interface PhrasingPattern {
  category: PhrasingCategory;
  label: string;
  count: number;
  sessions: number;
  /** Newest first, from the speaker's own sessions. */
  examples: (NaturalPhrasing & { sessionId: string; createdAt: string })[];
}

/** Patterns seen at least MIN_RECURRENCES times, most frequent first, top TOP_PATTERNS. */
export function phrasingTrends(all: readonly StoredSession[]): PhrasingPattern[] {
  const groups = new Map<PhrasingCategory, PhrasingPattern & { seen: Set<string> }>();
  const newestFirst = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const s of newestFirst) {
    for (const item of s.notes?.naturalPhrasing ?? []) {
      const category = categoryOf(item);
      if (category === 'other') continue;
      const g = groups.get(category) ?? { category, label: CATEGORY_LABELS[category], count: 0, sessions: 0, examples: [], seen: new Set<string>() };
      g.count++;
      g.seen.add(s.id);
      g.sessions = g.seen.size;
      if (g.examples.length < 2) g.examples.push({ ...item, sessionId: s.id, createdAt: s.createdAt });
      groups.set(category, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= MIN_RECURRENCES)
    .sort((a, b) => b.count - a.count || b.sessions - a.sessions)
    .slice(0, TOP_PATTERNS)
    .map((g) => ({ category: g.category, label: g.label, count: g.count, sessions: g.sessions, examples: g.examples }));
}
