/**
 * Turns camera observations (about 10 a second) into smoothed signals, timed events and a
 * summary. Pure: no camera, no MediaPipe, so it is tested with synthetic observations.
 */
import type { Observation, Point2 } from './signals';

export type CameraEventKind = 'look-away' | 'slouch' | 'out-of-frame' | 'fidget' | 'hands-frozen' | 'smile' | 'tension';

export interface CameraEvent {
  id: string;
  kind: CameraEventKind;
  startMs: number;
  endMs: number;
  /** A neutral measure for the event: mean score, or seconds for hands-frozen. */
  value: number;
}

export interface CameraSummary {
  /** Share of analysed time spent looking at the camera, 0 to 100. */
  eyeContactPct: number;
  longestLookAwayMs: number;
  /** Slouching and leaning-out-of-frame events. */
  postureAlerts: number;
  /** Times hands started moving, per minute of analysed time. */
  gestureRate: number;
  smilePct: number;
  trackedMs: number;
}

export interface CameraResult {
  events: CameraEvent[];
  summary: CameraSummary;
}

/** Your normal position, from the warm-up's "look at the camera" step. */
export interface Calibration {
  yawDeg: number;
  pitchDeg: number;
  gazeX: number;
  gazeY: number;
  headRise: number | null;
}

export const LOOK_TOLERANCE = { yawDeg: 15, pitchDeg: 12, gazeX: 0.12, gazeY: 0.18 };
export const SMOOTHING_MS = 1000;
export const DIM_AFTER_LOOK_AWAY_MS = 3000;
export const FROZEN_HANDS_MS = 30_000;

/** Minimum length for each kind to become an event. */
const MIN_EVENT_MS: Record<Exclude<CameraEventKind, 'hands-frozen'>, number> = {
  'look-away': 1000,
  slouch: 3000,
  'out-of-frame': 1000,
  fidget: 2000,
  smile: 1000,
  tension: 2000,
};

type SignalKey = Exclude<CameraEventKind, 'hands-frozen'> | 'eye-contact' | 'moving';

/** Exponentially smoothed on/off signal with about 1 s of memory. */
class Smoothed {
  value = 0;
  private last: number | null = null;
  update(x: number, t: number) {
    if (this.last === null) this.value = x;
    else this.value += (x - this.value) * (1 - Math.exp(-Math.max(0, t - this.last) / SMOOTHING_MS));
    this.last = t;
    return this.value;
  }
  get on() {
    return this.value > 0.5;
  }
}

interface Span {
  startMs: number;
  sum: number;
  n: number;
}

export class CameraTracker {
  private base: Calibration | null;
  private postureSamples: number[] = [];
  private smooth = new Map<SignalKey, Smoothed>();
  private open = new Map<SignalKey, Span>();
  private events: Omit<CameraEvent, 'id'>[] = [];
  private lastT: number | null = null;
  private firstT: number | null = null;
  private trackedMs = 0;
  private eyeMs = 0;
  private smileMs = 0;
  private gestureStarts = 0;
  private wasMoving = false;
  private lastMovementMs: number | null = null;
  private lastWrists: Point2[] = [];
  private wristTrail: { t: number; p: Point2 }[] = [];
  private lookAwaySince: number | null = null;

  constructor(calibration?: Calibration | null) {
    this.base = calibration ?? null;
  }

  private sig(key: SignalKey) {
    let s = this.smooth.get(key);
    if (!s) this.smooth.set(key, (s = new Smoothed()));
    return s;
  }

