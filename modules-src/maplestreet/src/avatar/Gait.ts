/**
 * Procedural gait shared by the scanned avatars and the stand-in body.
 *
 * One stride is a normalised cycle `u` in [0, 1) that starts at the left
 * heel strike; the right leg runs half a cycle behind. Cadence comes from
 * speed and stride length, so the planted foot keeps pace with the ground
 * instead of sliding. Walking and running are separate curves blended by
 * speed: running adds a forward lean, a deep swing-knee, bent pumping arms
 * and a flight-phase bounce.
 *
 * Angles are in radians with anatomical signs: hip > 0 swings the thigh
 * forward, knee > 0 bends it, ankle > 0 points the toe down, arm > 0 swings
 * the upper arm back, elbow > 0 bends it.
 */

const LEG = 0.9;
export const WALK_TOP = 2.8;
export const RUN_FULL = 5.0;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function bump(u: number, c: number, w: number) {
  let d = Math.abs(u - c) % 1;
  if (d > 0.5) d = 1 - d;
  return Math.exp(-(d / w) * (d / w));
}

/** 0 walking, 1 running. */
export const runBlend = (speed: number) => smooth(WALK_TOP, RUN_FULL, speed);
/** 0 standing still, 1 moving: fades the gait in and out. */
export const moveWeight = (speed: number) => smooth(0.05, 0.7, speed);

const walkHipAmp = (speed: number) => Math.min(0.5, 0.16 + speed * 0.13);

/** Strides per second for a speed in m/s. */
export function gaitFrequency(speed: number) {
  if (speed < 0.02) return 0;
  const a = walkHipAmp(speed);
  const stride = 4 * LEG * Math.sin(a) * 1.08;
  const walk = Math.min(1.5, speed / stride);
  const run = 1.3 + speed * 0.04;
  const r = runBlend(speed);
  return walk * (1 - r) + run * r;
}

export interface LegPose { hip: number; knee: number; ankle: number }
export interface ArmPose { arm: number; elbow: number }
export interface GaitPose {
  legL: LegPose; legR: LegPose;
  armL: ArmPose; armR: ArmPose;
  lean: number; twist: number; hipBob: number; headPitch: number;
}

function leg(u: number, speed: number, r: number, w: number): LegPose {
  const a = walkHipAmp(speed);
  const k = a / 0.5;
  const walkHip = a * Math.cos(2 * Math.PI * u) + 0.05;
  const walkKnee = (0.24 * bump(u, 0.1, 0.07) + 1.0 * bump(u, 0.7, 0.12)) * k + 0.03;
  const walkAnkle = -0.14 * bump(u, 0.02, 0.06) + 0.32 * bump(u, 0.58, 0.06) - 0.12 * bump(u, 0.8, 0.1);

  const runHip = 0.72 * Math.cos(2 * Math.PI * u) + 0.14;
  const runKnee = 0.25 * bump(u, 0.08, 0.07) + 1.85 * bump(u, 0.66, 0.15) + 0.18;
  const runAnkle = -0.08 * bump(u, 0.0, 0.05) + 0.45 * bump(u, 0.34, 0.07) - 0.18 * bump(u, 0.78, 0.12);

  return {
    hip: (walkHip * (1 - r) + runHip * r) * w,
    knee: (walkKnee * (1 - r) + runKnee * r) * w,
    ankle: (walkAnkle * (1 - r) + runAnkle * r) * w,
  };
}

function arm(hip: number, r: number, w: number): ArmPose {
  const swing = hip * (0.75 * (1 - r) + 0.95 * r);
  const a = swing - 0.12 * r * w;
  const forward = Math.max(0, -a);
  return {
    arm: a,
    elbow: (0.16 + forward * 0.35) * (1 - r) * w + (1.35 + forward * 0.3) * r * w + 0.1 * (1 - w),
  };
}

export function gaitPose(u: number, speed: number): GaitPose {
  const r = runBlend(speed), w = moveWeight(speed);
  const legL = leg(u, speed, r, w);
  const legR = leg((u + 0.5) % 1, speed, r, w);
  const hipCenter = (0.05 * (1 - r) + 0.14 * r) * w;
  const armL = arm(legL.hip - hipCenter, r, w);
  const armR = arm(legR.hip - hipCenter, r, w);
  const walkBob = -0.018 * Math.cos(4 * Math.PI * u) - 0.008;
  const runBob = -0.045 * Math.cos(4 * Math.PI * (u - 0.08)) - 0.05;
  const lean = (0.03 * (1 - r) + 0.17 * r) * w;
  return {
    legL, legR, armL, armR,
    lean,
    twist: (legL.hip - legR.hip) * (0.14 * (1 - r) + 0.1 * r),
    hipBob: (walkBob * (1 - r) + runBob * r) * w,
    headPitch: -lean * 0.65,
  };
}
