/** Confidence mode's breathing warm-up: timing, kept apart from the component so it can be tested. */

/** One minute, as the confidence mode spec asks. */
export const BREATHING_MS = 60_000;
/** Breathe in for 4 s, out for 6 s: a longer out-breath is the usual slow-breathing pattern. */
export const IN_MS = 4000;
export const OUT_MS = 6000;

/** "in" or "out" at a moment in the exercise. */
export function breathPhase(elapsedMs: number): 'in' | 'out' {
  return elapsedMs % (IN_MS + OUT_MS) < IN_MS ? 'in' : 'out';
}
