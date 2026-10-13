import { GoogleGenAI } from '@google/genai';
import { fieldNotesJsonSchema } from '../schema.js';

export const DEFAULT_GEMINI_TEARDOWN_MODEL = 'gemini-3.6-flash';

/** Gemini Flash with JSON output constrained to the field notes schema. */
export function createGeminiProvider({ apiKey, model = DEFAULT_GEMINI_TEARDOWN_MODEL, client } = {}) {
  if (!apiKey && !client) throw new Error('GEMINI_API_KEY is not set (needed for LLM_PROVIDER=gemini).');
  const ai = client ?? new GoogleGenAI({ apiKey });
  return {
    name: 'gemini',
    model,
    async complete({ system, messages }) {
      const response = await ai.models.generateContent({
        model,
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: fieldNotesJsonSchema(),
        },
      });
      return { text: response.text ?? '' };
    },
  };
}
