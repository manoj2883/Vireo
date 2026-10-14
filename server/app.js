import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTeardown, describeProvider, TeardownError } from './llm/index.js';
import { verifyNotes } from './llm/evidence.js';
import { grantSttToken, SttTokenError } from './stt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The HTTP API: transcription tokens, field notes and health, plus the built front end.
 * `generate` is injectable so the field notes route can be tested without a model.
 */
export function createApp({ env = process.env, generate = generateTeardown, grantToken = grantSttToken, fetchImpl = fetch, log = console } = {}) {
  // Per-connection session limit (in memory; replaced by a shared store for serverless).
  const ipRequestLogs = new Map();
  const MAX_SESSIONS_PER_IP_PER_HOUR = 20;

  function isRateLimited(ip) {
    const now = Date.now();
    const hourAgo = now - 3600 * 1000;
    let timestamps = ipRequestLogs.get(ip) || [];
    timestamps = timestamps.filter((t) => t > hourAgo);
    if (timestamps.length >= MAX_SESSIONS_PER_IP_PER_HOUR) {
      return true;
    }
    timestamps.push(now);
    ipRequestLogs.set(ip, timestamps);
    return false;
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Short-lived Deepgram token so the browser can open its own transcription socket.
  app.post('/api/stt-token', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      log.warn(`[stt-token] Rate limit exceeded for ${clientIp}`);
      return res.status(429).json({ error: 'Too many sessions from this connection. Try again in an hour.' });
    }
    try {
      res.json(await grantToken(env.DEEPGRAM_API_KEY, fetchImpl));
    } catch (err) {
      log.error('[stt-token]', err.message);
      res.status(err instanceof SttTokenError ? err.status : 500).json({ error: err.message });
    }
  });

  // Field notes endpoint: provider-agnostic teardown (LLM_PROVIDER = gemini | openrouter | anthropic)
  app.post('/api/field-notes', async (req, res) => {
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
        droppedNotes: dropped.length,
      });
    } catch (err) {
      const status = err instanceof TeardownError ? err.status : 500;
      log.error('[Server /api/field-notes Error]:', err.message);
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
