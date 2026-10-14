/**
 * Paragraphs for captions and the stored transcript, and "likely fillers" heard but not
 * transcribed. Pure functions so live captions and field notes break in exactly the same places.
 */
import type { PauseSpan } from '@/components/sonogram/types';
import type { VoicedInterval } from './vad';

/** A new paragraph starts after a pause at least this long (or a Deepgram UtteranceEnd). */
export const PARAGRAPH_PAUSE_MS = 1200;
/** Live captions keep about this many words on screen. */
export const CAPTION_WORDS = 60;

interface Timed {
  startMs: number;
  endMs: number;
}

export interface ParagraphOptions {
  /** Pauses the voice detector heard. Only those of PARAGRAPH_PAUSE_MS or longer break. */
  pauses?: readonly PauseSpan[];
  /** Times of Deepgram UtteranceEnd events (end of the utterance's last word). */
  utteranceEnds?: readonly number[];
  pauseMs?: number;
}

function breaksBetween(a: Timed, b: Timed, opts: ParagraphOptions): boolean {
  const pauseMs = opts.pauseMs ?? PARAGRAPH_PAUSE_MS;
  if (b.startMs - a.endMs >= pauseMs) return true;
  const longPause = (opts.pauses ?? []).some(
    (p) => p.endMs !== undefined && p.endMs - p.startMs >= pauseMs && p.startMs >= a.startMs && p.startMs <= b.startMs
  );
  if (longPause) return true;
  return (opts.utteranceEnds ?? []).some((u) => u >= a.endMs - 50 && u <= b.startMs);
}

/** Split words into paragraphs at long pauses and utterance ends. */
export function splitParagraphs<T extends Timed>(words: readonly T[], opts: ParagraphOptions = {}): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  words.forEach((w, i) => {
    if (i > 0 && breaksBetween(words[i - 1], w, opts)) {
      out.push(current);
      current = [];
    }
    current.push(w);
  });
  if (current.length) out.push(current);
  return out;
}

export interface CaptionWord extends Timed {
  text: string;
  kind: 'speech' | 'filler' | 'rushed';
  /** Still being transcribed: drawn lighter, replaced when final. */
  interim: boolean;
}

export interface CaptionView {
  /** The paragraph before this one, shown faded above. */
  previous: CaptionWord[] | null;
  /** The paragraph growing now, interim words at the end. */
  current: CaptionWord[];
}

/** The two paragraphs to show live, keeping about `maxWords` words in total. */
export function captionView(words: readonly CaptionWord[], opts: ParagraphOptions = {}, maxWords = CAPTION_WORDS): CaptionView {
  const paras = splitParagraphs(words, opts);
  if (!paras.length) return { previous: null, current: [] };
  const current = paras[paras.length - 1].slice(-maxWords);
  const room = maxWords - current.length;
  const prev = paras.length > 1 && room > 0 ? paras[paras.length - 2].slice(-room) : null;
  return { previous: prev && prev.length ? prev : null, current };
}

export interface LikelyFillerOptions {
  nowMs: number;
  /** Wait this long for the transcript to catch up before calling a burst untranscribed. */
  settleMs?: number;
  minMs?: number;
  maxMs?: number;
  /** Slack around words when checking overlap. */
  toleranceMs?: number;
}

/**
 * Short voiced bursts the on-device detector heard that no transcribed word covers: likely an
 * "um" or "uh" the transcriber dropped. Shown lightly and not counted until they have been
 * checked against labelled recordings.
 */
export function likelyFillerBursts(voiced: readonly VoicedInterval[], words: readonly Timed[], opts: LikelyFillerOptions): Timed[] {
  const { nowMs, settleMs = 1500, minMs = 120, maxMs = 700, toleranceMs = 80 } = opts;
  return voiced
    .filter((v) => v.endMs <= nowMs - settleMs)
    .filter((v) => v.endMs - v.startMs >= minMs && v.endMs - v.startMs <= maxMs)
    .filter((v) => !words.some((w) => w.startMs < v.endMs + toleranceMs && w.endMs > v.startMs - toleranceMs))
    .map((v) => ({ startMs: v.startMs, endMs: v.endMs }));
}
