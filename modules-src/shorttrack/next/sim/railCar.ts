import { z } from 'zod'

/** A lookup on an even grid: `y[i]` is the value at `x0 + i * dx`; outside the grid the end values hold. */
export type Table = { x0: number; dx: number; y: number[] }

export function lookup(t: Table, x: number): number {
  const n = t.y.length
  if (n === 1) return t.y[0]
  const f = (x - t.x0) / t.dx
  if (f <= 0) return t.y[0]
  if (f >= n - 1) return t.y[n - 1]
  const i = Math.floor(f), u = f - i
  return t.y[i] + (t.y[i + 1] - t.y[i]) * u
}

/** Corner order everywhere: LF, RF, LR, RR. */
export type Quad<T> = [T, T, T, T]

/**
 * The car the Straight Rail Setup Lab hands to the track test, in SI units (m, kg, N, rad unless the name says °).
 * Positions are relative to the centre of gravity with x forward and y to the left. Every number comes from the
 * Lab's own solve (`modules-src/railsetup/sim/vehicle.ts`), so a change on the setup sheet changes the car on track.
 */
export type RailVehicle = {
  v: 1
  name: string
  /** Total and unsprung (front axle, rear axle) mass, kg. */
  mass: number
  unsprung: [number, number]
  /** Total and sprung CG height above the ground, m. */
  cgH: number
  hs: number
  wheelbase: number
  /** Tire contact patches relative to the CG, m. */
  tires: Quad<[number, number]>
  trackF: number
  trackR: number
  /** Lateral position of each spring's line of action relative to the CG (front: the wheels, rear: the spring base). */
  springY: Quad<number>
  /** Wheel force added by the spring, bump spring and coilover motion ratio, N, against wheel travel (m, + = bump). */
  spring: Quad<Table>
  /** Wheel travel at which each bump spring starts to work, m (1 = no bump spring). */
  bumpTravel: Quad<number>
  /** Tire loads with the car at rest on flat ground, N. */
  staticLoad: Quad<number>
  /** Front bar roll stiffness (N·m/rad), its preload as body roll (rad, + = toward a left turn) and whether it is slack. */
  barF: number
  barPre: number
  barSlack: boolean
  barR: number
  /** Frame twist stiffness between the front and rear roll, N·m/rad. */
  twist: number
  /** Roll centre heights (m) and jacking ratios against body roll (rad, + = right side down, as in a left turn). */
  rcF: Table
  rcR: Table
  jackLF: Table
  jackRF: Table
  jackR: Table
  /** Anti-dive (front) and anti-squat (rear) as fractions, against axle travel (m, + = bump). */
  antiDive: Table
  antiSquat: Table
  /** Front camber and toe (°, the Lab's sign: camber + = top out, toe + = toe out) against wheel travel (m). */
  camber: [Table, Table]
  toe: [Table, Table]
  /** Rear axle steer (°, + = aims right, which loosens the car) against body roll (rad) and against rear travel (m). */
  rearSteerRoll: Table
  rearSteerHeave: Table
  /** Tire rollout (circumference, m) and vertical rate (N/m). */
  rollout: Quad<number>
  tireRate: number
  /** Front brake share (0..1). */
  brakeFront: number
  /** Frame and nose points that can touch the track: position relative to the CG and height at rest, m. */
  clearance: { name: string; x: number; y: number; h: number }[]
  /** The scale numbers, for the readouts. */
  scales: { left: number; rear: number; cross: number; weightLb: number }
  /** Handling against the Lab's test drive baseline per corner phase (balance points, + = tighter, − = looser). */
  handling?: { entry: number; center: number; exit: number }
}

const table = z.object({ x0: z.number().finite(), dx: z.number().finite().positive(), y: z.array(z.number().finite()).min(1).max(400) })
const quadNum = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
const pair = z.tuple([z.number().finite(), z.number().finite()])

export const railVehicleSchema = z.object({
  v: z.literal(1),
  name: z.string().max(80),
  mass: z.number().min(500).max(2500),
  unsprung: pair,
  cgH: z.number().min(0.1).max(1),
  hs: z.number().min(0.1).max(1),
  wheelbase: z.number().min(1.5).max(4),
  tires: z.tuple([pair, pair, pair, pair]),
  trackF: z.number().min(1).max(2.5),
  trackR: z.number().min(1).max(2.5),
  springY: quadNum,
  spring: z.tuple([table, table, table, table]),
  bumpTravel: quadNum,
  staticLoad: quadNum,
  barF: z.number().finite().min(0),
  barPre: z.number().finite(),
  barSlack: z.boolean(),
  barR: z.number().finite().min(0),
  twist: z.number().finite().positive(),
  rcF: table,
  rcR: table,
  jackLF: table,
  jackRF: table,
  jackR: table,
  antiDive: table,
  antiSquat: table,
  camber: z.tuple([table, table]),
  toe: z.tuple([table, table]),
  rearSteerRoll: table,
  rearSteerHeave: table,
  rollout: quadNum,
  tireRate: z.number().positive(),
  brakeFront: z.number().min(0).max(1),
  clearance: z.array(z.object({ name: z.string().max(20), x: z.number().finite(), y: z.number().finite(), h: z.number().finite() })).max(12),
  scales: z.object({ left: z.number().finite(), rear: z.number().finite(), cross: z.number().finite(), weightLb: z.number().finite() }),
  handling: z.object({ entry: z.number().min(-40).max(40), center: z.number().min(-40).max(40), exit: z.number().min(-40).max(40) }).optional(),
})

export function parseRailVehicle(raw: unknown): RailVehicle | null {
  const r = railVehicleSchema.safeParse(raw)
  return r.success ? (r.data as RailVehicle) : null
}

/** The track the Lab describes: its corner radius (ft) and banking (°). */
export type LabTrackSpec = { radiusFt: number; bankDeg: number; straightBankDeg: number }

export function labTrackSpec(q: URLSearchParams): LabTrackSpec {
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k))
    return q.get(k) != null && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
  }
  const bankDeg = num('bank', 12, 0, 20)
  return { radiusFt: num('rad', 120, 40, 300), bankDeg, straightBankDeg: num('sbank', Math.round(bankDeg / 3 * 2) / 2, 0, 20) }
}
