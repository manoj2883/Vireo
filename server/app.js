import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTeardown, generateTightened, describeProvider, TeardownError } from './llm/index.js';
import { verifyNotes, verifyPreviousFix } from './llm/evidence.js';
import { grantSttToken, SttTokenError } from './stt.js';
import { createLimiter, identifyVisitor } from './limits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The HTTP API: transcription tokens, field notes and health, plus the built front end.
 * `generate` is injectable so the field notes route can be tested without a model.
 */
export function createApp({ env = process.env, generate = generateTeardown, tighten = generateTightened, grantToken = grantSttToken, fetchImpl = fetch, log = console, limiter } = {}) {
  const limits = limiter ?? createLimiter({ env });
  if (env.VERCEL && limits.backend === 'memory') {
    log.warn('[limits] Upstash Redis is not configured, so usage limits are per function instance. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
  const secureCookie = Boolean(env.VERCEL) || env.NODE_ENV === 'production';

  /** Express middleware: count one use of `kind` for this visitor, or answer 429. */
  const limit = (kind) => async (req, res, next) => {
    const visitor = identifyVisitor(req, res, { secure: secureCookie });
    try {
      const result = await limits.check(kind, visitor);
      if (result.ok) return next();
      log.warn(`[limits] ${kind} refused (${result.rule})`);
      res.set('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({ error: result.message, retryAfterSec: result.retryAfterSec });
    } catch (err) {
      // If the limit store is down, fail closed for sessions (they cost the most), open for the rest.
      log.error('[limits] check failed:', err.message);
      if (kind === 'session') return res.status(503).json({ error: 'Vireo can’t start a session right now. Try again in a minute.' });
      return next();
    }
  };

  const app = express();
    // A ten-minute transcript is well under this; Vercel caps bodies at 4.5 MB anyway.
  app.use(express.json({ limit: '2mb' }));

  // Short-lived Deepgram token so the browser can open its own transcription socket.
  app.post('/api/stt-token', limit('session'), async (req, res) => {
    try {
      res.json(await grantToken(env.DEEPGRAM_API_KEY, fetchImpl));
    } catch (err) {
      log.error('[stt-token]', err.message);
      res.status(err instanceof SttTokenError ? err.status : 500).json({ error: err.message });
    }
  });

  // Field notes endpoint: provider-agnostic teardown (LLM_PROVIDER = gemini | openrouter | anthropic)
  app.post('/api/field-notes', limit('write'), async (req, res) => {
    const { sessionId, transcript, context } = req.body ?? {};
    if (!Array.isArray(transcript)) {
      return res.status(400).json({ error: 'transcript must be an array of { speaker, text, startMs } lines.' });
    }
    const lines = transcript
      .filter((t) => t && typeof t.text === 'string')
      .map((t) => ({ speaker: t.speaker === 'coach' ? 'coach' : 'user', text: t.text, startMs: Number(t.startMs) || 0 }));
    const spokenWords = lines
      .filter((t) => t.speaker === 'user')
      .reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
    if (spokenWords < 20) {
      return res.status(400).json({ error: `Say at least 20 words for field notes (heard ${spokenWords}).` });
    }

    try {
      const result = await generate(lines, context ?? {});
      // Evidence check: drop any note whose quote isn't in what the speaker actually said.
      const cameraEvents = Array.isArray(context?.camera?.events) ? context.camera.events : [];
    const { notes, dropped } = verifyNotes(result.notes.notes, lines, cameraEvents);
      if (dropped.length) {
        log.warn(`[field-notes] Dropped ${dropped.length} of ${result.notes.notes.length} notes: quote not found in transcript.`);
      }
      res.json({
        sessionId: sessionId || 'sess_' + Date.now(),
        createdAt: new Date().toISOString(),
        provider: result.provider,
        model: result.model,
        ...result.notes,
        notes,
        previousFix: verifyPreviousFix(result.notes.previousFix, lines),
        droppedNotes: dropped.length,
      });
    } catch (err) {
      const status = err instanceof TeardownError ? err.status : 500;
      log.error('[Server /api/field-notes Error]:', err.message);
      res.status(status).json({ error: err.message, provider: err.provider });
    }
  });

  // "Your answer, tightened": a read-aloud rewrite that only uses the speaker's own words.
  app.post('/api/tighten', limit('write'), async (req, res) => {
    const { transcript, context } = req.body ?? {};
    if (!Array.isArray(transcript)) {
      return res.status(400).json({ error: 'transcript must be an array of { speaker, text, startMs } lines.' });
    }
    const lines = transcript
      .filter((t) => t && typeof t.text === 'string')
      .map((t) => ({ speaker: t.speaker === 'coach' ? 'coach' : 'user', text: t.text, startMs: Number(t.startMs) || 0 }));
    const words = lines.filter((t) => t.speaker === 'user').reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
    if (words < 20) return res.status(400).json({ error: `Say at least 20 words to get a tightened version (heard ${words}).` });
    try {
      const prompt = typeof context?.prompt === 'string' ? context.prompt.slice(0, 500) : undefined;
      const oneFix = typeof context?.oneFix === 'string' ? context.oneFix.slice(0, 500) : undefined;
      res.json(await tighten(lines, { prompt, oneFix }));
    } catch (err) {
      const status = err instanceof TeardownError ? err.status : 500;
      log.error('[Server /api/tighten Error]:', err.message);
      res.status(status).json({ error: err.message, provider: err.provider });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      transcription: { provider: 'deepgram', configured: Boolean(env.DEEPGRAM_API_KEY && env.DEEPGRAM_API_KEY.trim()) },
      fieldNotes: describeProvider(env),
      timestamp: new Date().toISOString()
    });
  });

  // Serve static build files from dist
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));

  // SPA Fallback: Serve index.html for non-API, non-WebSocket GET requests
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) {
        res.status(404).send('Vireo production build (dist/index.html) not found. Run npm run build first.');
      }
    });
  });

  return { app };
}
