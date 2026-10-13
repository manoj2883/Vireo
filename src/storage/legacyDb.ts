import { openDB } from 'idb';

/** The previous version's database. Only read once (to import stories) and deleted with "Delete all data". */
export const LEGACY_DB_NAME = 'vireo_db';

export interface LegacyStory {
  title?: string;
  lesson?: string;
  beats?: Partial<Record<'hook' | 'stakes' | 'obstacle' | 'turn' | 'payoff' | 'landingLine', string>>;
}

export interface LegacyBit {
  setup?: string;
  line?: string;
  device?: string;
}

/** Whether the old database exists, without creating it. Unknown counts as yes. */
async function legacyDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases !== 'function') return true;
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === LEGACY_DB_NAME);
}

/** Read stories and bits from the old database, then close it. Never creates it. */
export async function readLegacyLibrary(): Promise<{ stories: LegacyStory[]; bits: LegacyBit[] }> {
  if (!(await legacyDbExists())) return { stories: [], bits: [] };
  const db = await openDB(LEGACY_DB_NAME);
  try {
    const has = (name: string) => db.objectStoreNames.contains(name);
    const stories = has('stories') ? ((await db.getAll('stories')) as LegacyStory[]) : [];
    const bits = has('bits') ? ((await db.getAll('bits')) as LegacyBit[]) : [];
    return { stories, bits };
  } finally {
    db.close();
  }
}
