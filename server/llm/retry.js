/**
 * Retry for provider calls: 429, 500, 502, 503, 504 and network errors are retried with
 * exponential backoff and jitter (about 1 s, 3 s, 7 s), honouring Retry-After when the
 * provider sends it. Everything else (bad requests, refusals, auth) fails at once.
 */

export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
export const DEFAULT_DELAYS_MS = [1000, 3000, 7000];
/** Never wait longer than this for a single Retry-After. */
const MAX_RETRY_AFTER_MS = 20_000;

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

/** HTTP status of a provider error, from the SDK's field or a JSON body in the message. */
export function errorStatus(err) {
  if (typeof err?.status === 'number') return err.status;
  const m = /"code"\s*:\s*(\d{3})/.exec(String(err?.message ?? ''));
  return m ? Number(m[1]) : undefined;
}

export function isNetworkError(err) {
  const code = err?.code ?? err?.cause?.code;
  if (code && NETWORK_CODES.has(code)) return true;
  const name = err?.name ?? '';
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'AbortError') return true;
  return err instanceof TypeError && /fetch failed|network/i.test(String(err.message));
}

export function isRetryable(err) {
  const status = errorStatus(err);
  return (status !== undefined && RETRYABLE_STATUS.has(status)) || isNetworkError(err);
}

/** Retry-After in ms, from seconds or an HTTP date. */
export function retryAfterMs(err, now = Date.now()) {
  const h = err?.headers;
  const raw = typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, secs * 1000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now)) : undefined;
}

/** Delay before retry number `retry` (0-based): the base delay plus up to 20% jitter. */
export function backoffMs(retry, delays = DEFAULT_DELAYS_MS, random = Math.random) {
  const base = delays[Math.min(retry, delays.length - 1)];
  return Math.round(base * (1 + 0.2 * random()));
}

/** Short, key-free description of an error for logs and messages. */
export function describeError(err) {
  const status = errorStatus(err);
  let msg = String(err?.message ?? err).replace(/\s+/g, ' ');
  // Provider errors sometimes echo request URLs; never let a key-looking query reach a log.
  msg = msg.replace(/([?&](?:key|api_key|token)=)[^&\s"]+/gi, '$1[redacted]');
  if (msg.length > 200) msg = msg.slice(0, 197) + '...';
  return status ? `${status} ${msg}` : msg;
}

/**
 * Call fn up to `attempts` times, retrying transient failures.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, delays?: number[], sleep?: (ms: number) => Promise<void>, random?: () => number, onRetry?: (info: { attempt: number, waitMs: number, err: unknown }) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      const waitMs = retryAfterMs(err) ?? backoffMs(attempt - 1, opts.delays, opts.random);
      opts.onRetry?.({ attempt, waitMs, err });
      await sleep(waitMs);
    }
  }
}
