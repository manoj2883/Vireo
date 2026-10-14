// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generateTeardown, getProvider, describeProvider, extractJson, validateReply, TeardownError } from './index.js';
import { createOpenRouterProvider, parseModelList, OPENROUTER_BASE_URL } from './providers/openrouter.js';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic.js';
import { buildFieldNotesPrompt, FIELD_NOTES_SYSTEM } from './prompt.js';

const TRANSCRIPT = [
  { speaker: 'user', text: 'So my research is about teaching AI systems to say no', startMs: 400 },
  { speaker: 'user', text: 'when they do not have the evidence.', startMs: 4300 },
  { speaker: 'coach', text: 'Slow down.', startMs: 6000 },
];

const VALID = {
  verdict: 'Clear story. Rushed ending.',
  oneFix: { instruction: 'Pause before your result.', why: 'It gives the result room to land.' },
  mainPointMs: 400,
  previousFix: null,
  summary: 'You opened with the point. The middle wandered. The result came too fast.',
  scores: { structure: 78, delivery: 64, clarity: 81 },
  storyMap: { sections: [{ title: 'The point', startMs: 400, endMs: 4200, outlinePoint: null, outlineIndex: null, status: null }] },
  notes: [
    { kind: 'keep', title: 'You led with the point.', body: 'Do it again.', quote: 'teaching AI systems to say no', cameraEventId: null, startMs: 400 },
    { kind: 'fix', title: 'You rushed your result.', body: 'Pause first.', quote: 'when they do not have the evidence', cameraEventId: null, startMs: 4300 },
  ],
  audienceFollowUp: { question: 'How do you measure a good refusal?', reason: 'It is the claim they will doubt.' },
  drills: [{ title: 'The full stop', instructions: 'State the result, breathe, explain.', minutes: 4 }],
};

function fakeProvider(replies) {
  const calls = [];
  return {
    name: 'fake',
    model: 'fake-1',
    calls,
    complete: vi.fn(async (req) => {
      calls.push(structuredClone({ system: req.system, messages: req.messages }));
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'string' ? { text: next } : next;
    }),
  };
}

const quiet = { log: () => {} };

describe('generateTeardown', () => {
  it('returns validated notes on the first valid reply', async () => {
    const provider = fakeProvider([JSON.stringify(VALID)]);
    const result = await generateTeardown(TRANSCRIPT, { prompt: 'Tell me about your research.' }, { provider, ...quiet });
    expect(result).toMatchObject({ provider: 'fake', model: 'fake-1', attempts: 1 });
    expect(result.notes.verdict).toBe('Clear story. Rushed ending.');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    const provider = fakeProvider(['```json\n' + JSON.stringify(VALID) + '\n```']);
    await expect(generateTeardown(TRANSCRIPT, {}, { provider, ...quiet })).resolves.toMatchObject({ attempts: 1 });
  });

  it('retries once after invalid JSON, explaining the problem', async () => {
    const provider = fakeProvider(['{"verdict": "oops"', JSON.stringify(VALID)]);
    const result = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet });
    expect(result.attempts).toBe(2);
    const retry = provider.calls[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"verdict": "oops"' });
    expect(retry[2].content).toMatch(/not valid JSON/);
  });

  it('retries once after a schema mismatch, naming the bad fields', async () => {
    const bad = { ...VALID, notes: [{ ...VALID.notes[0], kind: 'praise' }] };
    const provider = fakeProvider([JSON.stringify(bad), JSON.stringify(VALID)]);
    const result = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet });
    expect(result.attempts).toBe(2);
    expect(provider.calls[1].messages[2].content).toMatch(/notes\.0\.kind/);
  });

  it('fails clearly after two unusable replies', async () => {
    const provider = fakeProvider(['not json', '{"verdict": 3}']);
    const err = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.message).toMatch(/fake returned unusable field notes twice/);
    expect(err.message).toMatch(/did not match the schema/);
    expect(err.attempts).toBe(2);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('treats a provider-flagged invalid reply like invalid JSON', async () => {
    const provider = fakeProvider([{ text: '', invalid: 'the reply was cut off at the token limit' }, JSON.stringify(VALID)]);
    const result = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet });
    expect(result.attempts).toBe(2);
    expect(provider.calls[1].messages[2].content).toMatch(/cut off/);
  });

  it('does not retry a failed request; it reports which provider failed', async () => {
    const provider = fakeProvider([new Error('429 rate limited')]);
    const err = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.message).toBe('fake request failed: 429 rate limited');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('reports a missing key as a configuration error', async () => {
    const err = await generateTeardown(TRANSCRIPT, {}, { env: { LLM_PROVIDER: 'anthropic' }, ...quiet }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/ANTHROPIC_API_KEY is not set/);
  });
});

