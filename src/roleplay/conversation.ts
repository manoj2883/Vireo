/**
 * A roleplay or Q&A conversation, built on one live session: the partner asks, the speaker answers,
 * turn by turn. Words heard while the partner is speaking are dropped, so the partner's own voice
 * (through the speakers) never counts as the speaker's. Pure, so the splitting is tested here.
 */
import type { PauseSpan, WordSegment } from '@/components/sonogram/types';
import { summariseMetrics, toTranscriptLines, type SessionMetrics, type TranscriptLine } from '@/live/LiveSessionEngine';
import { TALK_TYPES, type TalkType } from '@/live/metrics/pace';

export type PartnerRole = 'interviewer' | 'investor' | 'customer' | 'tough_audience';
export type PartnerMode = 'roleplay' | 'qa';

export const ROLE_LABELS: Record<PartnerRole, string> = {
  interviewer: 'Interviewer',
  investor: 'Investor',
  customer: 'Customer',
  tough_audience: 'Tough audience member',
};

/** Mirrors server/llm/roleplay.js. */
export const MIN_TURNS = 3;
export const MAX_TURNS = 6;
export const QA_TURNS = 3;

/** The partner that fits each situation best, as the default choice. */
export const DEFAULT_ROLE: Record<string, PartnerRole> = {
  interview: 'interviewer',
  pitch: 'investor',
  presentation: 'tough_audience',
  english: 'interviewer',
  toast: 'tough_audience',
};

export interface PartnerSetup {
  mode: PartnerMode;
  role: PartnerRole;
  turns: number;
  /** Q&A only: the talk the questions are drawn from, and its session. */
  source?: string;
  sourceSessionId?: string;
}

export interface PartnerTurn {
  question: string;
  basedOn: string | null;
  /** Session time the partner started asking. */
  askedAtMs: number;
  answerStartMs: number;
  answerEndMs: number;
}

const inAnswer = (ms: number, turns: readonly PartnerTurn[]) => turns.some((t) => ms >= t.answerStartMs && ms <= t.answerEndMs);

/** Only the speaker's words: those that start inside an answer window. */
export function answerSegments(segments: readonly WordSegment[], turns: readonly PartnerTurn[]): WordSegment[] {
  return segments.filter((s) => inAnswer(s.startMs, turns));
}

/** The text of one answer, for the partner's next question. */
export function answerText(segments: readonly WordSegment[], turn: Pick<PartnerTurn, 'answerStartMs' | 'answerEndMs'>): string {
  return segments
    .filter((s) => s.startMs >= turn.answerStartMs && s.startMs <= turn.answerEndMs)
    .map((s) => s.text)
    .join(' ');
}

export interface Conversation {
  segments: WordSegment[];
  pauses: PauseSpan[];
  transcript: TranscriptLine[];
  metrics: SessionMetrics;
}

/**
 * The whole conversation as a stored session's parts: the partner's questions as coach lines (never
 * quoted in notes), the speaker's answers as their lines, and metrics over answering time only.
 */
export function buildConversation(
  all: { segments: readonly WordSegment[]; pauses: readonly PauseSpan[]; trace: readonly (number | null)[] },
  turns: readonly PartnerTurn[],
  talkType: TalkType
): Conversation {
  const segments = answerSegments(all.segments, turns);
  const pauses = all.pauses.filter((p) => p.endMs !== undefined && turns.some((t) => p.startMs >= t.answerStartMs && (p.endMs ?? p.startMs) <= t.answerEndMs));
  // The trace has one reading a second; keep only seconds spent answering.
  const trace = all.trace.map((v, i) => (inAnswer(i * 1000 + 500, turns) ? v : null));
  const answeringMs = turns.reduce((s, t) => s + Math.max(0, t.answerEndMs - t.answerStartMs), 0);
  const userLines = toTranscriptLines(segments, pauses);
  const partnerLines: TranscriptLine[] = turns.map((t) => ({ speaker: 'coach', text: t.question, startMs: Math.round(t.askedAtMs) }));
  const transcript = [...partnerLines, ...userLines].sort((a, b) => a.startMs - b.startMs || (a.speaker === 'coach' ? -1 : 1));
  return { segments, pauses, transcript, metrics: summariseMetrics(segments, pauses, trace, TALK_TYPES[talkType].zone, answeringMs) };
}
