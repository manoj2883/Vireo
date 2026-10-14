/**
 * The live session: microphone and camera in, a snapshot of everything the Live screen
 * draws out. Pauses, pace, fillers, ghost pace and nudges are computed here, on the device.
 * Deepgram transcribes the audio with real word timings; camera frames never leave the device.
 */
import type { PauseSpan, WordSegment } from '@/components/sonogram/types';
import type { AudioFrameReading } from '@/audio/pitch/PitchTracker';
import { VoiceActivityDetector } from './metrics/vad';
import { TranscriptTimeline } from './metrics/timeline';
import { PaceMeter, paceState, TALK_TYPES, type PaceState, type PaceZone, type TalkType } from './metrics/pace';
import { NudgeController, SPOKEN_NUDGES, type CoachMode } from './metrics/nudges';
import { ghostKey, ghostWpmAt, isBetterTake, summariseTake, type PaceTake } from './metrics/ghost';
import { DEFAULT_FILLERS, findFillers } from './metrics/fillers';
import { captionView, likelyFillerBursts, splitParagraphs, type CaptionView } from './metrics/paragraphs';
import { DeepgramLiveClient, type LiveStatus, type LiveWord, type SttCallbacks } from './deepgramLiveClient';
import { CoachVoice, type CoachVoiceLike } from './coachVoice';

export interface LiveSessionConfig {
  mode: CoachMode;
  talkType: TalkType;
  prompt: string;
  storyId?: string;
  fillers?: readonly string[];
  /** Expected delay between speaking and the transcript arriving (see TranscriptTimeline). */
  transcriptLatencyMs?: number;
  /** Words and phrases the speaker is likely to say, to help recognition. */
  keyterms?: readonly string[];
}

export interface LiveSnapshot {
  status: LiveStatus;
  statusMessage?: string;
  elapsedMs: number;
  segments: WordSegment[];
  /** Words still being transcribed; shown lighter and replaced when final. */
  interim: WordSegment[];
  /** The growing paragraph and the one before it, for live captions. */
  captions: CaptionView;
  /** Short voiced bursts with no transcribed word: likely fillers, not counted. */
  likelyFillers: { startMs: number; endMs: number }[];
  pauses: PauseSpan[];
  /** Length of the pause in progress, or 0. */
  pausingMs: number;
  speaking: boolean;
  wpm: number | null;
  zone: PaceZone;
  paceState: PaceState | null;
  ghostWpm: number | null;
  fillerCount: number;
  lastFiller: { text: string; atMs: number } | null;
  /** Visual nudge: warm frame and ringed dot. */
  nudge: 'fast' | 'slow' | null;
  /** Coach bubble text while a spoken nudge plays (coach mode). */
  coachSays: string | null;
  micLevel: number;
  pitchAvailable: boolean;
}

export interface TranscriptLine {
  speaker: 'user';
  text: string;
  startMs: number;
}

export interface SessionMetrics {
  durationMs: number;
  wordCount: number;
  avgWpm: number;
  timeInZonePct: number;
  fillerCount: number;
  fillersPerMin: number;
  pauseCount: number;
  pausesPerMin: number;
  longestPauseMs: number;
}

export interface LiveSessionResult {
  config: LiveSessionConfig;
  startedAt: string;
  segments: WordSegment[];
  pauses: PauseSpan[];
  transcript: TranscriptLine[];
  metrics: SessionMetrics;
  take: PaceTake;
  newBest: boolean;
  /** Likely fillers heard but not transcribed (not counted in metrics). */
  likelyFillers: { startMs: number; endMs: number }[];
}

/** Media plumbing, swappable for tests. */
export interface MediaHandle {
  pitchForWord(startMs: number, endMs: number): number[] | undefined;
  micLevel(): number;
  stop(): Promise<void>;
  pitchAvailable: boolean;
}

export interface MediaStartArgs {
  clockStartMs: number;
  videoElement?: HTMLVideoElement;
  onAudioFrame: (reading: AudioFrameReading) => void;
  onPcmChunk: (base64Pcm16k: string) => void;
}

export interface LiveClientLike {
  connect(): Promise<void>;
  sendAudio(pcm: string): void;
  close(): void;
}

