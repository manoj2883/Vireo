/**
 * The coach's voice: short pre-recorded clips from public/coach/, so a nudge plays the instant
 * it's due with no network round trip and no language model. If a clip is missing, the browser's
 * own English voice says the line instead.
 */
import { SPOKEN_NUDGES, type NudgeKind } from './metrics/nudges';

export const COACH_CLIPS: Record<NudgeKind, string> = {
  fast: '/coach/slow-down.mp3',
  slow: '/coach/pick-it-up.mp3',
};

export interface CoachVoiceLike {
  play(kind: NudgeKind): void;
  /** Stop at once (the speaker started talking again). */
  stop(): void;
  isPlaying(): boolean;
}

export class CoachVoice implements CoachVoiceLike {
  private clips: Partial<Record<NudgeKind, HTMLAudioElement>> = {};
  private ready = new Set<NudgeKind>();
  private current: HTMLAudioElement | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor(clips: Record<NudgeKind, string> = COACH_CLIPS) {
    if (typeof Audio === 'undefined') return;
    for (const kind of Object.keys(clips) as NudgeKind[]) {
      const audio = new Audio(clips[kind]);
      audio.preload = 'auto';
      audio.addEventListener('canplaythrough', () => this.ready.add(kind), { once: true });
      audio.addEventListener('error', () => this.ready.delete(kind));
      audio.load();
      this.clips[kind] = audio;
    }
  }

  play(kind: NudgeKind): void {
    this.stop();
    const clip = this.clips[kind];
    if (clip && this.ready.has(kind)) {
      clip.currentTime = 0;
      this.current = clip;
      clip.play().catch(() => this.speak(kind));
    } else {
      this.speak(kind);
    }
  }

  private speak(kind: NudgeKind): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(SPOKEN_NUDGES[kind]);
    u.lang = 'en-US';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    u.onend = () => {
      if (this.utterance === u) this.utterance = null;
    };
    this.utterance = u;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  stop(): void {
    if (this.current) {
      this.current.pause();
      this.current.currentTime = 0;
      this.current = null;
    }
    if (this.utterance && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.utterance = null;
  }

  isPlaying(): boolean {
    const clipPlaying = this.current !== null && !this.current.paused && !this.current.ended;
    return clipPlaying || this.utterance !== null;
  }
}
