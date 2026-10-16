// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { TeardownError } from './llm/index.js';

const TRANSCRIPT = [
  { speaker: 'user', text: 'So my research is about teaching AI systems to say no when they do not have the evidence.', startMs: 400 },
  { speaker: 'user', text: 'Um, so basically, the answers it refused were the right ones to refuse.', startMs: 6200 },
];

const NOTES = {
  verdict: 'Clear story. Rushed ending.',
  summary: 'One. Two. Three.',
  scores: { structure: 80, delivery: 60, clarity: 75 },
  storyMap: { sections: [] },
  notes: [
    { kind: 'keep', title: 'Real', body: 'b', quote: 'teaching AI systems to say no', startMs: 400 },
    { kind: 'fix', title: 'Invented', body: 'b', quote: 'I was extremely nervous', startMs: 3000 },
    { kind: 'fix', title: 'Across lines', body: 'b', quote: 'evidence. Um, so basically', startMs: 5000 },
  ],
  audienceFollowUp: { question: 'How?', reason: 'r' },
  drills: [{ title: 'd', instructions: 'i', minutes: 3 }],
};

let server;

async function start(opts) {
  const log = { warn: vi.fn(), error: vi.fn() };
  const { app } = createApp({ env: { GEMINI_API_KEY: 'k' }, log, ...opts });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) =>
    fetch(`${base}/api/field-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({
      status: r.status,
      body: await r.json(),
    }));
  return { base, post, log };
}

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  server = undefined;
});

describe('POST /api/field-notes', () => {
  it('drops notes whose quotes are not in the transcript and logs the count', async () => {
    const generate = vi.fn().mockResolvedValue({ notes: structuredClone(NOTES), provider: 'fake', model: 'fake-1', attempts: 1 });
    const { post, log } = await start({ generate });
    const res = await post({ sessionId: 's1', transcript: TRANSCRIPT, context: { prompt: 'Tell me' } });
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n) => n.title)).toEqual(['Real', 'Across lines']);
    expect(res.body.droppedNotes).toBe(1);
    expect(res.body).toMatchObject({ sessionId: 's1', provider: 'fake', verdict: 'Clear story. Rushed ending.' });
    expect(log.warn).toHaveBeenCalledWith('[field-notes] Dropped 1 of 3 notes: quote not found in transcript.');
    expect(generate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ startMs: 6200 })]), { prompt: 'Tell me' });
  });

  it('keeps only "say it more naturally" lines the speaker really said', async () => {
    const naturalPhrasing = [
      { original: 'the right ones to refuse', natural: 'the ones it should refuse', why: 'Simpler.' },
      { original: 'so much joyful', natural: 'really happy', why: 'Invented.' },
    ];
    const generate = vi.fn().mockResolvedValue({ notes: { ...structuredClone(NOTES), naturalPhrasing }, provider: 'fake', model: 'fake-1', attempts: 1 });
    const { post } = await start({ generate });
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.body.naturalPhrasing).toEqual([naturalPhrasing[0]]);
  });

  it('returns an empty natural phrasing list when the model gives none', async () => {
    const generate = vi.fn().mockResolvedValue({ notes: structuredClone(NOTES), provider: 'fake', model: 'fake-1', attempts: 1 });
    const { post } = await start({ generate });
    expect((await post({ transcript: TRANSCRIPT })).body.naturalPhrasing).toEqual([]);
  });

  it('rejects answers under twenty words without calling the model', async () => {
    const generate = vi.fn();
    const { post } = await start({ generate });
    const res = await post({ transcript: [{ speaker: 'user', text: 'too short', startMs: 0 }] });
    expect(res).toEqual({ status: 400, body: { error: 'Say at least 20 words for field notes (heard 2).' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('passes a teardown failure through with its status and provider', async () => {
    const generate = vi.fn().mockRejectedValue(new TeardownError('anthropic returned unusable field notes twice', { provider: 'anthropic', status: 502 }));
    const { post } = await start({ generate });
    const res = await post({ transcript: TRANSCRIPT });
    expect(res).toEqual({ status: 502, body: { error: 'anthropic returned unusable field notes twice', provider: 'anthropic' } });
  });

  it('requires a transcript array', async () => {
    const { post } = await start({ generate: vi.fn() });
    expect((await post({ transcript: 'hello' })).status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('reports transcription and the field notes provider', async () => {
    const { base } = await start({ env: { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_MODELS: 'a/b:free' } });
    const body = await fetch(`${base}/api/health`).then((r) => r.json());
    expect(body).toMatchObject({
      status: 'ok',
      transcription: { provider: 'deepgram', configured: false },
      fieldNotes: { name: 'openrouter', model: 'a/b:free', configured: true },
    });
  });
});

describe('POST /api/stt-token', () => {
  it('returns a short-lived Deepgram token, never the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'jwt.abc', expires_in: 60 }) });
    const { base } = await start({ env: { DEEPGRAM_API_KEY: 'dg-secret' }, fetchImpl });
    const res = await fetch(`${base}/api/stt-token`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ token: 'jwt.abc', expiresIn: 60 });
    expect(JSON.stringify(body)).not.toContain('dg-secret');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: 'Token dg-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
  });

  it('explains a missing key', async () => {
    const { base } = await start({ env: {} });
    const res = await fetch(`${base}/api/stt-token`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/DEEPGRAM_API_KEY is not set/);
  });

  it('explains a key Deepgram rejects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ err_msg: 'Insufficient permissions.' }) });
    const { base } = await start({ env: { DEEPGRAM_API_KEY: 'dg' }, fetchImpl });
    const res = await fetch(`${base}/api/stt-token`, { method: 'POST' });
    expect((await res.json()).error).toBe('Deepgram refused the token request: Insufficient permissions. Check the key, and that it has the Member role or higher.');
  });

  it('counts sessions per visitor and hands out an anonymous visitor cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 60 }) });
    const { base } = await start({ env: { DEEPGRAM_API_KEY: 'dg', SESSIONS_PER_VISITOR_PER_HOUR: '2' }, fetchImpl });
    const first = await fetch(`${base}/api/stt-token`, { method: 'POST' });
    const cookie = first.headers.get('set-cookie').split(';')[0];
    expect(cookie).toMatch(/^vireo_vid=[0-9a-f-]{36}$/);
    expect(first.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/);
    const again = (c) => fetch(`${base}/api/stt-token`, { method: 'POST', headers: c ? { cookie: c } : {} });
    expect((await again(cookie)).status).toBe(200);
    const third = await again(cookie);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(3000);
    expect((await third.json()).error).toMatch(/a lot of practice for one hour/);
    // Another visitor isn't affected.
    expect((await again(null)).status).toBe(200);
  });

  it('stops every session once the site-wide daily cap is reached', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 60 }) });
    const { base } = await start({ env: { DEEPGRAM_API_KEY: 'dg', DAILY_SESSION_CAP: '1' }, fetchImpl });
    expect((await fetch(`${base}/api/stt-token`, { method: 'POST' })).status).toBe(200);
    const res = await fetch(`${base}/api/stt-token`, { method: 'POST' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today’s practice limit for everyone/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses sessions if the limit store is down', async () => {
    const limiter = { backend: 'redis', check: vi.fn().mockRejectedValue(new Error('redis down')) };
    const { base } = await start({ env: { DEEPGRAM_API_KEY: 'dg' }, limiter });
    expect((await fetch(`${base}/api/stt-token`, { method: 'POST' })).status).toBe(503);
  });
});

describe('write limits', () => {
  const generate = () => vi.fn().mockResolvedValue({ notes: structuredClone(NOTES), provider: 'fake', model: 'm', attempts: 1 });
  const send = (base, cookie) =>
    fetch(`${base}/api/field-notes`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ transcript: TRANSCRIPT }) });

  it('limits field notes and tightening per visitor per hour', async () => {
    const { base } = await start({ env: { GEMINI_API_KEY: 'k', WRITES_PER_VISITOR_PER_HOUR: '1' }, generate: generate() });
    const first = await send(base);
    expect(first.status).toBe(200);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    expect((await send(base, cookie)).status).toBe(429);
  });

  it('also limits by IP, so dropping the cookie doesn’t reset it', async () => {
    const { base } = await start({ env: { GEMINI_API_KEY: 'k', WRITES_PER_IP_PER_HOUR: '2' }, generate: generate() });
    expect((await send(base)).status).toBe(200);
    expect((await send(base)).status).toBe(200);
    expect((await send(base)).status).toBe(429);
  });
});

describe('POST /api/tighten', () => {
  it('returns the tightened script from the injected generator', async () => {
    const tighten = vi.fn().mockResolvedValue({ script: 'Say no. / Then explain.', mainPoint: 'Say no.', provider: 'fake' });
    const { base } = await start({ tighten });
    const res = await fetch(`${base}/api/tighten`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: TRANSCRIPT, context: { oneFix: 'Pause first.' } }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ script: 'Say no. / Then explain.' });
    expect(tighten).toHaveBeenCalledWith(expect.any(Array), { prompt: undefined, oneFix: 'Pause first.' });
  });

  it('needs at least 20 words', async () => {
    const { base } = await start({ tighten: vi.fn() });
    const res = await fetch(`${base}/api/tighten`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: [{ speaker: 'user', text: 'short', startMs: 0 }] }) });
    expect(res.status).toBe(400);
  });
});
