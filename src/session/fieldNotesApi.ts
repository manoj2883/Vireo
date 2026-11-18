import type { FieldNotes } from '@/types/fieldNotes';
import type { StoredSession, StoredStory } from '@/storage/localDb';
import { TALK_TYPES } from '@/live/metrics/pace';
import { situationById } from './situations';
import { ROLE_LABELS } from '@/roleplay/conversation';
import type { PersonalBaseline } from '@/lib/personalBest';
import type { SkillId } from '@/lib/skills';

/** What Vireo knows about the speaker from earlier sessions on this device, sent with the request. */
export interface SpeakerMemory {
  masteredSkills?: SkillId[];
  personalBest?: PersonalBaseline | null;
}

/** Ask the server to write field notes for a stored session. Throws with the server's message. */
export async function requestFieldNotes(session: StoredSession, story?: StoredStory, fetchImpl: typeof fetch = fetch, memory: SpeakerMemory = {}): Promise<FieldNotes> {
  const talk = TALK_TYPES[session.config.talkType];
  const situation = situationById(session.config.situationId);
  const res = await fetchImpl('/api/field-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      transcript: session.transcript,
      context: {
        prompt: session.config.prompt,
        speakingContext: session.config.context,
        talkType: talk.label,
        mode: session.config.mode === 'coach' ? 'Coach me out loud' : 'Watch silently',
        durationMs: session.metrics.durationMs,
        paceZone: talk.zone,
        situation: situation ? { label: situation.label, criteria: situation.criteria, timeLimitMs: situation.timeLimitMs } : undefined,
        previousFix: session.config.retake?.oneFix,
        story: story ? { title: story.title, keyPoints: story.keyPoints } : undefined,
        metrics: session.metrics,
        camera: session.camera ? { summary: session.camera.summary, events: session.camera.events } : undefined,
        masteredSkills: memory.masteredSkills?.length ? memory.masteredSkills : undefined,
        personalBest: memory.personalBest ?? undefined,
        confidenceMode: session.config.confidenceMode || undefined,
        roleplay: session.roleplay
          ? {
              mode: session.roleplay.mode,
              roleLabel: ROLE_LABELS[session.roleplay.role],
              questions: session.roleplay.turns.map((t) => ({ question: t.question, answerStartMs: t.answerStartMs, answerEndMs: t.answerEndMs })),
            }
          : undefined,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Field notes failed (${res.status})`);
  return body as FieldNotes;
}

/** How long to wait before the automatic second try. Mutable so tests can shorten it. */
export const fieldNotesRetry = { delayMs: 15_000 };

/**
 * Ask for field notes; if the first try fails (the server already retried and fell back
 * between providers), wait and try once more. `onRetry` fires before the wait.
 */
export async function requestFieldNotesWithRetry(
  session: StoredSession,
  story: StoredStory | undefined,
  onRetry: (firstError: Error) => void,
  fetchImpl: typeof fetch = fetch,
  memory: SpeakerMemory = {}
): Promise<FieldNotes> {
  try {
    return await requestFieldNotes(session, story, fetchImpl, memory);
  } catch (err) {
    onRetry(err instanceof Error ? err : new Error(String(err)));
    await new Promise((r) => setTimeout(r, fieldNotesRetry.delayMs));
    return requestFieldNotes(session, story, fetchImpl, memory);
  }
}
