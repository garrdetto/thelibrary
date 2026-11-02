/**
 * Turns the admin's targets (top speed in mph, 0–60 time in seconds) into the
 * engine numbers the physics uses (engine force per driven wheel and the
 * torque-curve cutoff speed). It integrates the same longitudinal model as
 * src/physics/Vehicle.ts: pedal ramp, tapering torque curve, quadratic aero
 * drag and Rapier's linear damping. The editor's test drive then confirms the
 * result on the real physics (src/physics/Dyno.ts).
 */
import type { VehicleTuning } from './Vehicles';

export const MPH_TO_MS = 0.44704;
const DT = 1 / 60;
const AERO = 0.0009;
const LINEAR_DAMPING = 0.05;

const torque = (u: number) => Math.max(0, 1 - u) ** 0.6 * (1 + 0.25 * Math.max(0, 1 - u * 3));

export interface DriveTargets { topSpeedMph: number; zeroToMph: number; zeroToSeconds: number }
export interface DriveEngine { engineForce: number; topSpeed: number }

/** 0–60 for cars, 0–90% of top speed for anything that can't reach 60. */
export function accelTargetMph(topSpeedMph: number) {
  return topSpeedMph > 66 ? 60 : Math.max(1, Math.floor(topSpeedMph * 0.9));
}

/** Predicts the dyno run for a tuning: time to `toMph` and the speed it levels off at. */
export function predictDrive(t: Pick<VehicleTuning, 'mass' | 'axles' | 'engineForce' | 'topSpeed'>, toMph: number) {
  const driven = t.axles.reduce((n, a) => n + (a.drive ? 2 : 0), 0);
  const push = (t.engineForce * driven) / t.mass;
  const target = toMph * MPH_TO_MS;
  let v = 0, pedal = 0, time: number | null = null, top = 0, still = 0;
  for (let s = 0; s < 240 / DT; s++) {
    pedal = Math.min(1, pedal + DT * 3.2);
    let a = push * pedal * torque(v / t.topSpeed);
    if (v > 1) a -= AERO * v * v;
    v = Math.max(0, (v + a * DT) / (1 + DT * LINEAR_DAMPING));
    if (time === null && v >= target) time = (s + 1) * DT;
    if (v > top + 0.001) { top = v; still = 0; } else if ((still += DT) > 3) break;
  }
  return { time, topMph: top / MPH_TO_MS };
}

/**
 * Finds the engine force and torque cutoff that hit both targets for this
 * mass and drivetrain. Top speed is the speed the car actually levels off at.
 */
export function solveDrive(t: Pick<VehicleTuning, 'mass' | 'axles'>, targets: DriveTargets): DriveEngine {
  const wantTop = targets.topSpeedMph;
  let engineForce = t.mass * 2;
  let topSpeed = wantTop * MPH_TO_MS * 1.5;
  for (let round = 0; round < 6; round++) {
    let lo = wantTop * MPH_TO_MS * 1.001, hi = wantTop * MPH_TO_MS * 12;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (predictDrive({ ...t, engineForce, topSpeed: mid }, 0).topMph < wantTop) lo = mid; else hi = mid;
    }
    topSpeed = (lo + hi) / 2;
    let flo = 1, fhi = t.mass * 400;
    for (let i = 0; i < 50; i++) {
      const mid = (flo + fhi) / 2;
      const r = predictDrive({ ...t, engineForce: mid, topSpeed }, targets.zeroToMph);
      if (r.time === null || r.time > targets.zeroToSeconds) flo = mid; else fhi = mid;
    }
    engineForce = (flo + fhi) / 2;
  }
  return { engineForce: Math.round(engineForce), topSpeed: Math.round(topSpeed * 100) / 100 };
}
