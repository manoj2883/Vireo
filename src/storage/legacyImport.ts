import { readLegacyLibrary } from './legacyDb';
import { listStories, newId, saveStory, type StoredStory } from './localDb';

const FLAG = 'vireo-legacy-imported';

/**
 * One-time import of stories and bits from the previous version's database, so nothing the
 * user saved there is lost. Runs only when the new Story Bank is empty.
 */
export async function importLegacyStoriesOnce(): Promise<number> {
  try {
    if (localStorage.getItem(FLAG)) return 0;
  } catch {
    return 0;
  }
  let imported = 0;
  try {
    if ((await listStories()).length === 0) {
      const { stories, bits } = await readLegacyLibrary().catch(() => ({ stories: [], bits: [] }));
      const now = new Date().toISOString();
      for (const s of stories) {
        const b = s.beats ?? {};
        const keyPoints = [b.hook, b.stakes, b.obstacle, b.turn, b.payoff, b.landingLine].filter((p): p is string => Boolean(p && p.trim()));
        const story: StoredStory = {
          id: newId('story'),
          kind: 'story',
          title: s.title || 'Untitled story',
          tag: 'Interview',
          length: '2 minutes',
          gist: s.lesson || '',
          keyPoints,
          createdAt: now,
          updatedAt: now,
        };
        await saveStory(story);
        imported++;
      }
      for (const bit of bits) {
        const tag = bit.device === 'callback' ? 'Callback' : 'Opener';
        await saveStory({
          id: newId('bit'),
          kind: 'bit',
          title: bit.line || 'Untitled bit',
          tag,
          length: '15 seconds',
          gist: bit.setup || '',
          keyPoints: [],
          createdAt: now,
          updatedAt: now,
        });
        imported++;
      }
    }
  } finally {
    try {
      localStorage.setItem(FLAG, '1');
    } catch {
      // ignore
    }
  }
  return imported;
}
