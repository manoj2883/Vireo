import OpenAI from 'openai';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Comma or whitespace separated model IDs, in fallback order. */
export function parseModelList(value) {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * OpenRouter through the openai package. Free models rotate and get rate-limited, so the
 * model list always comes from OPENROUTER_MODELS and is sent as OpenRouter's `models`
 * fallback array; nothing is hardcoded.
 */
export function createOpenRouterProvider({ apiKey, models, client } = {}) {
  if (!apiKey && !client) throw new Error('OPENROUTER_API_KEY is not set (needed for LLM_PROVIDER=openrouter).');
  const list = Array.isArray(models) ? models : parseModelList(models);
  if (list.length === 0) {
    throw new Error('OPENROUTER_MODELS is empty. Set it to one or more model IDs, comma separated, in fallback order.');
  }
  // Retries are handled once, in llm/retry.js, so the SDK's own retries are off.
  const openai = client ?? new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL, maxRetries: 0 });
  return {
    name: 'openrouter',
    model: list[0],
    async complete({ system, messages }) {
      const completion = await openai.chat.completions.create({
        model: list[0],
        // OpenRouter-specific: tries each model in order when one is down or rate-limited.
        models: list,
        messages: [{ role: 'system', content: system }, ...messages],
        response_format: { type: 'json_object' },
      });
      const choice = completion.choices?.[0];
      return { text: choice?.message?.content ?? '', model: completion.model };
    },
  };
}
