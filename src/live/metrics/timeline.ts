/**
 * Builds timed word segments from a live transcript.
 *
 * Transcription arrives in chunks some time after the words were spoken. When new words
 * arrive, they are placed into the stretches of speech the voice detector heard since the
 * previous words, in proportion to their length. That keeps the sonogram's gaps where the
 * real pauses were. With no speech heard, they spread evenly over the time since the last word.
 */
import type { WordKind, WordSegment } from '@/components/sonogram/types';
import { fillerMask, DEFAULT_FILLERS } from './fillers';
import type { VoicedInterval } from './vad';

export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  /** Pace when the word arrived, used to mark rushed passages. */
  wpmAtArrival: number | null;
  /** A filler the transcriber showed in an interim result but dropped from the final. */
  rescued?: boolean;
}

/** Filler tokens Deepgram emits with filler_words=true. */
const FILLER_TOKENS = new Set(['um', 'uh', 'umm', 'uhh', 'erm', 'hmm', 'mhmm', 'mm', 'uh-huh']);
const isFillerToken = (text: string) => FILLER_TOKENS.has(text.toLowerCase().replace(/[^a-z-]/g, ''));

export interface TimelineOptions {
  fillers?: readonly string[];
  /** Words spoken faster than this are drawn as rushed. */
  rushedAboveWpm?: number;
  /**
   * How long transcription takes to arrive after the words are spoken. Speech heard in this
   * last stretch belongs to words not transcribed yet, so new words are placed before it.
   */
  latencyMs?: number;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Lay out `count` words with given weights across voiced intervals inside [fromMs, toMs]. */
export function placeWords(
  weights: readonly number[],
  fromMs: number,
  toMs: number,
  voiced: readonly VoicedInterval[]
): { startMs: number; endMs: number }[] {
  const spans = voiced
    .map((v) => ({ startMs: Math.max(v.startMs, fromMs), endMs: Math.min(v.endMs, toMs) }))
    .filter((v) => v.endMs - v.startMs > 0);
  if (spans.length === 0) {
    const end = Math.max(toMs, fromMs + weights.length * 50);
    spans.push({ startMs: fromMs, endMs: end });
  }
  const total = spans.reduce((s, v) => s + (v.endMs - v.startMs), 0);
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;

  // Map a position along the concatenated voiced time back to the clock.
  const at = (offset: number) => {
    let left = offset;
    for (const v of spans) {
      const len = v.endMs - v.startMs;
      if (left <= len) return v.startMs + left;
      left -= len;
    }
    return spans[spans.length - 1].endMs;
  };

  const out: { startMs: number; endMs: number }[] = [];
  let acc = 0;
  for (const w of weights) {
    const a = (acc / weightSum) * total;
    acc += w;
    const b = (acc / weightSum) * total;
    // Never let a word straddle a gap between voiced spans: end it where its span ends.
    const startMs = at(a + 1e-6);
    let endMs = at(b);
    const span = spans.find((v) => startMs >= v.startMs && startMs <= v.endMs);
    if (span && endMs > span.endMs) endMs = span.endMs;
    out.push({ startMs, endMs: Math.max(endMs, startMs + 1) });
  }
  return out;
}

export class TranscriptTimeline {
  private words: TimedWord[] = [];
  /** Words still being transcribed: shown, then replaced when the final arrives. */
  private interim: TimedWord[] = [];
  /** Fillers seen in interim results, kept in case the final drops them. */
  private interimFillers = new Map<number, TimedWord>();
  /** Webspeech-style utterances: id -> index of its first word and its word count. */
  private utterances = new Map<string, { first: number; count: number }>();
  private readonly fillers: readonly string[];
  private readonly rushedAboveWpm: number;
  private readonly latencyMs: number;

  constructor(opts: TimelineOptions = {}) {
    this.fillers = opts.fillers ?? DEFAULT_FILLERS;
    this.rushedAboveWpm = opts.rushedAboveWpm ?? Infinity;
    this.latencyMs = opts.latencyMs ?? 500;
  }

  private get lastEndMs(): number {
    return this.words.length ? this.words[this.words.length - 1].endMs : 0;
  }

  private place(texts: string[], nowMs: number, voiced: readonly VoicedInterval[], wpm: number | null): void {
    if (texts.length === 0) return;
    // Speech in the last latencyMs is (most likely) the next words, still being transcribed.
    const until = Math.max(this.lastEndMs + 1, nowMs - this.latencyMs);
    const times = placeWords(
      texts.map((t) => Math.max(1, t.length)),
      this.lastEndMs,
      until,
      voiced
    );
    texts.forEach((text, i) => this.words.push({ text, ...times[i], wpmAtArrival: wpm }));
  }

