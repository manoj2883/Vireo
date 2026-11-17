// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildRoleplayPrompt, MAX_QUESTION_WORDS, QA_TURNS, ROLEPLAY_SYSTEM, sanitizeRoleplay, validateRoleplay, verifyAnswers } from './roleplay.js';
import { generateRoleplayTurn } from './index.js';
import { synthesizeSpeech } from '../tts.js';
import { createLimiter } from '../limits.js';

const reply = (o) => JSON.stringify({ question: 'What did that cost you?', basedOn: null, ...o });
const base = sanitizeRoleplay({ role: 'investor', prompt: 'Pitch your project.', maxTurns: 4, turns: [{ question: 'What do you do?', answer: 'We cut hospital wait times by forty percent in six months.' }] });

describe('roleplay partner', () => {
  it('is tough but fair, one question at a time, and never mocks the speaker', () => {
    expect(ROLEPLAY_SYSTEM).toMatch(/exactly one question per turn/);
    expect(ROLEPLAY_SYSTEM).toMatch(/Never insult the speaker, never mock their ability or their accent/);
    expect(ROLEPLAY_SYSTEM).toMatch(/never label their emotions/);
  });

  it('cleans input: known roles, 3 to 6 turns, Q&A is always 3 with a tough audience member', () => {
    expect(sanitizeRoleplay({ role: 'hacker', maxTurns: 99 })).toMatchObject({ mode: 'roleplay', role: 'interviewer', maxTurns: 6 });
    expect(sanitizeRoleplay({ maxTurns: 1 }).maxTurns).toBe(3);
    expect(sanitizeRoleplay({ mode: 'qa', maxTurns: 6, source: 'x' })).toMatchObject({ mode: 'qa', role: 'tough_audience', maxTurns: QA_TURNS });
    expect(sanitizeRoleplay({ mode: 'roleplay', source: 'ignored' }).source).toBe('');
  });

  it('puts the role, context and conversation so far in the prompt', () => {
    const p = buildRoleplayPrompt({ ...base, speakingContext: { stakes: 'critical' } });
    expect(p).toContain('You are an investor hearing their pitch.');
    expect(p).toContain('stakes: critical');
    expect(p).toContain('This is question 2 of 4.');
    expect(p).toContain('A1: We cut hospital wait times');
  });

  it('lets the opening question stand on its own', () => {
    const r = sanitizeRoleplay({ role: 'interviewer', turns: [] });
    expect(validateRoleplay(reply({ question: 'Tell me about yourself.' }), r).data).toEqual({ question: 'Tell me about yourself.', basedOn: null });
  });

  it('requires a follow-up to build on the speaker’s exact words', () => {
    expect(validateRoleplay(reply({ basedOn: 'forty percent in six months' }), base).data).toMatchObject({ basedOn: 'forty percent in six months' });
    expect(validateRoleplay(reply({ basedOn: 'your billion dollar valuation' }), base).problem).toMatch(/exact words the speaker said/);
    expect(validateRoleplay(reply({ basedOn: null }), base).problem).toMatch(/exact words/);
  });

  it('draws Q&A questions from the talk itself', () => {
    const qa = sanitizeRoleplay({ mode: 'qa', source: 'Our model refuses unsupported claims. It refused 31 percent of answers last spring.', turns: [] });
    expect(validateRoleplay(reply({ basedOn: 'refused 31 percent of answers' }), qa).data).toBeTruthy();
    expect(validateRoleplay(reply({ basedOn: 'it never makes mistakes' }), qa).problem).toMatch(/talk or answers/);
  });

  it('keeps questions short enough to say aloud', () => {
    const long = Array.from({ length: MAX_QUESTION_WORDS + 1 }, () => 'why').join(' ');
    expect(validateRoleplay(reply({ question: long, basedOn: 'forty percent' }), base).problem).toMatch(/keep it under/);
  });

  it('runs through the provider chain, repairing an ungrounded question once', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: reply({ basedOn: 'made up' }) })
      .mockResolvedValueOnce({ text: reply({ basedOn: 'forty percent' }) });
    const r = await generateRoleplayTurn(base, { providers: [{ name: 'fake', model: 'f', complete }], log: () => {} });
    expect(r).toMatchObject({ basedOn: 'forty percent', provider: 'fake' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('keeps only answer notes whose quote is the speaker’s, one per question', () => {
    const lines = [{ speaker: 'user', text: 'We cut wait times by forty percent.', startMs: 0 }, { speaker: 'coach', text: 'How did you measure it?', startMs: 5000 }];
    const { answers, dropped } = verifyAnswers(
      [
        { questionIndex: 2, addressed: 'partly', note: 'n', quote: 'invented quote' },
        { questionIndex: 1, addressed: 'fully', note: 'n', quote: 'forty percent' },
        { questionIndex: 1, addressed: 'not', note: 'dup', quote: 'forty percent' },
        { questionIndex: 3, addressed: 'not', note: 'coach', quote: 'How did you measure it' },
      ],
      lines
    );
    expect(answers.map((a) => a.questionIndex)).toEqual([1]);
    expect(dropped).toBe(3);
  });
});

describe('partner voice', () => {
  it('returns base64 audio from Deepgram, or null so the browser can speak instead', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    expect(await synthesizeSpeech('Why?', { apiKey: 'k', fetchImpl: ok })).toBe('AQID');
    expect(ok.mock.calls[0][0]).toContain('model=aura-2-thalia-en');
    expect(await synthesizeSpeech('Why?', { apiKey: '', fetchImpl: ok })).toBeNull();
    const fail = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await synthesizeSpeech('Why?', { apiKey: 'k', fetchImpl: fail, log: { warn: () => {} } })).toBeNull();
  });
});

describe('roleplay limits', () => {
  it('counts each turn against the site’s daily cap and the visitor’s write limit', async () => {
    const limiter = createLimiter({ env: { DAILY_ROLEPLAY_TURN_CAP: '2', WRITES_PER_VISITOR_PER_HOUR: '40' }, redis: null });
    const v = { id: 'a', ip: '1' };
    expect((await limiter.check('roleplay', v)).ok).toBe(true);
    expect((await limiter.check('roleplay', { id: 'b', ip: '2' })).ok).toBe(true);
    expect(await limiter.check('roleplay', { id: 'c', ip: '3' })).toMatchObject({ ok: false, rule: 'roleplay-site-day' });
  });

  it('shares the write counter with field notes', async () => {
    const limiter = createLimiter({ env: { WRITES_PER_VISITOR_PER_HOUR: '2' }, redis: null });
    const v = { id: 'a', ip: '1' };
    await limiter.check('write', v);
    await limiter.check('roleplay', v);
    expect(await limiter.check('roleplay', v)).toMatchObject({ ok: false, rule: 'writes-hour' });
  });

  it('turns partners off with a cap of 0', async () => {
    const limiter = createLimiter({ env: { DAILY_ROLEPLAY_TURN_CAP: '0' }, redis: null });
    expect((await limiter.check('roleplay', { id: 'a', ip: '1' })).ok).toBe(false);
  });
});
