/**
 * Thin client for the server's Gemini Live proxy (/ws/live).
 *
 * Gemini Live does two jobs here: transcribing the speaker (input transcription) and, in
 * "Coach me out loud" mode only, saying the nudges Vireo asks for. Pace, fillers and pauses
 * are measured on the device; Gemini never decides when to interrupt.
 */
import type { CoachMode } from './metrics/nudges';

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'failed';

export interface GeminiLiveCallbacks {
  onStatus: (status: LiveStatus, message?: string) => void;
  /** A new chunk of the speaker's words. */
  onTranscript: (text: string) => void;
  /** Coach audio (24 kHz PCM, base64) for a nudge Vireo asked for. */
  onCoachAudio: (base64Pcm: string) => void;
}

export interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export interface GeminiLiveDeps {
  fetchToken?: () => Promise<string>;
  openSocket?: (url: string) => LiveSocket;
  /** Gemini Live sessions are capped server-side; reconnect transparently before that. */
  chunkAfterMs?: number;
}

const OPEN = 1;

async function defaultFetchToken(): Promise<string> {
  const res = await fetch('/api/session-token', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Session token request failed (${res.status})`);
  const token = body.sessionToken || body.token;
  if (!token) throw new Error('The server returned no session token.');
  return token;
}

function defaultOpenSocket(url: string): LiveSocket {
  return new WebSocket(url) as unknown as LiveSocket;
}

export class GeminiLiveClient {
  private ws: LiveSocket | null = null;
  private closedByUser = false;
  /** Play coach audio only for a turn Vireo asked for; drop anything else the model says. */
  private awaitingNudgeReply = false;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fetchToken: () => Promise<string>;
  private readonly openSocket: (url: string) => LiveSocket;
  private readonly chunkAfterMs: number;

  constructor(
    private readonly mode: CoachMode,
    private readonly cb: GeminiLiveCallbacks,
    deps: GeminiLiveDeps = {}
  ) {
    this.fetchToken = deps.fetchToken ?? defaultFetchToken;
    this.openSocket = deps.openSocket ?? defaultOpenSocket;
    this.chunkAfterMs = deps.chunkAfterMs ?? 9 * 60_000;
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    this.cb.onStatus('connecting');
    let token: string;
    try {
      token = await this.fetchToken();
    } catch (err) {
      this.cb.onStatus('failed', err instanceof Error ? err.message : String(err));
      return;
    }
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof location !== 'undefined' ? location.host : 'localhost';
    const ws = this.openSocket(`${proto}//${host}/ws/live?token=${encodeURIComponent(token)}&mode=${this.mode}`);
    this.ws = ws;

    ws.onopen = () => {
      this.cb.onStatus('connected');
      this.scheduleChunk();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => this.cb.onStatus('failed', 'The live connection failed.');
    ws.onclose = (ev) => {
      this.clearChunk();
      if (!this.closedByUser) this.cb.onStatus('failed', `The live connection closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
      else this.cb.onStatus('closed');
    };
  }

  private scheduleChunk(): void {
    this.clearChunk();
    this.chunkTimer = setTimeout(() => {
      this.send({ type: 'trigger_chunk_reconnect' });
      this.scheduleChunk();
    }, this.chunkAfterMs);
  }

  private clearChunk(): void {
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    this.chunkTimer = null;
  }

  private send(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendAudio(base64Pcm16k: string): void {
    this.send({ realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64Pcm16k }] } });
  }

  sendVideoFrame(base64Jpeg: string): void {
    this.send({ realtimeInput: { mediaChunks: [{ mimeType: 'image/jpeg', data: base64Jpeg }] } });
  }

  /** Ask the coach to say a nudge out loud. Only in coach mode. */
  sendNudge(text: string): boolean {
    if (this.mode !== 'coach') return false;
    const sent = this.send({
      clientContent: { turns: [{ role: 'user', parts: [{ text: `[NUDGE] ${text}` }] }], turnComplete: true },
    });
    if (sent) this.awaitingNudgeReply = true;
    return sent;
  }

  private handleMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }

    if (msg.type === 'chunk_reconnecting') {
      this.cb.onStatus('reconnecting');
      return;
    }
    if (msg.type === 'status' && msg.state === 'connected') {
      this.cb.onStatus('connected');
      return;
    }
    if (msg.type === 'error') {
      this.cb.onStatus('failed', String(msg.message ?? 'Live session error'));
      return;
    }

    const content = msg.serverContent as
      | {
          inputTranscription?: { text?: string };
          modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
          turnComplete?: boolean;
        }
      | undefined;
    if (!content) return;

    const heard = content.inputTranscription?.text;
    if (heard && heard.trim()) this.cb.onTranscript(heard);

    if (this.mode === 'coach' && this.awaitingNudgeReply) {
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.mimeType?.startsWith('audio/pcm') && part.inlineData.data) this.cb.onCoachAudio(part.inlineData.data);
      }
    }
    if (content.turnComplete) this.awaitingNudgeReply = false;
  }

  close(): void {
    this.closedByUser = true;
    this.clearChunk();
    this.ws?.close(1000, 'Session ended');
    this.ws = null;
  }
}
