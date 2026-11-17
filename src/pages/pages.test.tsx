import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IDBFactory } from 'fake-indexeddb';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppRoutes } from '@/routes';
import { getCustomTerms, getSession, listStories, resetLocalDbConnection, saveSession, saveStory, type StoredSession } from '@/storage/localDb';
import { saveConfig } from '@/session/config';
import { fieldNotesRetry } from '@/session/fieldNotesApi';
import { PaceBand } from '@/components/hud/PaceBand';
import { LiveCaptions } from '@/components/hud/LiveCaptions';
import { EyeContactDot } from '@/components/hud/EyeContactDot';
import type { FieldNotes } from '@/types/fieldNotes';

// Decoding needs a real browser audio stack; the upload test supplies four seconds of quiet audio.
vi.mock('@/upload/recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/upload/recording')>()),
  decodeToMono16k: vi.fn(async () => new Float32Array(16_000 * 4)),
}));

function renderAt(path: string, state?: unknown) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

const words = 'so my research is about teaching ai systems to say no when they do not have the evidence and um the answers it refused were the right ones'.split(' ');

function storedSession(over: Partial<StoredSession> = {}): StoredSession {
  const segments = words.map((text, i) => ({ text, startMs: 400 + i * 350, endMs: 400 + i * 350 + 300, kind: text === 'um' ? ('filler' as const) : ('speech' as const) }));
  return {
    id: 'sess_1',
    createdAt: new Date().toISOString(),
    config: { prompt: 'Tell me about your research.', talkType: 'interview', mode: 'coach', audience: true, hideFace: false },
    segments,
    pauses: [{ startMs: 6000, endMs: 7200 }],
    transcript: [
      { speaker: 'user', text: words.slice(0, 16).join(' '), startMs: 400 },
      { speaker: 'user', text: words.slice(16).join(' '), startMs: segments[16].startMs },
    ],
    metrics: { durationMs: 12_000, wordCount: words.length, avgWpm: 150, timeInZonePct: 71, fillerCount: 1, fillersPerMin: 5, pauseCount: 1, pausesPerMin: 5, longestPauseMs: 1200 },
    take: { avgWpm: 150, inZoneRatio: 0.71, fillersPerMin: 5 },
    newBest: true,
    notesStatus: 'pending',
    ...over,
  };
}

const NOTES: FieldNotes = {
  verdict: 'Clear story. Rushed ending.',
  summary: 'You opened with the point. The middle held. The result came too fast.',
  scores: { structure: 82, delivery: 64, clarity: 77 },
  storyMap: { sections: [{ title: 'The point', startMs: 400, endMs: 5000, outlinePoint: null, status: null }] },
  notes: [
    { kind: 'keep', title: 'You led with the point.', body: 'Do it again.', quote: 'teaching ai systems to say no', startMs: 1800 },
    { kind: 'fix', title: 'You rushed your result.', body: 'Pause first.', quote: 'um the answers it refused', startMs: 6000 },
  ],
  audienceFollowUp: { question: 'How do you know the refusals were right?', reason: 'Your answer claimed it without saying how you checked.' },
  drills: [{ title: 'The full stop', instructions: 'Say the result, breathe, explain.', minutes: 4 }],
};

/** Only the field-notes requests (the page also asks for the tightened answer). */
const notesCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]) === '/api/field-notes');

function mockFetch(response: { ok: boolean; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: response.ok, status: response.ok ? 200 : 502, json: async () => response.body } as Response);
}

beforeEach(() => {
  fieldNotesRetry.delayMs = 30;
  globalThis.indexedDB = new IDBFactory();
  resetLocalDbConnection();
  // The warm-up preview and the live session ask for media; jsdom has none.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
  });
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => vi.restoreAllMocks());

