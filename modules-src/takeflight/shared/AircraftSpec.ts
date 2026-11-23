/**
 * The data file that defines one aircraft for the flight model, checked with Zod when it loads (page and Worker alike).
 *
 * Body axes: x forward, y up, z right (right-handed), origin at the centre-of-gravity reference, metres. Control inputs are
 * normalised: pitch +1 is full back stick (nose up), roll +1 full right, yaw +1 full right pedal. Every moment coefficient below
 * is given in those terms, so a positive `pitchControl` raises the nose for a positive input. Rate derivatives use the standard
 * non-dimensional rates p·b/2V, q·c/2V, r·b/2V with p roll right, q pitch up and r yaw right.
 */
import { z } from 'zod'

const vec3 = z.tuple([z.number(), z.number(), z.number()])
const table = z.object({ alpha: z.array(z.number()).min(2), value: z.array(z.number()).min(2) }).refine((t) => t.alpha.length === t.value.length, 'table columns differ in length')

export const contactSchema = z.object({
  name: z.string(),
  position: vec3,
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
  /** Wheels roll along their heading and grip sideways; skids and structure points slide with `friction`. */
  kind: z.enum(['wheel', 'structure']),
  /** Most nose-wheel steering, degrees, from the rudder pedals (0 for a castering or fixed wheel). */
  steer: z.number().default(0),
  /** Which brake pedal works this wheel. */
  brake: z.enum(['none', 'left', 'right']).default('none'),
  retracts: z.boolean().default(false),
  friction: z.number().default(0.8),
  /** Vertical contact speed (m/s) above which touching down here breaks the aircraft. */
  breakSpeed: z.number().default(4),
})

export const engineSchema = z.object({
  kind: z.enum(['piston', 'turboprop', 'turbofan']),
  count: z.number().int().min(1).max(4),
  /** Shaft power per engine at sea level, watts (piston and turboprop). */
  maxPower: z.number().nonnegative().default(0),
  /** Static thrust per engine at sea level, newtons. */
  staticThrust: z.number().positive(),
  propEfficiency: z.number().min(0).max(1).default(0.8),
  /** Fuel burned per engine at full power, kg/s. */
  fuelFlow: z.number().positive(),
  /** Seconds for the engine to reach about two thirds of a throttle change. */
  spool: z.number().positive(),
  /** Yaw moment (N·m) per newton of thrust at low airspeed and high power: P-factor and slipstream, positive yaws left. */
  torqueYaw: z.number().default(0),
  /** Engine positions in body axes (one per engine). */
  positions: z.array(vec3).min(1),
  idle: z.number().min(0).max(1).default(0.08),
  /** Revolutions per minute at idle and at full power (shown on the tachometer). */
  rpm: z.tuple([z.number(), z.number()]).default([700, 2700]),
})

export const aircraftSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  maker: z.string(),
  family: z.string(),
  category: z.enum(['trainer', 'complex', 'twin', 'turboprop', 'bizjet', 'cargo', 'regional', 'narrowbody', 'widebody']),
  tier: z.number().int().min(1).max(8),
  seats: z.number().int().positive(),
  mass: z.object({
    empty: z.number().positive(),
    maxTakeoff: z.number().positive(),
    maxLanding: z.number().positive(),
    fuelCapacity: z.number().positive(),
    defaultFuel: z.number().nonnegative(),
    defaultPayload: z.number().nonnegative(),
  }),
  /** Moments of inertia at maximum take-off mass, kg·m²; they scale with mass. `rollYaw` is the product term. */
  inertia: z.object({ roll: z.number().positive(), pitch: z.number().positive(), yaw: z.number().positive(), rollYaw: z.number().default(0) }),
  wing: z.object({ area: z.number().positive(), span: z.number().positive(), chord: z.number().positive(), oswald: z.number().min(0.4).max(1) }),
  aero: z.object({
    lift: table,
    cd0: z.number().positive(),
    /** Extra drag at high angle of attack as a table of alpha (deg) to added drag coefficient. */
    stallDrag: table,
    stallAlpha: z.number(),
    flapLift: z.number(),
    flapDrag: z.number(),
    flapStallShift: z.number(),
    flapPitch: z.number(),
    gearDrag: z.number().nonnegative(),
    spoilerLift: z.number().default(0),
    spoilerDrag: z.number().default(0),
    sideslip: z.number(),
    sideRudder: z.number(),
    pitch0: z.number(),
    pitchAlpha: z.number(),
    pitchRate: z.number(),
    pitchControl: z.number(),
    pitchTrim: z.number(),
    rollSideslip: z.number(),
    rollRate: z.number(),
    rollYawRate: z.number(),
    rollControl: z.number(),
    rollRudder: z.number(),
    yawSideslip: z.number(),
    yawRate: z.number(),
    yawRollRate: z.number(),
    yawAileron: z.number(),
    yawControl: z.number(),
    /** Mach number where wave drag starts, and its growth (added drag coefficient per Mach² beyond it). */
    machCrit: z.number().default(0.72),
    machDrag: z.number().default(14),
    /** Less induced drag and a little more lift within a wingspan of the ground. */
    groundEffect: z.boolean().default(true),
  }),
  controls: z.object({
    /** Surface travel per second, as a share of full deflection. */
    rate: z.number().positive(),
    flapDetents: z.array(z.number()).min(1),
    /** Seconds to run the flaps from up to fully down. */
    flapTime: z.number().positive(),
    gearTime: z.number().nonnegative().default(0),
    retractable: z.boolean(),
    spoilers: z.boolean().default(false),
    reversers: z.boolean().default(false),
    /** Trim travel per second while the trim key is held. */
    trimRate: z.number().positive(),
  }),
  engine: engineSchema,
  contacts: z.array(contactSchema).min(3),
  /** Knots, indicated. */
  vSpeeds: z.object({ vs0: z.number(), vs1: z.number(), vr: z.number(), vx: z.number(), vy: z.number(), vref: z.number(), vapp: z.number(), cruise: z.number(), vfe: z.number(), vno: z.number(), vne: z.number(), va: z.number() }),
  limits: z.object({ gPositive: z.number(), gNegative: z.number(), maxCrosswind: z.number(), maxBank: z.number(), maxPitch: z.number() }),
  /** Pilot eye point in body axes for the cockpit camera. */
  eye: vec3,
  /** Asset base name under `/models/takeflight/`. */
  model: z.string(),
})

export type AircraftSpec = z.infer<typeof aircraftSchema>
export type ContactSpec = z.infer<typeof contactSchema>
export type EngineSpec = z.infer<typeof engineSchema>

export function parseAircraft(data: unknown): AircraftSpec {
  return aircraftSchema.parse(data)
}
