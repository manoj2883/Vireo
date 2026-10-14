/**
 * Real situations to practise for. Each has starter questions, its own pace zone (through its
 * talk type) and the criteria a good answer meets, which go to the field notes.
 */
import type { TalkType } from '@/live/metrics/pace';

export type SituationId = 'interview' | 'presentation' | 'pitch' | 'english' | 'toast';

export interface Situation {
  id: SituationId;
  label: string;
  blurb: string;
  talkType: TalkType;
  questions: [string, string, string];
  /** What a good answer looks like; passed to the field notes. */
  criteria: string[];
  /** Ask a follow-up afterwards by default. */
  audience: boolean;
  /** A visible countdown and a hard target length, for timed formats. */
  timeLimitMs?: number;
  /** Progress is shown as a trend over weeks on Home. */
  trackTrend?: boolean;
}

export const SITUATIONS: Situation[] = [
  {
    id: 'interview',
    label: 'Job interview',
    blurb: 'Answer the question fast, then back it up.',
    talkType: 'interview',
    questions: ['Tell me about yourself.', 'Tell me about a time you solved a hard problem.', 'Why do you want this role?'],
    criteria: [
      'Answers the question within the first 20 seconds.',
      'Gives a clear situation, action and result.',
      'Ends on what was learned.',
    ],
    audience: true,
  },
  {
    id: 'presentation',
    label: 'Presentation or class talk',
    blurb: 'Signpost, slow down on the main idea, land the ending.',
    talkType: 'talk',
    questions: ['Explain the main idea of your project in two minutes.', 'Walk us through your results.', 'Teach us one concept from your field.'],
    criteria: [
      'Signposts the structure (for example "first", "the key point").',
      'Slows down on the main idea.',
      'Ends with a strong last line.',
    ],
    audience: false,
  },
  {
    id: 'pitch',
    label: '60-second pitch',
    blurb: 'Problem, solution, ask, inside a minute.',
    talkType: 'pitch',
    questions: ['Pitch your project to an investor.', 'Pitch yourself to a hiring manager.', 'Pitch an idea to your team.'],
    criteria: ['States the problem, the solution and a clear ask.', 'Finishes inside 60 seconds.'],
    audience: false,
    timeLimitMs: 60_000,
  },
  {
    id: 'english',
    label: 'Speaking English with confidence',
    blurb: 'Steady pace, fewer fillers, complete sentences.',
    talkType: 'english',
    questions: ['Describe your city to someone who has never been.', 'Tell me about your week.', 'Explain your job to a friend.'],
    criteria: ['Keeps a steady pace.', 'Uses few fillers.', 'Speaks in complete sentences.'],
    audience: false,
    trackTrend: true,
  },
  {
    id: 'toast',
    label: 'Toast or big moment',
    blurb: 'Warmth, pauses before the laughs, a clear close.',
    talkType: 'toast',
    questions: ['Give a toast at a friend’s wedding.', 'Thank your team at a farewell.', 'Introduce a guest speaker.'],
    criteria: ['Sounds warm.', 'Pauses before the laughs.', 'Ends with a clear closing line.'],
    audience: false,
  },
];

export function situationById(id: string | undefined | null): Situation | undefined {
  return SITUATIONS.find((s) => s.id === id);
}
