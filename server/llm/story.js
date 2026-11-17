/**
 * Evidence checks for the story coach: story beats must quote the speaker exactly, a missing
 * beat's suggestion must stay in the speaker's own vocabulary, and a suggested landing line must
 * be short and built only from the speaker's own words.
 */
import { verifyNotes } from './evidence.js';
import { stem, unsupportedWords } from './tighten.js';

export const BEAT_KINDS = ['hook', 'stakes', 'turn', 'payoff', 'landing'];
/** A landing line is something you can say in one breath. */
export const MAX_LANDING_WORDS = 12;
/** A suggestion may use a few words of its own to give the instruction ("open with", "say what"). */
export const MAX_NEW_SUGGESTION_WORDS = 3;

/** Words a suggestion needs to be an instruction at all; they don't count as new vocabulary. */
const INSTRUCTION_WORDS = new Set(
  (
    'add open opening start end close closing say said tell name show try put give lead follow before after line sentence moment ' +
    'story listener listeners audience why what mattered matter matters risk changed change result happened ending first last ' +
    'beat hook stakes turn payoff landing word words own back with like e g eg example quote point'
  ).split(/\s+/)
);

const wordCount = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** Content words in a suggestion that aren't the speaker's and aren't instruction words. */
export function newVocabulary(text, said) {
  return unsupportedWords(text, said).filter((w) => !INSTRUCTION_WORDS.has(w) && !INSTRUCTION_WORDS.has(stem(w)));
}

/**
 * Keep beats whose quote is in the transcript (one per kind, in story order), and suggestions for
 * missing beats only when they stay in the speaker's vocabulary.
 * @returns {{ storyBeats: { present: object[], missing: { kind: string, suggestion: string | null }[] }, dropped: number }}
 */
export function verifyStoryBeats(storyBeats, lines) {
  const said = lines.filter((l) => l.speaker !== 'coach').map((l) => l.text).join(' ');
  const raw = Array.isArray(storyBeats?.present) ? storyBeats.present : [];
  const { notes: kept, dropped } = verifyNotes(raw.filter((b) => BEAT_KINDS.includes(b?.kind)), lines);
  const present = [];
  for (const kind of BEAT_KINDS) {
    const beat = kept.find((b) => b.kind === kind);
    if (beat) present.push({ kind, quote: beat.quote, startMs: beat.startMs });
  }
  const missing = [];
  for (const kind of BEAT_KINDS) {
    if (present.some((b) => b.kind === kind)) continue;
    const m = (Array.isArray(storyBeats?.missing) ? storyBeats.missing : []).find((x) => x?.kind === kind);
    const suggestion = m && typeof m.suggestion === 'string' && newVocabulary(m.suggestion, said).length <= MAX_NEW_SUGGESTION_WORDS ? m.suggestion : null;
    missing.push({ kind, suggestion });
  }
  return { storyBeats: { present, missing }, dropped: dropped.length + Math.max(0, kept.length - present.length) };
}

/** True when a suggested landing line is short enough and uses only the speaker's words. */
export function isValidLandingLine(line, said) {
  return typeof line === 'string' && wordCount(line) > 0 && wordCount(line) <= MAX_LANDING_WORDS && unsupportedWords(line, said).length === 0;
}

/** Up to two valid landing lines, and none when the answer already has a clear close. */
export function verifyLanding(landing, lines) {
  const said = lines.filter((l) => l.speaker !== 'coach').map((l) => l.text).join(' ');
  const hasClearClose = Boolean(landing?.hasClearClose);
  const offered = hasClearClose || !Array.isArray(landing?.suggestions) ? [] : landing.suggestions;
  const suggestions = offered.filter((s) => isValidLandingLine(s, said)).slice(0, 2);
  return { landing: { hasClearClose, suggestions }, dropped: offered.length - suggestions.length };
}
