import fs from 'fs';
import type { LabelFile } from './types';

export interface Pcm {
  sampleRate: number;
  samples: Float32Array;
}

/** Read a PCM WAV (8/16/24/32-bit integer or 32-bit float), mixing to mono. */
export function readWav(path: string): Pcm {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error(`${path}: data chunk before fmt chunk`);
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          let v: number;
          if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
          else if (fmt.bits === 16) v = buf.readInt16LE(p) / 32768;
          else if (fmt.bits === 24) v = buf.readIntLE(p, 3) / 8388608;
          else if (fmt.bits === 32) v = buf.readInt32LE(p) / 2147483648;
          else v = (buf.readUInt8(p) - 128) / 128;
          sum += v;
        }
        out[i] = sum / fmt.channels;
      }
      return { sampleRate: fmt.sampleRate, samples: out };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

/**
 * Synthesise speech-like audio from labelled words: a voiced tone with harmonics for each
 * word (flat pitch for fillers), quiet room noise everywhere else. Lets the harness run
 * end to end before any real recordings are labelled.
 */
export function synthesise(label: LabelFile, sampleRate = 16_000): Pcm {
  const end = Math.max(...label.words.map((w) => w.endMs), ...label.pauses.map((p) => p.endMs)) + 500;
  const samples = new Float32Array(Math.ceil((end / 1000) * sampleRate));
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = 0.003 * ((seed / 2147483647) * 2 - 1);
  }
  const fillerTimes = label.fillers;
  label.words.forEach((w, wi) => {
    const isFiller = fillerTimes.some((f) => w.startMs < f.endMs && w.endMs > f.startMs);
    const a = Math.floor((w.startMs / 1000) * sampleRate);
    const b = Math.floor((w.endMs / 1000) * sampleRate);
    for (let i = a; i < b && i < samples.length; i++) {
      const u = (i - a) / Math.max(1, b - a);
      const hz = isFiller ? 120 : 130 + 30 * Math.sin(wi + u * 3);
      const t = i / sampleRate;
      const env = Math.sin(Math.PI * u);
      samples[i] += 0.2 * env * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t));
    }
  });
  return { sampleRate, samples };
}
