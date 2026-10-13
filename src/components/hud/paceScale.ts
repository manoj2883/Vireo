/** The pace band runs from 80 to 220 wpm. */
export const PACE_MIN = 80;
export const PACE_MAX = 220;

export function pacePercent(wpm: number): number {
  return Math.max(3, Math.min(97, ((wpm - PACE_MIN) / (PACE_MAX - PACE_MIN)) * 100));
}