export interface GhostStoreLike {
  get(key: string): Promise<PaceTake | undefined>;
  put(take: PaceTake): Promise<void>;
}

export interface EngineDeps {
  startMedia?: (args: MediaStartArgs) => Promise<MediaHandle>;
  createClient?: (keyterms: readonly string[], cb: SttCallbacks, sessionClock: () => number) => LiveClientLike;
  /** The coach's voice for spoken nudges (coach mode). */
  voice?: CoachVoiceLike;
  ghostStore?: GhostStoreLike;
  /** Session clock source in ms (performance.now by default). */
  now?: () => number;
  tickMs?: number;
  /** Set false in tests to drive tick() by hand. */
  autoTick?: boolean;
}

const COACH_BUBBLE_MS = 3500;

export class LiveSessionEngine {
  readonly config: LiveSessionConfig;
  readonly zone: PaceZone;
  private readonly fillers: readonly string[];
  private readonly deps: EngineDeps;
  private readonly now: () => number;

  private readonly vad = new VoiceActivityDetector();
  private readonly timeline: TranscriptTimeline;
  private readonly pace = new PaceMeter();
  private readonly nudges: NudgeController;

  private client: LiveClientLike | null = null;
  private media: MediaHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: LiveSnapshot;

  private clockStart: number | null = null;
  private startedAt = '';
  private status: LiveStatus = 'idle';
  private statusMessage: string | undefined;
  private ghost: PaceTake | null = null;
  private trace: (number | null)[] = [];
  private coachSays: { text: string; untilMs: number } | null = null;
  /** Times Deepgram marked the end of an utterance: paragraph breaks. */
  private utteranceEnds: number[] = [];
  private coachVoice: CoachVoiceLike | null = null;
  private pitchCache = new Map<number, number[] | undefined>();
  private ended = false;

  constructor(config: LiveSessionConfig, deps: EngineDeps = {}) {
    this.config = config;
    this.zone = TALK_TYPES[config.talkType].zone;
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.fillers = config.fillers ?? DEFAULT_FILLERS;
    this.timeline = new TranscriptTimeline({ fillers: this.fillers, rushedAboveWpm: this.zone.max, latencyMs: config.transcriptLatencyMs });
    this.nudges = new NudgeController(config.mode);
    this.snapshot = this.compute(0);
  }

  /** The coach's voice, created on first use and only in coach mode. */
  private voice(): CoachVoiceLike | null {
    if (this.config.mode !== 'coach') return null;
    this.coachVoice ??= this.deps.voice ?? new CoachVoice();
    return this.coachVoice;
  }

  /** Session clock: ms since start(). */
  elapsed(): number {
    return this.clockStart === null ? 0 : this.now() - this.clockStart;
  }

