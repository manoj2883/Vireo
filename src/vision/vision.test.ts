import { describe, expect, it } from 'vitest';
import { blendshape, expressionFrom, gazeFromLandmarks, headPoseFromMatrix, postureFrom, type FaceSignals, type Landmark, type Observation, type PoseSignals } from './signals';
import { CameraTracker, DIM_AFTER_LOOK_AWAY_MS, calibrate } from './cameraTracker';

/** Column-major 4x4 rotation: yaw about Y, then pitch about X. */
function matrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  // Forward axis after rotation: (sin y cos p, -sin p, cos y cos p).
  const fwd = [Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)];
  const m = new Array(16).fill(0);
  m[0] = 1;
  m[5] = 1;
  [m[8], m[9], m[10]] = fwd;
  m[15] = 1;
  return m;
}

describe('signals', () => {
  it('reads head yaw and pitch from the transformation matrix', () => {
    const straight = headPoseFromMatrix(matrix(0, 0));
    expect(straight.yawDeg).toBeCloseTo(0);
    expect(straight.pitchDeg).toBeCloseTo(0);
    const turned = headPoseFromMatrix(matrix(25, 0));
    expect(turned.yawDeg).toBeCloseTo(25);
    const down = headPoseFromMatrix(matrix(0, 15));
    expect(down.pitchDeg).toBeCloseTo(15);
  });

  it('measures iris position within the eyes', () => {
    const lm: Landmark[] = [];
    const eye = (outer: number, inner: number, top: number, bottom: number, iris: number, x0: number, irisX: number) => {
      lm[outer] = { x: x0, y: 0.5 };
      lm[inner] = { x: x0 + 0.1, y: 0.5 };
      lm[top] = { x: x0 + 0.05, y: 0.48 };
      lm[bottom] = { x: x0 + 0.05, y: 0.52 };
      lm[iris] = { x: irisX, y: 0.5 };
    };
    eye(33, 133, 159, 145, 468, 0.3, 0.35);
    eye(263, 362, 386, 374, 473, 0.6, 0.65);
    expect(gazeFromLandmarks(lm).x).toBeCloseTo(0);
    lm[468] = { x: 0.38, y: 0.5 };
    lm[473] = { x: 0.68, y: 0.5 };
    expect(gazeFromLandmarks(lm).x).toBeCloseTo(0.3);
  });

  it('reports smiling and tension neutrally from blendshapes; there is no jawClench in MediaPipe', () => {
    const cats = [
      { categoryName: 'mouthSmileLeft', score: 0.8 },
      { categoryName: 'mouthSmileRight', score: 0.6 },
      { categoryName: 'browDownLeft', score: 0.1 },
      { categoryName: 'browDownRight', score: 0.1 },
      { categoryName: 'mouthPressLeft', score: 0.5 },
      { categoryName: 'mouthPressRight', score: 0.7 },
    ];
    expect(expressionFrom(cats)).toEqual({ smile: 0.7, tension: 0.6 });
    expect(blendshape(cats, 'jawClench')).toBe(0);
  });

  it('measures how high the head sits above the shoulders', () => {
    const lm: Landmark[] = [];
    lm[0] = { x: 0.5, y: 0.3, visibility: 0.99 };
    lm[11] = { x: 0.65, y: 0.6, visibility: 0.99 };
    lm[12] = { x: 0.35, y: 0.6, visibility: 0.99 };
    lm[15] = { x: 0.3, y: 0.9, visibility: 0.9 };
    lm[16] = { x: 0.7, y: 1.2, visibility: 0.9 }; // below the frame: not visible
    const p = postureFrom(lm)!;
    expect(p.headRise).toBeCloseTo(1);
    expect(p.inFrame).toBe(true);
    expect(p.wrists).toEqual([{ x: 0.3, y: 0.9 }]);
    lm[11] = { x: 0.99, y: 0.6, visibility: 0.99 };
    lm[12] = { x: 0.83, y: 0.6, visibility: 0.99 }; // leaning out to the side
    expect(postureFrom(lm)!.inFrame).toBe(false);
  });
});

// ---------- tracker ----------

const FACE: FaceSignals = { yawDeg: 0, pitchDeg: 0, gazeX: 0, gazeY: 0, smile: 0, tension: 0 };
const POSE: PoseSignals = { headRise: 1, shoulderMidX: 0.5, shoulderWidth: 0.3, inFrame: true, wrists: [] };

/** Observations every 100 ms from fromMs to toMs. */
function run(tracker: CameraTracker, fromMs: number, toMs: number, make: (t: number) => Partial<Observation> = () => ({})) {
  for (let t = fromMs; t < toMs; t += 100) tracker.push({ timeMs: t, face: FACE, pose: POSE, ...make(t) });
}

const calibration = { yawDeg: 0, pitchDeg: 0, gazeX: 0, gazeY: 0, headRise: 1 };

