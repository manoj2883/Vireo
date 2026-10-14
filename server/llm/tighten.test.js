// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { stem, unsupportedWords, validateTightened, buildTightenPrompt } from './tighten.js';
import { generateTightened } from './index.js';

const SAID =
  'Um so my research is about teaching AI systems to say no when they do not have the evidence and um so basically the answers it refused were the right ones to refuse';

describe('the tightened answer evidence check', () => {
  it('accepts a rewrite that only cuts, reorders and adds linking words', () => {
    const script = 'The answers it refused were the right ones. / My research teaches AI systems to say no / when they do not have the evidence.';
    expect(unsupportedWords(script, SAID)).toEqual([]);
  });

  it('rejects new content words, names and numbers', () => {
    expect(unsupportedWords('My research cut errors by 40 percent at Stanford.', SAID)).toEqual(['cut', 'errors', '40', 'percent', 'stanford']);
  });

  it('treats simple inflections as the same word', () => {
    expect(stem('refused')).toBe(stem('refuse'));
    expect(stem('answers')).toBe(stem('answer'));
    expect(unsupportedWords('It refuses answers.', SAID)).toEqual([]);
  });

  it('ignores the pause marks', () => {
    expect(unsupportedWords('Say no / when they do not have the evidence', SAID)).toEqual([]);
  });

  it('validates shape and evidence together', () => {
    expect(validateTightened(JSON.stringify({ script: 'Say no.', mainPoint: 'Say no.' }), SAID).data).toEqual({ script: 'Say no.', mainPoint: 'Say no.' });
    expect(validateTightened(JSON.stringify({ script: 'Say no to 40 vendors.', mainPoint: 'x' }), SAID).problem).toMatch(/never said: 40, vendors/);
    expect(validateTightened('{"script": 3}', SAID).problem).toMatch(/schema/);
  });
});

describe('generateTightened', () => {
  const lines = [{ speaker: 'user', text: SAID, startMs: 0 }];
  const fake = (replies) => ({ name: 'fake', model: 'm', complete: vi.fn(async () => ({ text: JSON.stringify(replies.shift()) })) });

  it('rejects a rewrite with invented claims and retries once with the reason', async () => {
    const provider = fake([
      { script: 'We cut refusal errors by 40 percent.', mainPoint: 'x' },
      { script: 'The answers it refused were the right ones. / My research teaches AI systems to say no.', mainPoint: 'The answers it refused were the right ones.' },
    ]);
    const result = await generateTightened(lines, { oneFix: 'Pause before the result.' }, { providers: [provider], log: () => {} });
    expect(result.script).toMatch(/^The answers it refused/);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    const retry = provider.complete.mock.calls[1][0].messages;
    expect(retry[2].content).toMatch(/never said: cut, refusal, errors, 40, percent/);
  });

  it('fails clearly when the rewrite keeps inventing words', async () => {
    const bad = { script: 'We doubled revenue.', mainPoint: 'x' };
    const err = await generateTightened(lines, {}, { providers: [fake([bad, bad])], log: () => {} }).catch((e) => e);
    expect(err.message).toMatch(/fake returned unusable tightened answers twice/);
  });

  it('builds the prompt from what was said and the one fix', () => {
    const prompt = buildTightenPrompt([...lines, { speaker: 'coach', text: 'Slow down.', startMs: 1 }], { prompt: 'Tell me about your research.', oneFix: 'Pause first.' });
    expect(prompt).toContain('One fix for the next take: Pause first.');
    expect(prompt).not.toContain('Slow down.');
  });
});
