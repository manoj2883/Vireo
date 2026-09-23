import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Story, Bit, TeardownReport } from '../types';

export interface StoredSessionInterruption {
  count: number;
  reason: string;
  isHostileAudienceTurn: boolean;
  timestampSec: number;
}

export interface StoredSession {
  id: string;
  createdAt: string;
  mode: 'live' | 'rehearsal' | 'interview';
  durationSec: number;
  transcript: { id?: string; speaker: 'user' | 'coach' | 'system'; text: string; timestampSec: number }[];
  metrics: {
    wpmHistory?: { timeSec: number; wpm: number }[];
    fillerCount: number;
    flatStretchWindows?: { startSec: number; endSec: number; reason: string }[];
  };
  interruptions?: StoredSessionInterruption[];
  mediaBlobUrl?: string; // Object URL or Base64 data URL for audio/video playback
  compositeScore?: number;
}

interface VireoDB extends DBSchema {
  stories: {
    key: string;
    value: Story;
    indexes: { 'by-source': string; 'by-lastTold': string };
  };
  bits: {
    key: string;
    value: Bit;
    indexes: { 'by-device': string };
  };
  sessions: {
    key: string;
    value: StoredSession;
    indexes: { 'by-date': string };
  };
  teardowns: {
    key: string;
    value: TeardownReport;
    indexes: { 'by-session': string; 'by-date': string };
  };
}

const DB_NAME = 'vireo_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<VireoDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<VireoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('stories')) {
          const storyStore = db.createObjectStore('stories', { keyPath: 'id' });
          storyStore.createIndex('by-source', 'source');
          storyStore.createIndex('by-lastTold', 'lastTold');
        }

        if (!db.objectStoreNames.contains('bits')) {
          const bitStore = db.createObjectStore('bits', { keyPath: 'id' });
          bitStore.createIndex('by-device', 'device');
        }

        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('by-date', 'createdAt');
        }

        if (!db.objectStoreNames.contains('teardowns')) {
          const teardownStore = db.createObjectStore('teardowns', { keyPath: 'id' });
          teardownStore.createIndex('by-session', 'sessionId');
          teardownStore.createIndex('by-date', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

// Story CRUD
export async function getAllStories(): Promise<Story[]> {
  const db = await getDB();
  return db.getAll('stories');
}

export async function saveStory(story: Story): Promise<void> {
  const db = await getDB();
  await db.put('stories', story);
}

export async function deleteStory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('stories', id);
}

// Bit CRUD
export async function getAllBits(): Promise<Bit[]> {
  const db = await getDB();
  return db.getAll('bits');
}

export async function saveBit(bit: Bit): Promise<void> {
  const db = await getDB();
  await db.put('bits', bit);
}

export async function deleteBit(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('bits', id);
}

// Session & Teardown Persistence
export async function saveSession(session: StoredSession): Promise<void> {
  const db = await getDB();
  await db.put('sessions', session);
}

export async function getAllSessions(): Promise<StoredSession[]> {
  const db = await getDB();
  const list = await db.getAllFromIndex('sessions', 'by-date');
  return list.reverse(); // Most recent first
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('sessions', id);
}

export async function saveTeardown(teardown: TeardownReport): Promise<void> {
  const db = await getDB();
  await db.put('teardowns', teardown);
}

export async function getAllTeardowns(): Promise<TeardownReport[]> {
  const db = await getDB();
  const list = await db.getAllFromIndex('teardowns', 'by-date');
  return list.reverse();
}

export async function getTeardownBySessionId(sessionId: string): Promise<TeardownReport | undefined> {
  const db = await getDB();
  const all = await db.getAllFromIndex('teardowns', 'by-session', sessionId);
  return all[0];
}
