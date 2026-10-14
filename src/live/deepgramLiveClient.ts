/**
 * Live transcription straight from the browser to Deepgram Nova-3.
 *
 * The server hands out a short-lived token (/api/stt-token); the browser opens the socket with
 * it as the `bearer` subprotocol, so the real key never reaches the page. Words come back with
 * real timings, which are converted to the session clock.
 * Docs: https://developers.deepgram.com/reference/speech-to-text/listen-streaming
 */

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'failed';

/** A transcribed word on the session clock. */
export interface LiveWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SttCallbacks {
  onStatus: (status: LiveStatus, message?: string) => void;
  /** Words from one Results message. Interim words are replaced by the next message; finals are kept. */
  onWords: (words: LiveWord[], isFinal: boolean) => void;
  /** Deepgram detected the end of an utterance; time of the last word's end. */
  onUtteranceEnd?: (lastWordEndMs: number) => void;
}

export interface SttSocket {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export interface SttDeps {
  fetchToken?: () => Promise<string>;
  openSocket?: (url: string, protocols: string[]) => SttSocket;
  /** Session clock in ms; marks when the audio stream started. */
  now?: () => number;
}

const OPEN = 1;
export const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen';

/** The listen URL with Vireo's settings and one `keyterm` per term. */
export function buildListenUrl(keyterms: readonly string[] = []): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    filler_words: 'true',
    vad_events: 'true',
    utterance_end_ms: '1000',
    endpointing: '300',
  });
  for (const t of keyterms) params.append('keyterm', t);
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}

async function defaultFetchToken(): Promise<string> {
  const res = await fetch('/api/stt-token', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Transcription token request failed (${res.status})`);
  if (!body.token) throw new Error('The server returned no transcription token.');
  return body.token;
}

function defaultOpenSocket(url: string, protocols: string[]): SttSocket {
  return new WebSocket(url, protocols) as unknown as SttSocket;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

export class DeepgramLiveClient {
  private ws: SttSocket | null = null;
  private closedByUser = false;
  /** Session time of the first audio sent: Deepgram's time zero. */
  private streamStartMs: number | null = null;
  private readonly fetchToken: () => Promise<string>;
  private readonly openSocket: (url: string, protocols: string[]) => SttSocket;
  private readonly now: () => number;

  constructor(
    private readonly keyterms: readonly string[],
    private readonly cb: SttCallbacks,
    deps: SttDeps = {}
  ) {
    this.fetchToken = deps.fetchToken ?? defaultFetchToken;
    this.openSocket = deps.openSocket ?? defaultOpenSocket;
    this.now = deps.now ?? (() => performance.now());
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
    let ws: SttSocket;
    try {
      ws = this.openSocket(buildListenUrl(this.keyterms), ['bearer', token]);
    } catch (err) {
      this.cb.onStatus('failed', `Couldn't open live transcription: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.cb.onStatus('connected');
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => this.cb.onStatus('failed', 'Live transcription lost its connection.');
    ws.onclose = (ev) => {
      if (this.closedByUser) this.cb.onStatus('closed');
      else this.cb.onStatus('failed', `Live transcription stopped (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`);
    };
  }

  /** Send 16 kHz 16-bit mono PCM, as raw bytes or base64. */
  sendAudio(pcm: ArrayBuffer | Uint8Array | string): void {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    if (this.streamStartMs === null) this.streamStartMs = this.now();
    this.ws.send(typeof pcm === 'string' ? base64ToBytes(pcm) : pcm);
  }

  private toSessionMs(seconds: number): number {
    return (this.streamStartMs ?? 0) + seconds * 1000;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'Results') {
      const channel = msg.channel as { alternatives?: { words?: DeepgramWord[] }[] } | undefined;
      const words = (channel?.alternatives?.[0]?.words ?? []).map((w) => ({
        text: w.punctuated_word ?? w.word,
        startMs: this.toSessionMs(w.start),
        endMs: this.toSessionMs(w.end),
      }));
      this.cb.onWords(words, msg.is_final === true);
    } else if (msg.type === 'UtteranceEnd' && typeof msg.last_word_end === 'number') {
      this.cb.onUtteranceEnd?.(this.toSessionMs(msg.last_word_end));
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.ws && this.ws.readyState === OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // ignore
      }
    }
    this.ws?.close(1000, 'Session ended');
    this.ws = null;
  }
}
