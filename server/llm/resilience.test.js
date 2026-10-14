// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generateTeardown, providerChain, buildProviders, describeProvider, TeardownError } from './index.js';
import { backoffMs, describeError, errorStatus, isRetryable, retryAfterMs, withRetry } from './retry.js';
import { ProviderRefusalError } from './providers/anthropic.js';

const TRANSCRIPT = [{ speaker: 'user', text: 'So my research is about teaching AI systems to say no.', startMs: 0 }];
const VALID = {
  verdict: 'Clear story.',
  summary: 'One. Two. Three.',
  scores: { structure: 80, delivery: 70, clarity: 75 },
  storyMap: { sections: [] },
  notes: [{ kind: 'keep', title: 't', body: 'b', quote: 'say no', startMs: 0 }],
  audienceFollowUp: { question: 'q', reason: 'r' },
  drills: [{ title: 'd', instructions: 'i', minutes: 3 }],
};

const BUSY_BODY = '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}';
/** Gemini-style error: status on the error, JSON body in the message. */
const busy = () => Object.assign(new Error(BUSY_BODY), { status: 503 });

function provider(name, script) {
  const queue = [...script];
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next) };
    }),
  };
}

const noSleep = { sleep: vi.fn(async () => {}), random: () => 0 };

describe('retry with backoff and fallback', () => {
  it('succeeds after a provider returns 503 twice', async () => {
    const gemini = provider('gemini', [busy(), busy(), VALID]);
    const sleep = vi.fn(async () => {});
    const logs = [];
    const result = await generateTeardown(TRANSCRIPT, {}, { providers: [gemini], retry: { sleep, random: () => 0 }, log: (m) => logs.push(m) });
    expect(result).toMatchObject({ provider: 'gemini', attempts: 3, tried: ['gemini'] });
    expect(gemini.complete).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 3000]);
    expect(logs[0]).toBe(`[field-notes] gemini attempt 1 failed (503 ${BUSY_BODY}); retrying in 1.0 s.`);
    expect(logs).toHaveLength(3);
  });

  it('falls back to the next provider when one keeps failing', async () => {
    const gemini = provider('gemini', [busy()]);
    const anthropic = provider('anthropic', [VALID]);
    const logs = [];
    const result = await generateTeardown(TRANSCRIPT, {}, { providers: [gemini, anthropic], retry: noSleep, log: (m) => logs.push(m) });
    expect(result).toMatchObject({ provider: 'anthropic', model: 'anthropic-model', tried: ['gemini', 'anthropic'] });
    expect(gemini.complete).toHaveBeenCalledTimes(3);
    expect(anthropic.complete).toHaveBeenCalledTimes(1);
    expect(logs).toContain(`[field-notes] gemini failed (503 ${BUSY_BODY}); falling back to anthropic.`);
  });

  it('falls back on a non-retryable request error without retrying it', async () => {
    const gemini = provider('gemini', [Object.assign(new Error('API key not valid'), { status: 400 })]);
    const openrouter = provider('openrouter', [VALID]);
    const result = await generateTeardown(TRANSCRIPT, {}, { providers: [gemini, openrouter], retry: noSleep, log: () => {} });
    expect(result.provider).toBe('openrouter');
    expect(gemini.complete).toHaveBeenCalledTimes(1);
  });

  it('reports every failure when all providers fail', async () => {
    const err = await generateTeardown(TRANSCRIPT, {}, { providers: [provider('gemini', [busy()]), provider('openrouter', [busy()])], retry: noSleep, log: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/^Every field notes provider failed \(gemini: 503 .*; openrouter: 503 .*\)\.$/);
  });

  it('says clearly when no provider is configured', async () => {
    const err = await generateTeardown(TRANSCRIPT, {}, { env: { LLM_FALLBACKS: 'anthropic,openrouter' }, log: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TeardownError);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/^No field notes provider is configured\. ANTHROPIC_API_KEY is not set.*OPENROUTER_API_KEY is not set/);
  });

  it('keeps refusals and unusable replies as they were: no fallback', async () => {
    const refusing = provider('anthropic', [new ProviderRefusalError('Claude declined to write these notes.')]);
    const backup = provider('gemini', [VALID]);
    const refused = await generateTeardown(TRANSCRIPT, {}, { providers: [refusing, backup], retry: noSleep, log: () => {} }).catch((e) => e);
    expect(refused.status).toBe(422);
    expect(backup.complete).not.toHaveBeenCalled();

    const junk = provider('gemini', ['not json']);
    const unusable = await generateTeardown(TRANSCRIPT, {}, { providers: [junk, backup], retry: noSleep, log: () => {} }).catch((e) => e);
    expect(unusable.message).toMatch(/gemini returned unusable field notes twice/);
    expect(backup.complete).not.toHaveBeenCalled();
  });
});

