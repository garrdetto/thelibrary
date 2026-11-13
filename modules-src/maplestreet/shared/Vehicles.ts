/**
 * Vehicle registry shared by every authority and client. Built-in vehicles
 * are defined here as plain tuning data (no three.js), and admin-published
 * vehicles (shared/CustomVehicles.ts) are added at runtime under
 * `custom:<uuid>` kinds, so physics, NPC traffic and validation all read one
 * source. Convention: chassis local +X = forward, +Y = up, +Z = right; SI units.
 */

import { FLEET_TUNING } from './FleetVehicles';

export const BUILTIN_VEHICLE_KINDS = ['truck', 'hdtruck', 'coupe', 'sedan', 'golfcart', 'atv', 'mower', 'zeroturn', 'trailer'] as const;
export type BuiltinVehicleKind = (typeof BUILTIN_VEHICLE_KINDS)[number];
export const CUSTOM_VEHICLE_PREFIX = 'custom:';
export type CustomVehicleKind = `custom:${string}`;
export type VehicleKind = BuiltinVehicleKind | CustomVehicleKind;

export const isCustomVehicleKind = (kind: string): kind is CustomVehicleKind => kind.startsWith(CUSTOM_VEHICLE_PREFIX);
export const isBuiltinVehicleKind = (kind: string): kind is BuiltinVehicleKind => (BUILTIN_VEHICLE_KINDS as readonly string[]).includes(kind);

export interface AxleTuning {
  x: number; radius: number; width: number; halfTrack: number; steer: boolean; drive: boolean; caster?: boolean;
  /** Dual wheels each side (trucks and trailers): drawn as two tires. */
  dual?: boolean;
  /** A semi-trailer's landing gear: struts that touch down only when the trailer is dropped, never rolling. */
  leg?: boolean;
}

export interface VehicleTuning {
  kind: VehicleKind;
  label: string;
  chassis: { hx: number; hy: number; hz: number };
  mass: number;
  /** Center-of-mass offset (lower = more stable). */
  comY: number;
  axles: AxleTuning[];
  /** Suspension mount height (chassis space). */
  wheelY: number;
  suspension: { rest: number; travel: number; stiffness: number; compression: number; relaxation: number };
  frictionSlip: number;
  sideStiffness: number;
  /** Per driven wheel, in newtons. */
  engineForce: number;
  /** m/s; the torque curve fades to zero here. */
  topSpeed: number;
  /** Rapier max brake impulse per wheel per step. */
  brake: number;
  /** Radians. */
  maxSteer: number;
  hitch?: { x: number; y: number };
  tongue?: { x: number; y: number };
  mowerDeck?: { x: number; width: number };
  /** Driver's hip position (chassis space): the avatar sits here, visibly driving. */
  seat: { x: number; y: number; z: number; straddle?: boolean };
  /** Differential steering: the rear wheels drive the turn, front casters swivel freely. */
  zeroTurn?: boolean;
  cam: { dist: number; height: number };
  paint: number;
  /** Haulers can run delivery jobs; mowers cut grass. */
  role?: 'hauler' | 'mower';
  /** A tipping body: hinge at (pivotX, pivotY) in the chassis frame, raised up to maxAngle radians. */
  dump?: { pivotX: number; pivotY: number; maxAngle: number };
}

