/**
 * The attention timeline and lightness cues: pure, deterministic heuristics over the timed
 * transcript (no model). Attention may drift in any stretch of ATTENTION_GAP_MS with nothing that
 * re-engages a listener; a lighter beat is due after LIGHT_BEAT_DUE_MS of heavy explanation.
 */
import type { WordSegment } from '@/components/sonogram/types';
import { EXAMPLE_PATTERNS, isNamedWord, isQuestion, LIGHT_PATTERNS, NUMBER_PATTERN, SIGNPOST_PATTERNS } from './attentionPatterns';

/** Ninety seconds without a hook of any kind is about where listeners start to drift in a talk. */
export const ATTENTION_GAP_MS = 90_000;
/** A lighter beat is due roughly every 90 to 120 s of heavy explanation; cues sit in the middle. */
export const LIGHT_BEAT_DUE_MS = 105_000;
/** A cue moves to the next sentence end if there's one this close, so it sits at a natural break. */
export const CUE_SNAP_MS = 20_000;

export type EngagementKind = 'signpost' | 'example' | 'light' | 'number' | 'name' | 'question' | 'beat';

export interface Moment {
  atMs: number;
  kind: EngagementKind;
}

/** Word index for each character offset of the joined, lower-cased transcript. */
function indexWords(words: readonly WordSegment[]): { text: string; wordAt: (offset: number) => number } {
  const starts: number[] = [];
  let text = '';
  for (const w of words) {
    if (text) text += ' ';
    starts.push(text.length);
    text += w.text.toLowerCase().replace(/[‘’]/g, "'");
  }
  return {
    text,
    wordAt: (offset) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

function matchAll(text: string, pattern: RegExp): number[] {
  const re = new RegExp(pattern.source, 'g');
  const out: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(m.index);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Every moment that re-engages a listener, in time order. `beatTimes` are story beats from the notes. */
export function engagementMoments(words: readonly WordSegment[], beatTimes: readonly number[] = []): Moment[] {
  if (!words.length) return [];
  const { text, wordAt } = indexWords(words);
  const out: Moment[] = [];
  const add = (patterns: RegExp[], kind: EngagementKind) => {
    for (const p of patterns) for (const at of matchAll(text, p)) out.push({ atMs: words[wordAt(at)].startMs, kind });
  };
  add(SIGNPOST_PATTERNS, 'signpost');
  add(EXAMPLE_PATTERNS, 'example');
  add(LIGHT_PATTERNS, 'light');
  add([NUMBER_PATTERN], 'number');
  words.forEach((w, i) => {
    if (isNamedWord(w.text, words[i - 1]?.text)) out.push({ atMs: w.startMs, kind: 'name' });
    if (isQuestion(w.text)) out.push({ atMs: w.startMs, kind: 'question' });
  });
  for (const t of beatTimes) out.push({ atMs: t, kind: 'beat' });
  return out.sort((a, b) => a.atMs - b.atMs);
}

export interface DriftBand {
  startMs: number;
  endMs: number;
}

/**
 * Stretches of at least ATTENTION_GAP_MS with no engagement moment, from the first word to the last.
 * A shorter session shows nothing rather than a forced result.
 */
export function attentionDrift(words: readonly WordSegment[], beatTimes: readonly number[] = []): DriftBand[] {
  if (!words.length) return [];
  const start = words[0].startMs;
  const end = words[words.length - 1].endMs;
  if (end - start < ATTENTION_GAP_MS) return [];
  const times = [start, ...engagementMoments(words, beatTimes).map((m) => m.atMs), end];
  const out: DriftBand[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] >= ATTENTION_GAP_MS) out.push({ startMs: times[i - 1], endMs: times[i] });
  }
  return out;
}

export type LightTechnique = 'callback' | 'rule-of-three' | 'understatement';

export const LIGHT_TECHNIQUES: Record<LightTechnique, { name: string; example: string }> = {
  callback: { name: 'A callback', example: 'Bring back a phrase or image from your opening, so the room recognises it.' },
  'rule-of-three': { name: 'The rule of three', example: 'List two things the listener expects, then a third that surprises them.' },
  understatement: { name: 'Understatement', example: 'Describe something big in deliberately small words: “It was a slightly long week.”' },
};

const ORDER: LightTechnique[] = ['callback', 'rule-of-three', 'understatement'];

export interface LightCue {
  atMs: number;
  technique: LightTechnique;
}

/** The first sentence end at or after `ms`, if one is within CUE_SNAP_MS. */
function snapToSentenceEnd(words: readonly WordSegment[], ms: number): number {
  const w = words.find((x) => x.endMs >= ms && /[.!?]["'”’)]*$/.test(x.text.trim()));
  return w && w.endMs - ms <= CUE_SNAP_MS ? w.endMs : ms;
}

/**
 * Where a lighter beat was structurally due: every LIGHT_BEAT_DUE_MS of speech without one. Shows the
 * place only, with a technique to try; it never writes a joke.
 */
export function lightnessCues(words: readonly WordSegment[]): LightCue[] {
  if (!words.length) return [];
  const light = engagementMoments(words).filter((m) => m.kind === 'light').map((m) => m.atMs);
  const end = words[words.length - 1].endMs;
  const cues: LightCue[] = [];
  let last = words[0].startMs;
  for (const t of [...light, end]) {
    while (t - last >= LIGHT_BEAT_DUE_MS) {
      const at = snapToSentenceEnd(words, last + LIGHT_BEAT_DUE_MS);
      cues.push({ atMs: at, technique: ORDER[cues.length % ORDER.length] });
      last = Math.max(last + LIGHT_BEAT_DUE_MS, at);
    }
    last = Math.max(last, t);
  }
  return cues.filter((c) => c.atMs < end);
}
