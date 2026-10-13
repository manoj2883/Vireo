import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IDBFactory } from 'fake-indexeddb';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppRoutes } from '@/routes';
import { getSession, listStories, resetLocalDbConnection, saveSession, saveStory, type StoredSession } from '@/storage/localDb';
import { saveConfig } from '@/session/config';
import { PaceBand } from '@/components/hud/PaceBand';
import type { FieldNotes } from '@/types/fieldNotes';

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

function mockFetch(response: { ok: boolean; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: response.ok, status: response.ok ? 200 : 502, json: async () => response.body } as Response);
}

beforeEach(() => {
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

  it('/app welcomes a first-time speaker inside the app shell', async () => {
    renderAt('/app');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your first session starts here.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('/session without a warm-up goes to the warm-up', async () => {
    renderAt('/session');
    expect(await screen.findByLabelText('What are you answering or presenting?')).toBeInTheDocument();
  });

  it('unknown paths show the not-found page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /nothing sings here/i })).toBeInTheDocument();
  });
});

describe('Warm-up', () => {
  it('sets the pace zone from the kind of talk and starts only with a prompt', async () => {
    renderAt('/warm-up');
    expect(screen.getByText('130 to 160 wpm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toast' }));
    expect(screen.getByRole('button', { name: 'Toast' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('110 to 140 wpm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What are you answering or presenting?'), { target: { value: 'A toast for Sam' } });
    expect(screen.getByRole('button', { name: /start speaking/i })).toBeEnabled();
  });

  it('explains blocked camera and microphone access', async () => {
    renderAt('/warm-up');
    expect(await screen.findByText(/camera and microphone are blocked/i)).toBeInTheDocument();
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

describe('Field notes', () => {
  it('writes the notes on first open and shows them beside the transcript', async () => {
    await saveSession(storedSession());
    const fetchSpy = mockFetch({ ok: true, body: NOTES });
    renderAt('/notes/sess_1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clear story. Rushed ending.' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.context).toMatchObject({ prompt: 'Tell me about your research.', paceZone: { min: 130, max: 160 } });
    expect(body.transcript).toHaveLength(2);

    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Keep this')).toBeInTheDocument();
    expect(screen.getByText('Fix next')).toBeInTheDocument();
    expect(screen.getAllByText(/1\.2 s pause/).length).toBeGreaterThanOrEqual(2); // in the drawing and the transcript
    expect((await getSession('sess_1'))?.notesStatus).toBe('ready');
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

  it('keeps the drawing and offers a retry when notes fail', async () => {
    await saveSession(storedSession());
    mockFetch({ ok: false, body: { error: 'gemini request failed: 429 rate limited' } });
    renderAt('/notes/sess_1');
    expect(await screen.findByRole('alert')).toHaveTextContent('gemini request failed: 429 rate limited');
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
});

describe('Story Bank', () => {
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