describe('routes', () => {
  it('/ shows the launch page with the sonogram hero', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /see your voice/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /um, so basically, our results were/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try a session' })).toHaveAttribute('href', '/warm-up');
  });

  it('says the demo is resting and won’t start a session when the server has no keys', async () => {
    mockFetch({ ok: true, body: { status: 'ok', transcription: { provider: 'deepgram', configured: false }, fieldNotes: { name: 'gemini', configured: false } } });
    const { unmount } = renderAt('/');
    expect(await screen.findByText(/the public demo is resting\. run vireo locally in a few minutes\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See local setup' })).toHaveAttribute('href', 'https://github.com/manoj2883/Vireo#local-setup');
    expect(screen.getByRole('button', { name: 'Try a session' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Try a session' })).toBeNull();
    unmount();

    renderAt('/warm-up');
    await screen.findByText(/the public demo is resting/i);
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeDisabled();
  });

  it('shows no banner when the server has both keys', async () => {
    const spy = mockFetch({ ok: true, body: { transcription: { configured: true }, fieldNotes: { configured: true } } });
    renderAt('/');
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/health'));
    expect(screen.queryByText(/the public demo is resting/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Try a session' })).toHaveAttribute('href', '/warm-up');
  });

  it('/app welcomes a first-time speaker inside the app shell', async () => {
    renderAt('/app');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your first session starts here.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('/session without a warm-up goes to the warm-up', async () => {
    renderAt('/session');
    expect(await screen.findByRole('group', { name: 'What are you practising for?' })).toBeInTheDocument();
  });

  it('unknown paths show the not-found page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /nothing sings here/i })).toBeInTheDocument();
  });
});

describe('Warm-up', () => {
  it('starts on a situation card with starter questions, criteria and its pace zone', async () => {
    renderAt('/warm-up');
    expect(screen.getByRole('radio', { name: /job interview/i })).toBeChecked();
    expect(screen.getByLabelText('Your question')).toHaveValue('Tell me about yourself.');
    expect(screen.getByText('Answers the question within the first 20 seconds.')).toBeInTheDocument();
    expect(screen.getByText('130 to 160 wpm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /toast or big moment/i }));
    expect(screen.getByLabelText('Your question')).toHaveValue('Give a toast at a friend’s wedding.');
    expect(screen.getByText('110 to 140 wpm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Introduce a guest speaker.' }));
    expect(screen.getByLabelText('Your question')).toHaveValue('Introduce a guest speaker.');
  });

  it('shows a countdown note for the 60-second pitch', () => {
    renderAt('/warm-up');
    fireEvent.click(screen.getByRole('radio', { name: /60-second pitch/i }));
    expect(screen.getByText(/with a 60-second countdown/)).toBeInTheDocument();
  });

  it('lets you write your own question, choosing the kind of talk, and starts only with a prompt', () => {
    renderAt('/warm-up');
    fireEvent.click(screen.getByRole('radio', { name: /write my own question/i }));
    const prompt = screen.getByLabelText('What are you answering or presenting?');
    expect(prompt).toHaveValue('');
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Toast' }));
    expect(screen.getByText('110 to 140 wpm')).toBeInTheDocument();
    fireEvent.change(prompt, { target: { value: 'A toast for Sam' } });
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeEnabled();
  });

  it('fills the prompt, situation and drill from a reminder link, with no transcript in it', () => {
    renderAt('/warm-up?situation=presentation&prompt=Walk%20us%20through%20your%20results.&drill=The%20full%20stop');
    expect(screen.getByRole('radio', { name: /presentation or class talk/i })).toBeChecked();
    expect(screen.getByLabelText('Your question')).toHaveValue('Walk us through your results.');
    expect(screen.getByText(/today’s drill:/i).parentElement).toHaveTextContent('The full stop');
  });

  it('explains blocked camera and microphone access', async () => {
    renderAt('/warm-up');
    expect(await screen.findByText(/camera and microphone are blocked/i)).toBeInTheDocument();
  });

  it('picks the drill for the weakest skill when a rehearsal reminder opens, and flags the final run for questions', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, oneFix: { instruction: 'Cut the ums.', why: 'w', targetMetric: 'fillers_per_min', direction: 'lower' } } }));
    mockFetch({ ok: true, body: { transcription: { configured: true }, fieldNotes: { configured: true } } });
    const { unmount } = renderAt('/warm-up?prompt=Tell%20me%20about%20yourself.&situation=interview&drill=auto');
    const drill = await screen.findByText(/today’s drill:/i);
    expect(drill.parentElement?.textContent).toMatch(/um|filler|breath|first sentence/i);
    expect(drill.parentElement?.textContent).not.toContain('auto');
    unmount();
    renderAt('/warm-up?prompt=Tell%20me%20about%20yourself.&situation=interview&drill=Full%20run&final=1');
    fireEvent.click(screen.getByRole('button', { name: /start speaking/i }));
    expect(JSON.parse(sessionStorage.getItem('vireo-session-config')!)).toMatchObject({ takeQuestions: true, drill: 'Full run' });
  });

  it('saves the optional audience, goal and stakes with the session, cleaned', () => {
    mockFetch({ ok: true, body: { transcription: { configured: true }, fieldNotes: { configured: true } } });
    renderAt('/warm-up');
    fireEvent.click(screen.getByText('Who’s it for?'));
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: '  Investors at a seed fund ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Persuade' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(screen.getByText(/feedback stays focused and serious/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start speaking/i }));
    const saved = JSON.parse(sessionStorage.getItem('vireo-session-config')!);
    expect(saved.context).toEqual({ audience: 'Investors at a seed fund', goal: 'persuade', stakes: 'critical' });
  });

  it('takes a preset from the Story Bank', () => {
    renderAt('/warm-up', { preset: { prompt: 'The judge that learned to say no', talkType: 'pitch', mode: 'watch' } });
    expect(screen.getByLabelText('What are you answering or presenting?')).toHaveValue('The judge that learned to say no');
    expect(screen.getByRole('radio', { name: /watch silently/i })).toBeChecked();
    expect(screen.getByText('140 to 170 wpm')).toBeInTheDocument();
  });
});

describe('Live session', () => {
  it('explains a blocked microphone instead of failing silently', async () => {
    saveConfig({ prompt: 'Tell me about your research.', talkType: 'interview', mode: 'coach', audience: true, hideFace: false });
    renderAt('/session');
    expect(await screen.findByRole('heading', { name: 'Tell me about your research.' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs your microphone/i);
    expect(screen.getByRole('link', { name: 'Back to warm-up' })).toBeInTheDocument();
  });
});

describe('Try again', () => {
  it('keeps the one fix on screen, offers the teleprompter and counts down a pitch', async () => {
    saveConfig({
      prompt: 'Pitch your project to an investor.',
      situationId: 'pitch',
      talkType: 'pitch',
      mode: 'watch',
      audience: false,
      hideFace: false,
      retake: { fromSessionId: 's0', oneFix: 'Say the ask in your first ten seconds.', script: 'We help students / find the right office.' },
    });
    renderAt('/session');
    expect(await screen.findByTestId('one-fix-line')).toHaveTextContent('Your fix: Say the ask in your first ten seconds.');
    expect(screen.getByRole('timer')).toHaveTextContent('1:00 left');
    expect(screen.queryByTestId('teleprompter')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Teleprompter' }));
    expect(screen.getByTestId('teleprompter')).toHaveTextContent('We help students / find the right office.');
  });

  it('shows no fix line, teleprompter or countdown on a first take', async () => {
    saveConfig({ prompt: 'Tell me about yourself.', situationId: 'interview', talkType: 'interview', mode: 'watch', audience: true, hideFace: false });
    renderAt('/session');
    await screen.findByRole('heading', { name: 'Tell me about yourself.' });
    expect(screen.queryByTestId('one-fix-line')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Teleprompter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('Field notes', () => {
  it('writes the notes on first open and shows them beside the transcript', async () => {
    await saveSession(storedSession({ config: { ...storedSession().config, context: { goal: 'inform', stakes: 'important' } } }));
    const fetchSpy = mockFetch({ ok: true, body: NOTES });
    renderAt('/notes/sess_1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' })).toBeInTheDocument();
    expect(notesCalls(fetchSpy)).toHaveLength(1);
    expect(JSON.parse(String((notesCalls(fetchSpy)[0][1] as RequestInit).body)).context.speakingContext).toEqual({ goal: 'inform', stakes: 'important' });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.context).toMatchObject({ prompt: 'Tell me about your research.', paceZone: { min: 130, max: 160 } });
    expect(body.transcript).toHaveLength(2);

    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Keep this')).toBeInTheDocument();
    expect(screen.getByText('Fix next')).toBeInTheDocument();
    expect(screen.getByText(/1\.2 s pause/)).toBeInTheDocument(); // in the transcript; the drawing leaves room for note pins
    expect((await getSession('sess_1'))?.notesStatus).toBe('ready');
  });

  it('shows nothing for "Say it more naturally" when there are no lines', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, naturalPhrasing: [] } }));
    renderAt('/notes/sess_1');
    await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' });
    expect(screen.queryByRole('heading', { name: 'Say it more naturally' })).toBeNull();
  });

  it('shows "Say it more naturally", collapsed except for Speaking English with confidence', async () => {
    const naturalPhrasing = [{ original: 'so much joyful', natural: 'really happy', why: 'For a feeling, say happy.' }];
    for (const situationId of ['interview', 'english'] as const) {
      await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, naturalPhrasing }, config: { ...storedSession().config, situationId } }));
      const { unmount } = renderAt('/notes/sess_1');
      const heading = await screen.findByRole('heading', { name: 'Say it more naturally' });
      const details = heading.closest('details')!;
      expect(details.open).toBe(situationId === 'english');
      expect(within(details).getByText('really happy')).toBeInTheDocument();
      expect(within(details).getByText('so much joyful')).toBeInTheDocument();
      unmount();
    }
  });

  it('pins the selected note and seeks the transcript to its moment', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    const fix = await screen.findByRole('button', { name: /you rushed your result/i });
    fireEvent.click(fix);
    expect(fix).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /pinned: you rushed your result/i })).toBeInTheDocument();

    const playButtons = screen.getAllByRole('button', { name: 'Play this moment' });
    fireEvent.click(playButtons[1]);
    const current = document.querySelector('[aria-current="true"][data-start-ms]') as HTMLElement;
    expect(Number(current.dataset.startMs)).toBeLessThanOrEqual(6000);
    expect(current).toHaveTextContent(/um/);
  });

  it('shows the Audience mode follow-up when it was asked for', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    expect(await screen.findByText('“How do you know the refusals were right?”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /answer it now/i })).toBeInTheDocument();
  });

  it('tries again automatically once when the first request fails', async () => {
    await saveSession(storedSession());
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: 'gemini request failed: 503 high demand' }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => NOTES } as Response);
    fieldNotesRetry.delayMs = 300;
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Busy, trying again' })).toBeInTheDocument();
    expect(screen.getByText(/your drawing and transcript are already saved/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' }, { timeout: 3000 })).toBeInTheDocument();
    expect(notesCalls(fetchSpy)).toHaveLength(2);
  });

  it('keeps the drawing and offers a retry when notes fail twice', async () => {
    await saveSession(storedSession());
    const fetchSpy = mockFetch({ ok: false, body: { error: 'gemini request failed: 429 rate limited' } });
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('alert')).toHaveTextContent('gemini request failed: 429 rate limited');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/your drawing and transcript are saved on this device/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /the whole answer as a sonogram/i })).toBeInTheDocument();

    mockFetch({ ok: true, body: NOTES });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' })).toBeInTheDocument();
  });

  it('asks for a longer answer without calling the server when too few words were heard', async () => {
    await saveSession(storedSession({ segments: storedSession().segments.slice(0, 5) }));
    const fetchSpy = mockFetch({ ok: true, body: NOTES });
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 20 words, and Vireo heard 5/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says when notes were left out for lack of evidence', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, notes: [], droppedNotes: 2 } }));
    renderAt('/notes/sess_1');
    expect(await screen.findByText(/couldn’t back any notes with your exact words/i)).toBeInTheDocument();
    expect(screen.getByText(/2 notes were left out this time/)).toBeInTheDocument();
  });

  it('saves the answer to the Story Bank', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    fireEvent.click(await screen.findByRole('button', { name: 'Save to Story Bank' }));
    expect(await screen.findByText('Saved to your Story Bank.')).toBeInTheDocument();
    const [story] = await listStories('story');
    expect(story).toMatchObject({ title: 'Tell me about your research.', keyPoints: ['The point'], lastSessionId: 'sess_1' });
  });
});