export const BUILTIN_TUNING: Record<BuiltinVehicleKind, VehicleTuning> = {
  truck: {
    role: 'hauler', kind: 'truck', label: 'Pickup Truck',
    chassis: { hx: 2.7, hy: 0.42, hz: 0.95 }, mass: 2200, comY: -0.5,
    axles: [
      { x: 1.72, radius: 0.42, width: 0.3, halfTrack: 0.86, steer: true, drive: true },
      { x: -1.72, radius: 0.42, width: 0.3, halfTrack: 0.86, steer: false, drive: true },
    ],
    wheelY: -0.18, suspension: { rest: 0.42, travel: 0.28, stiffness: 30, compression: 2.4, relaxation: 3.2 },
    frictionSlip: 2.3, sideStiffness: 1.0, engineForce: 2300, topSpeed: 42, brake: 70, maxSteer: 0.6,
    hitch: { x: -2.95, y: -0.28 }, seat: { x: 0.3, y: 0.36, z: -0.42 }, cam: { dist: 9.5, height: 3.3 }, paint: 0x8b1e1e,
  },
  sedan: {
    kind: 'sedan', label: 'Sedan',
    chassis: { hx: 2.35, hy: 0.34, hz: 0.9 }, mass: 1450, comY: -0.4,
    axles: [
      { x: 1.42, radius: 0.34, width: 0.24, halfTrack: 0.8, steer: true, drive: true },
      { x: -1.42, radius: 0.34, width: 0.24, halfTrack: 0.8, steer: false, drive: false },
    ],
    wheelY: -0.1, suspension: { rest: 0.32, travel: 0.2, stiffness: 34, compression: 2.6, relaxation: 3.4 },
    frictionSlip: 2.6, sideStiffness: 1.0, engineForce: 2600, topSpeed: 52, brake: 45, maxSteer: 0.55,
    seat: { x: -0.2, y: -0.06, z: -0.4 }, cam: { dist: 8, height: 2.6 }, paint: 0x1f3f6e,
  },
  golfcart: {
    kind: 'golfcart', label: 'Golf Cart',
    chassis: { hx: 1.25, hy: 0.28, hz: 0.65 }, mass: 450, comY: -0.25,
    axles: [
      { x: 0.84, radius: 0.24, width: 0.2, halfTrack: 0.56, steer: true, drive: false },
      { x: -0.84, radius: 0.24, width: 0.2, halfTrack: 0.56, steer: false, drive: true },
    ],
    wheelY: -0.08, suspension: { rest: 0.24, travel: 0.14, stiffness: 28, compression: 2.2, relaxation: 3.0 },
    frictionSlip: 2.0, sideStiffness: 1.0, engineForce: 520, topSpeed: 8.5, brake: 16, maxSteer: 0.65,
    seat: { x: -0.22, y: 0.45, z: -0.28 }, cam: { dist: 6, height: 2.4 }, paint: 0xf3f1ea,
  },
  atv: {
    kind: 'atv', label: 'Four-Wheeler',
    chassis: { hx: 1.0, hy: 0.28, hz: 0.55 }, mass: 330, comY: -0.2,
    axles: [
      { x: 0.66, radius: 0.31, width: 0.26, halfTrack: 0.5, steer: true, drive: true },
      { x: -0.66, radius: 0.31, width: 0.28, halfTrack: 0.5, steer: false, drive: true },
    ],
    wheelY: -0.02, suspension: { rest: 0.3, travel: 0.25, stiffness: 24, compression: 2.0, relaxation: 2.6 },
    frictionSlip: 2.8, sideStiffness: 1.1, engineForce: 420, topSpeed: 21, brake: 13, maxSteer: 0.62,
    hitch: { x: -1.2, y: -0.05 }, seat: { x: -0.15, y: 0.55, z: 0, straddle: true }, cam: { dist: 5.5, height: 2.2 }, paint: 0x2f5d2a,
  },
  mower: {
    role: 'mower', kind: 'mower', label: 'Riding Mower',
    chassis: { hx: 0.9, hy: 0.22, hz: 0.48 }, mass: 230, comY: -0.18,
    axles: [
      { x: 0.6, radius: 0.19, width: 0.15, halfTrack: 0.42, steer: true, drive: false },
      { x: -0.55, radius: 0.28, width: 0.22, halfTrack: 0.44, steer: false, drive: true },
    ],
    wheelY: -0.02, suspension: { rest: 0.2, travel: 0.1, stiffness: 30, compression: 2.4, relaxation: 3.0 },
    frictionSlip: 2.2, sideStiffness: 1.0, engineForce: 260, topSpeed: 4.2, brake: 10, maxSteer: 0.75,
    mowerDeck: { x: 0.05, width: 1.1 }, seat: { x: -0.4, y: 0.5, z: 0 }, cam: { dist: 5, height: 2.4 }, paint: 0x2c7a2c,
  },
  hdtruck: {
    role: 'hauler', kind: 'hdtruck', label: 'Heavy-Duty Crew Cab',
    chassis: { hx: 3.05, hy: 0.5, hz: 1.02 }, mass: 2900, comY: -0.6,
    axles: [
      { x: 2.0, radius: 0.5, width: 0.36, halfTrack: 0.96, steer: true, drive: true },
      { x: -2.0, radius: 0.5, width: 0.36, halfTrack: 0.96, steer: false, drive: true },
    ],
    wheelY: -0.2, suspension: { rest: 0.45, travel: 0.3, stiffness: 30, compression: 2.5, relaxation: 3.3 },
    frictionSlip: 2.4, sideStiffness: 1.0, engineForce: 3100, topSpeed: 45, brake: 95, maxSteer: 0.55,
    hitch: { x: -3.32, y: -0.34 }, seat: { x: 0.55, y: 0.6, z: -0.5 }, cam: { dist: 11, height: 3.8 }, paint: 0x1d2b3a,
  },
  coupe: {
    kind: 'coupe', label: 'Muscle Coupe',
    chassis: { hx: 2.45, hy: 0.32, hz: 0.96 }, mass: 1750, comY: -0.45,
    axles: [
      { x: 1.5, radius: 0.36, width: 0.27, halfTrack: 0.84, steer: true, drive: false },
      { x: -1.45, radius: 0.37, width: 0.31, halfTrack: 0.84, steer: false, drive: true },
    ],
    wheelY: -0.1, suspension: { rest: 0.3, travel: 0.18, stiffness: 38, compression: 2.8, relaxation: 3.6 },
    frictionSlip: 2.7, sideStiffness: 1.05, engineForce: 3900, topSpeed: 68, brake: 62, maxSteer: 0.5,
    seat: { x: -0.45, y: 0.0, z: -0.42 }, cam: { dist: 8.5, height: 2.4 }, paint: 0xc4400f,
  },
  zeroturn: {
    role: 'mower', kind: 'zeroturn', label: 'Zero-Turn Mower',
    chassis: { hx: 0.95, hy: 0.2, hz: 0.55 }, mass: 340, comY: -0.28,
    axles: [
      { x: 0.78, radius: 0.15, width: 0.1, halfTrack: 0.46, steer: false, drive: false, caster: true },
      { x: -0.45, radius: 0.32, width: 0.26, halfTrack: 0.55, steer: false, drive: true },
    ],
    wheelY: 0, suspension: { rest: 0.2, travel: 0.1, stiffness: 34, compression: 2.6, relaxation: 3.2 },
    frictionSlip: 2.4, sideStiffness: 1.0, engineForce: 430, topSpeed: 5.6, brake: 14, maxSteer: 0,
    zeroTurn: true, mowerDeck: { x: 0.45, width: 1.4 }, seat: { x: -0.32, y: 0.5, z: 0 }, cam: { dist: 5.5, height: 2.6 }, paint: 0xb01e1e,
  },
  trailer: {
    kind: 'trailer', label: 'Utility Trailer',
    chassis: { hx: 1.6, hy: 0.16, hz: 0.82 }, mass: 420, comY: -0.05,
    axles: [{ x: -0.25, radius: 0.33, width: 0.2, halfTrack: 0.95, steer: false, drive: false }],
    wheelY: -0.02, suspension: { rest: 0.3, travel: 0.15, stiffness: 32, compression: 2.4, relaxation: 3.2 },
    frictionSlip: 2.0, sideStiffness: 1.0, engineForce: 0, topSpeed: 0, brake: 6, maxSteer: 0,
    tongue: { x: 2.5, y: -0.12 }, seat: { x: 0, y: 0, z: 0 }, cam: { dist: 8, height: 3 }, paint: 0x5a5e63,
  },
};

