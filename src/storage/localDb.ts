import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PaceTake } from '@/live/metrics/ghost';

/**
 * On-device storage for the new app. Nothing here leaves the device.
 * Separate from the legacy 'VireoDB' so the old screens keep working until they are removed.
 */
export interface VireoLocalDB extends DBSchema {
  ghosts: {
    key: string;
    value: PaceTake;
  };
}

export const LOCAL_DB_NAME = 'vireo-local';
export const LOCAL_DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<VireoLocalDB>> | null = null;

export function getLocalDb(): Promise<IDBPDatabase<VireoLocalDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VireoLocalDB>(LOCAL_DB_NAME, LOCAL_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('ghosts', { keyPath: 'key' });
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

export async function getGhost(key: string): Promise<PaceTake | undefined> {
  return (await getLocalDb()).get('ghosts', key);
}

export async function putGhost(take: PaceTake): Promise<void> {
  await (await getLocalDb()).put('ghosts', take);
}
