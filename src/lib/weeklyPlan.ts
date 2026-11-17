/**
 * This week's plan: three short drills, chosen from the speaker's weakest skills that are still
 * being practised, each opening a warm-up with that drill preset. Worked out on this device from
 * sessions alone, and fixed for the week (a snapshot is kept in local settings).
 */
import type { StoredSession } from '@/storage/localDb';
import { skillModel, SKILL_IDS, type Skill, type SkillId } from './skills';

export const PLAN_SIZE = 3;

export interface PlanDrill {
  skill: SkillId;
  title: string;
  instructions: string;
  minutes: number;
}

export interface WeeklyPlan {
  /** ISO week, e.g. "2026-W47". */
  week: string;
  drills: PlanDrill[];
}

/** Three drills per skill; the week number picks which, so the plan changes week to week. */
export const DRILL_LIBRARY: Record<SkillId, Omit<PlanDrill, 'skill'>[]> = {
  fillers_per_min: [
    { title: 'Swap the um for a breath', instructions: 'Answer your question again. Each time you feel an “um” coming, close your mouth and breathe instead.', minutes: 4 },
    { title: 'The slow first sentence', instructions: 'Say only your first sentence, slowly, five times in a row with no filler before it.', minutes: 3 },
    { title: 'One-minute no-filler run', instructions: 'Talk for one minute about your week. Restart from the top whenever a filler slips in.', minutes: 5 },
  ],
  time_in_zone_pct: [
    { title: 'Walk the pace', instructions: 'Speak your answer while walking slowly, one step per two words. Then say it standing still at the same pace.', minutes: 4 },
    { title: 'Brake on the key line', instructions: 'Find your most important sentence and say it at half your usual speed, then the rest normally.', minutes: 3 },
    { title: 'Ghost race', instructions: 'Retake your best question and keep your pace dot level with your ghost for the whole answer.', minutes: 5 },
  ],
  time_to_main_point_s: [
    { title: 'Headline first', instructions: 'Answer in one sentence that could be a headline. Stop. Then give one reason.', minutes: 3 },
    { title: 'Ten-second answer', instructions: 'Answer your question in ten seconds. Then in thirty, keeping the same first sentence.', minutes: 4 },
    { title: 'Cut the warm-up', instructions: 'Say your answer, then say it again starting from your second sentence. Keep whichever lands faster.', minutes: 4 },
  ],
  sentence_end_pauses_pct: [
    { title: 'The full stop', instructions: 'Read your answer aloud and count “one, two” silently at every full stop.', minutes: 3 },
    { title: 'Land and look', instructions: 'At the end of each sentence, pause and look up as if checking the listener heard it.', minutes: 4 },
    { title: 'Pause before the number', instructions: 'Say an answer with a result in it, pausing before and after the number.', minutes: 3 },
  ],
  eye_contact_pct: [
    { title: 'Talk to the lens', instructions: 'Put a small sticker by your camera and talk to it for one minute as if it were a person.', minutes: 3 },
    { title: 'Look up to land', instructions: 'Glance at notes if you need to, but look into the camera for the last words of every sentence.', minutes: 4 },
    { title: 'Three-sentence hold', instructions: 'Say three sentences without looking away from the camera. Rest. Repeat three times.', minutes: 3 },
  ],
};

/** ISO 8601 week of the year, e.g. "2026-W47". */
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Weakest first: the lowest recent adoption rate, then the most times chosen (it keeps coming up). */
function byWeakness(a: Skill, b: Skill): number {
  const ra = a.recentAttempts ? a.recentAdopted / a.recentAttempts : 0;
  const rb = b.recentAttempts ? b.recentAdopted / b.recentAttempts : 0;
  return ra - rb || b.timesChosen - a.timesChosen || SKILL_IDS.indexOf(a.id) - SKILL_IDS.indexOf(b.id);
}

/**
 * Three drills from the weakest practising skills. With fewer than three practising, the rest come
 * from skills not yet worked on (eye contact only if the camera has been used). Null with no sessions.
 */
export function buildWeeklyPlan(all: readonly StoredSession[], now = new Date()): WeeklyPlan | null {
  if (!all.length) return null;
  const week = isoWeek(now);
  const weekNo = Number(week.slice(-2));
  const model = skillModel(all);
  const usedCamera = all.some((s) => s.camera);
  const practising = model.filter((s) => s.status === 'practising').sort(byWeakness);
  const fresh = model.filter((s) => s.status === 'new' && (s.id !== 'eye_contact_pct' || usedCamera));
  const chosen = [...practising, ...fresh].slice(0, PLAN_SIZE);
  return {
    week,
    drills: chosen.map((s) => {
      const options = DRILL_LIBRARY[s.id];
      return { skill: s.id, ...options[weekNo % options.length] };
    }),
  };
}
