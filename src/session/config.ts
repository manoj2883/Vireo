import type { CoachMode } from '@/live/metrics/nudges';
import type { TalkType } from '@/live/metrics/pace';
import type { Calibration } from '@/vision/cameraTracker';

/** Everything the warm-up decides for a session. */
export interface SessionConfig {
  prompt: string;
  talkType: TalkType;
  mode: CoachMode;
  /** Ask a follow-up afterwards (Audience mode). */
  audience: boolean;
  hideFace: boolean;
  storyId?: string;
  /** Set when this session answers another session's follow-up question. */
  parentSessionId?: string;
  /** From the warm-up's "look at the camera" step; null if skipped or unavailable. */
  calibration?: Calibration | null;
}

export const DEFAULT_CONFIG: SessionConfig = {
  prompt: '',
  talkType: 'interview',
  mode: 'coach',
  audience: true,
  hideFace: false,
};

const KEY = 'vireo-session-config';

/** Remember the warm-up between the warm-up and live screens (and across a refresh). */
export function saveConfig(config: SessionConfig): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Non-essential.
  }
}

export function loadConfig(): SessionConfig | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionConfig>;
    if (typeof parsed.prompt !== 'string') return null;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return null;
  }
}

/** Presets passed to the warm-up through router state. */
export type WarmUpPreset = Partial<SessionConfig>;
