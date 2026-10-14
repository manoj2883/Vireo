import { CameraTracker, type Calibration, type CameraResult } from './cameraTracker';

export interface VisionHandle {
  live(nowMs: number): { looking: boolean; awayMs: number; dim: boolean };
  result(endMs: number): CameraResult;
  stop(): void;
}

/**
 * Start on-device camera analysis for a session. Resolves to null when the camera is off or the
 * models can't load; the session carries on without camera feedback.
 */
export async function startVision(video: HTMLVideoElement | undefined, clock: () => number, calibration?: Calibration | null): Promise<VisionHandle | null> {
  if (!video) return null;
  try {
    const { loadModels, startAnalyzer } = await import('./cameraAnalyzer');
    const models = await loadModels();
    const tracker = new CameraTracker(calibration);
    const handle = startAnalyzer(video, models, clock, (o) => tracker.push(o));
    return {
      live: (t) => tracker.live(t),
      result: (t) => tracker.result(t),
      stop: () => handle.stop(),
    };
  } catch (err) {
    console.warn('[camera] Camera feedback unavailable:', err);
    return null;
  }
}
