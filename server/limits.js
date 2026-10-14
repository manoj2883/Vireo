/**
 * Usage limits, so a public deploy can't run up the transcription and model bills.
 *
 * Each visitor is identified by an anonymous random cookie (no account, no personal data), and
 * limited per hour and per day; their IP gets a looser hourly limit so clearing cookies doesn't
 * reset it. On top of that a site-wide daily cap bounds the total spend.
 *
 * On Vercel the counters live in Upstash Redis (shared by every function instance). Locally, or
 * when Redis isn't configured, they live in memory, which is fine for one server process.
 */
import { randomUUID } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const int = (v, fallback) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The limits, from the environment (see .env.example). */
export function limitsFromEnv(env = process.env) {
  return {
    sessionsPerHour: int(env.SESSIONS_PER_VISITOR_PER_HOUR, 12),
    sessionsPerDay: int(env.SESSIONS_PER_VISITOR_PER_DAY, 30),
    sessionsPerIpPerHour: int(env.SESSIONS_PER_IP_PER_HOUR, 40),
    /** Site-wide transcription sessions per UTC day: the main cost guard. 0 turns sessions off. */
    dailySessionCap: int(env.DAILY_SESSION_CAP, 300),
    /** Field notes and tightening calls per visitor per hour (each retake makes two). */
    writesPerHour: int(env.WRITES_PER_VISITOR_PER_HOUR, 40),
    writesPerIpPerHour: int(env.WRITES_PER_IP_PER_HOUR, 120),
  };
}

/** Upstash credentials, under either the Upstash or the Vercel Marketplace names. */
export function redisConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** A sliding (or fixed, for daily) window counter in memory, with the same shape as Ratelimit. */
function memoryWindow(max, windowMs, fixed) {
  const hits = new Map();
  return {
    async limit(key, now = Date.now()) {
      if (fixed) {
        const bucket = Math.floor(now / windowMs);
        const k = `${key}:${bucket}`;
        const n = (hits.get(k) ?? 0) + 1;
        if (n > max) return { success: false, reset: (bucket + 1) * windowMs };
        hits.set(k, n);
        // Forget old buckets now and then.
        if (hits.size > 10_000) for (const old of hits.keys()) if (!old.endsWith(`:${bucket}`)) hits.delete(old);
        return { success: true, reset: (bucket + 1) * windowMs };
      }
      const since = now - windowMs;
      const list = (hits.get(key) ?? []).filter((t) => t > since);
      if (list.length >= max) {
        hits.set(key, list);
        return { success: false, reset: list[0] + windowMs };
      }
      list.push(now);
      hits.set(key, list);
      return { success: true, reset: list[0] + windowMs };
    },
  };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, now?: () => number, redis?: object | null }} [opts]
 */
export function createLimiter({ env = process.env, now = () => Date.now(), redis } = {}) {
  const limits = limitsFromEnv(env);
  const cfg = redis === undefined ? redisConfig(env) : null;
  const store = redis ?? (cfg ? new Redis(cfg) : null);
  const backend = store ? 'redis' : 'memory';

  const make = (name, max, windowMs, fixed = false) => {
    if (!store) return memoryWindow(max, windowMs, fixed);
    const limiter = fixed ? Ratelimit.fixedWindow(max, windowMs === DAY ? '1 d' : '1 h') : Ratelimit.slidingWindow(max, windowMs === DAY ? '1 d' : '1 h');
    return new Ratelimit({ redis: store, limiter, prefix: `vireo:${name}`, analytics: false });
  };

  const rules = {
    session: [
      { name: 'site-day', max: limits.dailySessionCap, w: make('site-day', limits.dailySessionCap, DAY, true), key: () => 'all', message: 'Vireo has reached today’s practice limit for everyone. It resets at midnight UTC.' },
      { name: 'visitor-hour', max: limits.sessionsPerHour, w: make('visitor-hour', limits.sessionsPerHour, HOUR), key: (v) => v.id, message: 'That’s a lot of practice for one hour. Take a break and try again later.' },
      { name: 'visitor-day', max: limits.sessionsPerDay, w: make('visitor-day', limits.sessionsPerDay, DAY, true), key: (v) => v.id, message: 'You’ve reached today’s practice limit. Come back tomorrow.' },
      { name: 'ip-hour', max: limits.sessionsPerIpPerHour, w: make('ip-hour', limits.sessionsPerIpPerHour, HOUR), key: (v) => v.ip, message: 'Too many sessions from this network. Try again in an hour.' },
    ],
    write: [
      { name: 'writes-hour', max: limits.writesPerHour, w: make('writes-hour', limits.writesPerHour, HOUR), key: (v) => v.id, message: 'Too many field notes requests this hour. Try again later.' },
      { name: 'writes-ip-hour', max: limits.writesPerIpPerHour, w: make('writes-ip-hour', limits.writesPerIpPerHour, HOUR), key: (v) => v.ip, message: 'Too many field notes requests from this network. Try again later.' },
    ],
  };

  return {
    backend,
    limits,
    /**
     * Count one use of `kind` for this visitor. The site-wide cap is checked first, so a full
     * site doesn't use up anyone's own allowance.
     * @returns {Promise<{ ok: true } | { ok: false, rule: string, message: string, retryAfterSec: number }>}
     */
    async check(kind, visitor) {
      for (const r of rules[kind]) {
        if (r.max === 0) return { ok: false, rule: r.name, message: r.message, retryAfterSec: 3600 };
        const t = now();
        const res = await r.w.limit(`${r.key(visitor)}`, t);
        if (!res.success) return { ok: false, rule: r.name, message: r.message, retryAfterSec: Math.max(1, Math.ceil((res.reset - t) / 1000)) };
      }
      return { ok: true };
    },
  };
}

export const VISITOR_COOKIE = 'vireo_vid';

/** The anonymous visitor: their cookie id (minting one if needed) and IP. */
export function identifyVisitor(req, res, { secure = false } = {}) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
  let id = cookies[VISITOR_COOKIE];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = randomUUID();
    res.append(
      'Set-Cookie',
      `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    );
  }
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] ?? '') || req.socket?.remoteAddress || 'unknown';
  return { id, ip };
}
