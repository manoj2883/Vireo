import { FieldNotesSchema } from './schema.js';
import { FIELD_NOTES_SYSTEM, buildFieldNotesPrompt, buildRepairMessage } from './prompt.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createOpenRouterProvider } from './providers/openrouter.js';
import { createAnthropicProvider, ProviderRefusalError } from './providers/anthropic.js';

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

/** Builds the provider named by LLM_PROVIDER (default gemini) from environment variables. */
export function getProvider(env = process.env) {
  const name = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
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
      throw new Error(`Unknown LLM_PROVIDER "${name}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
}

/** Provider name and whether it looks configured, without throwing. For /api/health. */
export function describeProvider(env = process.env) {
  const name = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
  try {
    const provider = getProvider(env);
    return { name, model: provider.model, configured: true };
  } catch (err) {
    return { name, configured: false, problem: err.message };
  }
}

/** Strip markdown fences and surrounding prose; return the outermost JSON object text. */
export function extractJson(text) {
  const unfenced = String(text ?? '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start !== -1 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

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

/**
 * Write field notes for one session.
 * Validates the reply against the schema, retries once with the problem explained, then
 * fails with a TeardownError that says what went wrong.
 *
 * @param {{ speaker?: 'user' | 'coach', text: string, startMs: number }[]} transcript
 * @param {object} [context] prompt, talkType, mode, durationMs, paceZone, story, metrics
 * @param {{ provider?: ReturnType<typeof getProvider>, env?: NodeJS.ProcessEnv, log?: (msg: string) => void }} [opts]
 */
export async function generateTeardown(transcript, context = {}, opts = {}) {
  const log = opts.log ?? ((m) => console.log(m));
  let provider;
  try {
    provider = opts.provider ?? getProvider(opts.env);
  } catch (err) {
    throw new TeardownError(err.message, { status: 500, cause: err });
  }

  const messages = [{ role: 'user', content: buildFieldNotesPrompt(transcript, context) }];
  let lastProblem = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply;
    try {
      reply = await provider.complete({ system: FIELD_NOTES_SYSTEM, messages });
    } catch (err) {
      if (err instanceof ProviderRefusalError) {
        throw new TeardownError(err.message, { provider: provider.name, attempts: attempt, status: 422, cause: err });
      }
      throw new TeardownError(`${provider.name} request failed: ${err.message}`, {
        provider: provider.name,
        attempts: attempt,
        cause: err,
      });
    }

    const { data, problem } = reply.invalid ? { problem: reply.invalid } : validateReply(reply.text);
    if (data) {
      log(`[field-notes] ${provider.name} (${reply.model ?? provider.model}) succeeded on attempt ${attempt}.`);
      return { notes: data, provider: provider.name, model: reply.model ?? provider.model, attempts: attempt };
    }

    lastProblem = problem;
    log(`[field-notes] ${provider.name} attempt ${attempt} unusable: ${problem}`);
    if (attempt === 1) {
      messages.push({ role: 'assistant', content: reply.text || '(empty reply)' });
      messages.push({ role: 'user', content: buildRepairMessage(problem) });
    }
  }

  throw new TeardownError(`${provider.name} returned unusable field notes twice; last reply ${lastProblem}`, {
    provider: provider.name,
    attempts: 2,
  });
}
