import type { StoredSession, StoredStory } from '@/storage/localDb';

/** Key points hit or missed in the story's last rehearsal, matched against the outline. */
export function keyPointResults(story: StoredStory, session?: StoredSession): { label: string; hit: boolean | null }[] {
  const sections = session?.notes?.storyMap.sections ?? [];
  const norm = (s: string) => s.trim().toLowerCase();
  return story.keyPoints.map((p) => {
    const match = sections.find((s) => s.outlinePoint && norm(s.outlinePoint) === norm(p));
    return { label: p, hit: match ? match.status === 'hit' : session?.notes ? false : null };
  });
}
