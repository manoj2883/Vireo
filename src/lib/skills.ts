/**
 * Skill memory: a local model of which fixes the speaker has mastered. A skill is a fix's target
 * measure (fillers, pace zone, getting to the point, sentence-end pauses, eye contact). Each retake
 * whose previous fix targeted that skill is one attempt. Pure; computed from sessions on this device.
 */
import type { StoredSession } from '@/storage/localDb';
import { fixAdoption, TARGET_METRICS, type TargetMetricSpec } from './fixAdoption';
import { previousTake, seriesRoot } from './compare';

export type SkillId = TargetMetricSpec['id'];
export type SkillStatus = 'new' | 'practising' | 'mastered';

/** Mastery looks at the most recent attempts only, so an old run of luck doesn't count forever. */
export const MASTERY_WINDOW = 4;
/** Adopted in 3 of the last 4: consistent, with room for one off day. */
export const MASTERY_ADOPTED = 3;
/** Those adoptions must come from at least 2 different questions, so it isn't one answer memorised. */
export const MASTERY_MIN_SERIES = 2;

export const SKILL_IDS = Object.keys(TARGET_METRICS) as SkillId[];

export const SKILL_LABELS: Record<SkillId, string> = {
  fillers_per_min: 'Fewer fillers',
  time_in_zone_pct: 'Staying in your pace zone',
  time_to_main_point_s: 'Getting to the point',
  sentence_end_pauses_pct: 'Pausing at the end of a sentence',
  eye_contact_pct: 'Eye contact',
};

export interface Attempt {
  skill: SkillId;
  adopted: boolean;
  sessionId: string;
  seriesId: string;
  createdAt: string;
}

export interface Skill {
  id: SkillId;
  label: string;
  status: SkillStatus;
  /** Measured attempts, oldest first. */
  attempts: Attempt[];
  /** Adopted among the last MASTERY_WINDOW attempts. */
  recentAdopted: number;
  recentAttempts: number;
  /** Times this skill was chosen as the one fix. */
  timesChosen: number;
}

/** Every measured retake, oldest first. */
export function attemptsFrom(all: readonly StoredSession[]): Attempt[] {
  const out: Attempt[] = [];
  for (const s of all) {
    if (!s.retakeOf || !s.notes) continue;
    const prev = previousTake(s, all);
    if (!prev) continue;
    const a = fixAdoption(prev, s);
    if (!a || a.status === 'not_measurable') continue;
    out.push({ skill: a.metric, adopted: a.status === 'adopted', sessionId: s.id, seriesId: seriesRoot(s), createdAt: s.createdAt });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function isMastered(attempts: readonly Attempt[]): boolean {
  const recent = attempts.slice(-MASTERY_WINDOW);
  const adopted = recent.filter((a) => a.adopted);
  return adopted.length >= MASTERY_ADOPTED && new Set(adopted.map((a) => a.seriesId)).size >= MASTERY_MIN_SERIES;
}

export function skillModel(all: readonly StoredSession[]): Skill[] {
  const attempts = attemptsFrom(all);
  return SKILL_IDS.map((id) => {
    const mine = attempts.filter((a) => a.skill === id);
    const recent = mine.slice(-MASTERY_WINDOW);
    const timesChosen = all.filter((s) => s.notes?.oneFix?.targetMetric === id).length;
    const status: SkillStatus = isMastered(mine) ? 'mastered' : timesChosen || mine.length ? 'practising' : 'new';
    return { id, label: SKILL_LABELS[id], status, attempts: mine, recentAdopted: recent.filter((a) => a.adopted).length, recentAttempts: recent.length, timesChosen };
  });
}

export function masteredSkills(all: readonly StoredSession[]): SkillId[] {
  return skillModel(all)
    .filter((s) => s.status === 'mastered')
    .map((s) => s.id);
}