describe('Deleting', () => {
  it('deletes a session from its field notes after confirming', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session' }));
    expect(screen.getByText(/this deletes the transcript, drawing and notes from this device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your first session starts here.' })).toBeInTheDocument();
    expect(await getSession('sess_1')).toBeUndefined();
  });

  it('keeps the session when the delete is cancelled', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Delete session' })).toBeInTheDocument();
    expect(await getSession('sess_1')).toBeDefined();
  });

  it('deletes all data from Home', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/app');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all data' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Your first session starts here.' })).toBeInTheDocument();
    expect(await getSession('sess_1')).toBeUndefined();
  });
});

describe('Upload a real talk', () => {
  it('transcribes the audio with Deepgram directly, saves it as a session, and labels it from a recording', async () => {
    const words = Array.from({ length: 24 }, (_, i) => ({ word: 'word', punctuated_word: i === 23 ? 'word.' : 'word', start: 0.1 + i * 0.15, end: 0.2 + i * 0.15 }));
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      const body = u === '/api/stt-token' ? { token: 'jwt' } : u.startsWith('https://api.deepgram.com/v1/listen') ? { results: { channels: [{ alternatives: [{ words }] }] } } : u === '/api/field-notes' ? NOTES : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    renderAt('/upload');
    expect(screen.getByText(/video stays on this device/i)).toBeInTheDocument();
    const file = new File([new Uint8Array(8)], 'my-talk.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Audio or video file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyse this recording' }));
    expect(await screen.findByTestId('from-recording')).toHaveTextContent('From a recording');
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/stt-token');
    // The audio never goes through the Vireo server.
    const serverCalls = spy.mock.calls.filter((c) => String(c[0]).startsWith('/api'));
    expect(serverCalls.every((c) => !((c[1] as RequestInit | undefined)?.body instanceof Blob))).toBe(true);
  });
});