/** Every registered vehicle's tuning: built-ins plus published `custom:` vehicles. */
export const TUNING: Record<string, VehicleTuning> = { ...BUILTIN_TUNING, ...FLEET_TUNING };

export function tuningOf(kind: string): VehicleTuning | undefined {
  return TUNING[kind];
}

/** Chassis-center height above the road with the suspension settled under the body's weight. */
export function rideHeight(t: VehicleTuning): number {
  return t.axles[0].radius - (t.wheelY - t.suspension.rest * 0.8);
}

/** Front-steer to rear-axle distance (the same value the physics steering uses). */
export function wheelbaseOf(t: VehicleTuning): number {
  const steer = t.axles.filter(a => a.steer).map(a => a.x), fixed = t.axles.filter(a => !a.steer).map(a => a.x);
  if (steer.length && fixed.length) return Math.max(0.8, Math.abs(Math.max(...steer) - Math.min(...fixed)));
  const xs = t.axles.map(a => a.x);
  return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
}

/** Bumper-to-bumper size of the physics body, used by the editor's reference outlines. */
export function vehicleSize(t: VehicleTuning) {
  const wheels = t.axles.map(a => a.radius * 2);
  return {
    length: t.chassis.hx * 2,
    width: Math.max(t.chassis.hz * 2, ...t.axles.map(a => a.halfTrack * 2 + a.width)),
    wheelbase: wheelbaseOf(t),
    wheelDiameter: Math.max(...wheels),
    rideHeight: rideHeight(t),
  };
}

export const vehicleRole = (kind: string) => TUNING[kind]?.role ?? null;

/**
 * Bumper-to-bumper body extents of the built-in vehicles at rest, measured
 * from their procedural bodies (tow balls and mirrors excluded). The admin
 * editor draws these as true-scale reference outlines.
 */
export const BODY_EXTENTS: Record<Exclude<BuiltinVehicleKind, 'trailer'>, { front: number; rear: number; width: number; height: number }> = {
  truck: { front: 2.88, rear: -2.82, width: 2.08, height: 2.35 },
  hdtruck: { front: 3.26, rear: -3.16, width: 2.38, height: 2.99 },
  coupe: { front: 2.6, rear: -2.57, width: 2.15, height: 1.73 },
  sedan: { front: 2.48, rear: -2.44, width: 1.89, height: 1.65 },
  golfcart: { front: 1.33, rear: -1.3, width: 1.33, height: 2.28 },
  atv: { front: 1.1, rear: -1.0, width: 1.3, height: 1.28 },
  mower: { front: 0.93, rear: -0.83, width: 1.28, height: 1.18 },
  zeroturn: { front: 0.94, rear: -0.92, width: 1.62, height: 1.84 },
};
