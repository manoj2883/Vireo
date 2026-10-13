import type { FieldNotes } from '@/types/fieldNotes';
import type { StoredSession, StoredStory } from '@/storage/localDb';
import { TALK_TYPES } from '@/live/metrics/pace';

/** Ask the server to write field notes for a stored session. Throws with the server's message. */
export async function requestFieldNotes(session: StoredSession, story?: StoredStory, fetchImpl: typeof fetch = fetch): Promise<FieldNotes> {
  const talk = TALK_TYPES[session.config.talkType];
  const res = await fetchImpl('/api/field-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      transcript: session.transcript,
      context: {
        prompt: session.config.prompt,
        talkType: talk.label,
        mode: session.config.mode === 'coach' ? 'Coach me out loud' : 'Watch silently',
        durationMs: session.metrics.durationMs,
        paceZone: talk.zone,
        story: story ? { title: story.title, keyPoints: story.keyPoints } : undefined,
        metrics: session.metrics,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Field notes failed (${res.status})`);
  return body as FieldNotes;
}
