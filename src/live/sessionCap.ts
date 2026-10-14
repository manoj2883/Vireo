/**
 * Every live session stops at ten minutes, which keeps transcription costs bounded on a public
 * deploy (the server also caps sessions per visitor and per day). A notice shows in the last minute.
 */
export const MAX_SESSION_MS = 10 * 60_000;
export const CAP_WARNING_MS = 60_000;

export function sessionCap(elapsedMs: number, maxMs = MAX_SESSION_MS): { leftMs: number; warn: boolean; over: boolean } {
  const leftMs = Math.max(0, maxMs - elapsedMs);
  return { leftMs, warn: leftMs > 0 && leftMs <= CAP_WARNING_MS, over: elapsedMs >= maxMs };
}