describe('prompt', () => {
  it('gives every line its millisecond start and speaker, and the outline when chosen', () => {
    const prompt = buildFieldNotesPrompt(TRANSCRIPT, {
      prompt: 'Tell me about your research.',
      story: { title: 'The judge that learned to say no', keyPoints: ['The problem', 'The result'] },
      durationMs: 9000,
    });
    expect(prompt).toContain('[00:04 | 4300ms] You: when they do not have the evidence.');
    expect(prompt).toContain('[00:06 | 6000ms] Coach: Slow down.');
    expect(prompt).toContain('1. The problem');
    expect(prompt).toContain('What they were answering: Tell me about your research.');
  });

  it('lists camera events by id, or says the camera was not analysed', () => {
    const prompt = buildFieldNotesPrompt(TRANSCRIPT, {
      camera: { summary: { eyeContactPct: 70 }, events: [{ id: 'cam-1', kind: 'look-away', startMs: 1000, endMs: 4000, value: 30 }] },
    });
    expect(prompt).toContain('cam-1: look-away from 1000 to 4000 ms (value 30)');
    expect(prompt).toContain('"eyeContactPct":70');
    expect(buildFieldNotesPrompt(TRANSCRIPT)).toContain('Camera: not analysed. Do not write camera notes.');
  });

  it('says when no outline was chosen', () => {
    expect(buildFieldNotesPrompt(TRANSCRIPT)).toContain('Story Bank outline: none chosen.');
  });
});

