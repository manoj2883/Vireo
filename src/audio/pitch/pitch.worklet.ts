/**
 * AudioWorklet: every ~21 ms (1024 frames at 48 kHz) posts the loudness of that hop and a
 * pitch estimate over the last ~43 ms, downsampled to about 16 kHz to keep the work small.
 * Posts { frame, hz, rms, hopFrames } where frame is the AudioContext frame of the hop's end.
 * One worklet feeds both the sonogram's pitch and the pause detector.
 */
import { decimate, estimatePitch } from './autocorrelate';

declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean }
): void;

const WINDOW = 2048;
const HOP = 1024;

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(WINDOW);
  private filled = 0;
  private sinceLast = 0;
  private hopSumSquares = 0;
  private factor = Math.max(1, Math.floor(sampleRate / 16000));

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // Slide the window along by the new block.
    const n = channel.length;
    this.ring.copyWithin(0, n);
    this.ring.set(channel, WINDOW - n);
    this.filled = Math.min(WINDOW, this.filled + n);
    this.sinceLast += n;
    for (let i = 0; i < n; i++) this.hopSumSquares += channel[i] * channel[i];

    if (this.sinceLast >= HOP) {
      const hopFrames = this.sinceLast;
      const rms = Math.sqrt(this.hopSumSquares / hopFrames);
      this.sinceLast = 0;
      this.hopSumSquares = 0;
      const hz = this.filled === WINDOW ? estimatePitch(decimate(this.ring, this.factor), sampleRate / this.factor) : null;
      this.port.postMessage({ frame: currentFrame + n, hz, rms, hopFrames });
    }
    return true;
  }
}

registerProcessor('vireo-pitch', PitchProcessor);
