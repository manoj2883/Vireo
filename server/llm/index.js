import { FieldNotesSchema } from './schema.js';
import { FIELD_NOTES_SYSTEM, buildFieldNotesPrompt, buildRepairMessage } from './prompt.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createOpenRouterProvider } from './providers/openrouter.js';
import { createAnthropicProvider, ProviderRefusalError } from './providers/anthropic.js';
import { describeError, withRetry } from './retry.js';
import { extractJson } from './json.js';
import { TIGHTEN_SYSTEM, TightenSchema, buildTightenPrompt, validateTightened } from './tighten.js';

export const PROVIDERS = ['gemini', 'openrouter', 'anthropic'];

export class TeardownError extends Error {
  /** @param {string} message @param {{ provider?: string, attempts?: number, cause?: unknown, status?: number }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = 'TeardownError';
    this.provider = info.provider;
    this.attempts = info.attempts;
    this.status = info.status ?? 502;
    if (info.cause) this.cause = info.cause;
  }
}

/** Build one provider by name from environment variables. Throws if its key or settings are missing. */
export function createProvider(name, env = process.env) {
  switch (name) {
    case 'gemini':
      return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_TEARDOWN_MODEL || undefined });
    case 'openrouter':
      return createOpenRouterProvider({ apiKey: env.OPENROUTER_API_KEY, models: env.OPENROUTER_MODELS });
    case 'anthropic':
      return createAnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL || undefined,
        effort: env.ANTHROPIC_EFFORT || undefined,
        fallbacks: (env.ANTHROPIC_FALLBACKS || 'on').toLowerCase() !== 'off',
      });
    default:
      throw new Error(`Unknown provider "${name}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
}

/** Builds the provider named by LLM_PROVIDER (default gemini). */
export function getProvider(env = process.env) {
  const name = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  if (!PROVIDERS.includes(name)) throw new Error(`Unknown LLM_PROVIDER "${name}". Use one of: ${PROVIDERS.join(', ')}.`);
  return createProvider(name, env);
}

/**
 * Provider names in the order to try: LLM_PROVIDER first (if set), then LLM_FALLBACKS
 * (comma separated), without repeats. Defaults to gemini alone.
 */
export function providerChain(env = process.env) {
  const list = [env.LLM_PROVIDER, ...String(env.LLM_FALLBACKS ?? '').split(',')]
    .map((n) => String(n ?? '').trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  return unique.length ? unique : ['gemini'];
}

/** Build every provider in the chain, skipping those without a key or with an unknown name. */
export function buildProviders(env = process.env) {
  const providers = [];
  const skipped = [];
  for (const name of providerChain(env)) {
    try {
      providers.push(createProvider(name, env));
    } catch (err) {
      skipped.push({ name, problem: err.message });
    }
  }
  return { providers, skipped };
}

/** The provider chain and whether each is configured, without throwing. For /api/health. */
export function describeProvider(env = process.env) {
  const { providers, skipped } = buildProviders(env);
  const chain = providerChain(env).map((name) => {
    const p = providers.find((x) => x.name === name);
    return p ? { name, model: p.model, configured: true } : { name, configured: false, problem: skipped.find((s) => s.name === name)?.problem };
  });
  const first = chain.find((c) => c.configured) ?? chain[0];
  return { ...first, configured: providers.length > 0, chain };
}

export { extractJson };

/** Parse and validate one reply. Returns { data } or { problem } describing what was wrong. */
export function validateReply(text) {
  let json;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return { problem: `it was not valid JSON (${err.message}).` };
  }
  const result = FieldNotesSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { problem: `it did not match the schema (${issues}).` };
  }
  return { data: result.data };
}

class UnusableReplyError extends Error {}

/**
 * Get one structured reply from one provider: transient failures are retried with backoff; an
 * unusable reply (bad JSON, wrong shape, failed evidence check) is repaired once, then fails.
 */
async function fromProvider(provider, task, { log, retry }) {
  const messages = [{ role: 'user', content: task.user }];
  let lastProblem = '';
  let calls = 0;
  for (let round = 1; round <= 2; round++) {
    const reply = await withRetry(
      () => {
        calls++;
        return provider.complete({ system: task.system, messages, schema: task.schema });
      },
      {
        ...retry,
        onRetry: ({ attempt, waitMs, err }) => log(`[${task.label}] ${provider.name} attempt ${attempt} failed (${describeError(err)}); retrying in ${(waitMs / 1000).toFixed(1)} s.`),
      }
    );
    const { data, problem } = reply.invalid ? { problem: reply.invalid } : task.validate(reply.text);
    if (data) return { data, model: reply.model ?? provider.model, attempts: calls };
    lastProblem = problem;
    log(`[${task.label}] ${provider.name} reply ${round} unusable: ${problem}`);
    if (round === 1) {
      messages.push({ role: 'assistant', content: reply.text || '(empty reply)' });
      messages.push({ role: 'user', content: buildRepairMessage(problem) });
    }
  }
  throw new UnusableReplyError(`${provider.name} returned unusable ${task.noun} twice; last reply ${lastProblem}`);
}

/**
 * A structured reply from the configured providers, in order (LLM_PROVIDER, then LLM_FALLBACKS).
 * Transient errors (429, 5xx, network) are retried with backoff first; a provider that still
 * fails hands over to the next. Refusals and unusable replies fail straight away.
 *
 * @param {{ label: string, noun: string, system: string, user: string, schema?: object, validate: (text: string) => { data?: unknown, problem?: string } }} task
 * @param {{ provider?: object, providers?: object[], env?: NodeJS.ProcessEnv, log?: (msg: string) => void, retry?: object }} [opts]
 */
export async function generateStructured(task, opts = {}) {
  const log = opts.log ?? ((m) => console.log(m));
  const retry = opts.retry ?? {};
  let providers = opts.providers ?? (opts.provider ? [opts.provider] : null);
  let skipped = [];
  if (!providers) ({ providers, skipped } = buildProviders(opts.env));
  for (const s of skipped) log(`[${task.label}] skipping ${s.name}: ${s.problem}`);
  if (!providers.length) {
    const why = skipped.map((s) => s.problem).join(' ');
    throw new TeardownError(`No ${task.noun} provider is configured. ${why}`.trim(), { status: 500 });
  }

  const failures = [];
  for (const [i, provider] of providers.entries()) {
    try {
      const result = await fromProvider(provider, task, { log, retry });
      log(`[${task.label}] ${provider.name} (${result.model}) succeeded after ${result.attempts} ${result.attempts === 1 ? 'call' : 'calls'}.`);
      return { ...result, provider: provider.name, tried: [...failures.map((f) => f.name), provider.name] };
    } catch (err) {
      if (err instanceof ProviderRefusalError) {
        throw new TeardownError(err.message, { provider: provider.name, status: 422, cause: err });
      }
      if (err instanceof UnusableReplyError) {
        throw new TeardownError(err.message, { provider: provider.name, attempts: 2, cause: err });
      }
      failures.push({ name: provider.name, error: describeError(err) });
      const next = providers[i + 1];
      log(`[${task.label}] ${provider.name} failed (${describeError(err)})${next ? `; falling back to ${next.name}` : ''}.`);
    }
  }
  const summary = failures.map((f) => `${f.name}: ${f.error}`).join('; ');
  const last = failures[failures.length - 1];
  throw new TeardownError(
    failures.length === 1 ? `${last.name} request failed: ${last.error}` : `Every ${task.noun} provider failed (${summary}).`,
    { provider: last.name, status: 502 }
  );
}

/**
 * Write field notes for one session (see generateStructured for retries and fallbacks).
 *
 * @param {{ speaker?: 'user' | 'coach', text: string, startMs: number }[]} transcript
 * @param {object} [context] prompt, talkType, mode, durationMs, paceZone, story, metrics, situation, camera
 * @param {Parameters<typeof generateStructured>[1]} [opts]
 */
export async function generateTeardown(transcript, context = {}, opts = {}) {
  const r = await generateStructured(
    {
      label: 'field-notes',
      noun: 'field notes',
      system: FIELD_NOTES_SYSTEM,
      user: buildFieldNotesPrompt(transcript, context),
      schema: FieldNotesSchema,
      validate: validateReply,
    },
    opts
  );
  return { notes: r.data, model: r.model, attempts: r.attempts, provider: r.provider, tried: r.tried };
}

/**
 * "Your answer, tightened": rewrite the speaker's transcript into a script they can read aloud.
 * A rewrite that adds content words the speaker never said is rejected and retried once.
 */
export async function generateTightened(transcript, context = {}, opts = {}) {
  const said = transcript
    .filter((t) => t.speaker !== 'coach')
    .map((t) => t.text)
    .join(' ');
  const r = await generateStructured(
    {
      label: 'tighten',
      noun: 'tightened answers',
      system: TIGHTEN_SYSTEM,
      user: buildTightenPrompt(transcript, context),
      schema: TightenSchema,
      validate: (text) => validateTightened(text, said),
    },
    opts
  );
  return { ...r.data, provider: r.provider, model: r.model };
}
