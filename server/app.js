import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTeardown, describeProvider, TeardownError } from './llm/index.js';
import { verifyNotes } from './llm/evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The HTTP API: session tokens, field notes and health, plus the built front end.
 * `generate` is injectable so the field notes route can be tested without a model.
 */
export function createApp({ env = process.env, generate = generateTeardown, log = console } = {}) {
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  // Session Tokens & IP Rate Limiting
  const validSessionTokens = new Set();
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

  // Session Token Endpoint
  app.post('/api/session-token', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      log.warn(`[Server Auth] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        error: 'Too many session requests. Maximum 20 sessions per hour permitted.'
      });
    }

    const apiKeyPresent = Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== '');
    if (!apiKeyPresent) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please set it in environment variables.'
      });
    }

    const sessionToken = 'st_session_' + crypto.randomBytes(16).toString('hex');
    validSessionTokens.add(sessionToken);

    setTimeout(() => {
      validSessionTokens.delete(sessionToken);
    }, 3600 * 1000);

    res.json({
      sessionToken,
      expiresIn: 3600,
      serverTime: new Date().toISOString()
    });
  });

  // Backward compatibility route for /api/token
  app.post('/api/token', (req, res) => {
    const apiKeyPresent = Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== '');
    if (!apiKeyPresent) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
    }
    const sessionToken = 'st_session_' + crypto.randomBytes(16).toString('hex');
    validSessionTokens.add(sessionToken);
    res.json({ token: sessionToken, sessionToken, expiresIn: 3600 });
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
      const { notes, dropped } = verifyNotes(result.notes.notes, lines);
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
      hasApiKey: Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== ''),
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

  return { app, validSessionTokens };
}
