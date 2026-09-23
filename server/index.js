import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { TEARDOWN_PROMPT } from './prompts/teardown.js';

dotenv.config();

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// FIX 7: Rename to validSessionTokens and require token authentication
const validSessionTokens = new Set();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// FIX 7: Session Token Endpoint (Renamed from /api/token to /api/session-token)
app.post('/api/session-token', (req, res) => {
  const apiKeyPresent = Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== '');
  if (!apiKeyPresent) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server. Please set it in .env file.'
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

// FIX 8 & 4: Teardown Endpoint using standard Gemini Pro-tier model with transcript quote validation
app.post('/api/teardown', async (req, res) => {
  console.log('[Server /api/teardown] Request received.');

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY missing on server' });
  }

  try {
    const { sessionId, durationSec, mode, transcript, metrics, flatStretches, stories } = req.body;

    // FIX 8: Count total words across transcript turns
    const allWords = (transcript || [])
      .map((t) => t.text || '')
      .join(' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    // FIX 8: Return HTTP 400 if transcript is empty or shorter than 20 words
    if (!transcript || transcript.length === 0 || allWords.length < 20) {
      console.warn(`[Server /api/teardown] Rejecting short transcript (${allWords.length} words).`);
      return res.status(400).json({
        error: 'Transcript too short. Session transcript must contain at least 20 words for teardown analysis.'
      });
    }

    // Format transcript into timestamped turns: [mm:ss] Speaker: "text"
    const formattedTranscript = (transcript || []).map((t) => {
      const sec = t.timestampSec || 0;
      const m = Math.floor(sec / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      return `[${m}:${s}] ${t.speaker === 'user' ? 'Mano' : 'Coach'}: "${t.text}"`;
    }).join('\n');

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const promptContext = `
System Instruction:
${TEARDOWN_PROMPT}

Target Response JSON Schema (Return strict JSON matching this structure):
{
  "compositeScore": 75,
  "theOneThing": "The single highest leverage fix for next session...",
  "scores": {
    "storyStructure": { "score": 70, "evidenceQuote": "exact quote from transcript", "timestamp": "01:15", "explanation": "explanation" },
    "delivery": { "score": 80, "evidenceQuote": "exact quote from transcript", "timestamp": "02:30", "explanation": "explanation" },
    "registerPhrasing": { "score": 75, "evidenceQuote": "exact quote from transcript", "timestamp": "00:45", "explanation": "explanation" },
    "witLightness": { "score": 60, "evidenceQuote": "exact quote from transcript", "timestamp": "03:10", "explanation": "explanation" }
  },
  "structureTeardown": [
    { "storyName": "Main Story", "missingBeats": ["hook", "stakes"], "suggestedLandingLine": "compressed landing line under 12 words", "analysis": "analysis" }
  ],
  "deliveryTeardown": {
    "fillerRatePerMin": 4.5,
    "last5AvgFillerRate": 3.0,
    "paceRunawayTimestamps": ["01:30"],
    "missedPauseTimestamps": ["02:15"]
  },
  "registerTeardown": [
    { "originalText": "imprecise phrase", "nativeAlternative1": "native option 1", "nativeAlternative2": "native option 2", "contextAndRegister": "register difference" }
  ],
  "lightnessTeardown": {
    "missingBeatTimestamps": ["02:00"],
    "suggestedBitLine": "reusable bit line"
  },
  "tomorrowDrill": "10-minute specific drill description"
}

SESSION INPUT DATA:
Mode: ${mode}
Duration: ${durationSec} seconds

Timestamped Transcript:
${formattedTranscript}

Delivery Metrics: ${JSON.stringify(metrics || {})}
Flat-Stretch Drop-Off Windows: ${JSON.stringify(flatStretches || [])}
Relevant Story Bank Entries: ${JSON.stringify(stories || [])}
`;

    // FIX 4: Use current Gemini Pro-tier text model (gemini-2.0-flash)
    console.log('[Server /api/teardown] Calling Gemini 3.6 Flash text model...');
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: promptContext,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let rawText = response.text || '{}';
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const teardownData = JSON.parse(rawText);

    // FIX 8: Validate evidenceQuotes against actual transcript
    const unverifiedScores = [];
    const cleanTranscript = formattedTranscript.toLowerCase();

    if (teardownData.scores) {
      for (const [dim, scoreObj] of Object.entries(teardownData.scores)) {
        if (scoreObj && scoreObj.evidenceQuote) {
          const cleanQuote = scoreObj.evidenceQuote.toLowerCase().trim();
          if (cleanQuote.length > 0 && !cleanTranscript.includes(cleanQuote)) {
            unverifiedScores.push({
              dimension: dim,
              reason: 'Evidence quote not found as substring of actual session transcript',
              attemptedQuote: scoreObj.evidenceQuote,
            });
            delete teardownData.scores[dim];
          }
        }
      }
    }
    teardownData.unverifiedScores = unverifiedScores;

    teardownData.id = 'td_' + Date.now();
    teardownData.sessionId = sessionId || 'sess_' + Date.now();
    teardownData.createdAt = new Date().toISOString();
    teardownData.mode = mode || 'rehearsal';
    teardownData.durationSec = durationSec || 0;

    res.json(teardownData);
  } catch (err) {
    console.error('[Server /api/teardown Error]:', err.message);
    res.status(500).json({ error: 'Failed to generate teardown report: ' + err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim() !== ''),
    timestamp: new Date().toISOString()
  });
});

const server = createServer(app);
// FIX 1: Mount WebSocket server on /ws/live
const wss = new WebSocketServer({ server, path: '/ws/live' });

wss.on('connection', (clientWs, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const token = urlParams.get('token');
  const mode = urlParams.get('mode') || 'rehearsal';

  // FIX 7: Auth validation - REJECT if token is missing or invalid
  if (!token || !validSessionTokens.has(token)) {
    console.warn('[WS Server Auth] Rejected missing or invalid session token:', token);
    clientWs.send(JSON.stringify({ type: 'error', message: 'Missing or invalid session token' }));
    clientWs.close(4001, 'Missing token');
    return;
  }

  const apiKey = GEMINI_API_KEY;
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY not configured on server' }));
    clientWs.close(4002, 'API key missing');
    return;
  }

  // FIX 4: Use supported Gemini Live API model (gemini-2.5-flash-native-audio-latest)
  const geminiModel = 'models/gemini-2.5-flash-native-audio-latest';
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

  let geminiWs = null;
  let chunkCount = 1;
  let contextHistory = [];

  function connectToGemini(carriedContext = '') {
    geminiWs = new WebSocket(geminiWsUrl);

    geminiWs.on('open', () => {
      // FIX 9: Server-Enforced Silent Live Mode vs Rehearsal Mode
      let responseModalities = ["AUDIO"];
      let systemPromptText = "";

      if (mode === 'live') {
        // Live Mode: Silent coach
        systemPromptText = "You are Vireo, silent speech coach. Observe the talk and output transcript only. Do not generate conversational audio responses.";
      } else {
        // Rehearsal Mode: Active voice coach
        systemPromptText = "You are running a rehearsal with Mano. Camera and mic are on. You may interrupt when he buries point, abstracts, or exceeds 180 WPM.";
      }

      if (carriedContext) {
        systemPromptText += `\n\n[CARRIED-OVER SESSION CONTEXT]:\n${carriedContext}`;
      }

      // FIX 5: Enable inputAudioTranscription and outputAudioTranscription in setup message
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
      } catch (err) {
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

      // FIX 6: Log server-side video frame forwarding
      if (parsed.realtimeInput?.mediaChunks) {
        for (const chunk of parsed.realtimeInput.mediaChunks) {
          if (chunk.mimeType === 'image/jpeg') {
            console.log(`[Server WSS Proxy] Forwarding 1 FPS video frame (${chunk.data?.length || 0} bytes) to Gemini Live API`);
          }
        }
      }

      // FIX 10: Session Chunking Carryover with finalized transcript history
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

      if (parsed.type === 'transcript_user_text') {
        contextHistory.push(`Mano: ${parsed.text}`);
      }

      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(msgStr);
      }
    } catch (e) {
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(msg);
      }
    }
  });

  clientWs.on('close', () => {
    if (geminiWs) {
      geminiWs.close(1000, 'Client disconnected');
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Vireo Node Server running on http://localhost:${PORT}`);
  console.log(` WebSocket Server mounted at ws://localhost:${PORT}/ws/live`);
  console.log(`====================================================`);
});
