/**
 * "Practise again before it matters": three rehearsal reminders spread before the real date, as an
 * .ics file. Each links back to /warm-up with the same prompt and that day's drill; never the
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

export function buildIcs(input: ReminderInput): string {
  const days = rehearsalDays(input.today, input.eventDay);
  const now = input.now ?? new Date();
  const shortPrompt = input.prompt.length > 60 ? `${input.prompt.slice(0, 57)}...` : input.prompt;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vireo//Rehearsal reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  days.forEach((day, i) => {
    const drill = input.drills.length ? input.drills[i % input.drills.length] : undefined;
    const link = warmUpLink(input.origin, input.prompt, input.situationId, drill);
    const left = daysBetween(day, input.eventDay);
    const description = [`Rehearsal ${i + 1} of 3, ${left} ${left === 1 ? 'day' : 'days'} before the real thing.`, drill ? `Today's drill: ${drill}` : '', `Open Vireo: ${link}`].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:vireo-${compact(input.eventDay)}-${i + 1}-${stamp(now)}@vireo`,
      `DTSTAMP:${stamp(now)}`,
      // Floating local time: 6 pm wherever they are.
      `DTSTART:${compact(day)}T180000`,
      `DTEND:${compact(day)}T182000`,
      `SUMMARY:${icsEscape(`Vireo rehearsal: ${shortPrompt}`)}`,
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