describe('provider chain', () => {
  it('puts LLM_PROVIDER first, then LLM_FALLBACKS, without repeats', () => {
    expect(providerChain({ LLM_PROVIDER: 'gemini', LLM_FALLBACKS: 'gemini, Anthropic ,openrouter' })).toEqual(['gemini', 'anthropic', 'openrouter']);
    expect(providerChain({ LLM_FALLBACKS: 'openrouter' })).toEqual(['openrouter']);
    expect(providerChain({})).toEqual(['gemini']);
  });

  it('skips providers whose key is missing', () => {
    const { providers, skipped } = buildProviders({ LLM_FALLBACKS: 'gemini,anthropic,openrouter', ANTHROPIC_API_KEY: 'k' });
    expect(providers.map((p) => p.name)).toEqual(['anthropic']);
    expect(skipped.map((s) => s.name)).toEqual(['gemini', 'openrouter']);
  });

  it('describes the chain for /api/health', () => {
    expect(describeProvider({ LLM_FALLBACKS: 'gemini,anthropic', ANTHROPIC_API_KEY: 'k' })).toMatchObject({
      name: 'anthropic',
      configured: true,
      chain: [
        { name: 'gemini', configured: false },
        { name: 'anthropic', configured: true },
      ],
    });
  });
});

describe('retry helpers', () => {
  it('knows which errors are worth retrying', () => {
    for (const status of [429, 500, 502, 503, 504]) expect(isRetryable({ status })).toBe(true);
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryable({ status })).toBe(false);
    expect(isRetryable(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(true);
    expect(errorStatus(new Error('{"error":{"code":503}}'))).toBe(503);
  });

  it('honours Retry-After in seconds or as a date, capped', () => {
    expect(retryAfterMs({ headers: { 'retry-after': '2' } })).toBe(2000);
    expect(retryAfterMs({ headers: new Headers({ 'retry-after': '4' }) })).toBe(4000);
    expect(retryAfterMs({ headers: { 'retry-after': new Date(10_000).toUTCString() } }, 5_000)).toBe(5000);
    expect(retryAfterMs({ headers: { 'retry-after': '600' } })).toBe(20_000);
    expect(retryAfterMs({})).toBeUndefined();
  });

  it('uses Retry-After over the backoff schedule', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    await withRetry(
      async () => {
        if (n++ === 0) throw Object.assign(new Error('slow down'), { status: 429, headers: { 'retry-after': '2' } });
        return 'ok';
      },
      { sleep }
    );
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('backs off about 1, 3 and 7 seconds with up to 20% jitter', () => {
    expect([0, 1, 2].map((i) => backoffMs(i, undefined, () => 0))).toEqual([1000, 3000, 7000]);
    expect(backoffMs(0, undefined, () => 1)).toBe(1200);
  });

  it('never puts a key in a log line', () => {
    expect(describeError(new Error('GET https://x/v1?key=AIzaSECRET&alt=json failed'))).toBe('GET https://x/v1?key=[redacted]&alt=json failed');
  });
});
