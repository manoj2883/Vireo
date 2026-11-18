import { describe, expect, it, vi } from 'vitest';
import { answerSegments, answerText, buildConversation, type PartnerTurn } from './conversation';
import { estimatedSpeechMs, requestNextQuestion } from './partner';
import type { WordSegment } from '@/components/sonogram/types';

const w = (text: string, startMs: number): WordSegment => ({ text, startMs, endMs: startMs + 300, kind: text === 'um' ? 'filler' : 'speech' });

// Partner asks at 0 s (speaking until 3 s), you answer 3–10 s; asks at 11 s, you answer 14–20 s.
const turns: PartnerTurn[] = [
  { question: 'Tell me about yourself.', basedOn: null, askedAtMs: 0, answerStartMs: 3000, answerEndMs: 10_000 },
  { question: 'Why forty percent?', basedOn: 'forty percent', askedAtMs: 11_000, answerStartMs: 14_000, answerEndMs: 20_000 },
];
// The partner's own voice leaked into the mic at 1 s and 12 s.
const segments = [w('tell', 1000), w('I', 3500), w('cut', 4000), w('waits', 4500), w('um', 5000), w('forty', 5500), w('percent.', 6000), w('why', 12_000), w('Because', 14_500), w('we', 15_000), w('measured.', 15_500)];

describe('roleplay conversation', () => {
  it('keeps only words spoken while answering, so the partner’s voice never counts as yours', () => {
    expect(answerSegments(segments, turns).map((s) => s.text)).toEqual(['I', 'cut', 'waits', 'um', 'forty', 'percent.', 'Because', 'we', 'measured.']);
    expect(answerText(segments, turns[1])).toBe('Because we measured.');
  });

  it('builds the transcript with the partner’s questions as coach lines, in time order', () => {
    const c = buildConversation({ segments, pauses: [{ startMs: 7000, endMs: 9000 }, { startMs: 10_500, endMs: 13_500 }], trace: Array.from({ length: 21 }, () => 140) }, turns, 'interview');
    expect(c.transcript.map((l) => [l.speaker, l.startMs])).toEqual([
      ['coach', 0],
      ['user', 3500],
      ['coach', 11_000],
      ['user', 14_500],
    ]);
    expect(c.transcript[2].text).toBe('Why forty percent?');
    // Only the pause inside an answer counts.
    expect(c.pauses).toEqual([{ startMs: 7000, endMs: 9000 }]);
  });

  it('measures over answering time only', () => {
    const c = buildConversation({ segments, pauses: [], trace: Array.from({ length: 21 }, () => 140) }, turns, 'interview');
    expect(c.metrics.durationMs).toBe(13_000);
    expect(c.metrics.fillerCount).toBe(1);
    expect(c.metrics.fillersPerMin).toBeCloseTo(1 / (13_000 / 60_000), 1);
    expect(c.metrics.wordCount).toBe(9);
  });
});

describe('partner', () => {
  it('estimates how long a question takes to say', () => {
    expect(estimatedSpeechMs('one two three four five')).toBe(2800);
  });

  it('passes on the server’s reason when the partner can’t reply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Vireo has reached today’s limit for practice partners.' }) });
    await expect(requestNextQuestion({ mode: 'roleplay', role: 'investor', maxTurns: 3, prompt: 'p', turns: [] }, fetchImpl as unknown as typeof fetch)).rejects.toThrow('limit for practice partners');
  });
});