  /**
   * Add final words that already carry real timings (Deepgram). Words that overlap what is
   * already in the timeline are skipped, so a repeated final can't double up.
   */
  appendTimed(words: readonly { text: string; startMs: number; endMs: number }[], wpm: number | null = null): void {
    words = this.withRescuedFillers(words);
    for (const w of words) {
      if (!w.text || !Number.isFinite(w.startMs) || !Number.isFinite(w.endMs)) continue;
      if (this.words.length && w.startMs < this.lastEndMs - 20) continue;
      this.words.push({
        text: w.text,
        startMs: w.startMs,
        endMs: Math.max(w.endMs, w.startMs + 1),
        wpmAtArrival: wpm,
        ...('rescued' in w && w.rescued ? { rescued: true } : {}),
      });
    }
  }

  /**
   * Deepgram usually keeps "um"/"uh" in finals, but sometimes shows them in an interim result
   * and drops them from the final. Put back any interim filler inside this final's span that no
   * final word covers.
   */
  private withRescuedFillers(finals: readonly { text: string; startMs: number; endMs: number }[]) {
    if (!finals.length || !this.interimFillers.size) return finals;
    const from = finals[0].startMs - 150;
    const to = finals[finals.length - 1].endMs + 150;
    const rescued: (TimedWord & { rescued: true })[] = [];
    for (const [key, f] of this.interimFillers) {
      if (f.endMs < from || f.startMs > to) continue;
      this.interimFillers.delete(key);
      const covered = finals.some((w) => w.startMs < f.endMs - 20 && w.endMs > f.startMs + 20);
      if (!covered) rescued.push({ ...f, rescued: true });
    }
    return rescued.length ? [...finals, ...rescued].sort((a, b) => a.startMs - b.startMs) : finals;
  }

  /** Replace the in-progress (interim) words. */
  setInterim(words: readonly { text: string; startMs: number; endMs: number }[]): void {
    this.interim = words.filter((w) => w.text).map((w) => ({ ...w, wpmAtArrival: null }));
    for (const w of this.interim) {
      if (isFillerToken(w.text)) this.interimFillers.set(Math.round(w.startMs / 50), w);
    }
  }

  /** In-progress words as segments, with fillers marked. Never counted in metrics. */
  interimSegments(): WordSegment[] {
    const mask = fillerMask(
      this.interim.map((w) => w.text),
      this.fillers
    );
    return this.interim.map((w, i) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, kind: mask[i] ? 'filler' : 'speech' }));
  }

  /** Append a chunk of text without timings: words are placed into the speech the detector heard. */
  append(text: string, nowMs: number, voiced: readonly VoicedInterval[] = [], wpm: number | null = null): void {
    this.place(tokenize(text), nowMs, voiced, wpm);
  }

  /**
   * Update an utterance whose full text so far is re-sent each time (Web Speech interim
   * results). Revised words keep their timing; only words beyond the previous count are new.
   */
  updateUtterance(
    id: string,
    fullText: string,
    nowMs: number,
    voiced: readonly VoicedInterval[] = [],
    wpm: number | null = null
  ): void {
    const tokens = tokenize(fullText);
    const existing = this.utterances.get(id);
    if (!existing) {
      this.utterances.set(id, { first: this.words.length, count: tokens.length });
      this.place(tokens, nowMs, voiced, wpm);
      return;
    }
    const isLast = existing.first + existing.count === this.words.length;
    const keep = Math.min(existing.count, tokens.length);
    for (let i = 0; i < keep; i++) this.words[existing.first + i].text = tokens[i];
    if (!isLast) return; // An older utterance was revised after newer words; keep timing as is.
    if (tokens.length < existing.count) {
      this.words.splice(existing.first + tokens.length);
    } else {
      this.place(tokens.slice(existing.count), nowMs, voiced, wpm);
    }
    existing.count = tokens.length;
  }

  getWords(): readonly TimedWord[] {
    return this.words;
  }

  /** End of the latest transcribed word: how far the transcript has caught up. */
  frontierMs(): number | null {
    return this.words.length ? this.words[this.words.length - 1].endMs : null;
  }

  wordStarts(): number[] {
    return this.words.map((w) => w.startMs);
  }

  /** Segments for the sonogram, with filler and rushed kinds. */
  toSegments(): WordSegment[] {
    const mask = fillerMask(
      this.words.map((w) => w.text),
      this.fillers
    );
    return this.words.map((w, i) => {
      const kind: WordKind = mask[i] ? 'filler' : (w.wpmAtArrival ?? 0) > this.rushedAboveWpm ? 'rushed' : 'speech';
      return { text: w.text, startMs: w.startMs, endMs: w.endMs, kind };
    });
  }

  /** Plain transcript text. */
  text(): string {
    return this.words.map((w) => w.text).join(' ');
  }
}
