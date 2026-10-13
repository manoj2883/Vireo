/**
 * AudioWorklet: estimates pitch from the microphone every ~21 ms (1024 frames at 48 kHz)
 * over a ~43 ms window, after downsampling to about 16 kHz to keep the work small.
 * Posts { frame, hz } where frame is the AudioContext frame of the window's end.
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

    if (this.filled === WINDOW && this.sinceLast >= HOP) {
      this.sinceLast = 0;
      const hz = estimatePitch(decimate(this.ring, this.factor), sampleRate / this.factor);
      this.port.postMessage({ frame: currentFrame + n, hz });
    }
    return true;
  }
}

registerProcessor('vireo-pitch', PitchProcessor);
