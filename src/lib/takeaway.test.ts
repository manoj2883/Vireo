import { describe, expect, it } from 'vitest';
import { buildReport, makeReportPdf, pdfSafe } from './report';
import { buildIcs, foldLine, googleCalendarLinks, icsEscape, outlookLinks, rehearsalDays, reminderEvents, warmUpLink } from './reminders';
import type { StoredSession } from '@/storage/localDb';

const WORDS = 'Honestly my thesis measured refusal calibration across seven benchmarks';

function session(extra: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 's1',
    createdAt: '2026-10-12T10:00:00.000Z',
    config: { prompt: 'Tell me about your research.', talkType: 'interview', situationId: 'interview', mode: 'watch', audience: false, hideFace: false },
    segments: [],
    pauses: [],
    transcript: [{ speaker: 'user', text: WORDS, startMs: 0 }],
    metrics: { durationMs: 60_000, wordCount: 150, avgWpm: 150, timeInZonePct: 62, fillerCount: 3, fillersPerMin: 3, pauseCount: 4, pausesPerMin: 4, longestPauseMs: 900 },
    take: { avgWpm: 150, inZoneRatio: 0.62, fillersPerMin: 3 },
    newBest: false,
    notesStatus: 'ready',
    notes: {
      verdict: 'Clear story.',
      oneFix: { instruction: 'Say your result in the first sentence.', why: 'Interviewers decide early.' },
      summary: '',
      scores: { structure: 3, delivery: 3, clarity: 3 },
      storyMap: { sections: [] },
      notes: [],
      audienceFollowUp: { question: '', reason: '' },
      drills: [
        { title: 'Result first', instructions: 'Answer in one sentence, then explain.', minutes: 5 },
        { title: 'Pause before numbers', instructions: 'Breathe before every number.', minutes: 3 },
      ],
    },
    tightened: { script: 'My research measures refusal. / Across seven benchmarks.', mainPoint: 'My research measures refusal.', status: 'ready' },
    ...extra,
  };
}

/** All the text jsPDF wrote (it writes standard-font text uncompressed). */
async function pdfText(includeWords: boolean) {
  const doc = await makeReportPdf(buildReport(session(), null, { includeWords }));
  return { pages: doc.getNumberOfPages(), raw: new TextDecoder('latin1').decode(doc.output('arraybuffer')) };
}

describe('report PDF', () => {
  it('leaves the transcript out by default', async () => {
    expect(buildReport(session(), null).transcript).toBeNull();
    const { pages, raw } = await pdfText(false);
    expect(pages).toBe(1);
    expect(raw).not.toContain('thesis');
    expect(raw).toContain('Say your result in the first sentence.');
    expect(raw).toContain('Result first');
  });

  it('puts the transcript on page 2 only when asked', async () => {
    const { pages, raw } = await pdfText(true);
    expect(pages).toBe(2);
    expect(raw).toContain('thesis measured refusal calibration');
  });

  it('shows before and after numbers on a retake', () => {
    const prev = session({ id: 's0', metrics: { ...session().metrics, fillersPerMin: 6 } });
    const spec = buildReport(session({ retakeOf: 's0' }), prev);
    expect(spec.numbers[0]).toEqual({ label: 'Fillers', before: '6.0 a minute', after: '3.0 a minute' });
  });

  it('keeps text inside the built-in fonts', () => {
    expect(pdfSafe('It’s “done” — 5 → 3…')).toBe('It\'s "done" - 5 -> 3...');
  });
});

