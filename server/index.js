import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTeardown, describeProvider, TeardownError } from './llm/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
    console.warn(`[Server Auth] Rate limit exceeded for IP: ${clientIp}`);
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
    const result = await generateTeardown(lines, context ?? {});
    res.json({
      sessionId: sessionId || 'sess_' + Date.now(),
      createdAt: new Date().toISOString(),
      provider: result.provider,
      model: result.model,
      ...result.notes,
    });
  } catch (err) {
    const status = err instanceof TeardownError ? err.status : 500;
    console.error('[Server /api/field-notes Error]:', err.message);
    res.status(status).json({ error: err.message, provider: err.provider });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== ''),
    fieldNotes: describeProvider(),
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

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/live' });

wss.on('connection', (clientWs, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const token = urlParams.get('token');
  const mode = urlParams.get('mode') === 'coach' ? 'coach' : 'watch';

  // Auth validation - REJECT if token is missing or invalid
  if (!token || !validSessionTokens.has(token)) {
    console.warn('[WS Server Auth] Rejected missing or invalid session token:', token);
    clientWs.send(JSON.stringify({ type: 'error', message: 'Missing or invalid session token' }));
    clientWs.close(4001, 'Missing token');
    return;
  }

  // Enforce 10-minute maximum session duration cap
  const MAX_SESSION_DURATION_MS = 10 * 60 * 1000;
  const sessionDurationTimer = setTimeout(() => {
    console.log('[WS Server] Enforcing maximum 10-minute session duration limit.');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Maximum 10-minute session duration limit reached.' }));
      clientWs.close(1000, 'Max duration reached');
    }
  }, MAX_SESSION_DURATION_MS);

  const apiKey = GEMINI_API_KEY;
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY not configured on server' }));
    clientWs.close(4002, 'API key missing');
    clearTimeout(sessionDurationTimer);
    return;
  }

  const geminiModel = 'models/gemini-2.5-flash-native-audio-latest';
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

  let geminiWs = null;
  let chunkCount = 1;
  let contextHistory = [];

  function connectToGemini(carriedContext = '') {
    geminiWs = new WebSocket(geminiWsUrl);

    geminiWs.on('open', () => {
      let responseModalities = ["AUDIO"];
      let systemPromptText = "";

      if (mode === 'coach') {
        // "Coach me out loud": the device decides when to nudge and sends [NUDGE] messages.
        systemPromptText = "You are Vireo's voice. Stay silent while the speaker talks: do not reply, comment or answer questions. Only when you receive a message that starts with [NUDGE], say the words after it out loud, exactly as written, briefly and warmly, then go silent again.";
      } else {
        // "Watch silently": Gemini only transcribes. The device measures pace, fillers and pauses.
        systemPromptText = "You are Vireo, a silent speech coach. Listen and transcribe only. Never speak, never reply, never comment.";
      }

      if (carriedContext) {
        systemPromptText += `\n\n[CARRIED-OVER SESSION CONTEXT]:\n${carriedContext}`;
      }

      const setupMessage = {
        setup: {
          model: geminiModel,
          generationConfig: {
            responseModalities: responseModalities,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Puck"
                }
              }
            }
          },
          systemInstruction: {
            parts: [{ text: systemPromptText }]
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      };

      geminiWs.send(JSON.stringify(setupMessage));

      clientWs.send(JSON.stringify({
        type: 'status',
        state: 'connected',
        chunkIndex: chunkCount,
        message: `Connected to Gemini Live API`
      }));
    });

    geminiWs.on('message', (data) => {
      try {
        const responseString = data.toString();
        const jsonResponse = JSON.parse(responseString);

        const heard = jsonResponse.serverContent?.inputTranscription?.text;
        if (heard) {
          // Carried into the next chunk if the session reconnects.
          contextHistory.push(`Speaker: ${heard}`);
          if (contextHistory.length > 200) contextHistory.splice(0, contextHistory.length - 200);
        }

        if (jsonResponse.serverContent?.modelTurn?.parts) {
          for (const part of jsonResponse.serverContent.modelTurn.parts) {
            if (part.text) {
              contextHistory.push(`Coach: ${part.text}`);
            }
          }
        }

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(responseString);
        }
      } catch {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      }
    });

    geminiWs.on('error', (err) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: `Gemini API Error: ${err.message}` }));
      }
    });

    geminiWs.on('close', (code, reason) => {
      console.log(`[WS Server] Gemini WSS closed (${code}: ${reason.toString()})`);
    });
  }

  connectToGemini();

  clientWs.on('message', (msg) => {
    try {
      const msgStr = msg.toString();
      const parsed = JSON.parse(msgStr);

      if (parsed.realtimeInput?.mediaChunks) {
        for (const chunk of parsed.realtimeInput.mediaChunks) {
          if (chunk.mimeType === 'image/jpeg') {
            console.log(`[Server WSS Proxy] Forwarding 1 FPS video frame (${chunk.data?.length || 0} bytes) to Gemini Live API`);
          }
        }
      }

      if (parsed.type === 'trigger_chunk_reconnect') {
        chunkCount++;
        const summaryContext = contextHistory.slice(-20).join('\n') || parsed.context || 'Continuing session context...';
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.close(1000, 'Chunking refresh');
        }
        clientWs.send(JSON.stringify({
          type: 'chunk_reconnecting',
          chunkIndex: chunkCount,
          message: `Initiating transparent session chunk #${chunkCount}...`
        }));
        connectToGemini(summaryContext);
        return;
      }


      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(msgStr);
      }
    } catch {
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(msg);
      }
    }
  });

  clientWs.on('close', () => {
    clearTimeout(sessionDurationTimer);
    if (geminiWs) {
      geminiWs.close(1000, 'Client disconnected');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(` Vireo Node Server running on http://${HOST}:${PORT}`);
  console.log(` WebSocket Server mounted at ws://${HOST}:${PORT}/ws/live`);
  console.log(`====================================================`);
});
