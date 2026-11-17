/** Talking to the partner: the next question from the server, and saying it aloud. */
import type { SpeakingContext } from '@/session/speakingContext';
import type { PartnerMode, PartnerRole } from './conversation';

export interface NextQuestionRequest {
  mode: PartnerMode;
  role: PartnerRole;
  maxTurns: number;
  prompt: string;
  situation?: string;
  speakingContext?: SpeakingContext;
  source?: string;
  turns: { question: string; answer: string }[];
}

export interface NextQuestion {
  question: string;
  basedOn: string | null;
  /** Base64 MP3 from Deepgram, or null: the browser's own voice is used instead. */
  audio: string | null;
  audioType: string | null;
}

export async function requestNextQuestion(req: NextQuestionRequest, fetchImpl: typeof fetch = fetch): Promise<NextQuestion> {
  const res = await fetchImpl('/api/roleplay/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Your partner couldn’t reply (${res.status}).`);
  return { question: String(body.question ?? ''), basedOn: body.basedOn ?? null, audio: body.audio ?? null, audioType: body.audioType ?? null };
}

/** Roughly how long a question takes to say, so a silent fallback never hangs: 2.5 words a second, plus a beat. */
export function estimatedSpeechMs(text: string): number {
  return Math.round((text.split(/\s+/).filter(Boolean).length / 2.5) * 1000) + 800;
}

/**
 * Say the question: the partner's Deepgram voice if the server sent one, else the browser's English
 * voice. Resolves when it's finished (or after the estimated length, whichever comes first).
 */
export function speakQuestion(q: NextQuestion, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, estimatedSpeechMs(q.question) + 4000);
    signal?.addEventListener('abort', () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // ignore
      }
      finish();
    });
    try {
      if (q.audio) {
        const audio = new Audio(`data:${q.audioType ?? 'audio/mpeg'};base64,${q.audio}`);
        audio.onended = finish;
        audio.onerror = finish;
        signal?.addEventListener('abort', () => audio.pause());
        void audio.play().catch(finish);
        return;
      }
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        finish();
        return;
      }
      const u = new SpeechSynthesisUtterance(q.question);
      u.lang = 'en-US';
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
    } catch {
      finish();
    }
  });
}
