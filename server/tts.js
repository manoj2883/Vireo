/**
 * The roleplay partner's voice: Deepgram text-to-speech (Aura-2), as in scripts/generate-coach-clips.mjs.
 * Returns base64 MP3, or null on any failure so the browser can fall back to its own voice.
 * Docs: https://developers.deepgram.com/reference/text-to-speech/speak-request
 */

export const DEFAULT_PARTNER_VOICE = 'aura-2-thalia-en';
/** A roleplay question is short; anything bigger than this is a mistake, not speech. */
const MAX_TTS_CHARS = 600;

export async function synthesizeSpeech(text, { apiKey, voice = DEFAULT_PARTNER_VOICE, fetchImpl = fetch, log = console } = {}) {
  if (!apiKey || !apiKey.trim() || !text) return null;
  try {
    const res = await fetchImpl(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, MAX_TTS_CHARS) }),
    });
    if (!res.ok) {
      log.warn?.(`[tts] Deepgram speak failed: HTTP ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (err) {
    log.warn?.(`[tts] Deepgram speak failed: ${err?.message ?? err}`);
    return null;
  }
}