  async start(videoElement?: HTMLVideoElement): Promise<void> {
    this.clockStart = this.now();
    this.startedAt = new Date().toISOString();

    const key = ghostKey(this.config.storyId ?? this.config.prompt);
    this.deps.ghostStore
      ?.get(key)
      .then((g) => (this.ghost = g ?? null))
      .catch(() => {});

    const createClient = this.deps.createClient ?? ((keyterms, cb, clock) => new DeepgramLiveClient(keyterms, cb, { now: clock }));
    this.client = createClient(
      this.config.keyterms ?? [],
      {
        onStatus: (status, message) => {
          this.status = status;
          this.statusMessage = message;
          this.publish();
        },
        onWords: (words, isFinal) => this.ingestWords(words, isFinal),
        onUtteranceEnd: (atMs) => this.utteranceEnds.push(atMs),
      },
      () => this.elapsed()
    );

    const startMedia = this.deps.startMedia ?? (await import('./browserMedia')).startBrowserMedia;
    this.media = await startMedia({
      clockStartMs: this.clockStart!,
      videoElement,
      onAudioFrame: (r) => this.ingestAudioFrame(r),
      onPcmChunk: (pcm) => this.client?.sendAudio(pcm),
    });

    await this.client.connect();
    if (this.deps.autoTick !== false) {
      this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? 100);
    }
  }

  ingestAudioFrame(reading: AudioFrameReading): void {
    this.vad.process(reading.rms, reading.timeMs, reading.durationMs);
  }

  /** Timed words from the transcriber. Finals are kept; interim words are shown until replaced. */
  ingestWords(words: readonly LiveWord[], isFinal: boolean): void {
    const timed = words.every((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
    if (!timed) {
      // A stream without timings: fall back to placing words into the speech we heard.
      if (isFinal) this.ingestTranscript(words.map((w) => w.text).join(' '));
      return;
    }
    if (isFinal) {
      this.timeline.appendTimed(words, this.pace.wpm);
      this.timeline.setInterim([]);
    } else {
      this.timeline.setInterim(words);
    }
  }

  /** Text without timings (fallback): words are placed into the speech the detector heard. */
  ingestTranscript(text: string, atMs = this.elapsed()): void {
    this.timeline.append(text, atMs, this.vad.getVoicedIntervals(), this.pace.wpm);
  }

  /** Recompute metrics and the snapshot. Runs on a timer during a session. */
  tick(nowMs = this.elapsed()): LiveSnapshot {
    const wpm = this.pace.update(this.timeline.wordStarts(), nowMs, Math.min(nowMs, this.timeline.frontierMs() ?? nowMs));
    const speaking = this.vad.isSpeaking();
    const state = this.timeline.getWords().length ? paceState(Math.round(wpm), this.zone) : null;

    const open = this.vad.getOpenPause(nowMs);
    const pauseMs = open ? nowMs - open.startMs : 0;
    const voice = this.voice();
    // Never talk over the speaker: if they start again mid-nudge, stop at once.
    if (speaking && voice?.isPlaying()) {
      voice.stop();
      this.coachSays = null;
    }
    const nudge = this.nudges.tick(state, speaking, nowMs, pauseMs);
    if (nudge.speak && voice) {
      voice.play(nudge.speak);
      this.coachSays = { text: SPOKEN_NUDGES[nudge.speak], untilMs: nowMs + COACH_BUBBLE_MS };
    }

    const second = Math.floor(nowMs / 1000);
    while (this.trace.length <= second) this.trace.push(speaking && this.timeline.getWords().length ? Math.round(wpm) : null);

    this.snapshot = this.compute(nowMs, nudge.visual);
    this.publish(false);
    return this.snapshot;
  }

  private segmentsWithPitch(nowMs: number): WordSegment[] {
    return this.timeline.toSegments().map((seg, i) => {
      if (seg.kind === 'filler' || !this.media?.pitchAvailable) return seg;
      if (!this.pitchCache.has(i) && seg.endMs < nowMs - 150) {
        this.pitchCache.set(i, this.media.pitchForWord(seg.startMs, seg.endMs));
      }
      const pitch = this.pitchCache.get(i);
      return pitch ? { ...seg, pitch } : seg;
    });
  }

  private compute(nowMs: number, visual: 'fast' | 'slow' | null = null): LiveSnapshot {
    const segments = this.segmentsWithPitch(nowMs);
    const open = this.vad.getOpenPause(nowMs);
    const pauses: PauseSpan[] = [...this.vad.getPauses(), ...(open ? [open] : [])];
    const fillers = segments.filter((s) => s.kind === 'filler');
    const last = fillers[fillers.length - 1];
    const hasWords = segments.length > 0;
    const wpm = hasWords && !open ? this.pace.wpm : null;
    const coach = this.coachSays && this.coachSays.untilMs > nowMs ? this.coachSays.text : null;
    return {
      status: this.status,
      statusMessage: this.statusMessage,
      elapsedMs: nowMs,
      segments,
      interim: this.timeline.interimSegments(),
      captions: captionView(
        [...segments.map((w) => ({ ...w, interim: false })), ...this.timeline.interimSegments().map((w) => ({ ...w, interim: true }))],
        { pauses, utteranceEnds: this.utteranceEnds }
      ),
      likelyFillers: likelyFillerBursts(this.vad.getVoicedIntervals(), [...segments, ...this.timeline.interimSegments()], { nowMs }),
      pauses,
      pausingMs: open ? nowMs - open.startMs : 0,
      speaking: this.vad.isSpeaking(),
      wpm,
      zone: this.zone,
      paceState: paceState(wpm, this.zone),
      ghostWpm: ghostWpmAt(this.ghost, nowMs),
      fillerCount: countFillers(segments, this.fillers),
      lastFiller: last ? { text: last.text.replace(/[^\p{L}\p{N}' ]/gu, ''), atMs: last.startMs } : null,
      nudge: visual,
      coachSays: coach,
      micLevel: this.media?.micLevel() ?? 0,
      pitchAvailable: this.media?.pitchAvailable ?? false,
    };
  }

  getSnapshot = (): LiveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(recompute = true): void {
    if (recompute) this.snapshot = { ...this.snapshot, status: this.status, statusMessage: this.statusMessage };
    for (const l of this.listeners) l();
  }

  /**
   * Stop everything and return what the field notes need. Saves the take as the ghost if it's
   * the best yet, under `takeId` (the stored session's id, so deleting the session removes it).
   */
  async end(takeId = `take_${Date.now()}`): Promise<LiveSessionResult> {
    const nowMs = this.elapsed();
    this.tick(nowMs);
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client?.close();
    this.coachVoice?.stop();
    await this.media?.stop();
    this.status = 'closed';

    const segments = this.snapshot.segments;
    const pauses = this.vad.getPauses().slice();
    const key = ghostKey(this.config.storyId ?? this.config.prompt);
    const take = summariseTake(key, takeId, this.trace, this.zone, countFillers(segments, this.fillers), nowMs);
    const newBest = isBetterTake(take, this.ghost);
    if (newBest) await this.deps.ghostStore?.put(take).catch(() => {});

    return {
      config: this.config,
      startedAt: this.startedAt,
      segments,
      pauses,
      transcript: toTranscriptLines(segments, pauses, this.utteranceEnds),
      metrics: summariseMetrics(segments, pauses, this.trace, this.zone, nowMs, this.fillers),
      take,
      newBest,
      likelyFillers: this.snapshot.likelyFillers,
    };
  }

  /** Leave without a result: release the mic, camera and connection. Nothing is saved. */
  async abort(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client?.close();
    this.coachVoice?.stop();
    await this.media?.stop().catch(() => {});
  }

  get isEnded(): boolean {
    return this.ended;
  }
}

/** Fillers counted as matches, not words: "you know" is one filler, "um, so basically" is two. */
export function countFillers(segments: readonly WordSegment[], fillers: readonly string[] = DEFAULT_FILLERS): number {
  return findFillers(
    segments.map((s) => s.text),
    fillers
  ).length;
}

/**
 * Group words into transcript paragraphs, breaking only at pauses of PARAGRAPH_PAUSE_MS or
 * longer and at Deepgram utterance ends, the same breaks the live captions use.
 */
export function toTranscriptLines(segments: readonly WordSegment[], pauses: readonly PauseSpan[], utteranceEnds: readonly number[] = []): TranscriptLine[] {
  return splitParagraphs(segments, { pauses, utteranceEnds }).map((para) => ({
    speaker: 'user' as const,
    text: para.map((w) => w.text).join(' '),
    startMs: Math.round(para[0].startMs),
  }));
}

export function summariseMetrics(
  segments: readonly WordSegment[],
  pauses: readonly PauseSpan[],
  trace: readonly (number | null)[],
  zone: PaceZone,
  durationMs: number,
  fillers: readonly string[] = DEFAULT_FILLERS
): SessionMetrics {
  const spoken = trace.filter((v): v is number => v !== null);
  const minutes = Math.max(durationMs, 1) / 60_000;
  const fillerCount = countFillers(segments, fillers);
  const closed = pauses.filter((p) => p.endMs !== undefined);
  return {
    durationMs: Math.round(durationMs),
    wordCount: segments.length,
    avgWpm: spoken.length ? Math.round(spoken.reduce((s, v) => s + v, 0) / spoken.length) : 0,
    timeInZonePct: spoken.length ? Math.round((spoken.filter((v) => v >= zone.min && v <= zone.max).length / spoken.length) * 100) : 0,
    fillerCount,
    fillersPerMin: Math.round((fillerCount / minutes) * 10) / 10,
    pauseCount: closed.length,
    pausesPerMin: Math.round((closed.length / minutes) * 10) / 10,
    longestPauseMs: Math.round(Math.max(0, ...closed.map((p) => (p.endMs ?? p.startMs) - p.startMs))),
  };
}