describe('rehearsal reminders (.ics)', () => {
  const input = {
    today: '2026-10-14',
    eventDay: '2026-10-24',
    prompt: 'Tell me about your research, briefly; then why us?',
    situationId: 'interview',
    drills: ['Result first', 'Pause before numbers'],
    origin: 'https://vireo.example',
    now: new Date('2026-10-14T09:30:00Z'),
  };

  it('spreads three rehearsals before the date, the last the day before', () => {
    expect(rehearsalDays('2026-10-14', '2026-10-24')).toEqual(['2026-10-16', '2026-10-19', '2026-10-23']);
    expect(rehearsalDays('2026-10-14', '2026-10-18')).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    // Across a month and a daylight-saving change.
    expect(rehearsalDays('2026-10-20', '2026-11-03')).toEqual(['2026-10-23', '2026-10-27', '2026-11-02']);
    expect(() => rehearsalDays('2026-10-14', '2026-10-16')).toThrow(/at least 4 days/);
    expect(() => rehearsalDays('2026-10-14', '2026-10-01')).toThrow();
  });

  it('is a valid calendar with three events at the right dates', () => {
    const ics = buildIcs(input);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Every line ends in CRLF and fits in 75 octets.
    const physical = ics.slice(0, -2).split('\r\n');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const l of physical) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    // Unfold, then check structure.
    const lines = ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
    const count = (p: string) => lines.filter((l) => l === p).length;
    expect(count('BEGIN:VEVENT')).toBe(3);
    expect(count('END:VEVENT')).toBe(3);
    expect(count('BEGIN:VALARM')).toBe(3);
    expect(lines.filter((l) => l.startsWith('DTSTART:'))).toEqual(['DTSTART:20261016T180000', 'DTSTART:20261019T180000', 'DTSTART:20261023T180000']);
    expect(lines.filter((l) => l.startsWith('UID:'))).toHaveLength(3);
    expect(new Set(lines.filter((l) => l.startsWith('UID:'))).size).toBe(3);
    expect(lines).toContain('DTSTAMP:20261014T093000Z');
    for (const l of lines) expect(l).toMatch(/^[A-Z-]+[:;]/);
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toContain('briefly\\; then why us?');
  });

  it('links each reminder to /warm-up with the prompt and that day’s drill, and no transcript', () => {
    const ics = buildIcs(input).replace(/\r\n /g, '');
    const urls = ics.split('\r\n').filter((l) => l.startsWith('URL:')).map((l) => new URL(l.slice(4)));
    expect(urls).toHaveLength(3);
    expect(urls.map((u) => u.pathname)).toEqual(['/warm-up', '/warm-up', '/warm-up']);
    expect(urls.map((u) => u.searchParams.get('drill'))).toEqual(['Result first', 'Pause before numbers', 'Result first']);
    for (const u of urls) {
      expect(u.searchParams.get('prompt')).toBe(input.prompt);
      expect(u.searchParams.get('situation')).toBe('interview');
      expect([...u.searchParams.keys()].sort()).toEqual(['drill', 'prompt', 'situation']);
    }
    expect(ics).not.toContain('thesis');
  });

  it('makes Google and Outlook links with the same dates and 6:00-6:20 pm times as the .ics', () => {
    const ics = buildIcs(input).replace(/\r\n /g, '').split('\r\n');
    const icsTimes = ics.filter((l) => /^DT(START|END):/.test(l)).map((l) => l.split(':')[1]);
    expect(icsTimes).toEqual(['20261016T180000', '20261016T182000', '20261019T180000', '20261019T182000', '20261023T180000', '20261023T182000']);
    const summaries = ics.filter((l) => l.startsWith('SUMMARY:'));

    const google = googleCalendarLinks(input);
    expect(google).toHaveLength(3);
    const googleTimes = google.flatMap((g) => new URL(g.href).searchParams.get('dates')!.split('/'));
    expect(googleTimes).toEqual(icsTimes); // no Z: local time, like the .ics
    for (const g of google) {
      const u = new URL(g.href);
      expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
      expect(u.searchParams.get('action')).toBe('TEMPLATE');
    }

    const outlook = outlookLinks(input);
    expect(outlook).toHaveLength(3);
    const outlookTimes = outlook.flatMap((o) => {
      const u = new URL(o.href);
      return [u.searchParams.get('startdt'), u.searchParams.get('enddt')].map((t) => t!.replace(/[-:]/g, ''));
    });
    expect(outlookTimes).toEqual(icsTimes);
    expect(new URL(outlook[0].href).searchParams.get('startdt')).toBe('2026-10-16T18:00:00');
    expect(outlook[0].href.startsWith('https://outlook.live.com/calendar/0/deeplink/compose?')).toBe(true);

    // Same title and description everywhere.
    const events = reminderEvents(input);
    events.forEach((e, i) => {
      expect(summaries[i]).toBe(`SUMMARY:${icsEscape(e.title)}`);
      expect(new URL(google[i].href).searchParams.get('text')).toBe(e.title);
      expect(new URL(google[i].href).searchParams.get('details')).toBe(e.description);
      expect(new URL(outlook[i].href).searchParams.get('subject')).toBe(e.title);
      expect(new URL(outlook[i].href).searchParams.get('body')).toBe(e.description);
      expect(e.description).toContain(e.link);
    });
    expect(google.map((g) => g.label)).toEqual(['Fri 16 Oct — Result first', 'Mon 19 Oct — Pause before numbers', 'Fri 23 Oct — Result first']);
    expect(outlook.map((o) => o.label)).toEqual(google.map((g) => g.label));
  });

  it('folds long lines without splitting characters', () => {
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(80)}`);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(80)}`);
  });

  it('builds a link without a drill when there is none', () => {
    expect(warmUpLink('https://v.example/', 'Hi', undefined, undefined)).toBe('https://v.example/warm-up?prompt=Hi');
  });
});
