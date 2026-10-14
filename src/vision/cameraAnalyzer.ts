/**
 * Runs MediaPipe Face and Pose Landmarker on the <video> element, on the device, about 10 times a
 * second. No frame leaves the browser; only the model files are downloaded.
 * Docs: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
 */
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { expressionFrom, gazeFromLandmarks, headPoseFromMatrix, postureFrom, type Observation } from './signals';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const FRAME_INTERVAL_MS = 100;

interface Models {
  face: FaceLandmarker;
  pose: PoseLandmarker;
}

let modelsPromise: Promise<Models> | null = null;

/** Load both models once per page. Rejects if they can't load (offline, no WebAssembly). */
export function loadModels(): Promise<Models> {
  modelsPromise ??= (async () => {
    const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = async (delegate: 'GPU' | 'CPU') => ({
      face: await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
      pose: await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    });
    try {
      return await make('GPU');
    } catch {
      return make('CPU');
    }
  })();
  modelsPromise.catch(() => (modelsPromise = null));
  return modelsPromise;
}

/** Analyse one frame. */
export function observe(models: Models, video: HTMLVideoElement, timeMs: number, frameTs: number): Observation {
  const face = models.face.detectForVideo(video, frameTs);
  const pose = models.pose.detectForVideo(video, frameTs);
  const lm = face.faceLandmarks?.[0];
  const matrix = face.facialTransformationMatrixes?.[0]?.data;
  const shapes = face.faceBlendshapes?.[0]?.categories ?? [];
  return {
    timeMs,
    face: lm && matrix ? { ...headPoseFromMatrix(matrix), ...((g) => ({ gazeX: g.x, gazeY: g.y }))(gazeFromLandmarks(lm)), ...expressionFrom(shapes) } : null,
    pose: pose.landmarks?.[0] ? postureFrom(pose.landmarks[0]) : null,
  };
}

export interface AnalyzerHandle {
  stop(): void;
}

/**
 * Call `onObservation` about 10 times a second with the session-clock time. Uses
 * requestVideoFrameCallback where available, so analysis follows real frames rather than React
 * renders; pauses while the tab is hidden.
 */
export function startAnalyzer(video: HTMLVideoElement, models: Models, clock: () => number, onObservation: (o: Observation) => void): AnalyzerHandle {
  let stopped = false;
  let lastRun = -Infinity;
  let lastTs = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  type VideoWithRvfc = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  const v = video as VideoWithRvfc;

  const run = () => {
    if (stopped || document.hidden || video.readyState < 2 || video.videoWidth === 0) return;
    const now = performance.now();
    if (now - lastRun < FRAME_INTERVAL_MS) return;
    lastRun = now;
    // MediaPipe needs strictly increasing timestamps.
    const ts = Math.max(lastTs + 1, Math.round(now));
    lastTs = ts;
    try {
      onObservation(observe(models, video, clock(), ts));
    } catch (err) {
      console.warn('[camera] Analysis skipped a frame:', err);
    }
  };

  if (typeof v.requestVideoFrameCallback === 'function') {
    const loop = () => {
      if (stopped) return;
      run();
      v.requestVideoFrameCallback!(loop);
    };
    v.requestVideoFrameCallback(loop);
    // A hidden <video> ("Hide my face") may stop presenting frames: keep analysing on a timer too.
    timer = setInterval(() => {
      if (performance.now() - lastRun > 500) run();
    }, FRAME_INTERVAL_MS);
  } else {
    timer = setInterval(run, FRAME_INTERVAL_MS);
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

/** Watch the video for `ms` and return what was seen, for calibration. */
export async function collect(video: HTMLVideoElement, ms: number): Promise<Observation[]> {
  const models = await loadModels();
  const out: Observation[] = [];
  const start = performance.now();
  const handle = startAnalyzer(video, models, () => performance.now() - start, (o) => out.push(o));
  await new Promise((r) => setTimeout(r, ms));
  handle.stop();
  return out;
}
