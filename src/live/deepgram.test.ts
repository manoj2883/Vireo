import { describe, expect, it, vi } from 'vitest';
import { DeepgramLiveClient, buildListenUrl, type SttSocket } from './deepgramLiveClient';
import { buildKeyterms } from './keyterms';

function fakeSocket() {
  const sent: unknown[] = [];
  const ws: SttSocket = {
    readyState: 1,
    send: (d) => void sent.push(typeof d === 'string' ? JSON.parse(d) : d),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  return { ws, sent };
}

async function connected(keyterms: string[] = [], clock = { t: 0 }) {
  const { ws, sent } = fakeSocket();
  const cb = { onStatus: vi.fn(), onWords: vi.fn(), onUtteranceEnd: vi.fn() };
  let opened: { url: string; protocols: string[] } | null = null;
  const client = new DeepgramLiveClient(keyterms, cb, {
    fetchToken: async () => 'jwt.temporary',
    openSocket: (url, protocols) => {
      opened = { url, protocols };
      return ws;
    },
    now: () => clock.t,
  });
  await client.connect();
  ws.onopen?.({});
  const receive = (msg: unknown) => ws.onmessage?.({ data: JSON.stringify(msg) });
  return { client, cb, sent, ws, receive, opened: opened! };
}

const results = (words: [string, number, number][], isFinal: boolean) => ({
  type: 'Results',
  is_final: isFinal,
  channel: { alternatives: [{ transcript: words.map((w) => w[0]).join(' '), words: words.map(([w, start, end]) => ({ word: w.toLowerCase().replace(/[^a-z']/g, ''), punctuated_word: w, start, end })) }] },
});

describe('buildListenUrl', () => {
  it('asks Nova-3 for English with interim results, fillers, VAD events and utterance ends', () => {
    const url = new URL(buildListenUrl());
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
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
  });

  it('repeats keyterm once per term, encoding spaces', () => {
    const url = buildListenUrl(['DiabEvidence', 'claim checking']);
    expect(url).toContain('keyterm=DiabEvidence&keyterm=claim+checking');
  });
});

describe('DeepgramLiveClient', () => {
  it('opens the socket with the temporary token as the bearer subprotocol', async () => {
    const { opened, cb } = await connected(['DiabEvidence']);
    expect(opened.protocols).toEqual(['bearer', 'jwt.temporary']);
    expect(opened.url).toContain('keyterm=DiabEvidence');
    expect(cb.onStatus).toHaveBeenLastCalledWith('connected');
  });

  it('streams raw PCM bytes, decoding base64', async () => {
    const { client, sent } = await connected();
    client.sendAudio(btoa('\x01\x02\x03'));
    expect(Array.from(sent[0] as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('converts word timings to the session clock from the first audio sent', async () => {
    const clock = { t: 0 };
    const { client, cb, receive } = await connected([], clock);
    clock.t = 1500; // the first audio goes out 1.5 s into the session
    client.sendAudio(new Uint8Array([0, 0]));
    receive(results([['So', 0.1, 0.3], ['basically,', 0.32, 0.9]], true));
    expect(cb.onWords).toHaveBeenCalledWith(
      [
        { text: 'So', startMs: 1600, endMs: 1800 },
        { text: 'basically,', startMs: 1820, endMs: 2400 },
      ],
      true
    );
  });

  it('marks interim results as not final', async () => {
    const { client, cb, receive } = await connected();
    client.sendAudio(new Uint8Array([0]));
    receive(results([['our', 0, 0.2]], false));
    expect(cb.onWords).toHaveBeenCalledWith([{ text: 'our', startMs: 0, endMs: 200 }], false);
  });

  it('reports utterance ends on the session clock', async () => {
    const clock = { t: 0 };
    const { client, cb, receive } = await connected([], clock);
    clock.t = 1000;
    client.sendAudio(new Uint8Array([0]));
    receive({ type: 'UtteranceEnd', channel: [0, 1], last_word_end: 2.5 });
    expect(cb.onUtteranceEnd).toHaveBeenCalledWith(3500);
  });

  it('ignores audio before the socket is open and metadata messages', async () => {
    const { client, sent, ws, receive, cb } = await connected();
    ws.readyState = 0;
    client.sendAudio(new Uint8Array([9]));
    expect(sent).toEqual([]);
    receive({ type: 'Metadata', request_id: 'r' });
    expect(cb.onWords).not.toHaveBeenCalled();
  });

  it('closes the stream politely', async () => {
    const { client, sent, ws } = await connected();
    client.close();
    expect(sent[sent.length - 1]).toEqual({ type: 'CloseStream' });
    expect(ws.close).toHaveBeenCalledWith(1000, 'Session ended');
  });

  it('reports a failed token request clearly', async () => {
    const cb = { onStatus: vi.fn(), onWords: vi.fn() };
    const client = new DeepgramLiveClient([], cb, { fetchToken: async () => Promise.reject(new Error('DEEPGRAM_API_KEY is not set on the server, so live transcription is off.')) });
    await client.connect();
    expect(cb.onStatus).toHaveBeenLastCalledWith('failed', 'DEEPGRAM_API_KEY is not set on the server, so live transcription is off.');
  });

  it('reports an unexpected close as a failure, and its own close as closed', async () => {
    const a = await connected();
    a.ws.onclose?.({ code: 1011, reason: 'NET-0001' });
    expect(a.cb.onStatus).toHaveBeenLastCalledWith('failed', 'Live transcription stopped (1011: NET-0001).');
    const b = await connected();
    b.client.close();
    b.ws.onclose?.({ code: 1000, reason: '' });
    expect(b.cb.onStatus).toHaveBeenLastCalledWith('closed');
  });
});

describe('buildKeyterms', () => {
  it('puts short key points and the story title first, then distinctive words', () => {
    const terms = buildKeyterms({
      prompt: 'Tell me about your research and why it matters.',
      storyTitle: 'The judge that learned to say no',
      keyPoints: ['Similarity thresholds failed', 'The two-stage judge', 'Next: measuring trust'],
    });
    expect(terms.slice(0, 3)).toEqual(['Similarity thresholds failed', 'The two-stage judge', 'Next measuring trust']);
    expect(terms).toContain('research');
    for (const common of ['tell', 'about', 'your', 'why', 'matters', 'the']) expect(terms.map((t) => t.toLowerCase())).not.toContain(common);
  });

  it('keeps acronyms and names ahead of ordinary words, without repeats', () => {
    const terms = buildKeyterms({ prompt: 'How does DiabEvidence use an LLM judge with PubMed and research research?' });
    expect(terms.slice(0, 3)).toEqual(['LLM', 'DiabEvidence', 'PubMed']);
    expect(terms.filter((t) => t === 'research')).toHaveLength(1);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Termword${i}`).join(' ');
    expect(buildKeyterms({ prompt: many })).toHaveLength(20);
  });

  it('is empty for an empty prompt', () => {
    expect(buildKeyterms({})).toEqual([]);
  });
});
