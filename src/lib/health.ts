import { useEffect, useState } from 'react';

/** Where to send people when the public demo can't run a session. */
export const LOCAL_SETUP_URL = 'https://github.com/manoj2883/Vireo#local-setup';

/**
 * Whether this server can run a session, from GET /api/health:
 * - `resting`: it answered and says the transcription or field notes key is missing
 * - `ready`: it answered and both are configured
 * - `unknown`: still checking, or the check failed; sessions aren't blocked on a guess
 */
export type DemoHealth = 'ready' | 'resting' | 'unknown';

interface HealthReply {
  transcription?: { configured?: boolean };
  fieldNotes?: { configured?: boolean };
}

export function healthFromReply(body: unknown): DemoHealth {
  const h = (body ?? {}) as HealthReply;
  if (h.transcription?.configured === false || h.fieldNotes?.configured === false) return 'resting';
  if (h.transcription?.configured === true && h.fieldNotes?.configured === true) return 'ready';
  return 'unknown';
}

export function useDemoHealth(): DemoHealth {
  const [health, setHealth] = useState<DemoHealth>('unknown');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled) setHealth(healthFromReply(body));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return health;
}
