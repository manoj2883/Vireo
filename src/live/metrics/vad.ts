/**
 * Energy-based voice activity detection with hangover.
 *
 * Feed it one loudness reading per audio frame. A frame is speech when its RMS is well above
 * an adaptive noise floor. Speech "hangs over" for a short time after the energy drops, so
 * the dips inside and between words don't flicker the state. A pause is silence after speech
 * that lasts longer than MIN_PAUSE_MS; leading silence before the first word isn't a pause.
 */
import type { PauseSpan } from '@/components/sonogram/types';

export const MIN_PAUSE_MS = 300;

export interface VadOptions {
  /** Length of each frame in ms. */
  frameMs?: number;
  /** Speech keeps counting this long after the energy drops. */
  hangoverMs?: number;
  minPauseMs?: number;
  /** Absolute floor below which nothing is speech. */
  minSpeechRms?: number;
  /** Speech must be this many times louder than the noise floor. */
  floorRatio?: number;
  /** The first frames only measure the room; nothing in them counts as speech. */
  calibrationMs?: number;
}

export interface VoicedInterval {
  startMs: number;
  endMs: number;
}

export function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

export class VoiceActivityDetector {
  private readonly frameMs: number;
  private readonly hangoverMs: number;
  private readonly minPauseMs: number;
  private readonly minSpeechRms: number;
  private readonly floorRatio: number;
  private readonly calibrationMs: number;
  private calibratedMs = 0;

  private noiseFloor: number | null = null;
  private heardSpeech = false;
  /** End of the most recent speech frame. */
  private lastSpeechEndMs = 0;
  /** Start of the current silence, once past the hangover. */
  private silenceStartMs: number | null = null;
  private currentVoicedStartMs: number | null = null;
  private lastFrameEndMs = 0;

  private readonly pauses: PauseSpan[] = [];
  private readonly voiced: VoicedInterval[] = [];

  constructor(opts: VadOptions = {}) {
    this.frameMs = opts.frameMs ?? 20;
    this.hangoverMs = opts.hangoverMs ?? 200;
    this.minPauseMs = opts.minPauseMs ?? MIN_PAUSE_MS;
    this.minSpeechRms = opts.minSpeechRms ?? 0.006;
    this.floorRatio = opts.floorRatio ?? 3;
    this.calibrationMs = opts.calibrationMs ?? 200;
  }

  /** Current speech threshold, for debugging and the mic meter. */
  get threshold(): number {
    return Math.max(this.minSpeechRms, (this.noiseFloor ?? 0) * this.floorRatio);
  }

  processFrame(frame: Float32Array, timeMs: number, frameMs = (frame.length / 16000) * 1000): boolean {
    return this.process(frameRms(frame), timeMs, frameMs);
  }

  /** Feed one loudness reading for the frame starting at timeMs. Returns whether it is speech. */
  process(rms: number, timeMs: number, frameMs = this.frameMs): boolean {
    const endMs = timeMs + frameMs;
    this.lastFrameEndMs = endMs;
    const calibrating = this.calibratedMs < this.calibrationMs;
    this.calibratedMs += frameMs;
    const isSpeech = !calibrating && rms >= this.threshold;

    if (isSpeech) {
      if (this.silenceStartMs !== null) {
        const length = timeMs - this.silenceStartMs;
        if (this.heardSpeech && length >= this.minPauseMs) {
          this.pauses.push({ startMs: this.silenceStartMs, endMs: timeMs });
        }
        this.silenceStartMs = null;
      }
      if (this.currentVoicedStartMs === null) this.currentVoicedStartMs = timeMs;
      this.heardSpeech = true;
      this.lastSpeechEndMs = endMs;
    } else {
      // Track the noise floor only from non-speech frames, so speech can't drag it up.
      this.noiseFloor = this.noiseFloor === null ? rms : this.noiseFloor * 0.95 + rms * 0.05;
      if (this.heardSpeech && this.silenceStartMs === null && endMs - this.lastSpeechEndMs > this.hangoverMs) {
        this.silenceStartMs = this.lastSpeechEndMs;
        if (this.currentVoicedStartMs !== null) {
          this.voiced.push({ startMs: this.currentVoicedStartMs, endMs: this.lastSpeechEndMs });
          this.currentVoicedStartMs = null;
        }
      }
    }
    return isSpeech;
  }

  /** Speaking now, counting the hangover. */
  isSpeaking(): boolean {
    return this.heardSpeech && this.silenceStartMs === null;
  }

  /** Finished pauses longer than the minimum. */
  getPauses(): readonly PauseSpan[] {
    return this.pauses;
  }

  /** The pause in progress, once the silence has passed the minimum. */
  getOpenPause(nowMs = this.lastFrameEndMs): PauseSpan | null {
    if (this.silenceStartMs === null || nowMs - this.silenceStartMs < this.minPauseMs) return null;
    return { startMs: this.silenceStartMs };
  }

  /** Stretches of speech, including the one in progress (ending at the last speech frame). */
  getVoicedIntervals(): VoicedInterval[] {
    if (this.currentVoicedStartMs === null) return [...this.voiced];
    return [...this.voiced, { startMs: this.currentVoicedStartMs, endMs: this.lastSpeechEndMs }];
  }
}
