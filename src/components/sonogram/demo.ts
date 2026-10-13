import type { PauseSpan, SonogramAnnotation, WordKind, WordSegment } from './types';

/** Build word segments from [text, durationMs, kind] tuples with a fixed gap between words. */
export function buildSegments(
  words: readonly (readonly [string, number, WordKind?] | readonly ['', number, 'pause'])[],
  { startMs = 0, gapMs = 70 } = {}
): { segments: WordSegment[]; pauses: PauseSpan[] } {
  const segments: WordSegment[] = [];
  const pauses: PauseSpan[] = [];
  let t = startMs;
  for (const [text, dur, kind] of words) {
    if (kind === 'pause') {
      pauses.push({ startMs: t, endMs: t + dur });
    } else {
      segments.push({ text, startMs: t, endMs: t + dur, kind: kind ?? 'speech' });
    }
    t += dur + gapMs;
  }
  return { segments, pauses };
}

/** The launch-page sentence: three fillers, a pause that landed, then a rushed result. */
const hero = buildSegments([
  ['Um,', 500, 'filler'],
  ['so', 280, 'filler'],
  ['basically,', 620, 'filler'],
  ['our', 300],
  ['results', 580],
  ['were', 360],
  ['', 1200, 'pause'],
  ['a', 160, 'rushed'],
  ['lot', 260, 'rushed'],
  ['better', 360, 'rushed'],
  ['than', 240, 'rushed'],
  ['we', 180, 'rushed'],
  ['expected.', 600, 'rushed'],
]);

export const DEMO_SEGMENTS: WordSegment[] = hero.segments;
export const DEMO_PAUSES: PauseSpan[] = hero.pauses;

export const DEMO_ANNOTATIONS: SonogramAnnotation[] = [
  { startMs: DEMO_SEGMENTS[0].startMs, endMs: DEMO_SEGMENTS[2].endMs, text: 'three fillers before the point', tone: 'amber' },
  { startMs: DEMO_PAUSES[0].startMs, endMs: DEMO_PAUSES[0].endMs!, text: 'a pause that landed', tone: 'sky' },
  { startMs: DEMO_SEGMENTS[6].startMs, endMs: DEMO_SEGMENTS[11].endMs, text: 'the payoff, rushed to 184 wpm', tone: 'amber' },
];

export const DEMO_LABEL =
  "The sentence 'Um, so basically, our results were, pause, a lot better than we expected' drawn as a sonogram. " +
  'The first three words are fillers, the pause lasts 1.2 seconds, and the final six words are rushed at 184 words per minute.';