  /** Baseline head height: calibrated, or the median of the first 5 s. */
  private baseRise(): number | null {
    if (this.base?.headRise != null) return this.base.headRise;
    if (this.postureSamples.length < 20) return null;
    const s = [...this.postureSamples].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  push(obs: Observation): void {
    const t = obs.timeMs;
    const dt = this.lastT === null ? 0 : Math.min(500, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.firstT ??= t;
    this.trackedMs += dt;

    const b = this.base ?? { yawDeg: 0, pitchDeg: 0, gazeX: 0, gazeY: 0, headRise: null };
    const f = obs.face;
    const looking =
      !!f &&
      Math.abs(f.yawDeg - b.yawDeg) < LOOK_TOLERANCE.yawDeg &&
      Math.abs(f.pitchDeg - b.pitchDeg) < LOOK_TOLERANCE.pitchDeg &&
      Math.abs(f.gazeX - b.gazeX) < LOOK_TOLERANCE.gazeX &&
      Math.abs(f.gazeY - b.gazeY) < LOOK_TOLERANCE.gazeY;

    const p = obs.pose;
    if (p && !this.base?.headRise && this.firstT !== null && t - this.firstT < 5000) this.postureSamples.push(p.headRise);
    const rise = this.baseRise();
    const slouch = !!p && rise !== null && rise > 0 && p.headRise < rise * 0.8;
    const outOfFrame = !f || !p || !p.inFrame;

    // Hands: movement energy in shoulder widths per second, and small repetitive movement.
    const sw = p?.shoulderWidth ?? 0;
    const wrists = p?.wrists ?? [];
    let speed = 0;
    if (sw > 0 && dt > 0 && wrists.length && this.lastWrists.length) {
      const pairs = wrists.map((w) => Math.min(...this.lastWrists.map((l) => Math.hypot(w.x - l.x, w.y - l.y))));
      speed = Math.max(...pairs) / sw / (dt / 1000);
    }
    this.lastWrists = wrists;
    if (wrists[0]) this.wristTrail.push({ t, p: wrists[0] });
    this.wristTrail = this.wristTrail.filter((e) => e.t >= t - 2000);
    const moving = speed > 0.3;
    if (moving) this.lastMovementMs = t;
    const fidget = sw > 0 && this.isFidgety(sw);

    const values: Record<SignalKey, number> = {
      'eye-contact': looking ? 1 : 0,
      'look-away': looking ? 0 : 1,
      slouch: slouch ? 1 : 0,
      'out-of-frame': outOfFrame ? 1 : 0,
      fidget: fidget ? 1 : 0,
      moving: moving ? 1 : 0,
      smile: f && f.smile > 0.4 ? 1 : 0,
      tension: f && f.tension > 0.45 ? 1 : 0,
    };
    for (const key of Object.keys(values) as SignalKey[]) this.sig(key).update(values[key], t);

    if (this.sig('eye-contact').on) this.eyeMs += dt;
    if (this.sig('smile').on) this.smileMs += dt;
    const nowMoving = this.sig('moving').on;
    if (nowMoving && !this.wasMoving) this.gestureStarts++;
    this.wasMoving = nowMoving;

    // Look-away clock for the live dot.
    if (this.sig('eye-contact').on) this.lookAwaySince = null;
    else this.lookAwaySince ??= t;

    const measures: Partial<Record<SignalKey, number>> = {
      'look-away': f ? Math.abs(f.yawDeg - b.yawDeg) : 90,
      slouch: p && rise ? p.headRise / rise : 0,
      'out-of-frame': 1,
      fidget: speed,
      smile: f?.smile ?? 0,
      tension: f?.tension ?? 0,
    };
    for (const kind of Object.keys(MIN_EVENT_MS) as (keyof typeof MIN_EVENT_MS)[]) {
      this.track(kind, this.sig(kind).on, t, measures[kind] ?? 0);
    }
  }

  /** Lots of wrist travel in the last 2 s, but within a small area: small repetitive movement. */
  private isFidgety(sw: number): boolean {
    if (this.wristTrail.length < 8) return false;
    let path = 0;
    let turns = 0;
    for (let i = 1; i < this.wristTrail.length; i++) {
      const a = this.wristTrail[i - 1].p;
      const c = this.wristTrail[i].p;
      path += Math.hypot(c.x - a.x, c.y - a.y);
      if (i > 1) {
        const z = this.wristTrail[i - 2].p;
        if ((a.x - z.x) * (c.x - a.x) + (a.y - z.y) * (c.y - a.y) < 0) turns++;
      }
    }
    const xs = this.wristTrail.map((e) => e.p.x);
    const ys = this.wristTrail.map((e) => e.p.y);
    const range = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return path / sw > 0.6 && range / sw < 0.3 && turns >= 4;
  }

  private track(kind: keyof typeof MIN_EVENT_MS, on: boolean, t: number, measure: number) {
    const span = this.open.get(kind);
    if (on && !span) this.open.set(kind, { startMs: t, sum: measure, n: 1 });
    else if (on && span) {
      span.sum += measure;
      span.n++;
    } else if (!on && span) {
      this.open.delete(kind);
      this.close(kind, span, t);
    }
  }

  private close(kind: keyof typeof MIN_EVENT_MS, span: Span, endMs: number) {
    if (endMs - span.startMs >= MIN_EVENT_MS[kind]) {
      this.events.push({ kind, startMs: span.startMs, endMs, value: Math.round((span.sum / span.n) * 100) / 100 });
    }
  }

  /** The live cue: looking at the camera, and how long you've looked away. */
  live(nowMs: number): { looking: boolean; awayMs: number; dim: boolean } {
    const awayMs = this.lookAwaySince === null ? 0 : nowMs - this.lookAwaySince;
    return { looking: this.lookAwaySince === null, awayMs, dim: awayMs > DIM_AFTER_LOOK_AWAY_MS };
  }

  result(endMs = this.lastT ?? 0): CameraResult {
    const events = [...this.events];
    for (const [kind, span] of this.open) {
      if (kind in MIN_EVENT_MS && endMs - span.startMs >= MIN_EVENT_MS[kind as keyof typeof MIN_EVENT_MS]) {
        events.push({ kind: kind as CameraEventKind, startMs: span.startMs, endMs, value: Math.round((span.sum / span.n) * 100) / 100 });
      }
    }
    // Hands frozen: no movement for 30 s or more (including never moving).
    const still = this.lastMovementMs ?? this.firstT;
    if (still !== null && endMs - still >= FROZEN_HANDS_MS) {
      events.push({ kind: 'hands-frozen', startMs: still, endMs, value: Math.round((endMs - still) / 1000) });
    }
    events.sort((a, b) => a.startMs - b.startMs);
    const tracked = Math.max(1, this.trackedMs);
    const lookAways = events.filter((e) => e.kind === 'look-away');
    return {
      events: events.map((e, i) => ({ id: `cam-${i + 1}`, ...e })),
      summary: {
        eyeContactPct: Math.round((this.eyeMs / tracked) * 100),
        longestLookAwayMs: Math.max(0, ...lookAways.map((e) => e.endMs - e.startMs)),
        postureAlerts: events.filter((e) => e.kind === 'slouch' || e.kind === 'out-of-frame').length,
        gestureRate: Math.round((this.gestureStarts / (tracked / 60_000)) * 10) / 10,
        smilePct: Math.round((this.smileMs / tracked) * 100),
        trackedMs: Math.round(this.trackedMs),
      },
    };
  }
}

/** Average a few seconds of observations into a calibration. Null if the face was rarely seen. */
export function calibrate(observations: readonly Observation[]): Calibration | null {
  const faces = observations.map((o) => o.face).filter((f): f is NonNullable<typeof f> => f !== null);
  if (faces.length < Math.max(3, observations.length / 2)) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const rises = observations.map((o) => o.pose?.headRise).filter((r): r is number => typeof r === 'number' && r > 0);
  return {
    yawDeg: mean(faces.map((f) => f.yawDeg)),
    pitchDeg: mean(faces.map((f) => f.pitchDeg)),
    gazeX: mean(faces.map((f) => f.gazeX)),
    gazeY: mean(faces.map((f) => f.gazeY)),
    headRise: rises.length ? mean(rises) : null,
  };
}