describe('Trust page', () => {
  it('is linked from the launch footer and Home', async () => {
    const { unmount } = renderAt('/');
    expect(screen.getByRole('link', { name: 'Trust and privacy' })).toHaveAttribute('href', '/trust');
    unmount();
    renderAt('/app');
    expect(await screen.findByRole('link', { name: /everything that leaves this device/i })).toHaveAttribute('href', '/trust');
  });

  it('lists what stays, every data flow, what Vireo never does, and unpublished accuracy honestly', () => {
    renderAt('/trust');
    expect(screen.getByRole('heading', { level: 1, name: 'What happens to your voice' })).toBeInTheDocument();
    const leaves = screen.getByRole('region', { name: 'Leaves this device' });
    for (const name of ['Deepgram', 'Google Gemini', 'Upstash Redis', 'Vercel', 'Google Fonts', 'jsDelivr']) expect(within(leaves).getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vireo never' })).toHaveTextContent(/never what you felt/);
    expect(screen.getByRole('region', { name: 'Current accuracy' })).toHaveTextContent(/Not published yet.*at least 10 real recordings/);
    expect(screen.getByRole('link', { name: 'MIT licence' })).toHaveAttribute('href', 'https://github.com/manoj2883/Vireo/blob/main/LICENSE');
    expect(screen.getByRole('link', { name: 'run it yourself' })).toHaveAttribute('href', 'https://github.com/manoj2883/Vireo#local-setup');
  });

  it('deletes all data', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/trust');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Everything Vireo kept on this device is gone.');
    expect(await getSession('sess_1')).toBeUndefined();
  });
});

describe('Home', () => {
  it('builds the headline and numbers from real sessions', async () => {
    const day = 86_400_000;
    await saveSession(storedSession({ id: 'a', createdAt: new Date(Date.now() - 20 * day).toISOString(), metrics: { ...storedSession().metrics, fillersPerMin: 5.4 } }));
    await saveSession(
      storedSession({ id: 'b', createdAt: new Date(Date.now() - day).toISOString(), notesStatus: 'ready', notes: NOTES, metrics: { ...storedSession().metrics, fillersPerMin: 2.1 } })
    );
    renderAt('/app');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your fillers are down by more than half.' })).toBeInTheDocument();
    expect(screen.getByText(/from 5\.4 a minute in your first session to 2\.1/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The full stop' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your last 2 sessions, drawn/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2\.1 fillers a minute\. open field notes/i })).toHaveAttribute('href', '/notes/b');
    expect(screen.getByText('Follow-up question waiting')).toBeInTheDocument();
  });

  it('saves the words Vireo should know on this device', async () => {
    renderAt('/app');
    const section = await screen.findByRole('region', { name: 'Words Vireo should know' });
    const input = within(section).getByRole('textbox');
    await waitFor(() => expect(input).toHaveValue(''));
    fireEvent.change(input, { target: { value: 'Jordan Lee,  Acme Robotics, LangGraph, langgraph' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Save words' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Saved 3 words.');
    expect(input).toHaveValue('Jordan Lee, Acme Robotics, LangGraph');
    expect(await getCustomTerms()).toEqual(['Jordan Lee', 'Acme Robotics', 'LangGraph']);
  });
});

describe('Story Bank', () => {
  it('builds a story through the interviewer, one question at a time, then rehearses it', async () => {
    const filled = { hook: 'the demo crashed', stakes: null, turn: null, payoff: null, image: null, lesson: null, landing: null };
    const story = { title: 'The crash', script: 'The demo crashed. We fixed it. Rehearse the failure.', keyPoints: ['The crash', 'The fix'] };
    const all = { hook: 'a', stakes: 'b', turn: 'c', payoff: 'd', image: 'e', lesson: 'Rehearse the failure', landing: 'g' };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ filled, done: false, question: 'What did your manager say?', story: null }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ filled: all, done: true, question: null, story }) } as Response);
    renderAt('/stories');
    fireEvent.click(await screen.findByRole('button', { name: 'Build a story with me' }));
    const log = screen.getByRole('list', { name: 'Interview' });
    expect(log).toHaveTextContent('When was it, and where were you?');
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Tuesday night, the demo crashed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(await within(log).findByText('What did your manager say?')).toBeInTheDocument();
    expect(screen.getByText('1 of 7 found in your answers.')).toBeInTheDocument();
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
    expect(body.turns).toEqual([
      { role: 'coach', text: 'Think of the moment this story is about. When was it, and where were you?' },
      { role: 'speaker', text: 'Tuesday night, the demo crashed.' },
    ]);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'We cancel or we fix it now.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(await screen.findByTestId('interview-story')).toHaveTextContent('The demo crashed. We fixed it. Rehearse the failure.');
    fireEvent.click(screen.getByRole('button', { name: 'Rehearse this story' }));
    expect(await screen.findByLabelText('What are you answering or presenting?')).toHaveValue('The crash');
    const saved = (await listStories('story'))[0];
    expect(saved).toMatchObject({ title: 'The crash', keyPoints: ['The crash', 'The fix'], script: story.script, gist: 'Rehearse the failure', length: '30 seconds' });
  });

  it('keeps the answer when the interviewer fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Too many field notes requests this hour.' }) } as Response);
    renderAt('/stories');
    fireEvent.click(await screen.findByRole('button', { name: 'Build a story with me' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Last spring.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many field notes requests this hour. Your answer is still in the box.');
    expect(screen.getByLabelText('Your answer')).toHaveValue('Last spring.');
  });

  it('creates a story with key points and offers to rehearse it', async () => {
    renderAt('/stories');
    expect(await screen.findByText('No stories yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New story' }));
    const form = screen.getByRole('form', { name: 'New story' });
    fireEvent.change(within(form).getByLabelText('Title, or the question it answers'), { target: { value: 'The judge that learned to say no' } });
    fireEvent.change(within(form).getByLabelText('Key points, one per line'), { target: { value: 'Thresholds failed\nThe two-stage judge\n' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    });
    const card = await screen.findByRole('article', { name: 'The judge that learned to say no' });
    expect(within(card).getByText('Thresholds failed')).toBeInTheDocument();
    expect(within(card).getByText('Not rehearsed yet')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Rehearse' })).toBeInTheDocument();
  });

  it('marks key points hit or missed from the last rehearsal', async () => {
    const now = new Date().toISOString();
    const notes: FieldNotes = {
      ...NOTES,
      storyMap: {
        sections: [
          { title: 'Thresholds', startMs: 0, endMs: 3000, outlinePoint: 'Thresholds failed', status: 'hit' },
          { title: 'The judge', startMs: null, endMs: null, outlinePoint: 'The two-stage judge', status: 'missed' },
        ],
      },
    };
    await saveSession(storedSession({ id: 'r1', notesStatus: 'ready', notes }));
    await saveStory({ id: 'st1', kind: 'story', title: 'The judge', tag: 'Research', length: '2 minutes', gist: '', keyPoints: ['Thresholds failed', 'The two-stage judge'], createdAt: now, updatedAt: now, lastSessionId: 'r1' });
    renderAt('/stories');
    const card = await screen.findByRole('article', { name: 'The judge' });
    expect(within(card).getByText(', hit last time')).toBeInTheDocument();
    expect(within(card).getByText(', missed last time')).toBeInTheDocument();
    expect(within(card).getByText('Rehearsed today')).toBeInTheDocument();
  });

  it('switches between Stories and Bits with the arrow keys', async () => {
    renderAt('/stories');
    const stories = await screen.findByRole('tab', { name: /stories/i });
    stories.focus();
    fireEvent.keyDown(stories, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /bits/i })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: /bits/i })).toHaveFocus();
    expect(await screen.findByText('No bits yet.')).toBeInTheDocument();
  });
});