describe('validation helpers', () => {
  it('extracts the JSON object from surrounding prose', () => {
    expect(extractJson('Here you go:\n{"a": {"b": 1}}\nThanks')).toBe('{"a": {"b": 1}}');
  });

  it('accepts outlineIndex for each story section, numbered from 1', () => {
    const ok = { title: 'Thresholds', startMs: 0, endMs: 900, outlinePoint: 'Similarity thresholds failed', outlineIndex: 1, status: 'hit' };
    expect(validateReply(JSON.stringify({ ...VALID, storyMap: { sections: [ok] } })).data).toBeTruthy();
    expect(validateReply(JSON.stringify({ ...VALID, storyMap: { sections: [{ ...ok, outlineIndex: 0 }] } })).problem).toMatch(/outlineIndex/);
  });

  it('tells the model to mark ideas covered in different words as hit, by number', () => {
    const prompt = buildFieldNotesPrompt(TRANSCRIPT, { story: { title: 't', keyPoints: ['a', 'b'] } });
    expect(FIELD_NOTES_SYSTEM).toMatch(/outlineIndex to that key point's number/);
    expect(FIELD_NOTES_SYSTEM).toMatch(/even if the speaker used different words/);
    expect(prompt).toContain('  1. a\n  2. b');
  });

  it('rejects out-of-range scores', () => {
    expect(validateReply(JSON.stringify({ ...VALID, scores: { ...VALID.scores, delivery: 140 } })).problem).toMatch(/scores\.delivery/);
  });

  it('allows null times for missed outline points', () => {
    const missed = { title: 'The result', startMs: null, endMs: null, outlinePoint: 'The result', outlineIndex: null, status: 'missed' };
    expect(validateReply(JSON.stringify({ ...VALID, storyMap: { sections: [missed] } })).data).toBeTruthy();
  });
});

describe('provider selection', () => {
  it('defaults to gemini', () => {
    expect(getProvider({ GEMINI_API_KEY: 'k' }).name).toBe('gemini');
  });

  it('builds each provider from its environment', () => {
    expect(getProvider({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_MODELS: 'a/b:free, c/d' }).model).toBe('a/b:free');
    expect(getProvider({ LLM_PROVIDER: 'Anthropic', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5');
    expect(getProvider({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).model).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  it('rejects an unknown provider by name', () => {
    expect(() => getProvider({ LLM_PROVIDER: 'mystery' })).toThrow('Unknown LLM_PROVIDER "mystery". Use one of: gemini, openrouter, anthropic.');
  });

  it('describes configuration without throwing', () => {
    expect(describeProvider({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' })).toMatchObject({
      name: 'openrouter',
      configured: false,
      problem: expect.stringMatching(/OPENROUTER_MODELS is empty/),
    });
  });
});

describe('openrouter provider', () => {
  it('parses the model list from the environment, never hardcoding IDs', () => {
    expect(parseModelList(' a/b:free,c/d  e/f ')).toEqual(['a/b:free', 'c/d', 'e/f']);
    expect(parseModelList(undefined)).toEqual([]);
  });

  it('sends the whole list as the models fallback array with JSON output', async () => {
    const create = vi.fn().mockResolvedValue({ model: 'c/d', choices: [{ message: { content: '{}' } }] });
    const provider = createOpenRouterProvider({ models: 'a/b:free,c/d', client: { chat: { completions: { create } } } });
    const reply = await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(create).toHaveBeenCalledWith({
      model: 'a/b:free',
      models: ['a/b:free', 'c/d'],
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    });
    expect(reply).toEqual({ text: '{}', model: 'c/d' });
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });
});

describe('anthropic provider', () => {
  const ok = (overrides = {}) => ({
    stop_reason: 'end_turn',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(VALID) }],
    ...overrides,
  });

  it('asks for structured output, high effort and refusal fallbacks by default', async () => {
    const parse = vi.fn().mockResolvedValue(ok());
    const provider = createAnthropicProvider({ client: { beta: { messages: { parse } } } });
    const reply = await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    const req = parse.mock.calls[0][0];
    expect(req).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'sys',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high' },
    });
    expect(req.output_config.format).toBeTruthy();
    expect(reply.text).toBe(JSON.stringify(VALID));
  });

  it('leaves effort alone for other models and can turn fallbacks off', async () => {
    const parse = vi.fn().mockResolvedValue(ok());
    const provider = createAnthropicProvider({ model: 'claude-haiku-4-5', fallbacks: false, client: { beta: { messages: { parse } } } });
    await provider.complete({ system: 's', messages: [] });
    const req = parse.mock.calls[0][0];
    expect(req.output_config.effort).toBeUndefined();
    expect(req.betas).toBeUndefined();
    expect(req.fallbacks).toBeUndefined();
  });

  it('turns a refusal into a clear, non-retried error', async () => {
    const parse = vi.fn().mockResolvedValue(ok({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }));
    const provider = createAnthropicProvider({ client: { beta: { messages: { parse } } } });
    const err = await generateTeardown(TRANSCRIPT, {}, { provider, ...quiet }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/declined.*cyber/);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('flags a truncated reply as invalid so it is retried', async () => {
    const parse = vi.fn().mockResolvedValue(ok({ stop_reason: 'max_tokens' }));
    const provider = createAnthropicProvider({ client: { beta: { messages: { parse } } } });
    expect(await provider.complete({ system: 's', messages: [] })).toEqual({ text: '', invalid: expect.stringMatching(/token limit/) });
  });
});

describe('situation criteria', () => {
  it('passes the situation and what a good answer looks like', () => {
    const prompt = buildFieldNotesPrompt(TRANSCRIPT, { situation: { label: '60-second pitch', criteria: ['States the problem, the solution and a clear ask.'], timeLimitMs: 60_000 } });
    expect(prompt).toContain('Situation: 60-second pitch. Target length: under 60 seconds. A good answer here:\n  - States the problem, the solution and a clear ask.');
  });
});
