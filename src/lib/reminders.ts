/**
 * "Practise again before it matters": three rehearsal reminders spread before the real date, as an
 * .ics file or as Google Calendar and Outlook.com links. Each links back to /warm-up with the same prompt and that day's drill; never the
 * transcript. No email address is collected.
 */

export const MIN_DAYS_AHEAD = 4;
export const MAX_DAYS_AHEAD = 365;

/** "2026-10-14" from a Date, in local time. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function dayFromNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * Three days to rehearse, between today and the event: about a quarter and half of the way there,
 * then the day before. Needs the event at least four days away so all three are in the future.
 */
export function rehearsalDays(today: string, eventDay: string): string[] {
  const span = daysBetween(today, eventDay);
  if (!Number.isFinite(span) || span < MIN_DAYS_AHEAD) throw new Error(`Pick a date at least ${MIN_DAYS_AHEAD} days away, so there’s room for three rehearsals.`);
  if (span > MAX_DAYS_AHEAD) throw new Error('Pick a date within the next year.');
  const start = dayNumber(today);
  return [Math.floor(span / 4), Math.floor(span / 2), span - 1].map((k) => dayFromNumber(start + k));
}

export interface ReminderInput {
  today: string;
  eventDay: string;
  prompt: string;
  situationId?: string;
  /** A drill title per rehearsal, cycled. */
  drills: string[];
  origin: string;
  /** When the file was made, for DTSTAMP. */
  now?: Date;
}

export function warmUpLink(origin: string, prompt: string, situationId: string | undefined, drill: string | undefined): string {
  const params = new URLSearchParams();
  params.set('prompt', prompt.slice(0, 300));
  if (situationId) params.set('situation', situationId);
  if (drill) params.set('drill', drill.slice(0, 300));
  return `${origin.replace(/\/$/, '')}/warm-up?${params.toString()}`;
}

/** Escape a TEXT value (RFC 5545 3.3.11). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets, without splitting a character (RFC 5545 3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compact = (day: string) => day.replace(/-/g, '');

/** Every reminder is 6:00 to 6:20 pm, in the user's local time. */
const START_TIME = '18:00:00';
const END_TIME = '18:20:00';

/** One rehearsal, shared by the .ics file and the Google and Outlook links so they always agree. */
export interface ReminderEvent {
  day: string;
  drill: string | undefined;
  title: string;
  description: string;
  link: string;
  /** "Sat 17 Oct — First-Sentence Landing" */
  label: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 17 Oct" for "2026-10-17". */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function reminderEvents(input: ReminderInput): ReminderEvent[] {
  const shortPrompt = input.prompt.length > 60 ? `${input.prompt.slice(0, 57)}...` : input.prompt;
  return rehearsalDays(input.today, input.eventDay).map((day, i) => {
    const drill = input.drills.length ? input.drills[i % input.drills.length] : undefined;
    const link = warmUpLink(input.origin, input.prompt, input.situationId, drill);
    const left = daysBetween(day, input.eventDay);
    const description = [`Rehearsal ${i + 1} of 3, ${left} ${left === 1 ? 'day' : 'days'} before the real thing.`, drill ? `Today's drill: ${drill}` : '', `Open Vireo: ${link}`].filter(Boolean).join('\n');
    return { day, drill, title: `Vireo rehearsal: ${shortPrompt}`, description, link, label: `${shortDay(day)} — ${drill ?? `Rehearsal ${i + 1}`}` };
  });
}

/** Google Calendar "new event" links, one per rehearsal. No `Z` on the dates, so they stay local time like the .ics. */
export function googleCalendarLinks(input: ReminderInput): { label: string; href: string }[] {
  return reminderEvents(input).map((e) => {
    const at = (time: string) => `${compact(e.day)}T${time.replace(/:/g, '')}`;
    const q = `action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${at(START_TIME)}/${at(END_TIME)}&details=${encodeURIComponent(e.description)}`;
    return { label: e.label, href: `https://calendar.google.com/calendar/render?${q}` };
  });
}

/** Outlook.com "new event" links, one per rehearsal, with ISO local date-times. */
export function outlookLinks(input: ReminderInput): { label: string; href: string }[] {
  return reminderEvents(input).map((e) => {
    // encodeURIComponent, not URLSearchParams: spaces as %20, since a "+" is not always read as a space.
    const params: [string, string][] = [
      ['path', '/calendar/action/compose'],
      ['rru', 'addevent'],
      ['subject', e.title],
      ['startdt', `${e.day}T${START_TIME}`],
      ['enddt', `${e.day}T${END_TIME}`],
      ['body', e.description],
    ];
    const q = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return { label: e.label, href: `https://outlook.live.com/calendar/0/deeplink/compose?${q}` };
  });
}

export function buildIcs(input: ReminderInput): string {
  const now = input.now ?? new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vireo//Rehearsal reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  reminderEvents(input).forEach(({ day, title, description, link }, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:vireo-${compact(input.eventDay)}-${i + 1}-${stamp(now)}@vireo`,
      `DTSTAMP:${stamp(now)}`,
      // Floating local time: 6 pm wherever they are.
      `DTSTART:${compact(day)}T${START_TIME.replace(/:/g, '')}`,
      `DTEND:${compact(day)}T${END_TIME.replace(/:/g, '')}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `URL:${link}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:PT0M',
      `DESCRIPTION:${icsEscape('Time to rehearse with Vireo')}`,
      'END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