describe('PaceBand', () => {
  it('rings the dot when rushing, so colour is not the only signal', () => {
    render(<PaceBand wpm={184} zone={{ min: 130, max: 160 }} ghostWpm={146} rushing />);
    expect(screen.getByTestId('pace-dot')).toHaveAttribute('data-rushing', 'true');
    expect(screen.getByTestId('ghost-dot')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Speaking pace' })).toHaveAttribute('aria-valuetext', '184 words a minute, faster than your zone');
  });

  it('shows no dot and a dash while silent', () => {
    render(<PaceBand wpm={null} zone={{ min: 130, max: 160 }} />);
    expect(screen.queryByTestId('pace-dot')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('LiveCaptions', () => {
  const word = (text: string, startMs: number, interim = false, kind: 'speech' | 'filler' = 'speech') => ({ text, startMs, endMs: startMs + 200, kind, interim });

  it('shows the growing paragraph, interim words lighter, and the previous paragraph faded', () => {
    render(
      <LiveCaptions
        placeholder="Start speaking"
        captions={{ previous: [word('First', 0), word('thought.', 300)], current: [word('Um,', 2000, false, 'filler'), word('second', 2300), word('idea', 2600, true)] }}
      />
    );
    expect(screen.getByTestId('caption-previous')).toHaveTextContent('First thought.');
    expect(screen.getByTestId('caption-previous').className).toMatch(/opacity-45/);
    const current = screen.getByTestId('caption-current');
    expect(current).toHaveTextContent('Um, second idea');
    expect(within(current).getByText(/idea/)).toHaveAttribute('data-interim', 'true');
    expect(within(current).getByText(/Um,/)).toHaveClass('italic', 'text-amber');
  });

  it('shows the placeholder before anything is said', () => {
    render(<LiveCaptions placeholder="Start speaking when you’re ready." captions={{ previous: null, current: [] }} />);
    expect(screen.getByText('Start speaking when you’re ready.')).toBeInTheDocument();
  });
});

describe('camera feedback', () => {
  const camera = {
    events: [
      { id: 'cam-1', kind: 'look-away' as const, startMs: 6000, endMs: 9000, value: 30 },
      { id: 'cam-2', kind: 'smile' as const, startMs: 500, endMs: 2500, value: 0.7 },
    ],
    summary: { eyeContactPct: 72, longestLookAwayMs: 3000, postureAlerts: 0, gestureRate: 4, smilePct: 18, trackedMs: 12_000 },
  };

  it('dims the eye-contact dot after looking away, with a shape change too', () => {
    const { rerender } = render(<EyeContactDot eyeContact={{ looking: true, dim: false }} />);
    expect(screen.getByRole('status', { name: 'Eye contact: on' })).not.toHaveAttribute('data-dim');
    rerender(<EyeContactDot eyeContact={{ looking: false, dim: true }} />);
    expect(screen.getByRole('status', { name: 'Eye contact: looking away' })).toHaveAttribute('data-dim', 'true');
  });

  it('shows nothing without camera feedback', () => {
    const { container } = render(<EyeContactDot eyeContact={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends camera events with the field notes request and shows the eye-contact strip', async () => {
    await saveSession(storedSession({ camera }));
    const fetchSpy = mockFetch({ ok: true, body: { ...NOTES, notes: [...NOTES.notes, { kind: 'fix', title: 'You looked away at your result.', body: 'Keep your eyes up.', quote: '', cameraEventId: 'cam-1', startMs: 6000 }] } });
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' })).toBeInTheDocument();
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.context.camera.events.map((e: { id: string }) => e.id)).toEqual(['cam-1', 'cam-2']);
    expect(screen.getByTestId('eye-contact-strip').querySelectorAll('[data-away]')).toHaveLength(1);
    expect(screen.getByText(/eye contact 72% of the time/i)).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'You looked away at your result.' });
    expect(within(card).getByText('Camera')).toBeInTheDocument();
    expect(within(card).queryByText(/“/)).not.toBeInTheDocument();
  });

  it('leaves the strip out when the camera was not analysed', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES }));
    renderAt('/notes/sess_1');
    await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' });
    expect(screen.queryByTestId('eye-contact-strip')).not.toBeInTheDocument();
  });
});

describe('Story coach', () => {
  const beats = {
    present: [
      { kind: 'hook' as const, quote: 'teaching ai systems to say no', startMs: 1800 },
      { kind: 'payoff' as const, quote: 'the answers it refused were the right ones', startMs: 7000 },
    ],
    missing: [
      { kind: 'stakes' as const, suggestion: 'Say what would happen if they said yes.' },
      { kind: 'turn' as const, suggestion: null },
      { kind: 'landing' as const, suggestion: null },
    ],
  };

  it('shows which story beats are present, pins them, and suggests what to add', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, storyBeats: beats, droppedBeats: 1 }, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    const { container } = renderAt('/notes/sess_1');
    const section = await screen.findByRole('region', { name: 'Story beats' });
    expect(section).toHaveTextContent('2 of 5 in your answer');
    expect(section.querySelector('[data-beat="hook"]')).toHaveTextContent('teaching ai systems to say no');
    expect(section.querySelector('[data-beat="stakes"]')).toHaveTextContent('Missing');
    expect(section.querySelector('[data-beat="stakes"]')).toHaveTextContent('Try: Say what would happen if they said yes.');
    expect(section).toHaveTextContent('1 beat was left out');
    expect(container.querySelectorAll('[data-testid="markers"] text')).toHaveLength(2);
    expect(screen.getByRole('img', { name: /story beats: hook at 0:01, payoff at 0:07/i })).toBeInTheDocument();
  });

  it('offers landing lines only when the answer doesn’t land', async () => {
    const landing = { hasClearClose: false, suggestions: ['The answers it refused were the right ones.'] };
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, landing }, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    const { unmount } = renderAt('/notes/sess_1');
    expect(await screen.findByRole('region', { name: /didn’t land on a clear line/i })).toHaveTextContent('The answers it refused were the right ones.');
    unmount();
    await saveSession(storedSession({ notesStatus: 'ready', notes: { ...NOTES, landing: { hasClearClose: true, suggestions: [] } }, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    renderAt('/notes/sess_1');
    await screen.findByRole('heading', { name: 'Clear story. Rushed ending.' });
    expect(screen.queryByRole('region', { name: /didn’t land/i })).toBeNull();
  });

  it('marks long stretches where attention may drift and where a lighter beat was due', async () => {
    const segments = Array.from({ length: 600 }, (_, i) => ({ text: i % 7 === 6 ? 'process.' : 'method', startMs: i * 400, endMs: i * 400 + 300, kind: 'speech' as const }));
    await saveSession(
      storedSession({
        segments,
        transcript: [{ speaker: 'user', text: segments.map((s) => s.text).join(' '), startMs: 0 }],
        metrics: { ...storedSession().metrics, durationMs: 240_000 },
        notesStatus: 'ready',
        notes: NOTES,
        tightened: { script: 'x', mainPoint: 'x', status: 'ready' },
      })
    );
    const { container } = renderAt('/notes/sess_1');
    expect(await screen.findByTestId('attention-note')).toHaveTextContent('Attention may drift there');
    expect(container.querySelector('[data-testid="bands"]')).toHaveTextContent('Attention may drift here');
    expect(screen.getByTestId('lightness-cues')).toHaveTextContent('Try a callback');
  });
});

describe('A coach that knows you', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const withFix = (targetMetric: 'fillers_per_min' | 'time_in_zone_pct', extra: Partial<FieldNotes> = {}): FieldNotes => ({
    ...NOTES,
    oneFix: { instruction: 'Cut the ums.', why: 'w', targetMetric, direction: 'lower' },
    ...extra,
  });

  /** Two questions, each retaken twice, adopting the fillers fix three times out of four. */
  async function seedMastery() {
    let n = 0;
    for (const [root, values] of [
      ['q1', [5, 3, 2]],
      ['q2', [6, 4, 3.8]],
    ] as const) {
      for (const [i, f] of values.entries()) {
        n++;
        await saveSession(
          storedSession({
            id: i === 0 ? root : `${root}-${i}`,
            createdAt: minutesAgo(100 - n),
            retakeOf: i === 0 ? undefined : root,
            config: { ...storedSession().config, prompt: root === 'q1' ? 'Tell me about yourself.' : 'Why this role?' },
            notesStatus: 'ready',
            notes: withFix('fillers_per_min'),
            metrics: { ...storedSession().metrics, fillersPerMin: f },
          })
        );
      }
    }
  }

  it('shows skills by status and this week’s plan on Home', async () => {
    await seedMastery();
    renderAt('/app');
    const skills = await screen.findByRole('region', { name: 'Your skills' });
    expect(within(skills).getByRole('list', { name: 'Mastered' })).toHaveTextContent('Fewer fillers');
    expect(within(skills).getByRole('list', { name: 'Mastered' })).toHaveTextContent('Adopted in 3 of your last 4 retakes');
    const plan = await screen.findByRole('region', { name: 'This week’s plan' });
    expect(within(plan).getAllByRole('button', { name: /start this drill/i })).toHaveLength(3);
    fireEvent.click(within(plan).getAllByRole('button', { name: /start this drill/i })[0]);
    expect(await screen.findByText(/today’s drill:/i)).toBeInTheDocument();
  });

  it('tells the field notes your mastered skills and your personal best on this question', async () => {
    await seedMastery();
    await saveSession(storedSession({ id: 'now', createdAt: minutesAgo(1), config: { ...storedSession().config, prompt: 'Tell me about yourself.', confidenceMode: true } }));
    const spy = mockFetch({ ok: true, body: NOTES });
    renderAt('/notes/now');
    await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' });
    const context = JSON.parse(String((notesCalls(spy)[0][1] as RequestInit).body)).context;
    expect(context.masteredSkills).toEqual(['fillers_per_min']);
    expect(context.personalBest).toMatchObject({ scope: 'question', fillersPerMin: 2 });
    expect(context.confidenceMode).toBe(true);
  });

  it('shows recurring phrasing patterns on Speaking English with confidence', async () => {
    const phr = (o: string, n: string) => ({ original: o, natural: n, why: 'w' });
    await saveSession(storedSession({ id: 'e1', createdAt: minutesAgo(30), config: { ...storedSession().config, situationId: 'english' }, notesStatus: 'ready', notes: { ...NOTES, naturalPhrasing: [phr('in Monday', 'on Monday')] } }));
    await saveSession(storedSession({ id: 'e2', createdAt: minutesAgo(20), config: { ...storedSession().config, situationId: 'english' }, notesStatus: 'ready', notes: { ...NOTES, naturalPhrasing: [phr('in the weekend', 'on the weekend')] } }));
    renderAt('/app');
    const section = await screen.findByRole('region', { name: 'Speaking English with confidence' });
    expect(section).toHaveTextContent('Prepositions');
    expect(section).toHaveTextContent('2 times across 2 sessions');
    expect(section).toHaveTextContent('on the weekend');
  });

  it('confidence mode: breathing first, camera off, pause ring only, and notes that start with what went well', async () => {
    mockFetch({ ok: true, body: { transcription: { configured: true }, fieldNotes: { configured: true } } });
    const { unmount } = renderAt('/warm-up');
    fireEvent.click(screen.getByRole('switch', { name: /confidence mode/i }));
    fireEvent.click(screen.getByRole('button', { name: /start speaking/i }));
    expect(screen.getByRole('heading', { name: 'A minute to settle in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Breathe in');
    fireEvent.click(screen.getByRole('button', { name: /i’m ready, start speaking/i }));
    expect(await screen.findByTestId('camera-off')).toHaveTextContent('Camera off for this first take');
    expect(screen.getByTestId('calm-hud')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Live captions' })).toBeNull();
    unmount();

    await saveSession(storedSession({ config: { ...storedSession().config, confidenceMode: true }, notesStatus: 'ready', notes: withFix('fillers_per_min') }));
    renderAt('/notes/sess_1');
    const wentWell = await screen.findByTestId('went-well');
    expect(wentWell).toHaveTextContent('What went well');
    expect(wentWell.compareDocumentPosition(screen.getByText('Your one fix for the next take')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('One fix and your answer, tightened', () => {
  const ONE_FIX = { ...NOTES, oneFix: { instruction: 'Give your result a full pause before you say it.', why: 'It lands harder.' }, mainPointMs: 2000 };
  const TIGHT = { script: 'The answers it refused were the right ones. / My research is about teaching AI systems to say no.', mainPoint: 'The answers it refused were the right ones.' };

  function routeFetch() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url) === '/api/tighten' ? TIGHT : ONE_FIX;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
  }

  it('opens with the one fix as the heading, then asks for the tightened answer', async () => {
    await saveSession(storedSession());
    const spy = routeFetch();
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Give your result a full pause before you say it.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Clear story. Rushed ending.' })).toBeInTheDocument();
    expect(await screen.findByText(/^The answers it refused were the right ones\.\s*$/)).toBeInTheDocument();
    const tightenCall = spy.mock.calls.find((c) => String(c[0]) === '/api/tighten')!;
    expect(JSON.parse((tightenCall[1] as RequestInit).body as string).context.oneFix).toBe('Give your result a full pause before you say it.');
    expect((await getSession('sess_1'))?.tightened?.status).toBe('ready');
  });

  it('shows what changed: removed words struck through, pauses kept', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: ONE_FIX, tightened: { ...TIGHT, status: 'ready' } }));
    renderAt('/notes/sess_1');
    fireEvent.click(await screen.findByRole('switch', { name: 'Show changes' }));
    const changes = screen.getByTestId('tightened-changes');
    expect(within(changes).getAllByText(/^um$/i)[0].closest('del')).not.toBeNull();
    expect(within(changes).getByLabelText('pause')).toBeInTheDocument();
  });

  it('reruns the same question with the fix carried along', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: ONE_FIX, tightened: { ...TIGHT, status: 'ready' } }));
    renderAt('/notes/sess_1');
    fireEvent.click(await screen.findByRole('button', { name: /try again with this fix/i }));
    const saved = JSON.parse(sessionStorage.getItem('vireo-session-config')!);
    expect(saved).toMatchObject({ prompt: 'Tell me about your research.', retake: { fromSessionId: 'sess_1', oneFix: 'Give your result a full pause before you say it.', script: TIGHT.script } });
  });

  it('explains a failed tightening and offers to try again', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: ONE_FIX, tightened: { script: '', mainPoint: '', status: 'failed', error: 'gemini returned unusable tightened answers twice' } }));
    renderAt('/notes/sess_1');
    const alert = await screen.findByText(/unusable tightened answers/);
    expect(alert.parentElement).toHaveTextContent('Try again');
  });
});