describe('CameraTracker', () => {
  it('records a look-away with its timing and keeps eye contact percentage', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 4000);
    run(tr, 4000, 7000, () => ({ face: { ...FACE, yawDeg: 35 } }));
    run(tr, 7000, 10_000);
    const { events, summary } = tr.result(10_000);
    const away = events.filter((e) => e.kind === 'look-away');
    expect(away).toHaveLength(1);
    expect(away[0].id).toMatch(/^cam-\d+$/);
    expect(away[0].startMs).toBeGreaterThanOrEqual(4000);
    expect(away[0].startMs).toBeLessThan(5000); // about a second of smoothing
    expect(away[0].endMs - away[0].startMs).toBeGreaterThan(2500);
    expect(summary.eyeContactPct).toBeGreaterThan(60);
    expect(summary.eyeContactPct).toBeLessThan(80);
    expect(summary.longestLookAwayMs).toBe(away[0].endMs - away[0].startMs);
  });

  it('ignores glances shorter than a second', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 3000);
    run(tr, 3000, 3400, () => ({ face: { ...FACE, yawDeg: 40 } }));
    run(tr, 3400, 6000);
    expect(tr.result(6000).events.filter((e) => e.kind === 'look-away')).toEqual([]);
  });

  it('dims the live cue only after three seconds of looking away', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 2000);
    run(tr, 2000, 4500, () => ({ face: { ...FACE, gazeX: 0.4 } }));
    expect(tr.live(4500).dim).toBe(false);
    run(tr, 4500, 6500, () => ({ face: { ...FACE, gazeX: 0.4 } }));
    const live = tr.live(6500);
    expect(live.awayMs).toBeGreaterThan(DIM_AFTER_LOOK_AWAY_MS);
    expect(live.dim).toBe(true);
    run(tr, 6500, 8000);
    expect(tr.live(8000)).toMatchObject({ looking: true, dim: false });
  });

  it('flags slouching against the calibrated posture', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 2000);
    run(tr, 2000, 7000, () => ({ pose: { ...POSE, headRise: 0.6 } }));
    run(tr, 7000, 9000);
    const { events, summary } = tr.result(9000);
    expect(events.filter((e) => e.kind === 'slouch')).toHaveLength(1);
    expect(summary.postureAlerts).toBe(1);
  });

  it('uses the first five seconds as the posture baseline when not calibrated', () => {
    const tr = new CameraTracker();
    run(tr, 0, 5000);
    run(tr, 5000, 10_000, () => ({ pose: { ...POSE, headRise: 0.5 } }));
    expect(tr.result(10_000).events.some((e) => e.kind === 'slouch')).toBe(true);
  });

  it('treats no face as out of frame, not eye contact', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 1000);
    run(tr, 1000, 4000, () => ({ face: null }));
    run(tr, 4000, 5000);
    const kinds = tr.result(5000).events.map((e) => e.kind);
    expect(kinds).toContain('out-of-frame');
    expect(kinds).toContain('look-away');
  });

  it('counts gestures and flags fast, small, repetitive hand movement as fidgeting', () => {
    const tr = new CameraTracker(calibration);
    // Three deliberate gestures: a sweep across, then still.
    for (const start of [1000, 6000, 11_000]) {
      run(tr, start - 1000, start, () => ({ pose: { ...POSE, wrists: [{ x: 0.3, y: 0.8 }] } }));
      run(tr, start, start + 1000, (t) => ({ pose: { ...POSE, wrists: [{ x: 0.3 + ((t - start) / 1000) * 0.3, y: 0.8 }] } }));
      run(tr, start + 1000, start + 4000, () => ({ pose: { ...POSE, wrists: [{ x: 0.6, y: 0.8 }] } }));
    }
    // Fidgeting: a small, fast back-and-forth for 4 s.
    run(tr, 15_000, 19_000, (t) => ({ pose: { ...POSE, wrists: [{ x: 0.5 + (Math.floor(t / 100) % 2 ? 0.02 : -0.02), y: 0.8 }] } }));
    const { events, summary } = tr.result(20_000);
    expect(summary.gestureRate).toBeGreaterThan(5);
    expect(events.some((e) => e.kind === 'fidget' && e.startMs >= 15_000)).toBe(true);
  });

  it('flags hands frozen for 30 seconds or more', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 35_000, () => ({ pose: { ...POSE, wrists: [{ x: 0.4, y: 0.8 }] } }));
    const frozen = tr.result(35_000).events.filter((e) => e.kind === 'hands-frozen');
    expect(frozen).toHaveLength(1);
    expect(frozen[0].value).toBe(35);
    const short = new CameraTracker(calibration);
    run(short, 0, 20_000);
    expect(short.result(20_000).events.some((e) => e.kind === 'hands-frozen')).toBe(false);
  });

  it('reports smiling time', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 5000, () => ({ face: { ...FACE, smile: 0.8 } }));
    run(tr, 5000, 10_000);
    const { events, summary } = tr.result(10_000);
    expect(events.some((e) => e.kind === 'smile')).toBe(true);
    expect(summary.smilePct).toBeGreaterThan(40);
    expect(summary.smilePct).toBeLessThan(65);
  });

  it('numbers events in time order', () => {
    const tr = new CameraTracker(calibration);
    run(tr, 0, 3000, () => ({ face: { ...FACE, smile: 0.9 } }));
    run(tr, 3000, 6000, () => ({ face: { ...FACE, yawDeg: 40 } }));
    run(tr, 6000, 8000);
    const ids = tr.result(8000).events.map((e) => e.id);
    expect(ids).toEqual(ids.map((_, i) => `cam-${i + 1}`));
  });
});

describe('calibrate', () => {
  it('averages two seconds of looking at the camera', () => {
    const obs: Observation[] = Array.from({ length: 20 }, (_, i) => ({ timeMs: i * 100, face: { ...FACE, yawDeg: 6, gazeX: 0.05 }, pose: { ...POSE, headRise: 1.2 } }));
    const c = calibrate(obs)!;
    expect(c.yawDeg).toBeCloseTo(6);
    expect(c.gazeX).toBeCloseTo(0.05);
    expect(c.headRise).toBeCloseTo(1.2);
  });

  it('gives up when the face was rarely seen', () => {
    const obs: Observation[] = Array.from({ length: 20 }, (_, i) => ({ timeMs: i * 100, face: i < 3 ? FACE : null, pose: null }));
    expect(calibrate(obs)).toBeNull();
  });
});
