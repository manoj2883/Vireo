import { useId, useState } from 'react';
import { CalendarPlus, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildReport, reportPdfBlob } from '@/lib/report';
import { buildIcs, isoDay, MAX_DAYS_AHEAD, MIN_DAYS_AHEAD, rehearsalDays } from '@/lib/reminders';
import { saveBlob } from '@/lib/shareCard';
import { situationById } from '@/session/situations';
import type { StoredSession } from '@/storage/localDb';

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** "Take it with you": a PDF report and calendar reminders, both made on this device. */
export function TakeItWithYou({ session, previous }: { session: StoredSession; previous: StoredSession | null }) {
  const [includeWords, setIncludeWords] = useState(false);
  const [pdfState, setPdfState] = useState<'idle' | 'making' | { error: string }>('idle');
  const today = isoDay(new Date());
  const [eventDay, setEventDay] = useState('');
  const wordsId = useId();
  const dateId = useId();
  const situation = situationById(session.config.situationId);
  const what = situation?.id === 'presentation' ? 'talk' : situation?.id === 'pitch' ? 'pitch' : situation?.id === 'toast' ? 'big moment' : 'interview';

  let days: string[] | null = null;
  let dateError: string | null = null;
  if (eventDay) {
    try {
      days = rehearsalDays(today, eventDay);
    } catch (err) {
      dateError = err instanceof Error ? err.message : String(err);
    }
  }

  async function downloadReport() {
    setPdfState('making');
    try {
      saveBlob(await reportPdfBlob(buildReport(session, previous, { includeWords })), 'vireo-report.pdf');
      setPdfState('idle');
    } catch (err) {
      setPdfState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  function downloadReminders() {
    const drills = session.notes?.drills.map((d) => d.title) ?? [];
    const ics = buildIcs({
      today,
      eventDay,
      prompt: session.config.prompt,
      situationId: session.config.situationId,
      drills: drills.length ? drills : session.notes?.oneFix ? [session.notes.oneFix.instruction] : [],
      origin: window.location.origin,
    });
    saveBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'vireo-rehearsals.ics');
  }

  return (
    <section aria-labelledby="take-h" className="flex flex-col gap-8 border-t border-line pt-10">
      <h2 id="take-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
        Take it with you
      </h2>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h3 className="m-0 text-heading">Download your report</h3>
          <p className="m-0 text-body text-ink-muted">One page: your one fix, your answer tightened, the numbers{previous ? ' before and after' : ''} and your drills. Made on this device; nothing is sent anywhere.</p>
          <label htmlFor={wordsId} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-label">
            <input id={wordsId} type="checkbox" className="h-5 w-5 accent-[rgb(var(--olive))]" checked={includeWords} onChange={(e) => setIncludeWords(e.target.checked)} />
            Include my words (adds the transcript on page 2)
          </label>
          <div>
            <Button size="lg" onClick={downloadReport} disabled={pdfState === 'making'}>
              <FileDown className="h-4 w-4" aria-hidden="true" />
              {pdfState === 'making' ? 'Making your report' : 'Download your report'}
            </Button>
          </div>
          {typeof pdfState === 'object' && (
            <p role="alert" className="m-0 text-small text-amber">
              Couldn’t make the report: {pdfState.error}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="m-0 text-heading">Practise again before it matters</h3>
          <label htmlFor={dateId} className="text-body text-ink-muted">
            When is the real {what}? We’ll put three short rehearsals in your calendar before it, each with that day’s drill.
          </label>
          <input
            id={dateId}
            type="date"
            className="min-h-12 w-fit rounded-md border border-line bg-surface-100 px-4 text-body text-foreground"
            min={addDays(today, MIN_DAYS_AHEAD)}
            max={addDays(today, MAX_DAYS_AHEAD)}
            value={eventDay}
            onChange={(e) => setEventDay(e.target.value)}
          />
          {dateError && (
            <p role="alert" className="m-0 text-small text-amber">
              {dateError}
            </p>
          )}
          {days && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body" aria-label="Rehearsal days">
              {days.map((d) => (
                <li key={d}>{longDay(d)}, 6 pm</li>
              ))}
            </ul>
          )}
          <div>
            <Button size="lg" variant="outline" onClick={downloadReminders} disabled={!days}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Add 3 reminders to my calendar
            </Button>
          </div>
          <p className="m-0 text-small text-ink-muted">Downloads an .ics file for any calendar app. Each reminder links back to this question, never to what you said. No email needed.</p>
        </div>
      </div>
    </section>
  );
}
