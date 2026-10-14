/**
 * Camera signals from MediaPipe results, as plain numbers. Pure, so they can be tested without a
 * camera. Expression values are reported neutrally (smiling, visible tension); never as emotions.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface Landmark extends Point2 {
  z?: number;
  visibility?: number;
}

export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

/** What one analysed frame contributes. Missing parts are null. */
export interface Observation {
  timeMs: number;
  face: FaceSignals | null;
  pose: PoseSignals | null;
}

export interface FaceSignals {
  yawDeg: number;
  pitchDeg: number;
  /** Iris position in the eye, about 0 when centred; positive to the image right / down. */
  gazeX: number;
  gazeY: number;
  smile: number;
  tension: number;
}

export interface PoseSignals {
  /** Nose height above the shoulder line, in shoulder widths. Falls when you slouch. */
  headRise: number;
  shoulderMidX: number;
  shoulderWidth: number;
  /** Shoulders and nose visible and well inside the frame. */
  inFrame: boolean;
  /** Visible wrists, in image coordinates. */
  wrists: Point2[];
}

/** Head yaw and pitch in degrees from MediaPipe's facial transformation matrix (4x4, column-major). */
export function headPoseFromMatrix(data: readonly number[]): { yawDeg: number; pitchDeg: number } {
  // Third column of the rotation: where the face's forward axis points.
  const fx = data[8];
  const fy = data[9];
  const fz = data[10];
  const deg = 180 / Math.PI;
  return {
    yawDeg: Math.atan2(fx, fz) * deg,
    pitchDeg: Math.atan2(-fy, Math.hypot(fx, fz)) * deg,
  };
}

// Face mesh indices (478-landmark model with irises).
const RIGHT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const LEFT_EYE = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };

function eyeGaze(lm: readonly Landmark[], eye: typeof RIGHT_EYE): Point2 | null {
  const [o, i, t, b, c] = [lm[eye.outer], lm[eye.inner], lm[eye.top], lm[eye.bottom], lm[eye.iris]];
  if (!o || !i || !t || !b || !c) return null;
  const width = Math.hypot(i.x - o.x, i.y - o.y);
  const height = Math.abs(b.y - t.y);
  if (width < 1e-4) return null;
  const midX = (o.x + i.x) / 2;
  const midY = (t.y + b.y) / 2;
  return { x: (c.x - midX) / width, y: height > 1e-4 ? (c.y - midY) / height : 0 };
}

/** Average iris offset of both eyes, about 0 when looking straight ahead. */
export function gazeFromLandmarks(lm: readonly Landmark[]): Point2 {
  const eyes = [eyeGaze(lm, RIGHT_EYE), eyeGaze(lm, LEFT_EYE)].filter((e): e is Point2 => e !== null);
  if (!eyes.length) return { x: 0, y: 0 };
  return { x: eyes.reduce((s, e) => s + e.x, 0) / eyes.length, y: eyes.reduce((s, e) => s + e.y, 0) / eyes.length };
}

export function blendshape(categories: readonly BlendshapeCategory[], name: string): number {
  return categories.find((c) => c.categoryName === name)?.score ?? 0;
}

/**
 * Smiling and visible tension, 0 to 1. MediaPipe has no jawClench blendshape, so tension comes
 * from lowered brows and pressed lips (jawClench is used too, if a model provides it).
 */
export function expressionFrom(categories: readonly BlendshapeCategory[]): { smile: number; tension: number } {
  const avg = (a: string, b: string) => (blendshape(categories, a) + blendshape(categories, b)) / 2;
  const smile = avg('mouthSmileLeft', 'mouthSmileRight');
  const brow = avg('browDownLeft', 'browDownRight');
  const press = avg('mouthPressLeft', 'mouthPressRight');
  const clench = blendshape(categories, 'jawClench');
  return { smile, tension: Math.max(brow, press, clench) };
}

// Pose indices: nose 0, shoulders 11/12, wrists 15/16.
const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const WRISTS = [15, 16];
const VISIBLE = 0.5;

const seen = (p: Landmark | undefined): p is Landmark =>
  !!p && (p.visibility ?? 1) >= VISIBLE && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export function postureFrom(lm: readonly Landmark[]): PoseSignals | null {
  const nose = lm[NOSE];
  const ls = lm[L_SHOULDER];
  const rs = lm[R_SHOULDER];
  if (!seen(ls) || !seen(rs)) return null;
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (shoulderWidth < 0.02) return null;
  const midX = (ls.x + rs.x) / 2;
  const midY = (ls.y + rs.y) / 2;
  const headRise = seen(nose) ? (midY - nose.y) / shoulderWidth : 0;
  return {
    headRise,
    shoulderMidX: midX,
    shoulderWidth,
    inFrame: seen(nose) && midX > 0.12 && midX < 0.88,
    wrists: WRISTS.map((i) => lm[i]).filter(seen).map((p) => ({ x: p.x, y: p.y })),
  };
}
