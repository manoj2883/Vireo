/**
 * "Download your report": a one-page PDF made in the browser. Nothing is sent to the server.
 * The transcript goes on a second page only when "Include my words" is ticked.
 */
import { compareTakes } from '@/lib/compare';
import { situationById } from '@/session/situations';
import { TALK_TYPES } from '@/live/metrics/pace';
import type { StoredSession } from '@/storage/localDb';
import type { jsPDF } from 'jspdf';

export interface ReportSpec {
  title: string;
  subtitle: string;
  prompt: string;
  oneFix: { instruction: string; why: string } | null;
  tightened: string | null;
  /** Before and after on a retake; this take's numbers otherwise. */
  numbers: { label: string; before: string | null; after: string }[];
  fixResult: string | null;
  drills: { title: string; instructions: string; minutes: number }[];
  /** The speaker's words: only when they asked for them. */
  transcript: string | null;
}

const oneDp = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function buildReport(session: StoredSession, previous: StoredSession | null, { includeWords = false }: { includeWords?: boolean } = {}): ReportSpec {
  const situation = situationById(session.config.situationId);
  const date = new Date(session.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let numbers: ReportSpec['numbers'];
  let fixResult: string | null = null;
  if (previous) {
    const cmp = compareTakes(previous, session);
    numbers = cmp.changes.map((c) => ({ label: c.label, before: c.format(c.before), after: c.format(c.after) }));
    if (cmp.fix) fixResult = `${cmp.fix.instruction} ${cmp.fix.achieved ? 'Achieved' : 'Not yet'}: "${cmp.fix.evidence}"`;
  } else {
    const m = session.metrics;
    numbers = [
      { label: 'Fillers', before: null, after: `${oneDp(m.fillersPerMin)} a minute` },
      { label: 'Time in your pace zone', before: null, after: `${Math.round(m.timeInZonePct)}%` },
      { label: 'Pauses', before: null, after: `${oneDp(m.pausesPerMin)} a minute` },
      ...(session.camera ? [{ label: 'Eye contact', before: null, after: `${Math.round(session.camera.summary.eyeContactPct)}%` }] : []),
    ];
  }
  return {
    title: 'Your Vireo report',
    subtitle: `${situation?.label ?? TALK_TYPES[session.config.talkType]?.label ?? 'Practice'}, ${date}`,
    prompt: session.config.prompt,
    oneFix: session.notes?.oneFix ?? null,
    tightened: session.tightened?.status === 'ready' ? session.tightened.script : null,
    numbers,
    fixResult,
    drills: (session.notes?.drills ?? []).slice(0, 3).map((d) => ({ title: d.title, instructions: d.instructions, minutes: d.minutes })),
    transcript: includeWords ? session.transcript.map((l) => l.text).join('\n') : null,
  };
}

/** The PDF's built-in fonts only cover Latin-1: swap typographic characters for plain ones. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
    })
    .join('');
}

const INK: [number, number, number] = [20, 26, 44];
const MUTED: [number, number, number] = [100, 106, 122];
const OLIVE: [number, number, number] = [93, 107, 12];
const AMBER: [number, number, number] = [180, 71, 31];

/** Lay the report out on an A4 page (and a second for the transcript, if included). */
export async function makeReportPdf(spec: ReportSpec): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const inner = W - M * 2;
  const bottom = H - 56;
  let y = M;

  const text = (s: string, size: number, opts: { font?: 'helvetica' | 'times'; style?: 'normal' | 'bold' | 'italic'; color?: [number, number, number]; maxLines?: number; gap?: number } = {}) => {
    doc.setFont(opts.font ?? 'helvetica', opts.style ?? 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK));
    const lineH = size * 1.32;
    let lines = doc.splitTextToSize(pdfSafe(s), inner) as string[];
    const room = Math.max(0, Math.floor((bottom - y) / lineH));
    const max = Math.min(opts.maxLines ?? Infinity, room);
    if (lines.length > max) lines = [...lines.slice(0, Math.max(0, max - 1)), `${lines[Math.max(0, max - 1)] ?? ''}...`].slice(0, max);
    for (const line of lines) {
      doc.text(line, M, y + size);
      y += lineH;
    }
    y += opts.gap ?? 6;
  };
  const heading = (s: string) => {
    y += 8;
    text(s.toUpperCase(), 9, { style: 'bold', color: MUTED, gap: 2 });
  };

  // The mark: three harmonic strokes and an apricot note (as in VireoMark), then the wordmark.
  const s = 0.9;
  doc.setDrawColor(...OLIVE);
  doc.setLineCap('round');
  for (const [y0, w] of [
    [24, 3.2],
    [16, 2.0],
    [9, 1.2],
  ] as const) {
    doc.setLineWidth(w * s);
    doc.lines(
      [
        [4 * s, -3 * s, 7 * s, -3 * s, 10 * s, 0],
        [3 * s, 3 * s, 6 * s, 2 * s, 9 * s, -2 * s],
      ],
      M + 5 * s,
      y + y0 * s,
      [1, 1],
      'S',
      false
    );
  }
  doc.setFillColor(...AMBER);
  doc.circle(M + 28.5 * s, y + 21 * s, 2.2 * s, 'F');
  doc.setFont('times', 'normal');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text('Vireo', M + 40, y + 22);
  y += 46;

  text(spec.title, 26, { font: 'times', gap: 2 });
  text(spec.subtitle, 10, { color: MUTED, gap: 4 });
  text(`"${spec.prompt}"`, 11, { font: 'times', style: 'italic', maxLines: 2 });

  if (spec.oneFix) {
    heading('Your one fix for the next take');
    text(spec.oneFix.instruction, 16, { font: 'times', maxLines: 3, gap: 2 });
    text(spec.oneFix.why, 10, { color: MUTED, maxLines: 2 });
  }

  if (spec.fixResult) {
    heading('Last time’s fix');
    text(spec.fixResult, 10, { maxLines: 3 });
  }

  if (spec.numbers.length) {
    heading(spec.numbers[0].before !== null ? 'Before and after' : 'This take');
    doc.setFontSize(10);
    for (const n of spec.numbers) {
      if (y + 16 > bottom) break;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(pdfSafe(n.label), M, y + 10);
      doc.setTextColor(...INK);
      doc.text(pdfSafe(n.before !== null ? `${n.before}  ->  ${n.after}` : n.after), M + 190, y + 10);
      y += 16;
    }
    y += 4;
  }

  if (spec.tightened) {
    heading('Your answer, tightened (/ = pause)');
    text(spec.tightened, 11, { font: 'times', maxLines: 12 });
  }

  if (spec.drills.length) {
    heading('Drills');
    for (const d of spec.drills) {
      if (y + 30 > bottom) break;
      text(`${d.title} (${d.minutes} min)`, 10, { style: 'bold', gap: 0, maxLines: 1 });
      text(d.instructions, 9.5, { color: MUTED, maxLines: 3, gap: 4 });
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  // Matches the README's Privacy section: only the PDF itself is drawn locally.
  const footer = doc.splitTextToSize(
    'Made by Vireo, a field guide to your voice. This PDF was drawn on your device. Your transcript was sent to write the field notes; audio and video were not.',
    W - M * 2,
  ) as string[];
  doc.text(footer, M, H - 32 - (footer.length - 1) * 10);

  if (spec.transcript) {
    doc.addPage();
    y = M;
    text('What you said', 20, { font: 'times' });
    // The transcript can run long: keep going onto more pages.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    for (const line of doc.splitTextToSize(pdfSafe(spec.transcript), inner) as string[]) {
      if (y + 14 > bottom) {
        doc.addPage();
        y = M;
      }
      doc.text(line, M, y + 10);
      y += 14;
    }
  }
  return doc;
}

export async function reportPdfBlob(spec: ReportSpec): Promise<Blob> {
  return (await makeReportPdf(spec)).output('blob');
}
