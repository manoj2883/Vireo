/**
 * The shareable before-and-after card: a 1080×1350 PNG drawn in the browser. It carries the two
 * sonograms, the three biggest changes and the Vireo mark. None of the speaker's words appear
 * unless they tick "include my words".
 */
import { compareTakes, topImprovements } from '@/lib/compare';
import { situationById } from '@/session/situations';
import type { StoredSession } from '@/storage/localDb';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/** The dark palette, fixed so the card looks the same whatever theme made it. */
const C = {
  bg: '#121829',
  panel: '#1c2338',
  ink: '#eef0f6',
  muted: 'rgba(238,240,246,0.62)',
  olive: '#d7e36b',
  amber: '#ff9e7a',
  sky: '#6fd3d0',
};
const DISPLAY = 'Newsreader, Georgia, serif';
const SANS = '"Schibsted Grotesk", system-ui, sans-serif';

export interface CardTrack {
  label: string;
  durationMs: number;
  /** Word spans only: timing and kind, never the text. */
  bars: { startMs: number; endMs: number; filler: boolean }[];
  pauses: { startMs: number; endMs: number }[];
}

export interface ShareCardSpec {
  heading: string;
  context: string;
  windowMs: number;
  tracks: CardTrack[];
  numbers: { label: string; before: string; after: string }[];
  fix: string | null;
  /** The speaker's words from the latest take: only when they asked for them. */
  words: string | null;
}

function track(label: string, s: StoredSession): CardTrack {
  return {
    label,
    durationMs: s.metrics.durationMs,
    bars: s.segments.map((w) => ({ startMs: w.startMs, endMs: w.endMs, filler: w.kind === 'filler' })),
    pauses: s.pauses.filter((p) => p.endMs !== undefined && Number.isFinite(p.endMs) && p.endMs - p.startMs >= 300).map((p) => ({ startMs: p.startMs, endMs: p.endMs as number })),
  };
}

export function buildShareCard(before: StoredSession, after: StoredSession, { includeWords = false }: { includeWords?: boolean } = {}): ShareCardSpec {
  const cmp = compareTakes(before, after);
  const top = topImprovements(cmp, 3);
  // Always three numbers: the best improvements, topped up with whatever else changed.
  const rest = cmp.changes.filter((c) => !top.includes(c));
  const numbers = [...top, ...rest].slice(0, 3).map((c) => ({ label: c.label, before: c.format(c.before), after: c.format(c.after) }));
  const situation = situationById(after.config.situationId);
  const words = includeWords
    ? after.transcript
        .map((l) => l.text)
        .join(' ')
        .slice(0, 280)
    : null;
  return {
    heading: 'Before and after',
    context: situation ? situation.label : 'Practice take',
    windowMs: Math.max(before.metrics.durationMs, after.metrics.durationMs, 1000),
    tracks: [track('Before', before), track('After', after)],
    numbers,
    fix: cmp.fix ? `${cmp.fix.achieved ? 'Fixed' : 'Working on'}: ${cmp.fix.instruction}` : null,
    words: words || null,
  };
}

/** The subset of the canvas API the card uses, so tests can record what was drawn. */
export type CardContext = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'globalAlpha' | 'font' | 'textBaseline' | 'fillRect' | 'fillText' | 'measureText' | 'beginPath' | 'moveTo' | 'bezierCurveTo' | 'stroke' | 'arc' | 'fill' | 'roundRect'
>;

