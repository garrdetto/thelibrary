/**
 * Straight-line acceleration run on the real vehicle physics: full throttle
 * from rest on a flat pad, timing 0–target mph and the speed where the car
 * stops gaining. The admin vehicle editor's test drive and the vehicle tests
 * both use it, so the numbers the editor shows are the numbers the game
 * produces in every mode.
 */
import * as THREE from 'three/webgpu';
import { Physics } from './Physics';
import { Vehicle } from './Vehicle';

export const MPH = 0.44704;
const STEP = 1 / 60;

export interface DynoResult {
  /** Seconds from rest to `targetMph`, or null if it never got there. */
  time: number | null;
  targetMph: number;
  /** Highest speed reached, mph. */
  topMph: number;
  /** Seconds simulated. */
  duration: number;
  /** Speed trace at 10 Hz (mph), for the editor's chart. */
  trace: number[];
}

export interface DynoOptions { targetMph?: number; maxSeconds?: number; maxDistance?: number; onStep?: (v: Vehicle) => void }

/** The 0–60 target, or 0–90% of top speed for vehicles that can't reach 60. */
export function dynoTarget(topSpeedMs: number) {
  const top = topSpeedMs / MPH;
  return top > 66 ? 60 : Math.max(1, Math.floor(top * 0.9));
}

export function runDyno(physics: Physics, vehicle: Vehicle, opts: DynoOptions = {}): DynoResult {
  const targetMph = opts.targetMph ?? dynoTarget(vehicle.preset.topSpeed);
  const maxSeconds = opts.maxSeconds ?? 90;
  for (let i = 0; i < 90; i++) physics.step(STEP);
  vehicle.input = { throttle: 1, steer: 0, brake: 0, handbrake: false };
  const start = vehicle.body.translation();
  const maxDistance = opts.maxDistance ?? Infinity;
  let t = 0, time: number | null = null, top = 0, stall = 0;
  const trace: number[] = [];
  while (t < maxSeconds) {
    physics.step(STEP);
    opts.onStep?.(vehicle);
    t += STEP;
    const mph = vehicle.speed / MPH;
    if (time === null && mph >= targetMph) time = Math.round(t * 100) / 100;
    if (Math.round(t * 60) % 6 === 0) trace.push(Math.round(mph * 10) / 10);
    if (mph > top + 0.05) { top = mph; stall = 0; } else stall += STEP;
    if (time !== null && stall > 4) break;
    const p = vehicle.body.translation();
    if (Math.hypot(p.x - start.x, p.z - start.z) > maxDistance) break;
  }
  vehicle.input = { throttle: 0, steer: 0, brake: 1, handbrake: false };
  return { time, targetMph, topMph: Math.round(top * 10) / 10, duration: Math.round(t * 10) / 10, trace };
}

/** Builds a throwaway flat world and runs one vehicle kind on it. */
export async function dynoKind(kind: string, opts: DynoOptions = {}): Promise<DynoResult> {
  const physics = await Physics.create();
  physics.addGround(3000);
  const scene = new THREE.Scene();
  const v = new Vehicle(physics, kind, `dyno-${kind}`, new THREE.Vector3(-2800, 0, 0), 0, scene);
  v.setFuel(Infinity, Infinity, 0, 1);
  const result = runDyno(physics, v, { maxDistance: 5600, ...opts });
  v.dispose(scene);
  return result;
}
