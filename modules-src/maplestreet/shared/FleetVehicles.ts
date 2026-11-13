/**
 * The freight fleet: a tandem-axle dump truck, a long-nose semi tractor and
 * four semi-trailers (a 53 ft dry van, a 48 ft flatbed, a log trailer and a
 * fuel tanker). Plain tuning data like the rest of shared/Vehicles.ts (chassis
 * +X forward, +Y up, +Z right; SI units), sized from real rigs: 22.5 in
 * wheels on 1.06 m tires, a fifth wheel 1.25 m off the road, trailers 2.6 m
 * wide on a slid-back tandem with landing gear up front.
 *
 * Every rig's collider is the whole body, so the chassis centre sits high and
 * the wheel mounts (`wheelY`) hang far below it. Trailer landing legs are an
 * extra axle (`leg`): short struts that only reach the road when the trailer
 * is dropped, never rolling (they are braked hard).
 */
import type { VehicleTuning } from './Vehicles';

export const FLEET_KINDS = ['dumptruck', 'semi', 'dryvan', 'flatbed', 'logger', 'tanker'] as const;
export type FleetKind = (typeof FLEET_KINDS)[number];
export const SEMI_TRAILERS = ['dryvan', 'flatbed', 'logger', 'tanker'] as const;
export type SemiTrailerKind = (typeof SEMI_TRAILERS)[number];

/** Fifth wheel and kingpin height above the road. */
export const COUPLING_HEIGHT = 1.25;

const TIRE = 0.53;
const TRAILER_TIRE = 0.5;
const ride = (radius: number, center: number, rest: number) => radius - center + rest * 0.8;

const suspension = (rest: number, stiffness: number) => ({ rest, travel: 0.22, stiffness, compression: 3.2, relaxation: 3.8 });

function trailer(kind: SemiTrailerKind, label: string, o: { length: number; center: number; hy: number; axles: [number, number]; legs: number; mass: number; paint: number }): VehicleTuning {
  const hx = o.length / 2;
  const rest = 0.3;
  const wheelY = ride(TRAILER_TIRE, o.center, rest);
  return {
    kind: kind as VehicleTuning['kind'], label,
    chassis: { hx, hy: o.hy, hz: 1.3 }, mass: o.mass, comY: -o.hy * 0.6,
    axles: [
      ...o.axles.map(x => ({ x, radius: TRAILER_TIRE, width: 0.56, halfTrack: 0.92, steer: false, drive: false, dual: true })),
      { x: hx - o.legs, radius: TRAILER_TIRE - 0.38, width: 0.2, halfTrack: 0.95, steer: false, drive: false, leg: true },
    ],
    wheelY, suspension: suspension(rest, 42),
    frictionSlip: 2.4, sideStiffness: 1.1, engineForce: 0, topSpeed: 0, brake: 210, maxSteer: 0,
    tongue: { x: hx - 0.92, y: COUPLING_HEIGHT - o.center },
    seat: { x: 0, y: 0, z: 0 }, cam: { dist: 20, height: 6 }, paint: o.paint,
  };
}

export const FLEET_TUNING: Record<FleetKind, VehicleTuning> = {
  dumptruck: {
    role: 'hauler', kind: 'dumptruck' as VehicleTuning['kind'], label: 'Tandem Dump Truck',
    chassis: { hx: 3.93, hy: 1.5, hz: 1.25 }, mass: 12500, comY: -0.85,
    axles: [
      { x: 3.02, radius: TIRE, width: 0.32, halfTrack: 0.99, steer: true, drive: false },
      { x: -1.49, radius: TIRE, width: 0.62, halfTrack: 0.84, steer: false, drive: true, dual: true },
      { x: -2.85, radius: TIRE, width: 0.62, halfTrack: 0.84, steer: false, drive: true, dual: true },
    ],
    wheelY: ride(TIRE, 1.85, 0.36), suspension: suspension(0.36, 38),
    frictionSlip: 2.6, sideStiffness: 1.05, engineForce: 6200, topSpeed: 29, brake: 380, maxSteer: 0.6,
    dump: { pivotX: -3.75, pivotY: -0.6, maxAngle: 0.9 },
    seat: { x: 1.6, y: 0.05, z: -0.5 }, cam: { dist: 15, height: 5 }, paint: 0xa81c1c,
  },
  semi: {
    role: 'hauler', kind: 'semi' as VehicleTuning['kind'], label: 'Long-Nose Tractor',
    chassis: { hx: 4.03, hy: 1.45, hz: 1.25 }, mass: 8600, comY: -0.9,
    axles: [
      { x: 3.31, radius: TIRE, width: 0.32, halfTrack: 1.05, steer: true, drive: false },
      { x: -1.94, radius: TIRE, width: 0.62, halfTrack: 0.86, steer: false, drive: true, dual: true },
      { x: -3.26, radius: TIRE, width: 0.62, halfTrack: 0.86, steer: false, drive: true, dual: true },
    ],
    wheelY: ride(TIRE, 1.8, 0.36), suspension: suspension(0.36, 36),
    frictionSlip: 2.6, sideStiffness: 1.05, engineForce: 6800, topSpeed: 31, brake: 300, maxSteer: 0.62,
    hitch: { x: -2.75, y: COUPLING_HEIGHT - 1.8 },
    seat: { x: 1.6, y: 0.3, z: -0.52 }, cam: { dist: 17, height: 5.5 }, paint: 0x1b3a8a,
  },
  dryvan: trailer('dryvan', '53 ft Dry Van', { length: 16.15, center: 2.62, hy: 1.47, axles: [-5.95, -7.2], legs: 2.9, mass: 6800, paint: 0xf2f2ef }),
  flatbed: trailer('flatbed', '48 ft Flatbed', { length: 14.63, center: 1.36, hy: 0.2, axles: [-5.2, -6.45], legs: 2.6, mass: 4800, paint: 0x2b2d31 }),
  logger: trailer('logger', 'Log Trailer', { length: 12.2, center: 1.32, hy: 0.22, axles: [-4.1, -5.35], legs: 2.4, mass: 4200, paint: 0x26282b }),
  tanker: trailer('tanker', 'Fuel Tanker', { length: 13.0, center: 2.42, hy: 1.17, axles: [-4.55, -5.8], legs: 2.6, mass: 6200, paint: 0xd8dbdf }),
};

export const isFleetKind = (kind: string): kind is FleetKind => (FLEET_KINDS as readonly string[]).includes(kind);
export const isSemiTrailer = (kind: string): kind is SemiTrailerKind => (SEMI_TRAILERS as readonly string[]).includes(kind);
