/**
 * The live session: microphone and camera in, a snapshot of everything the Live screen
 * draws out. Pauses, pace, fillers, ghost pace and nudges are computed here, on the device.
 * Gemini Live only transcribes and, in coach mode, voices the nudges this engine asks for.
 */
import type { PauseSpan, WordSegment } from '@/components/sonogram/types';
import type { AudioFrameReading } from '@/audio/pitch/PitchTracker';
import { VoiceActivityDetector } from './metrics/vad';
import { TranscriptTimeline } from './metrics/timeline';
import { PaceMeter, paceState, TALK_TYPES, type PaceState, type PaceZone, type TalkType } from './metrics/pace';
import { NudgeController, type CoachMode } from './metrics/nudges';
import { ghostKey, ghostWpmAt, isBetterTake, summariseTake, type PaceTake } from './metrics/ghost';
import { DEFAULT_FILLERS, findFillers } from './metrics/fillers';
import { GeminiLiveClient, type GeminiLiveCallbacks, type LiveStatus } from './geminiLiveClient';

export interface LiveSessionConfig {
  mode: CoachMode;
  talkType: TalkType;
  prompt: string;
  storyId?: string;
  fillers?: readonly string[];
}

export interface LiveSnapshot {
  status: LiveStatus;
  statusMessage?: string;
  elapsedMs: number;
  segments: WordSegment[];
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
}

/** Media plumbing, swappable for tests. */
export interface MediaHandle {
  pitchForWord(startMs: number, endMs: number): number[] | undefined;
  micLevel(): number;
  playCoachAudio(base64Pcm: string): void;
  stop(): Promise<void>;
  pitchAvailable: boolean;
}

export interface MediaStartArgs {
  clockStartMs: number;
  videoElement?: HTMLVideoElement;
  onAudioFrame: (reading: AudioFrameReading) => void;
  onPcmChunk: (base64Pcm16k: string) => void;
  onVideoFrame: (base64Jpeg: string) => void;
}

export interface LiveClientLike {
  connect(): Promise<void>;
  sendAudio(base64: string): void;
  sendVideoFrame(base64: string): void;
  sendNudge(text: string): boolean;
  close(): void;
}

export interface GhostStoreLike {
  get(key: string): Promise<PaceTake | undefined>;
  put(take: PaceTake): Promise<void>;
}

export interface EngineDeps {
  startMedia?: (args: MediaStartArgs) => Promise<MediaHandle>;
  createClient?: (mode: CoachMode, cb: GeminiLiveCallbacks) => LiveClientLike;
  ghostStore?: GhostStoreLike;
  /** Session clock source in ms (performance.now by default). */
  now?: () => number;
  tickMs?: number;
  /** Set false in tests to drive tick() by hand. */
  autoTick?: boolean;
}

const COACH_BUBBLE_MS = 3500;
const CAPTION_LINE_WORDS = 14;

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
  private pitchCache = new Map<number, number[] | undefined>();
  private ended = false;

  constructor(config: LiveSessionConfig, deps: EngineDeps = {}) {
    this.config = config;
    this.zone = TALK_TYPES[config.talkType].zone;
    this.deps = deps;
    this.now = deps.now ?? (() => performance.now());
    this.fillers = config.fillers ?? DEFAULT_FILLERS;
    this.timeline = new TranscriptTimeline({ fillers: this.fillers, rushedAboveWpm: this.zone.max });
    this.nudges = new NudgeController(config.mode);
    this.snapshot = this.compute(0);
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

    const createClient = this.deps.createClient ?? ((mode, cb) => new GeminiLiveClient(mode, cb));
    this.client = createClient(this.config.mode, {
      onStatus: (status, message) => {
        this.status = status;
        this.statusMessage = message;
        this.publish();
      },
      onTranscript: (text) => this.ingestTranscript(text),
      onCoachAudio: (pcm) => this.media?.playCoachAudio(pcm),
    });

    const startMedia = this.deps.startMedia ?? (await import('./browserMedia')).startBrowserMedia;
    this.media = await startMedia({
      clockStartMs: this.clockStart!,
      videoElement,
      onAudioFrame: (r) => this.ingestAudioFrame(r),
      onPcmChunk: (pcm) => this.client?.sendAudio(pcm),
      onVideoFrame: (jpeg) => this.client?.sendVideoFrame(jpeg),
    });

    await this.client.connect();
    if (this.deps.autoTick !== false) {
      this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? 100);
    }
  }

  ingestAudioFrame(reading: AudioFrameReading): void {
    this.vad.process(reading.rms, reading.timeMs, reading.durationMs);
  }

  ingestTranscript(text: string, atMs = this.elapsed()): void {
    this.timeline.append(text, atMs, this.vad.getVoicedIntervals(), this.pace.wpm);
  }

  /** Recompute metrics and the snapshot. Runs on a timer during a session. */
  tick(nowMs = this.elapsed()): LiveSnapshot {
    const wpm = this.pace.update(this.timeline.wordStarts(), nowMs);
    const speaking = this.vad.isSpeaking();
    const state = this.timeline.getWords().length ? paceState(Math.round(wpm), this.zone) : null;

    const nudge = this.nudges.tick(state, speaking, nowMs);
    if (nudge.speak && this.client?.sendNudge(nudge.speak)) {
      this.coachSays = { text: nudge.speak, untilMs: nowMs + COACH_BUBBLE_MS };
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

  /** Stop everything and return what the field notes need. Saves the take as the ghost if it's the best yet. */
  async end(): Promise<LiveSessionResult> {
    const nowMs = this.elapsed();
    this.tick(nowMs);
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client?.close();
    await this.media?.stop();
    this.status = 'closed';

    const segments = this.snapshot.segments;
    const pauses = this.vad.getPauses().slice();
    const key = ghostKey(this.config.storyId ?? this.config.prompt);
    const take = summariseTake(key, `take_${Date.now()}`, this.trace, this.zone, countFillers(segments, this.fillers), nowMs);
    const newBest = isBetterTake(take, this.ghost);
    if (newBest) await this.deps.ghostStore?.put(take).catch(() => {});

    return {
      config: this.config,
      startedAt: this.startedAt,
      segments,
      pauses,
      transcript: toTranscriptLines(segments, pauses),
      metrics: summariseMetrics(segments, pauses, this.trace, this.zone, nowMs, this.fillers),
      take,
      newBest,
    };
  }

  /** Leave without a result: release the mic, camera and connection. Nothing is saved. */
  async abort(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client?.close();
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

/** Group words into transcript lines, breaking at pauses and every few words. */
export function toTranscriptLines(segments: readonly WordSegment[], pauses: readonly PauseSpan[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let current: WordSegment[] = [];
  const flush = () => {
    if (current.length) lines.push({ speaker: 'user', text: current.map((w) => w.text).join(' '), startMs: Math.round(current[0].startMs) });
    current = [];
  };
  segments.forEach((w, i) => {
    const prev = segments[i - 1];
    const pauseBetween = prev && pauses.some((p) => p.startMs >= prev.startMs && p.startMs <= w.startMs);
    if (pauseBetween || current.length >= CAPTION_LINE_WORDS) flush();
    current.push(w);
  });
  flush();
  return lines;
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
