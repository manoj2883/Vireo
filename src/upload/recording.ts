/**
 * "Upload a real talk": an audio or video file, analysed like a live session. Video never leaves
 * the device: the browser decodes the file and keeps only the audio (mono, 16 kHz). That audio is
 * sent straight to Deepgram's pre-recorded API with a short-lived token (never through the Vercel
 * function, which caps request bodies at about 4.5 MB). Temporary tokens work for pre-recorded
 * requests: https://developers.deepgram.com/guides/fundamentals/token-based-authentication
 */
import type { PauseSpan, WordSegment } from '@/components/sonogram/types';
import { estimatePitch } from '@/audio/pitch/autocorrelate';
import { findFillers, DEFAULT_FILLERS } from '@/live/metrics/fillers';
import { frameRms, VoiceActivityDetector } from '@/live/metrics/vad';
import { longPauses, PACE_WINDOW_MS, TALK_TYPES, windowWpm, type TalkType } from '@/live/metrics/pace';
import { summariseMetrics, toTranscriptLines, type SessionMetrics, type TranscriptLine } from '@/live/LiveSessionEngine';
import type { LiveWord } from '@/live/deepgramLiveClient';

/** The spec's limit: long enough for a real talk, short enough to analyse in the browser. */
export const MAX_RECORDING_MS = 15 * 60_000;
/** Deepgram expects this rate, and it's plenty for speech. */
export const UPLOAD_SAMPLE_RATE = 16_000;
/** Same frame size as the live pause detector. */
const FRAME_MS = 20;
/** Pitch samples per word, for the sonogram's shape. */
const PITCH_POINTS = 5;
/** Window for each pitch estimate (128 ms at 16 kHz): long enough for a low voice. */
const PITCH_WINDOW = 2048;

export const DEEPGRAM_PRERECORDED_URL = 'https://api.deepgram.com/v1/listen';

/** The pre-recorded URL with the same model and formatting as live sessions. */
export function buildPrerecordedUrl(keyterms: readonly string[] = []): string {
  const params = new URLSearchParams({ model: 'nova-3', language: 'en', smart_format: 'true', punctuate: 'true', filler_words: 'true' });
  for (const t of keyterms) params.append('keyterm', t);
  return `${DEEPGRAM_PRERECORDED_URL}?${params.toString()}`;
}

/** 16-bit PCM mono WAV from float samples. */
export function encodeWav16(samples: Float32Array, sampleRate = UPLOAD_SAMPLE_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Words from a pre-recorded response, in ms from the start of the audio. */
export function parsePrerecorded(body: unknown): LiveWord[] {
  const words = (body as { results?: { channels?: { alternatives?: { words?: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[] } })?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words.map((w) => ({ text: w.punctuated_word ?? w.word, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }));
}

/** Decode any audio or video file the browser can play into mono 16 kHz samples. Browser only. */
export async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const data = await file.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data);
  } catch {
    throw new Error('Vireo couldn’t read the sound in that file. Try an MP3, M4A, WAV, MP4 or WebM.');
  } finally {
    void ctx.close();
  }
  if (decoded.duration * 1000 > MAX_RECORDING_MS) throw new Error(`That recording is ${Math.round(decoded.duration / 60)} minutes. Vireo can take up to ${MAX_RECORDING_MS / 60_000}.`);
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * UPLOAD_SAMPLE_RATE), UPLOAD_SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

/** Get a short-lived token from the server, then send the audio straight to Deepgram. */
export async function transcribeRecording(wav: Blob, keyterms: readonly string[], fetchImpl: typeof fetch = fetch): Promise<LiveWord[]> {
  const t = await fetchImpl('/api/stt-token', { method: 'POST' });
  const tb = await t.json().catch(() => ({}));
  if (!t.ok || !tb.token) throw new Error(tb.error || `Couldn’t start transcription (${t.status}).`);
  let res: Response;
  try {
    res = await fetchImpl(buildPrerecordedUrl(keyterms), { method: 'POST', headers: { Authorization: `Bearer ${tb.token}`, 'Content-Type': 'audio/wav' }, body: wav });
  } catch (err) {
    throw new Error(`Couldn’t reach Deepgram: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Deepgram couldn’t transcribe the recording: ${body.err_msg || body.message || res.status}.`);
  return parsePrerecorded(body);
}

export interface RecordingAnalysis {
  segments: WordSegment[];
  pauses: PauseSpan[];
  transcript: TranscriptLine[];
  metrics: SessionMetrics;
  /** Pace once a second while speaking, null while silent (as a live take's trace). */
  trace: (number | null)[];
  durationMs: number;
}

/**
 * The same on-device measurements as a live session, over the whole recording at once: pauses from
 * loudness, pace once a second from word starts, fillers from the words, pitch for each word.
 */
export function analyseRecording(samples: Float32Array, sampleRate: number, words: readonly LiveWord[], talkType: TalkType, fillers: readonly string[] = DEFAULT_FILLERS): RecordingAnalysis {
  const durationMs = (samples.length / sampleRate) * 1000;
  const zone = TALK_TYPES[talkType].zone;

  const vad = new VoiceActivityDetector({ frameMs: FRAME_MS });
  const frameLen = Math.round((sampleRate * FRAME_MS) / 1000);
  for (let t = 0, i = 0; i + frameLen <= samples.length; t += FRAME_MS, i += frameLen) vad.process(frameRms(samples.subarray(i, i + frameLen)), t, FRAME_MS);
  const pauses = vad.getPauses().filter((p) => p.endMs !== undefined);

  const starts = words.map((w) => w.startMs);
  const gaps = longPauses(words);
  const trace: (number | null)[] = [];
  for (let t = 1000; t <= durationMs; t += 1000) {
    const speaking = words.some((w) => w.startMs <= t && w.endMs >= t - 1000);
    const before = starts.filter((s) => s <= t);
    trace.push(speaking && before.length ? windowWpm(before, t, PACE_WINDOW_MS, gaps) : null);
  }

  const fillerWords = new Set<number>();
  for (const m of findFillers(words.map((w) => w.text), fillers)) for (let k = 0; k < m.length; k++) fillerWords.add(m.start + k);
  const segments: WordSegment[] = words.map((w, i) => {
    const wpm = trace[Math.max(0, Math.ceil(w.startMs / 1000) - 1)] ?? null;
    const kind = fillerWords.has(i) ? 'filler' : wpm !== null && wpm > zone.max ? 'rushed' : 'speech';
    return { text: w.text, startMs: w.startMs, endMs: w.endMs, kind, pitch: pitchFor(samples, sampleRate, w.startMs, w.endMs) };
  });

  return { segments, pauses, transcript: toTranscriptLines(segments, pauses), metrics: summariseMetrics(segments, pauses, trace, zone, durationMs, fillers), trace, durationMs };
}

function pitchFor(samples: Float32Array, sampleRate: number, startMs: number, endMs: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < PITCH_POINTS; k++) {
    const mid = startMs + ((k + 0.5) / PITCH_POINTS) * (endMs - startMs);
    const a = Math.max(0, Math.round((mid / 1000) * sampleRate) - PITCH_WINDOW / 2);
    const win = samples.subarray(a, a + PITCH_WINDOW);
    out.push(win.length === PITCH_WINDOW ? estimatePitch(win, sampleRate) ?? 0 : 0);
  }
  return out;
}
