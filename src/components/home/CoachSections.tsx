import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { relativeDay } from '@/lib/format';
import { buildWeeklyPlan, isoWeek, type WeeklyPlan } from '@/lib/weeklyPlan';
import { MASTERY_ADOPTED, MASTERY_WINDOW, skillModel, type SkillStatus } from '@/lib/skills';
import { phrasingTrends } from '@/lib/phrasing';
import type { SessionConfig } from '@/session/config';
import { weeklyPlanFor, type StoredSession } from '@/storage/localDb';

const H2 = 'm-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]';

/** This week's three drills, each opening a warm-up with the drill preset. */
export function WeeklyPlanSection({ sessions }: { sessions: StoredSession[] }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  useEffect(() => {
    const now = new Date();
    weeklyPlanFor(() => buildWeeklyPlan(sessions, now), isoWeek(now))
      .then(setPlan)
      .catch(() => setPlan(buildWeeklyPlan(sessions, now)));
  }, [sessions]);
  if (!plan?.drills.length) return null;
  const latest = sessions[0];

  function start(drill: WeeklyPlan['drills'][number]) {
    const preset: Partial<SessionConfig> = {
      prompt: latest?.config.prompt ?? '',
      situationId: latest?.config.situationId,
      talkType: latest?.config.talkType,
      drill: `${drill.title}: ${drill.instructions}`,
    };
    navigate('/warm-up', { state: { preset } });
  }

  return (
    <section aria-labelledby="plan-h" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="plan-h" className={H2}>
          This week’s plan
        </h2>
        <span className="font-display text-lg italic text-ink-muted">Three short drills for the skills you’re still building. New ones each week.</span>
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-10 p-0">
        {plan.drills.map((d, i) => (
          <li key={d.skill} className="flex flex-col gap-2 border-t border-line py-6">
            <span className="text-small text-ink-muted">
              Drill {i + 1}, about {d.minutes} minutes
            </span>
            <span className="font-display text-[28px] leading-8">{d.title}</span>
            <span className="text-[16px] leading-[25px] text-ink-muted">{d.instructions}</span>
            <span>
              <Button variant="link" className="h-11 px-0 text-[15px]" onClick={() => start(d)}>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Start this drill<span className="sr-only">: {d.title}</span>
              </Button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const GROUPS: { status: SkillStatus; title: string; empty: string }[] = [
  { status: 'practising', title: 'Practising', empty: 'Nothing yet. Your first one fix starts a skill.' },
  { status: 'mastered', title: 'Mastered', empty: `A skill is mastered when you adopt its fix in ${MASTERY_ADOPTED} of your last ${MASTERY_WINDOW} retakes, on at least two different questions.` },
  { status: 'new', title: 'Not started', empty: '' },
];

/** Skills as a simple list grouped by status. Mastered skills are never chosen as the one fix. */
export function SkillsSection({ sessions }: { sessions: StoredSession[] }) {
  const model = skillModel(sessions);
  return (
    <section aria-labelledby="skills-h" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="skills-h" className={H2}>
          Your skills
        </h2>
        <span className="font-display text-lg italic text-ink-muted">Once you’ve mastered a skill, Vireo picks a different one fix.</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-10">
        {GROUPS.map((g) => {
          const items = model.filter((s) => s.status === g.status);
          if (!items.length && !g.empty) return null;
          return (
            <div key={g.status} className="flex flex-col gap-3 border-t border-line py-5">
              <h3 className="m-0 text-label text-ink-muted">{g.title}</h3>
              {items.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={g.title}>
                  {items.map((s) => (
                    <li key={s.id} className="flex flex-col">
                      <span className={cn('text-[17px] font-semibold', g.status === 'mastered' && 'text-olive')}>{s.label}</span>
                      {s.recentAttempts > 0 && (
                        <span className="text-small text-ink-muted">
                          Adopted in {s.recentAdopted} of your last {s.recentAttempts} {s.recentAttempts === 1 ? 'retake' : 'retakes'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-small text-ink-muted">{g.empty}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Speaking English with confidence": the top recurring phrasing patterns, with the speaker's own examples. */
export function EnglishPatternsSection({ sessions }: { sessions: StoredSession[] }) {
  const trends = phrasingTrends(sessions);
  const practisesEnglish = sessions.some((s) => s.config.situationId === 'english');
  if (!trends.length && !practisesEnglish) return null;
  return (
    <section aria-labelledby="english-h" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="english-h" className={H2}>
          Speaking English with confidence
        </h2>
        <span className="font-display text-lg italic text-ink-muted">Patterns that come up again and again in your “say it more naturally” notes</span>
      </div>
      {trends.length === 0 ? (
        <p className="m-0 border-t border-line pt-6 text-body text-ink-muted">No pattern has repeated yet. After a few more sessions, the ones that keep coming up will show here.</p>
      ) : (
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6 p-0">
          {trends.map((t) => (
            <li key={t.category} className="flex flex-col gap-3 rounded-lg bg-surface-100 p-6">
              <span className="text-label">{t.label}</span>
              <span className="text-small text-ink-muted">
                {t.count} times across {t.sessions} {t.sessions === 1 ? 'session' : 'sessions'}
              </span>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {t.examples.map((e) => (
                  <li key={`${e.sessionId}-${e.original}`} className="flex flex-col gap-0.5">
                    <span className="text-small text-ink-muted">
                      {relativeDay(e.createdAt)}, you said <q className="italic">{e.original}</q>
                    </span>
                    <span className="font-display text-[20px] leading-[1.35]">{e.natural}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