describe('Before and after', () => {
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  async function seedPair() {
    await saveSession(storedSession({ id: 'sess_0', createdAt: day(2), notesStatus: 'ready', notes: { ...NOTES, mainPointMs: 20_000 }, metrics: { ...storedSession().metrics, fillersPerMin: 6, timeInZonePct: 40 } }));
    await saveSession(
      storedSession({
        id: 'sess_1',
        createdAt: day(1),
        retakeOf: 'sess_0',
        config: { ...storedSession().config, retake: { fromSessionId: 'sess_0', oneFix: 'Lead with your result.' } },
        notesStatus: 'ready',
        notes: { ...NOTES, mainPointMs: 4000, previousFix: { achieved: true, evidence: 'the answers it refused were the right ones', startMs: 4000 } },
        tightened: { script: 'x', mainPoint: 'x', status: 'ready' },
        metrics: { ...storedSession().metrics, fillersPerMin: 2, timeInZonePct: 70 },
      })
    );
  }

  it('shows both sonograms, what changed and whether the fix was achieved', async () => {
    await seedPair();
    renderAt('/notes/sess_1');
    const section = await screen.findByRole('region', { name: 'Before and after' });
    expect(within(section).getAllByRole('img')).toHaveLength(2);
    expect(within(section).getByTestId('fix-result')).toHaveTextContent('Your fix: Lead with your result. The notes heard it in your words.');
    const changes = within(section).getByRole('list', { name: 'What changed' });
    expect(changes).toHaveTextContent('Fillers down from 6.0 a minute to 2.0 a minute.');
    expect(changes).toHaveTextContent('Time to the main point down from 20.0 s to 4.0 s.');
  });

  it('is not shown on a first take', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    renderAt('/notes/sess_1');
    await screen.findByRole('heading', { name: 'Clear story. Rushed ending.' });
    expect(screen.queryByRole('region', { name: 'Before and after' })).not.toBeInTheDocument();
  });

  it('puts the best improvement of the week on Home', async () => {
    await seedPair();
    renderAt('/app');
    const week = await screen.findByRole('region', { name: 'Your best improvement this week' });
    expect(week).toHaveTextContent('Time to the main point down from 20.0 s to 4.0 s.');
  });

  it('shows fix adoption measured on the device', async () => {
    await seedPair();
    const first = (await getSession('sess_0'))!;
    await saveSession({ ...first, notes: { ...first.notes!, oneFix: { instruction: 'Cut the ums.', why: 'w', targetMetric: 'fillers_per_min', direction: 'lower' } } });
    renderAt('/notes/sess_1');
    expect(await screen.findByTestId('fix-adoption')).toHaveTextContent('Fix adopted ✓ — fillers 6.0 → 2.0 a minute');
  });

  it('puts “How this was scored” under every score and headline number', async () => {
    await seedPair();
    for (const path of ['/notes/sess_1', '/app']) {
      const { container, unmount } = renderAt(path);
      await waitFor(() => expect(container.querySelectorAll('[data-score]').length).toBeGreaterThan(3));
      const scored = [...container.querySelectorAll<HTMLElement>('[data-score]')];
      for (const el of scored) {
        const id = el.dataset.score!;
        expect(el.querySelector(`[data-how-scored="${id}"]`), `${path}: ${id} has no explanation`).not.toBeNull();
      }
      unmount();
    }
  });
});

