import type { StoredSession } from '@/storage/localDb';

/** Ask the server for "your answer, tightened". Throws with the server's message. */
export async function requestTightened(session: StoredSession, fetchImpl: typeof fetch = fetch): Promise<{ script: string; mainPoint: string }> {
  const res = await fetchImpl('/api/tighten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: session.transcript,
      context: { prompt: session.config.prompt, oneFix: session.notes?.oneFix?.instruction },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Tightening failed (${res.status})`);
  return { script: String(body.script ?? ''), mainPoint: String(body.mainPoint ?? '') };
}
