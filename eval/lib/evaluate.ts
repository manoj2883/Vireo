/**
 * Runs Vireo's on-device metrics over one labelled recording, exactly as a live session
 * would: 20 ms loudness frames into the voice detector, transcript chunks into the timeline,
 * the smoothed pace meter ticking ten times a second.
 */
import { VoiceActivityDetector, frameRms } from '@/live/metrics/vad';
import { TranscriptTimeline } from '@/live/metrics/timeline';
import { PaceMeter, windowWpm } from '@/live/metrics/pace';
import { findFillers } from '@/live/metrics/fillers';
import type { Pcm } from './audio';
import type { Interval, LabelFile } from './types';
import { meanAbsoluteError, scoreFillers, scorePauses, type PRF } from './scoring';

const FRAME_MS = 20;

export interface FileResult {
  pauses: PRF;
  fillers: PRF;
  wpm: { mae: number; points: number };
  predicted: { pauses: Interval[]; fillers: Interval[] };
  series: { predicted: (number | null)[]; truth: (number | null)[] };
}

/** Transcript chunks as they would arrive live: from the label's asr, or simulated. */
export function transcriptChunks(label: LabelFile, latencyMs = 500, wordsPerChunk = 4): { atMs: number; text: string }[] {
  if (label.asr?.length) return [...label.asr].sort((a, b) => a.atMs - b.atMs);
  const chunks: { atMs: number; text: string }[] = [];
  for (let i = 0; i < label.words.length; i += wordsPerChunk) {
    const group = label.words.slice(i, i + wordsPerChunk);
    chunks.push({ atMs: group[group.length - 1].endMs + latencyMs, text: group.map((w) => w.text).join(' ') });
  }
  return chunks;
}

export function evaluateFile(label: LabelFile, audio: Pcm, fillerList?: readonly string[]): FileResult {
  const vad = new VoiceActivityDetector({ frameMs: FRAME_MS });
  const timeline = new TranscriptTimeline({ fillers: fillerList });
  const pace = new PaceMeter();
  const chunks = transcriptChunks(label);
  const frameLen = Math.round((audio.sampleRate * FRAME_MS) / 1000);
  const durationMs = (audio.samples.length / audio.sampleRate) * 1000;
  const truthStarts = label.words.map((w) => w.startMs);

  let next = 0;
  const predictedWpm: (number | null)[] = [];
  const truthWpm: (number | null)[] = [];
  for (let t = 0, i = 0; t < durationMs; t += FRAME_MS, i += frameLen) {
    vad.process(frameRms(audio.samples.subarray(i, i + frameLen)), t, FRAME_MS);
    while (next < chunks.length && chunks[next].atMs <= t + FRAME_MS) {
      timeline.append(chunks[next].text, chunks[next].atMs, vad.getVoicedIntervals(), pace.wpm);
      next++;
    }
    if ((t + FRAME_MS) % 100 === 0) {
      const now = t + FRAME_MS;
      const v = pace.update(timeline.wordStarts(), now, Math.min(now, timeline.frontierMs() ?? now));
      if (now % 1000 === 0) {
        // Compare once a second while speaking, skipping the first two seconds of speech.
        const speaking = label.words.some((w) => w.startMs <= now && w.endMs >= now - 1000);
        const warm = truthStarts.length && now - truthStarts[0] >= 2000;
        predictedWpm.push(speaking && warm && timeline.getWords().length ? v : null);
        truthWpm.push(speaking && warm ? windowWpm(truthStarts, now) : null);
      }
    }
  }

  const words = timeline.getWords();
  const predictedFillers = findFillers(
    words.map((w) => w.text),
    fillerList
  ).map((m) => ({ startMs: words[m.start].startMs, endMs: words[m.start + m.length - 1].endMs }));
  const predictedPauses = vad.getPauses().map((p) => ({ startMs: p.startMs, endMs: p.endMs ?? p.startMs }));

  return {
    pauses: scorePauses(predictedPauses, label.pauses),
    fillers: scoreFillers(predictedFillers, label.fillers),
    wpm: meanAbsoluteError(predictedWpm, truthWpm),
    predicted: { pauses: predictedPauses, fillers: predictedFillers },
    series: { predicted: predictedWpm, truth: truthWpm },
  };
}
