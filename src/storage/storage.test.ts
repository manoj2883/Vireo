import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import {
  deleteAllData,
  deleteSession,
  getGhost,
  getSession,
  getStory,
  listSessions,
  listStories,
  putGhost,
  resetLocalDbConnection,
  saveSession,
  saveStory,
  type StoredSession,
} from './localDb';
import { LEGACY_DB_NAME } from './legacyDb';
import { importLegacyStoriesOnce } from './legacyImport';

function session(id: string, createdAt: string): StoredSession {
  return {
    id,
    createdAt,
    config: { prompt: 'p', talkType: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [{ text: 'hello', startMs: 0, endMs: 300, kind: 'speech' }],
    pauses: [],
    transcript: [{ speaker: 'user', text: 'hello', startMs: 0 }],
    metrics: { durationMs: 1000, wordCount: 1, avgWpm: 60, timeInZonePct: 0, fillerCount: 0, fillersPerMin: 0, pauseCount: 0, pausesPerMin: 0, longestPauseMs: 0 },
    take: { avgWpm: 60, inZoneRatio: 0, fillersPerMin: 0 },
    newBest: false,
    notesStatus: 'pending',
  };
}

const now = new Date().toISOString();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetLocalDbConnection();
  localStorage.clear();
  sessionStorage.clear();
});

async function seedLegacy() {
  const db = await openDB(LEGACY_DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('stories', { keyPath: 'id' });
      d.createObjectStore('bits', { keyPath: 'id' });
      d.createObjectStore('sessions', { keyPath: 'id' });
    },
  });
  await db.put('stories', { id: 'old1', title: 'The night the pipeline broke', lesson: 'Check the queue first.', beats: { hook: 'Pager at 2am', payoff: 'Fixed it', landingLine: '' } });
  await db.put('bits', { id: 'b1', setup: 'When asked something out of scope', line: 'The judge said no to me too', device: 'callback' });
  await db.put('sessions', { id: 'old-session', transcript: 'private words' });
  db.close();
}

describe('sessions', () => {
  it('lists newest first', async () => {
    await saveSession(session('a', '2026-10-01T10:00:00Z'));
    await saveSession(session('b', '2026-10-12T10:00:00Z'));
    expect((await listSessions()).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('deleteSession', () => {
  it('removes the session, the ghost take it set and its Story Bank link', async () => {
    await saveSession(session('s1', now));
    await saveSession(session('s2', now));
    await putGhost({ key: 'prompt', takeId: 's1', createdAt: now, trace: [150], avgWpm: 150, inZoneRatio: 1, fillersPerMin: 0 });
    await putGhost({ key: 'other', takeId: 's2', createdAt: now, trace: [140], avgWpm: 140, inZoneRatio: 1, fillersPerMin: 0 });
    await saveStory({ id: 'st', kind: 'story', title: 't', tag: 'Interview', length: '', gist: '', keyPoints: [], createdAt: now, updatedAt: now, lastSessionId: 's1' });

    await deleteSession('s1');

    expect(await getSession('s1')).toBeUndefined();
    expect(await getSession('s2')).toBeDefined();
    expect(await getGhost('prompt')).toBeUndefined();
    expect(await getGhost('other')).toBeDefined();
    expect((await getStory('st'))?.lastSessionId).toBeUndefined();
  });
});

describe('deleteAllData', () => {
  it('deletes the local and legacy databases and Vireo’s browser storage, keeping the theme', async () => {
    await saveSession(session('s1', now));
    await seedLegacy();
    sessionStorage.setItem('vireo-session-config', '{}');
    localStorage.setItem('vireo-legacy-imported', '1');
    localStorage.setItem('vireo-theme', 'light');

    await deleteAllData();

    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain('vireo-local');
    expect(names).not.toContain(LEGACY_DB_NAME);
    expect(sessionStorage.getItem('vireo-session-config')).toBeNull();
    expect(localStorage.getItem('vireo-legacy-imported')).toBeNull();
    expect(localStorage.getItem('vireo-theme')).toBe('light');
    // The app keeps working afterwards with a fresh, empty database.
    expect(await listSessions()).toEqual([]);
  });
});

describe('legacy import', () => {
  it('brings old stories and bits across once, with beats as key points', async () => {
    await seedLegacy();
    expect(await importLegacyStoriesOnce()).toBe(2);
    const [story] = await listStories('story');
    expect(story).toMatchObject({ title: 'The night the pipeline broke', gist: 'Check the queue first.', keyPoints: ['Pager at 2am', 'Fixed it'] });
    const [bit] = await listStories('bit');
    expect(bit).toMatchObject({ title: 'The judge said no to me too', tag: 'Callback' });
    expect(await importLegacyStoriesOnce()).toBe(0);
  });

  it('never creates the old database when there is none', async () => {
    expect(await importLegacyStoriesOnce()).toBe(0);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(LEGACY_DB_NAME);
  });
});
