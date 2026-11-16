/**
 * Life Sim's vehicle tuning: the administrator's changes to each vehicle's top speed and handling, made in the
 * developer panel (dev/DevPanel.ts, Vehicle tuning) and saved for everyone through `/api/lifesim-tuning` (D1
 * `library_settings`, key `lifesim-vehicle-tuning`). Life Sim applies them over the registered tuning (TUNING in
 * maplestreet/shared/Vehicles.ts) before any vehicle is made, and again live while the panel edits. Only Life Sim reads
 * them: Fox Plains keeps its own numbers. Renderer-free; the Worker validates saves with the same limits.
 */
import { TUNING, type VehicleTuning } from '../../maplestreet/shared/Vehicles'

export const TUNING_VERSION = 1
export const MPH = 0.44704

/** One vehicle's changes; a missing field keeps the vehicle's own value. */
export interface TuningEdit {
  /** Top speed, mph. */
  topSpeedMph?: number
  /** Engine force per driven wheel, newtons. */
  power?: number
  /** Tyre grip (friction slip). */
  grip?: number
  /** Sideways grip (side friction stiffness). */
  sideGrip?: number
  /** Steering lock, degrees. */
  steerDeg?: number
  /** Brake strength. */
  brake?: number
  /** Helicopters: climb rate, m/s. */
  climb?: number
  /** Helicopters: turn rate, degrees a second. */
  yawDeg?: number
  /** Helicopters: how quickly it reaches the speed asked for, m/s². */
  agility?: number
}

export interface TuningDoc {
  v: typeof TUNING_VERSION
  vehicles: Record<string, TuningEdit>
}

export type TuningField = keyof TuningEdit

export interface FieldSpec {
  key: TuningField
  label: string
  unit: string
  min: number
  max: number
  step: number
  /** Only for helicopters, or only for vehicles that drive on wheels. */
  only?: 'flight' | 'ground'
}

export const TUNING_FIELDS: readonly FieldSpec[] = [
  { key: 'topSpeedMph', label: 'Top speed', unit: 'mph', min: 2, max: 200, step: 1 },
  { key: 'power', label: 'Engine power', unit: 'N', min: 50, max: 20000, step: 10, only: 'ground' },
  { key: 'grip', label: 'Grip', unit: '', min: 0.5, max: 6, step: 0.05, only: 'ground' },
  { key: 'sideGrip', label: 'Side grip', unit: '', min: 0.3, max: 3, step: 0.05, only: 'ground' },
  { key: 'steerDeg', label: 'Steering lock', unit: '°', min: 6, max: 68, step: 1, only: 'ground' },
  { key: 'brake', label: 'Brakes', unit: '', min: 1, max: 400, step: 1, only: 'ground' },
  { key: 'climb', label: 'Climb rate', unit: 'm/s', min: 0.5, max: 30, step: 0.5, only: 'flight' },
  { key: 'yawDeg', label: 'Turn rate', unit: '°/s', min: 6, max: 229, step: 1, only: 'flight' },
  { key: 'agility', label: 'Agility', unit: 'm/s²', min: 0.5, max: 30, step: 0.5, only: 'flight' },
]

export const emptyTuning = (): TuningDoc => ({ v: TUNING_VERSION, vehicles: {} })

const KIND = /^(?:[a-z]+|custom:[a-z0-9-]{8,64})$/
export const MAX_TUNED = 200

/** Light check for documents read from the network or this device (the server validates fully with Zod). */
export function isTuningDoc(v: unknown): v is TuningDoc {
  if (!v || typeof v !== 'object') return false
  const d = v as TuningDoc
  if (d.v !== TUNING_VERSION || !d.vehicles || typeof d.vehicles !== 'object') return false
  const kinds = Object.keys(d.vehicles)
  if (kinds.length > MAX_TUNED) return false
  return kinds.every((k) => KIND.test(k) && isEdit(d.vehicles[k]))
}

function isEdit(e: unknown): e is TuningEdit {
  if (!e || typeof e !== 'object') return false
  return Object.entries(e).every(([k, v]) => {
    const f = TUNING_FIELDS.find((x) => x.key === k)
    return !!f && typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max
  })
}

/** Each kind's own numbers before any edit, kept the first time it is tuned (and again when it is re-registered). */
const base = new Map<string, { tuning: VehicleTuning; snapshot: string }>()

function own(kind: string): VehicleTuning | null {
  const t = TUNING[kind]
  if (!t) return null
  const kept = base.get(kind)
  if (!kept || kept.tuning !== t) base.set(kind, { tuning: t, snapshot: JSON.stringify(t) })
  return JSON.parse(base.get(kind)!.snapshot) as VehicleTuning
}

/** The value a field shows for a kind with no edit. */
export function defaultValue(kind: string, key: TuningField): number | null {
  const t = own(kind)
  return t ? read(t, key) : null
}

export function currentValue(kind: string, key: TuningField): number | null {
  const t = TUNING[kind]
  return t ? read(t, key) : null
}

function read(t: VehicleTuning, key: TuningField): number | null {
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
  switch (key) {
    case 'topSpeedMph': return r(t.topSpeed / MPH, 1)
    case 'power': return t.flight ? null : r(t.engineForce, 0)
    case 'grip': return t.flight ? null : r(t.frictionSlip)
    case 'sideGrip': return t.flight ? null : r(t.sideStiffness)
    case 'steerDeg': return t.flight ? null : r((t.maxSteer * 180) / Math.PI, 1)
    case 'brake': return t.flight ? null : r(t.brake, 1)
    case 'climb': return t.flight ? r(t.flight.climb, 1) : null
    case 'yawDeg': return t.flight ? r((t.flight.yawRate * 180) / Math.PI, 0) : null
    case 'agility': return t.flight ? r(t.flight.accel, 1) : null
  }
}

/**
 * Sets one kind's tuning to its own numbers with `edit` over them, in place (vehicles already on the road hold the
 * same object, so they drive with the change at once; grip needs `Vehicle.retune`).
 */
export function applyEdit(kind: string, edit: TuningEdit | undefined): boolean {
  const t = TUNING[kind]
  const b = own(kind)
  if (!t || !b) return false
  const e = edit ?? {}
  t.topSpeed = e.topSpeedMph !== undefined ? e.topSpeedMph * MPH : b.topSpeed
  t.engineForce = e.power ?? b.engineForce
  t.frictionSlip = e.grip ?? b.frictionSlip
  t.sideStiffness = e.sideGrip ?? b.sideStiffness
  t.maxSteer = e.steerDeg !== undefined ? (e.steerDeg * Math.PI) / 180 : b.maxSteer
  t.brake = e.brake ?? b.brake
  if (t.flight && b.flight) {
    t.flight.climb = e.climb ?? b.flight.climb
    t.flight.yawRate = e.yawDeg !== undefined ? (e.yawDeg * Math.PI) / 180 : b.flight.yawRate
    t.flight.accel = e.agility ?? b.flight.accel
  }
  return true
}

/** Applies a whole document: every kind it names (kinds that aren't registered are skipped). */
export function applyTuning(doc: TuningDoc): void {
  for (const [kind, edit] of Object.entries(doc.vehicles)) applyEdit(kind, edit)
}
