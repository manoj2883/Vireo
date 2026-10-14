// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLimiter, identifyVisitor, limitsFromEnv, redisConfig } from './limits.js';

const visitor = (id = 'v1', ip = '1.1.1.1') => ({ id, ip });

describe('limits', () => {
  it('reads limits from the environment, with defaults', () => {
    expect(limitsFromEnv({})).toMatchObject({ sessionsPerHour: 12, sessionsPerDay: 30, dailySessionCap: 300 });
    expect(limitsFromEnv({ DAILY_SESSION_CAP: '50', SESSIONS_PER_VISITOR_PER_HOUR: 'nonsense' })).toMatchObject({ dailySessionCap: 50, sessionsPerHour: 12 });
  });

  it('finds Upstash credentials under either name', () => {
    expect(redisConfig({})).toBeNull();
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' })).toEqual({ url: 'u', token: 't' });
    expect(redisConfig({ KV_REST_API_URL: 'u2', KV_REST_API_TOKEN: 't2' })).toEqual({ url: 'u2', token: 't2' });
    expect(createLimiter({ env: {} }).backend).toBe('memory');
  });

  it('frees an hourly slot an hour after it was used', async () => {
    let t = Date.UTC(2026, 9, 14, 10);
    const l = createLimiter({ env: { SESSIONS_PER_VISITOR_PER_HOUR: '2' }, now: () => t });
    expect((await l.check('session', visitor())).ok).toBe(true);
    t += 10 * 60_000;
    expect((await l.check('session', visitor())).ok).toBe(true);
    const refused = await l.check('session', visitor());
    expect(refused).toMatchObject({ ok: false, rule: 'visitor-hour', retryAfterSec: 50 * 60 });
    t += 50 * 60_000 + 1;
    expect((await l.check('session', visitor())).ok).toBe(true);
  });

  it('resets the daily caps at midnight UTC', async () => {
    let t = Date.UTC(2026, 9, 14, 23, 0);
    const l = createLimiter({ env: { DAILY_SESSION_CAP: '1' }, now: () => t });
    expect((await l.check('session', visitor('a'))).ok).toBe(true);
    expect(await l.check('session', visitor('b', '2.2.2.2'))).toMatchObject({ ok: false, rule: 'site-day', retryAfterSec: 3600 });
    t = Date.UTC(2026, 9, 15, 0, 1);
    expect((await l.check('session', visitor('b', '2.2.2.2'))).ok).toBe(true);
  });

  it('checks the site cap before using up a visitor’s own allowance', async () => {
    const l = createLimiter({ env: { DAILY_SESSION_CAP: '0', SESSIONS_PER_VISITOR_PER_HOUR: '1' } });
    expect((await l.check('session', visitor())).rule).toBe('site-day');
    expect((await l.check('session', visitor())).rule).toBe('site-day');
  });

  it('limits an IP across visitor ids', async () => {
    const l = createLimiter({ env: { SESSIONS_PER_IP_PER_HOUR: '2' } });
    expect((await l.check('session', visitor('a'))).ok).toBe(true);
    expect((await l.check('session', visitor('b'))).ok).toBe(true);
    expect((await l.check('session', visitor('c'))).rule).toBe('ip-hour');
  });
});

describe('identifyVisitor', () => {
  const res = () => {
    const headers = [];
    return { headers, append: (k, v) => headers.push([k, v]) };
  };

  it('keeps a valid cookie and takes the first forwarded IP', () => {
    const r = res();
    const v = identifyVisitor({ headers: { cookie: 'a=1; vireo_vid=0b9a8c1e-1234-4abc-8def-0123456789ab', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }, r);
    expect(v).toEqual({ id: '0b9a8c1e-1234-4abc-8def-0123456789ab', ip: '9.9.9.9' });
    expect(r.headers).toEqual([]);
  });

  it('mints a new anonymous id for a missing or tampered cookie', () => {
    const r = res();
    const v = identifyVisitor({ headers: { cookie: 'vireo_vid=<script>' }, socket: { remoteAddress: '127.0.0.1' } }, r, { secure: true });
    expect(v.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.ip).toBe('127.0.0.1');
    expect(r.headers[0][1]).toMatch(/^vireo_vid=[0-9a-f-]{36}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
  });
});
