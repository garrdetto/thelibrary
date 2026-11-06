/**
 * The flyable aircraft, as data: the five-seat turbine utility helicopter
 * (the model from look development) and the two-seat high-wing trainer.
 * Original designs and names. Body frame: +X nose, +Y up, +Z right; the
 * origin is where the skids or wheels touch the ground.
 */
import type { V3 } from './FlightMath';

export interface HeliSpec {
  kind: 'heli'; id: string; name: string;
  mass: number; inertia: V3; com: V3;
  hub: V3; rotorRadius: number; tailArm: number;
  /** Thrust at zero and full collective, as multiples of weight, at full rotor speed. */
  thrust: [number, number];
  maxTilt: [number, number]; headStiffness: number; rotorDamping: number;
  torquePerThrust: number; tailMax: number; yawDamping: number;
  drag: V3; fin: number; stab: number;
  spool: number; fuel: number; burn: [number, number];
  seat: V3; skids: { z: number; x0: number; x1: number; y: number; r: number }; body: { hx: number; hy: number; hz: number; cx: number; cy: number };
  cam: { dist: number; height: number };
}

export interface PlaneSpec {
  kind: 'plane'; id: string; name: string;
  mass: number; inertia: V3; com: V3;
  area: number; span: number; chord: number; incidence: number;
  cl0: number; clAlpha: number; clMax: number; flapCl: number[]; flapCd: number[]; cd0: number; oswald: number;
  cm0: number; cmAlpha: number; cmQ: number; cmElevator: number;
  clBeta: number; clP: number; clR: number; clAileron: number;
  cnBeta: number; cnR: number; cnRudder: number; cnAileron: number; cyBeta: number;
  surfaces: { elevator: number; aileron: number; rudder: number; rate: number };
  power: number; staticThrust: number; propEff: number; pFactor: number;
  fuel: number; burn: [number, number];
  wheels: { x: number; z: number; radius: number; steer: boolean; brake: boolean }[]; rest: number; stiffness: number;
  body: { hx: number; hy: number; hz: number; cx: number; cy: number }; wing: { hx: number; hy: number; hz: number; cx: number; cy: number };
  seat: V3; cam: { dist: number; height: number };
}

export type AircraftSpec = HeliSpec | PlaneSpec;

export const UTILITY_HELI: HeliSpec = {
  kind: 'heli', id: 'heli-utility', name: 'Kestrel 5 utility helicopter',
  mass: 1600, inertia: [1700, 4800, 4300], com: [0.1, 1.35, 0],
  hub: [0, 3.37, 0], rotorRadius: 5.35, tailArm: 7.7,
  thrust: [0.35, 1.65],
  maxTilt: [0.17, 0.14], headStiffness: 14000, rotorDamping: 5200,
  torquePerThrust: 0.11, tailMax: 6000, yawDamping: 3800,
  drag: [1.7, 8.5, 5.5], fin: 10.6, stab: 11.5,
  spool: 3.2, fuel: 340, burn: [0.006, 0.024],
  seat: [1.35, 0.95, 0.42], skids: { z: 1.08, x0: -1.75, x1: 1.45, y: 0.07, r: 0.06 }, body: { hx: 2.4, hy: 0.85, hz: 0.82, cx: 0.1, cy: 1.65 },
  cam: { dist: 15, height: 4.5 },
};

export const TRAINER_PLANE: PlaneSpec = {
  kind: 'plane', id: 'plane-trainer', name: 'Kestrel Skylark trainer',
  mass: 760, inertia: [1290, 2670, 1830], com: [0.15, 1.15, 0],
  area: 16.2, span: 10.1, chord: 1.6, incidence: 0.01,
  cl0: 0.25, clAlpha: 5.0, clMax: 1.45, flapCl: [0, 0.35, 0.6], flapCd: [0, 0.018, 0.05], cd0: 0.031, oswald: 0.75,
  cm0: 0.04, cmAlpha: -0.9, cmQ: -12.4, cmElevator: -1.2,
  clBeta: -0.09, clP: -0.47, clR: 0.1, clAileron: 0.18,
  cnBeta: 0.065, cnR: -0.1, cnRudder: -0.07, cnAileron: -0.012, cyBeta: -0.6,
  surfaces: { elevator: 0.42, aileron: 0.27, rudder: 0.35, rate: 3 },
  power: 82000, staticThrust: 2700, propEff: 0.78, pFactor: 0.14,
  fuel: 150, burn: [0.0008, 0.0095],
  wheels: [{ x: 1.55, z: 0, radius: 0.22, steer: true, brake: false }, { x: -0.3, z: -1.15, radius: 0.28, steer: false, brake: true }, { x: -0.3, z: 1.15, radius: 0.28, steer: false, brake: true }],
  rest: 0.3, stiffness: 38,
  body: { hx: 3.3, hy: 0.6, hz: 0.55, cx: -0.6, cy: 1.35 }, wing: { hx: 0.8, hy: 0.08, hz: 5.05, cx: 0.0, cy: 2.35 },
  seat: [0.55, 0.85, -0.3], cam: { dist: 16, height: 4 },
};

export const AIRCRAFT: Record<string, AircraftSpec> = { [UTILITY_HELI.id]: UTILITY_HELI, [TRAINER_PLANE.id]: TRAINER_PLANE };
