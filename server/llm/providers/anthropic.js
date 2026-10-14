import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { FieldNotesSchema } from '../schema.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export class ProviderRefusalError extends Error {}

/**
 * Claude through the official SDK, with structured outputs so the reply is schema-valid JSON.
 * Server-side refusal fallback is on by default (ANTHROPIC_FALLBACKS=off to disable): if a
 * safety classifier declines, the API retries on Anthropic's recommended fallback model.
 */
export function createAnthropicProvider({
  apiKey,
  model = DEFAULT_ANTHROPIC_MODEL,
  effort,
  fallbacks = true,
  client,
} = {}) {
  if (!apiKey && !client) throw new Error('ANTHROPIC_API_KEY is not set (needed for LLM_PROVIDER=anthropic).');
  // Retries are handled once, in llm/retry.js, so the SDK's own retries are off.
  const anthropic = client ?? new Anthropic({ apiKey, maxRetries: 0 });
  // Claude Opus 5.5 defaults to medium effort; field notes are judgement work, so ask for high.
  const resolvedEffort = effort ?? (model === DEFAULT_ANTHROPIC_MODEL ? 'high' : undefined);

  return {
    name: 'anthropic',
    model,
    async complete({ system, messages }) {
      const request = {
        model,
        max_tokens: 16000,
        system,
        messages,
        output_config: {
          format: betaZodOutputFormat(FieldNotesSchema),
          ...(resolvedEffort ? { effort: resolvedEffort } : {}),
        },
        ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      };

      let response;
      try {
        response = await anthropic.beta.messages.parse(request);
      } catch (err) {
        // A reply that fails the SDK's own parse is invalid output, not an API failure:
        // hand back the raw text so the caller's retry can repair it.
        if (err instanceof Anthropic.APIError) throw err;
        return { text: err?.rawText ?? '', invalid: String(err?.message ?? err) };
      }

      if (response.stop_reason === 'refusal') {
        throw new ProviderRefusalError(
          `Claude declined to write these notes${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`
        );
      }
      if (response.stop_reason === 'max_tokens') {
        return { text: '', invalid: 'the reply was cut off at the token limit' };
      }
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, model: response.model };
    },
  };
}
