/**
 * Deepgram temporary tokens for the browser's live transcription socket.
 * The real API key stays on the server; the browser gets a short-lived JWT that only needs
 * to be valid when the socket opens (the connection then stays open).
 * Docs: https://developers.deepgram.com/reference/auth/tokens/grant
 */

export const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
/** Long enough to open the socket, short enough to be useless if it leaks. */
export const STT_TOKEN_TTL_SECONDS = 60;

export class SttTokenError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'SttTokenError';
    this.status = status;
  }
}

/**
 * @param {string | undefined} apiKey DEEPGRAM_API_KEY
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ token: string, expiresIn: number }>}
 */
export async function grantSttToken(apiKey, fetchImpl = fetch) {
  if (!apiKey || !apiKey.trim()) {
    throw new SttTokenError('DEEPGRAM_API_KEY is not set on the server, so live transcription is off.', 500);
  }
  let res;
  try {
    res = await fetchImpl(DEEPGRAM_GRANT_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: STT_TOKEN_TTL_SECONDS }),
    });
  } catch (err) {
    throw new SttTokenError(`Couldn't reach Deepgram: ${err?.message ?? err}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = body.err_msg || body.message || body.error || `HTTP ${res.status}`;
    const hint = res.status === 401 || res.status === 403 ? ' Check the key, and that it has the Member role or higher.' : '';
    throw new SttTokenError(`Deepgram refused the token request: ${reason}.${hint}`, res.status === 401 || res.status === 403 ? 500 : 502);
  }
  return { token: body.access_token, expiresIn: Number(body.expires_in) || STT_TOKEN_TTL_SECONDS };
}