function wrap(ctx: CardContext, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The mark from VireoMark.tsx (three harmonic strokes and an apricot note), drawn at (x, y). */
function drawMark(ctx: CardContext, x: number, y: number, scale: number) {
  const strokes: [number, number, number][] = [
    [24, 3.2, 1],
    [16, 2.4, 0.6],
    [9, 1.8, 0.32],
  ];
  const p = (px: number, py: number): [number, number] => [x + px * scale, y + py * scale];
  ctx.strokeStyle = C.olive;
  ctx.lineCap = 'round';
  for (const [y0, w, a] of strokes) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w * scale;
    ctx.beginPath();
    ctx.moveTo(...p(5, y0));
    ctx.bezierCurveTo(...p(9, y0 - 3), ...p(12, y0 - 3), ...p(15, y0));
    ctx.bezierCurveTo(...p(18, y0 + 3), ...p(21, y0 + 2), ...p(24, y0 - 2));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.arc(...p(28.5, 21), 2.2 * scale, 0, Math.PI * 2);
  ctx.fill();
}

export function drawShareCard(ctx: CardContext, spec: ShareCardSpec): void {
  const pad = 80;
  const inner = CARD_WIDTH - pad * 2;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.textBaseline = 'alphabetic';

  drawMark(ctx, pad - 8, 70, 2.4);
  ctx.fillStyle = C.ink;
  ctx.font = `500 44px ${DISPLAY}`;
  ctx.fillText('Vireo', pad + 80, 122);

  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${SANS}`;
  ctx.fillText(spec.context.toUpperCase(), pad, 230);
  ctx.fillStyle = C.ink;
  ctx.font = `400 92px ${DISPLAY}`;
  ctx.fillText(spec.heading, pad, 320);

  // Two sonograms on one time scale.
  let y = 380;
  const trackH = 150;
  for (const t of spec.tracks) {
    ctx.fillStyle = C.panel;
    ctx.beginPath();
    ctx.roundRect(pad, y, inner, trackH, 20);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(t.label, pad + 24, y + 40);
    const x0 = pad + 24;
    const w = inner - 48;
    const mid = y + 95;
    const toX = (ms: number) => x0 + (Math.min(ms, spec.windowMs) / spec.windowMs) * w;
    ctx.fillStyle = C.sky;
    for (const p of t.pauses) ctx.fillRect(toX(p.startMs), mid + 26, Math.max(2, toX(p.endMs) - toX(p.startMs)), 4);
    for (const b of t.bars) {
      ctx.fillStyle = b.filler ? C.amber : C.olive;
      const bw = Math.max(3, toX(b.endMs) - toX(b.startMs) - 1.5);
      ctx.beginPath();
      ctx.roundRect(toX(b.startMs), mid - (b.filler ? 22 : 14), bw, b.filler ? 44 : 28, 3);
      ctx.fill();
    }
    y += trackH + 24;
  }

  // Three changed numbers.
  y += 40;
  const colW = inner / 3;
  spec.numbers.forEach((n, i) => {
    const x = pad + i * colW;
    ctx.fillStyle = C.muted;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(n.label, x, y);
    ctx.fillStyle = C.muted;
    ctx.font = `400 34px ${DISPLAY}`;
    ctx.fillText(n.before, x, y + 52);
    ctx.fillStyle = C.ink;
    ctx.font = `400 58px ${DISPLAY}`;
    ctx.fillText(n.after, x, y + 118);
  });
  y += 190;

  if (spec.fix) {
    ctx.fillStyle = C.olive;
    ctx.font = `500 30px ${SANS}`;
    for (const line of wrap(ctx, spec.fix, inner).slice(0, 2)) {
      ctx.fillText(line, pad, y);
      y += 42;
    }
    y += 20;
  }

  if (spec.words) {
    ctx.fillStyle = C.ink;
    ctx.font = `italic 400 32px ${DISPLAY}`;
    for (const line of wrap(ctx, `“${spec.words}”`, inner).slice(0, 4)) {
      ctx.fillText(line, pad, y);
      y += 44;
    }
  }

  ctx.fillStyle = C.muted;
  ctx.font = `500 24px ${SANS}`;
  ctx.fillText('A field guide to your voice', pad, CARD_HEIGHT - 70);
}

/** Draw the card on a fresh canvas and return it as a PNG. */
export async function shareCardPng(spec: ShareCardSpec): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw the card.');
  drawShareCard(ctx, spec);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t make the image.'))), 'image/png'));
}

/** Save a blob as a file without sending it anywhere. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
