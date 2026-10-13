/** A pitch reading on the session clock. hz is null for silence and unvoiced frames. */
export interface PitchSample {
  timeMs: number;
  hz: number | null;
}

/**
 * Pitch samples for one word, resampled to `count` evenly spaced points (nearest reading).
 * Unvoiced points become 0, which the sonogram treats as unvoiced. Returns undefined when
 * fewer than two voiced readings fall inside the word, so the renderer falls back to its
 * synthetic contour.
 */
export function pitchForWord(
  samples: readonly PitchSample[],
  startMs: number,
  endMs: number,
  count = 8
): number[] | undefined {
  const inside = samples.filter((s) => s.timeMs >= startMs && s.timeMs <= endMs);
  if (inside.filter((s) => s.hz !== null).length < 2) return undefined;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = startMs + (count === 1 ? 0 : (i / (count - 1)) * (endMs - startMs));
    let best = inside[0];
    for (const s of inside) if (Math.abs(s.timeMs - t) < Math.abs(best.timeMs - t)) best = s;
    out.push(best.hz ?? 0);
  }
  return out;
}
