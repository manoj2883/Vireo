import workletUrl from './pitch.worklet.ts?worker&url';
import { pitchForWord, type PitchSample } from './samples';

/**
 * Tracks the speaker's pitch from a microphone stream using the pitch AudioWorklet.
 * Times are milliseconds since `start()`, the same clock as the session transcript.
 * If AudioWorklet isn't available, `start()` resolves to false and the sonogram uses its
 * synthetic contour instead.
 */
export class PitchTracker {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private samples: PitchSample[] = [];
  private readonly maxSamples: number;

  constructor(opts: { maxSamples?: number } = {}) {
    // About 47 readings a second; the default keeps roughly 20 minutes.
    this.maxSamples = opts.maxSamples ?? 60_000;
  }

  async start(stream: MediaStream): Promise<boolean> {
    if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') return false;
    try {
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.source = this.ctx.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(this.ctx, 'vireo-pitch', { numberOfOutputs: 1 });
      // A silent sink keeps the node in the rendering graph without playing the mic back.
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      const startFrame = Math.round(this.ctx.currentTime * this.ctx.sampleRate);
      const rate = this.ctx.sampleRate;
      this.node.port.onmessage = (e: MessageEvent<{ frame: number; hz: number | null }>) => {
        this.samples.push({ timeMs: ((e.data.frame - startFrame) / rate) * 1000, hz: e.data.hz });
        if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
      };
      this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination);
      return true;
    } catch (err) {
      console.warn('[PitchTracker] Pitch tracking unavailable, using synthetic contours:', err);
      await this.stop();
      return false;
    }
  }

  getSamples(): readonly PitchSample[] {
    return this.samples;
  }

  /** Pitch for one word on the session clock, ready for WordSegment.pitch. */
  pitchForWord(startMs: number, endMs: number, count?: number): number[] | undefined {
    return pitchForWord(this.samples, startMs, endMs, count);
  }

  async stop(): Promise<void> {
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.sink = null;
  }
}
