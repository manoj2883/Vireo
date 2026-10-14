import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { LEGACY_DB_NAME } from './legacyDb';
import type { PaceTake } from '@/live/metrics/ghost';
import type { LiveSessionResult, SessionMetrics, TranscriptLine } from '@/live/LiveSessionEngine';
import type { PauseSpan, WordSegment } from '@/components/sonogram/types';
import type { SessionConfig } from '@/session/config';
import type { FieldNotes } from '@/types/fieldNotes';

/**
 * On-device storage. Nothing here leaves the device; no video is ever stored.
 * The previous version's database is only read once to import old stories (see legacyDb).
 */

export type NotesStatus = 'pending' | 'ready' | 'failed';

export interface StoredSession {
  id: string;
  createdAt: string;
  config: SessionConfig;
  segments: WordSegment[];
  pauses: PauseSpan[];
  transcript: TranscriptLine[];
  metrics: SessionMetrics;
  /** Ghost-pace summary of this take. */
  take: Pick<PaceTake, 'avgWpm' | 'inZoneRatio' | 'fillersPerMin'>;
  newBest: boolean;
  notesStatus: NotesStatus;
  notes?: FieldNotes;
  notesError?: string;
  /** Drill titles ticked off on the field notes page. */
  drillsDone?: string[];
  /** Voiced bursts with no transcribed word: likely fillers, shown lightly, not counted. */
  likelyFillers?: { startMs: number; endMs: number }[];
}

export type StoryKind = 'story' | 'bit';

export interface StoredStory {
  id: string;
  kind: StoryKind;
  title: string;
  /** Stories: Interview, Research, Pitch, Talk, Toast. Bits: Opener, Callback, Closer. */
  tag: string;
  /** Roughly how long it should take, e.g. "90 seconds". */
  length: string;
  gist: string;
  /** The key points a rehearsal should hit, in order. */
  keyPoints: string[];
  createdAt: string;
  updatedAt: string;
  lastSessionId?: string;
}

export interface VireoLocalDB extends DBSchema {
  ghosts: { key: string; value: PaceTake };
  sessions: { key: string; value: StoredSession; indexes: { 'by-createdAt': string } };
  stories: { key: string; value: StoredStory; indexes: { 'by-kind': StoryKind } };
}

export const LOCAL_DB_NAME = 'vireo-local';
export const LOCAL_DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<VireoLocalDB>> | null = null;

export function getLocalDb(): Promise<IDBPDatabase<VireoLocalDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VireoLocalDB>(LOCAL_DB_NAME, LOCAL_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('ghosts', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-createdAt', 'createdAt');
          const stories = db.createObjectStore('stories', { keyPath: 'id' });
          stories.createIndex('by-kind', 'kind');
        }
      },
    });
  }
  return dbPromise;
}

/** Forget the cached connection (tests, and after deleting the database). */
export function resetLocalDbConnection(): void {
  dbPromise = null;
}

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// ---------- ghosts ----------

export async function getGhost(key: string): Promise<PaceTake | undefined> {
  return (await getLocalDb()).get('ghosts', key);
}

export async function putGhost(take: PaceTake): Promise<void> {
  await (await getLocalDb()).put('ghosts', take);
}

// ---------- sessions ----------

export function sessionFromResult(result: LiveSessionResult, config: SessionConfig, id = newId('sess')): StoredSession {
  return {
    id,
    createdAt: result.startedAt || new Date().toISOString(),
    config,
    segments: result.segments,
    pauses: result.pauses,
    transcript: result.transcript,
    metrics: result.metrics,
    take: { avgWpm: result.take.avgWpm, inZoneRatio: result.take.inZoneRatio, fillersPerMin: result.take.fillersPerMin },
    newBest: result.newBest,
    likelyFillers: result.likelyFillers,
    notesStatus: 'pending',
  };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await (await getLocalDb()).put('sessions', session);
}

export async function getSession(id: string): Promise<StoredSession | undefined> {
  return (await getLocalDb()).get('sessions', id);
}

/** Newest first. */
export async function listSessions(): Promise<StoredSession[]> {
  const all = await (await getLocalDb()).getAllFromIndex('sessions', 'by-createdAt');
  return all.reverse();
}

export async function updateSession(id: string, patch: Partial<StoredSession>): Promise<StoredSession | undefined> {
  const db = await getLocalDb();
  const current = await db.get('sessions', id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id };
  await db.put('sessions', next);
  return next;
}

// ---------- stories and bits ----------

export async function listStories(kind?: StoryKind): Promise<StoredStory[]> {
  const db = await getLocalDb();
  const all = kind ? await db.getAllFromIndex('stories', 'by-kind', kind) : await db.getAll('stories');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStory(id: string): Promise<StoredStory | undefined> {
  return (await getLocalDb()).get('stories', id);
}

export async function saveStory(story: StoredStory): Promise<void> {
  await (await getLocalDb()).put('stories', story);
}

export async function deleteStory(id: string): Promise<void> {
  await (await getLocalDb()).delete('stories', id);
}

// ---------- deleting ----------

/**
 * Delete one session and everything derived from it: the session record (transcript,
 * metrics, notes), the ghost pace take it set, and the link from its Story Bank story.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getLocalDb();
  const tx = db.transaction(['sessions', 'ghosts', 'stories'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  for (const ghost of await tx.objectStore('ghosts').getAll()) {
    if (ghost.takeId === id) await tx.objectStore('ghosts').delete(ghost.key);
  }
  for (const story of await tx.objectStore('stories').getAll()) {
    if (story.lastSessionId === id) await tx.objectStore('stories').put({ ...story, lastSessionId: undefined });
  }
  await tx.done;
}

/** Browser storage keys Vireo writes, besides the theme preference. */
const SESSION_KEYS = ['vireo-session-config'];
const LOCAL_KEYS = ['vireo-legacy-imported'];

/**
 * Delete everything Vireo keeps on this device: sessions, notes, the Story Bank, ghost pace,
 * the previous version's database and the remembered warm-up. The theme preference stays.
 */
export async function deleteAllData(): Promise<void> {
  if (dbPromise) {
    (await dbPromise.catch(() => null))?.close();
    dbPromise = null;
  }
  await deleteDB(LOCAL_DB_NAME);
  await deleteDB(LEGACY_DB_NAME);
  for (const k of SESSION_KEYS) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
  for (const k of LOCAL_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}
