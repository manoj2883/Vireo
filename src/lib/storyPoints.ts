import type { StoredSession, StoredStory } from '@/storage/localDb';

/**
 * Key points hit or missed in the story's last rehearsal. Sections are matched to key points by
 * their number in the outline (outlineIndex), so a point said in different words still counts.
 * Notes written before outlineIndex existed fall back to matching the key point's text.
 */
export function keyPointResults(story: StoredStory, session?: StoredSession): { label: string; hit: boolean | null }[] {
  const sections = session?.notes?.storyMap.sections ?? [];
  const norm = (s: string) => s.trim().toLowerCase();
  return story.keyPoints.map((p, i) => {
    const forPoint = sections.filter((s) =>
      typeof s.outlineIndex === 'number' ? s.outlineIndex === i + 1 : !!s.outlinePoint && norm(s.outlinePoint) === norm(p)
    );
    if (!session?.notes) return { label: p, hit: null };
    return { label: p, hit: forPoint.some((s) => s.status === 'hit') };
  });
}
