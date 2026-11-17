// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { analyseRecording, buildPrerecordedUrl, encodeWav16, parsePrerecorded, transcribeRecording } from './recording';
import { synthesise } from '../../eval/lib/audio';
import type { LabelFile } from '../../eval/lib/types';

const label = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../eval/labels/example-synthetic.json'), 'utf8')) as LabelFile;

describe('upload: audio handling', () => {
  it('encodes mono 16 kHz 16-bit WAV', async () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -1, 1]), 16_000);
    const v = new DataView(await wav.arrayBuffer());
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 16383, -32768, 32767]);
    expect(wav.type).toBe('audio/wav');
  });

  it('asks Deepgram for the same model and formatting as live sessions', () => {
    const u = new URL(buildPrerecordedUrl(['Vireo']));
    expect(u.origin + u.pathname).toBe('https://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ model: 'nova-3', smart_format: 'true', filler_words: 'true', keyterm: 'Vireo' });
  });

  it('reads word timings from a pre-recorded response', () => {
    const body = { results: { channels: [{ alternatives: [{ words: [{ word: 'so', punctuated_word: 'So,', start: 0.5, end: 0.72 }] }] }] } };
    expect(parsePrerecorded(body)).toEqual([{ text: 'So,', startMs: 500, endMs: 720 }]);
    expect(parsePrerecorded({})).toEqual([]);
  });

  it('sends the audio straight to Deepgram with a short-lived token, never through the server', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: 'jwt-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: { channels: [{ alternatives: [{ words: [{ word: 'hi', start: 0, end: 0.2 }] }] }] } }) });
    const wav = encodeWav16(new Float32Array(16));
    const words = await transcribeRecording(wav, [], fetchImpl as unknown as typeof fetch);
    expect(words).toEqual([{ text: 'hi', startMs: 0, endMs: 200 }]);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/stt-token');
    const [url, init] = fetchImpl.mock.calls[1];
    expect(String(url).startsWith('https://api.deepgram.com/v1/listen?')).toBe(true);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-1', 'Content-Type': 'audio/wav' });
    expect(init.body).toBe(wav);
  });

  it('explains a refused token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'You’ve reached today’s practice limit.' }) });
    await expect(transcribeRecording(encodeWav16(new Float32Array(4)), [], fetchImpl as unknown as typeof fetch)).rejects.toThrow('today’s practice limit');
  });
});

describe('upload: the same measurements as a live session', () => {
  const pcm = synthesise(label);
  const words = label.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
  const a = analyseRecording(pcm.samples, pcm.sampleRate, words, 'interview');

  it('counts fillers, finds the labelled pauses and draws every word with pitch', () => {
    expect(a.metrics.fillerCount).toBe(3);
    expect(a.segments.filter((s) => s.kind === 'filler').map((s) => s.text)).toEqual(['Um,', 'you', 'know,', 'like']);
    expect(a.segments.every((s) => s.pitch?.length === 5)).toBe(true);
    for (const p of label.pauses) {
      expect(a.pauses.some((q) => q.startMs < p.endMs && (q.endMs ?? 0) > p.startMs)).toBe(true);
    }
    expect(a.metrics.durationMs).toBeCloseTo(a.durationMs, -1);
    expect(a.transcript.map((l) => l.text).join(' ')).toContain('Next I want to measure trust.');
  });

  it('measures pace once a second while speaking', () => {
    expect(a.trace).toHaveLength(Math.floor(a.durationMs / 1000));
    const silent = analyseRecording(new Float32Array(16_000 * 4), 16_000, [{ text: 'Hi.', startMs: 0, endMs: 300 }], 'interview');
    expect(silent.trace.slice(1)).toEqual([null, null, null]);
    expect(a.trace.filter((v): v is number => v !== null).every((v) => v > 0)).toBe(true);
    expect(a.metrics.avgWpm).toBeGreaterThan(0);
  });
});
