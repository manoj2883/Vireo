import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { oneDecimal, relativeDay, signed } from '@/lib/format';
import { homeNumbers, kicker, progressHeadline } from '@/lib/progress';
import { Button } from '@/components/ui/button';
import { Sonogram } from '@/components/sonogram';
import { deleteAllData, listSessions, listStories, type StoredSession, type StoredStory } from '@/storage/localDb';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { bestImprovementThisWeek, describeChange } from '@/lib/compare';
import { saveConfig, type SessionConfig } from '@/session/config';

/** Home (`/app`): progress from real sessions, today's drill, the last ten sessions drawn. */
export function HomePage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);
  const [stories, setStories] = useState<StoredStory[]>([]);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]));
    listStories('story').then(setStories).catch(() => setStories([]));
  }, []);

  if (sessions === null) return <p className="text-ink-muted">Opening Home</p>;

  const headline = progressHeadline(sessions);
  const numbers = homeNumbers(sessions);
  const withDrill = sessions.find((s) => s.notes?.drills.length);
  const drill = withDrill?.notes?.drills.find((d) => !withDrill.drillsDone?.includes(d.title)) ?? withDrill?.notes?.drills[0];
  const recent = sessions.slice(0, 10).reverse();
  const weekly = bestImprovementThisWeek(sessions);

  function startDrill() {
    if (!withDrill) return;
    const config: SessionConfig = { ...withDrill.config, parentSessionId: undefined };
    saveConfig(config);
    navigate('/warm-up', { state: { preset: config } });
  }

  function rehearse(story: StoredStory) {
    navigate('/warm-up', { state: { preset: { storyId: story.id, prompt: story.title } } });
  }

  return (
    <div className="flex flex-col gap-20">
      {weekly && (
        <section aria-labelledby="week-h" className="paper-scope flex flex-wrap items-center justify-between gap-6 rounded-lg bg-paper p-7 text-paper-foreground sm:p-10">
          <div className="flex flex-col gap-2">
            <p id="week-h" className="m-0 text-label opacity-75">
              Your best improvement this week
            </p>
            <p className="m-0 font-display text-[clamp(30px,4vw,48px)] leading-[1.05] tracking-[-0.02em]">{describeChange(weekly.change)}</p>
            <p className="m-0 text-small opacity-75">On “{weekly.session.config.prompt}”</p>
          </div>
          <Button variant="outline" size="lg" onClick={() => navigate(`/notes/${weekly.session.id}`)}>
            See before and after
          </Button>
        </section>
      )}
      <section className="flex flex-wrap items-stretch gap-10">
        <div className="flex min-w-0 flex-[1_1_460px] flex-col justify-between gap-8">
          <div>
            <p className="m-0 mb-4 text-ink-muted">{kicker(sessions)}</p>
            <h1 className="m-0 font-display text-[clamp(48px,6.4vw,92px)] font-normal leading-[0.96] tracking-[-0.035em]">{headline.title}</h1>
          </div>
          <p className="m-0 max-w-[520px] text-[19px] leading-[30px] text-ink-muted">{headline.detail}</p>
        </div>

        <div className="paper-scope flex min-w-0 flex-[1_1_400px] flex-col gap-[18px] rounded-[32px] bg-paper p-8 text-paper-foreground sm:p-9">
          {drill && withDrill ? (
            <>
              <p className="m-0 text-[15px] font-semibold opacity-75">Today’s drill, from your {relativeDay(withDrill.createdAt).toLowerCase() === 'today' ? 'latest' : relativeDay(withDrill.createdAt).toLowerCase()} notes</p>
              <h2 className="m-0 font-display text-[46px] font-normal leading-[48px] tracking-[-0.02em]">{drill.title}</h2>
              <p className="m-0 text-body opacity-85">{drill.instructions}</p>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                <Button size="lg" onClick={startDrill} className="bg-paper-foreground text-paper hover:bg-paper-foreground/90">
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  Start the drill
                </Button>
                <span className="text-[15px] opacity-75">About {drill.minutes} minutes</span>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-[15px] font-semibold opacity-75">Your first drill</p>
              <h2 className="m-0 font-display text-[46px] font-normal leading-[48px] tracking-[-0.02em]">Answer one question</h2>
              <p className="m-0 text-body opacity-85">
                Pick something you need to say well this week. Speak for a minute or two. Vireo will draw it, then write you a drill from what it hears.
              </p>
              <div className="mt-auto pt-2">
                <Button asChild size="lg" className="bg-paper-foreground text-paper hover:bg-paper-foreground/90">
                  <Link to="/warm-up">
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Start a session
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="ten-h" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="ten-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
              Your last {recent.length === 1 ? 'session' : `${recent.length} sessions`}, drawn
            </h2>
            <span className="font-display text-lg italic text-ink-muted">Apricot marks are fillers. Watch them thin out.</span>
          </div>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-0">
            {recent.map((s, i) => {
              const last = i === recent.length - 1;
              return (
                <li key={s.id}>
                  <Link
                    to={`/notes/${s.id}`}
                    aria-label={`${relativeDay(s.createdAt)}: ${oneDecimal(s.metrics.fillersPerMin)} fillers a minute. Open field notes.`}
                    className={cn('flex flex-col gap-3 rounded-[20px] p-[18px] text-ink', last ? 'bg-surface-200 shadow-[inset_0_0_0_1.5px_rgb(var(--olive))]' : 'bg-surface-100 hover:bg-surface-200')}
                  >
                    <Sonogram variant="mini" segments={s.segments} pauses={s.pauses} label="" className="h-16" />
                    <span className="flex items-baseline justify-between gap-2" aria-hidden="true">
                      <span className="text-small text-ink-muted">{relativeDay(s.createdAt)}</span>
                      <span className="text-small">
                        <span className="font-semibold">{oneDecimal(s.metrics.fillersPerMin)}</span>
                        <span className="text-ink-muted"> fillers a min</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sessions.length > 0 && (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-10 border-t border-line pt-10">
          <BigNumber
            value={numbers.timeInZonePct === null ? '—' : `${numbers.timeInZonePct}%`}
            label="Time in your pace zone"
            note={numbers.timeInZoneChange === null ? 'In your latest session' : `${signed(numbers.timeInZoneChange)} points on two weeks ago`}
          />
          <BigNumber value={numbers.pausesPerMin === null ? '—' : oneDecimal(numbers.pausesPerMin)} tone="sky" label="Deliberate pauses a minute" note="Good speakers land between 3 and 5" />
          <BigNumber
            value={String(numbers.minutesThisWeek)}
            unit="min"
            label="Practised this week"
            note={`Across ${numbers.sessionsThisWeek} ${numbers.sessionsThisWeek === 1 ? 'session' : 'sessions'}`}
          />
          <BigNumber
            value={String(numbers.followUpsWaiting.length)}
            tone={numbers.followUpsWaiting.length ? 'amber' : undefined}
            label={numbers.followUpsWaiting.length === 1 ? 'Follow-up question waiting' : 'Follow-up questions waiting'}
            note={
              numbers.followUpsWaiting.length ? (
                <Link to={`/notes/${numbers.followUpsWaiting[0].id}`} className="rounded-sm text-olive">
                  Answer it in Audience mode
                </Link>
              ) : (
                'Turn on Audience mode in the warm-up'
              )
            }
          />
        </section>
      )}

      <section aria-labelledby="stories-h" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="stories-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
            Ready to rehearse
          </h2>
          <Link to="/stories" className="rounded-sm text-[16px] font-semibold text-olive">
            Open Story Bank
          </Link>
        </div>
        {stories.length === 0 ? (
          <p className="m-0 border-t border-line pt-6 text-body text-ink-muted">
            Keep the stories you want ready on demand in your <Link to="/stories" className="text-olive underline-offset-4 hover:underline">Story Bank</Link>, and Vireo will check you hit their key points.
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-10 p-0">
            {stories.slice(0, 3).map((st) => (
              <li key={st.id} className="flex flex-col gap-2 border-t border-line py-6">
                <span className="text-small text-ink-muted">
                  {st.tag}
                  {st.length ? `, ${st.length}` : ''}
                </span>
                <span className="font-display text-[28px] leading-8">{st.title}</span>
                <span>
                  <Button variant="link" className="h-auto px-0 text-[15px]" onClick={() => rehearse(st)}>
                    Rehearse
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="data-h" className="flex flex-col gap-4 border-t border-line pt-10">
        <h2 id="data-h" className="m-0 text-heading">
          Your data stays here
        </h2>
        <p className="m-0 max-w-[720px] text-body text-ink-muted">
          Sessions, transcripts, field notes and your Story Bank are stored in this browser only. Video is analysed on this device and never leaves it. During a session, your audio goes to Deepgram to be transcribed; afterwards, your transcript goes to the model your server is set up to use for field notes.
        </p>
        <div>
          <ConfirmDelete
            label="Delete all data"
            warning="This deletes every session, note and story on this device."
            confirmLabel="Delete everything"
            onConfirm={async () => {
              await deleteAllData();
              setSessions([]);
              setStories([]);
            }}
          />
        </div>
      </section>
    </div>
  );
}

function BigNumber({ value, unit, label, note, tone }: { value: string; unit?: string; label: string; note: React.ReactNode; tone?: 'sky' | 'amber' }) {
  return (
    <div>
      <p className={cn('m-0 font-display text-[72px] leading-none tracking-[-0.03em]', tone === 'sky' && 'text-sky', tone === 'amber' && 'text-amber')}>
        {value}
        {unit && <span className="text-[32px] text-ink-muted"> {unit}</span>}
      </p>
      <p className="m-0 mb-1 mt-3 text-lg font-semibold">{label}</p>
      <p className="m-0 text-[15px] text-ink-muted">{note}</p>
    </div>
  );
}