describe('Take it with you', () => {
  it('offers the report with words off by default, and three reminder days once a date is picked', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    renderAt('/notes/sess_1');
    const section = await screen.findByRole('region', { name: 'Take it with you' });
    expect(within(section).getByRole('checkbox', { name: /include my words/i })).not.toBeChecked();
    expect(within(section).getByRole('button', { name: 'Apple Calendar / Outlook desktop (.ics)' })).toBeDisabled();
    expect(within(section).queryByRole('list', { name: 'Google Calendar reminders' })).toBeNull();

    const inTen = new Date();
    inTen.setDate(inTen.getDate() + 10);
    const day = `${inTen.getFullYear()}-${String(inTen.getMonth() + 1).padStart(2, '0')}-${String(inTen.getDate()).padStart(2, '0')}`;
    fireEvent.change(within(section).getByLabelText(/when is the real interview/i), { target: { value: day } });
    expect(within(within(section).getByRole('list', { name: 'Rehearsal days' })).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).getByRole('button', { name: 'Apple Calendar / Outlook desktop (.ics)' })).toBeEnabled();
    for (const name of ['Google Calendar reminders', 'Outlook.com reminders']) {
      const links = within(within(section).getByRole('list', { name })).getAllByRole('link');
      expect(links).toHaveLength(3);
      for (const a of links) {
        expect(a).toHaveAttribute('target', '_blank');
        expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  it('explains a date that is too soon', async () => {
    await saveSession(storedSession({ notesStatus: 'ready', notes: NOTES, tightened: { script: 'x', mainPoint: 'x', status: 'ready' } }));
    renderAt('/notes/sess_1');
    const section = await screen.findByRole('region', { name: 'Take it with you' });
    const soon = new Date();
    soon.setDate(soon.getDate() + 1);
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    fireEvent.change(within(section).getByLabelText(/when is the real interview/i), { target: { value: day } });
    expect(within(section).getByRole('alert')).toHaveTextContent(/at least 4 days away/);
  });
});
