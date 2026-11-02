import { z } from 'zod'
import { BRAND_PATTERN, DRIVE_TEMPLATES, TRAFFIC_ROUTES, VEHICLE_LIMITS, type CustomVehicleRecord, type CustomVehicleSpec } from '../../modules-src/maplestreet/shared/CustomVehicles'
import type { Env } from './env'

export const VEHICLE_MODEL_KEY = (id: string) => `maplestreet-vehicle/${id}`
export const VEHICLE_WHEEL_KEY = (id: string) => `maplestreet-vehicle/${id}/wheel`
export const vehicleModelUrl = (id: string) => `/api/maplestreet-vehicles?model=${id}`
export const vehicleWheelUrl = (id: string) => `/api/maplestreet-vehicles?wheel=${id}`

const TABLE = `CREATE TABLE IF NOT EXISTS maplestreet_vehicles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL, model_type TEXT NOT NULL,
  model_bytes INTEGER NOT NULL, wheel_type TEXT, wheel_bytes INTEGER, active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

const n = (min: number, max: number) => z.number().finite().min(min).max(max)
const point = (lim = 10) => z.object({ x: n(-lim, lim), y: n(-lim, lim), z: n(-lim, lim) }).strict()
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const plainText = (max: number) => z.string().trim().max(max).regex(/^[\p{L}\p{N} .,'&()+#/-]*$/u, 'Use letters, numbers and simple punctuation.')
const noBrand = (value: string) => !BRAND_PATTERN.test(value)
const BRAND_MESSAGE = 'Vehicles are original designs: leave real manufacturer and model names out.'

export const vehicleNameSchema = plainText(VEHICLE_LIMITS.nameMax).min(VEHICLE_LIMITS.nameMin).refine(noBrand, BRAND_MESSAGE)

const axleSchema = z.object({
  x: n(-5, 5),
  radius: n(VEHICLE_LIMITS.wheelRadiusMin, VEHICLE_LIMITS.wheelRadiusMax),
  width: n(0.05, 1),
  halfTrack: n(0.2, 1.6),
  steer: z.boolean(),
  drive: z.boolean(),
}).strict()

export const vehicleSpecSchema = z.object({
  template: z.enum(DRIVE_TEMPLATES),
  model: z.object({ scale: n(0.0001, 10000), yaw: n(-360, 360), x: n(-50, 50), y: n(-50, 50), z: n(-50, 50) }).strict(),
  physics: z.object({
    chassis: z.object({ hx: n(VEHICLE_LIMITS.lengthMin / 2, VEHICLE_LIMITS.lengthMax / 2), hy: n(0.05, 2), hz: n(0.2, VEHICLE_LIMITS.widthMax / 2) }).strict(),
    mass: n(VEHICLE_LIMITS.massMin, VEHICLE_LIMITS.massMax),
    comY: n(-3, 1),
    axles: z.array(axleSchema).min(2).max(VEHICLE_LIMITS.axlesMax)
      .refine(axles => axles.some(a => a.drive), 'At least one axle must drive.')
      .refine(axles => axles.some(a => a.steer), 'At least one axle must steer.'),
    wheelY: n(-2, 2),
    suspension: z.object({ rest: n(0.05, 1.5), travel: n(0.02, 1), stiffness: n(5, 120), compression: n(0.5, 10), relaxation: n(0.5, 10) }).strict(),
    frictionSlip: n(0.5, 6),
    sideStiffness: n(0.3, 3),
    engineForce: n(1, 200_000),
    topSpeed: n(0.5, 200),
    brake: n(1, 1000),
    maxSteer: n(0.1, 1.2),
    seat: z.object({ x: n(-10, 10), y: n(-10, 10), z: n(-10, 10), straddle: z.boolean().optional() }).strict(),
    hitch: z.object({ x: n(-6, 0), y: n(-2, 2) }).strict().nullable(),
    cam: z.object({ dist: n(3, 20), height: n(1, 8) }).strict(),
  }).strict(),
  lights: z.object({ head: z.array(point()).max(VEHICLE_LIMITS.lightsMax), tail: z.array(point()).max(VEHICLE_LIMITS.lightsMax) }).strict(),
  paint: z.object({ mode: z.enum(['none', 'material', 'color']), material: z.string().max(120), key: hex, tolerance: n(0.01, 1), color: hex }).strict(),
  targets: z.object({ topSpeedMph: n(2, VEHICLE_LIMITS.topSpeedMphMax), zeroToMph: n(1, 60), zeroToSeconds: n(0.5, 120) }).strict(),
  dealer: z.object({ forSale: z.boolean(), price: z.number().int().min(0).max(VEHICLE_LIMITS.priceMax), fuel: z.enum(['gas', 'electric']), tank: n(0.5, 200), mpg: n(1, 500) }).strict(),
  traffic: z.object({ enabled: z.boolean(), driver: plainText(40).refine(noBrand, BRAND_MESSAGE), route: z.enum(TRAFFIC_ROUTES), mph: n(3, 60) }).strict(),
  wheelsRemoved: z.boolean(),
}).strict()

type VehicleRow = { id: string; name: string; spec: string; wheel_type: string | null; active: number; updated_at: number }

let tableReady: Promise<unknown> | null = null
export function ensureVehiclesTable(env: Env) {
  tableReady ??= env.DB.prepare(TABLE).run().catch(error => { tableReady = null; throw error })
  return tableReady
}

function toRecord(row: VehicleRow): CustomVehicleRecord | null {
  let spec: CustomVehicleSpec
  try {
    spec = vehicleSpecSchema.parse(JSON.parse(row.spec)) as CustomVehicleSpec
  } catch {
    return null
  }
  return {
    ...spec,
    id: row.id,
    name: row.name,
    modelUrl: vehicleModelUrl(row.id),
    wheelUrl: row.wheel_type ? vehicleWheelUrl(row.id) : null,
    active: row.active === 1,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = 'id, name, spec, wheel_type, active, updated_at'

export async function listStoreVehicles(env: Env): Promise<CustomVehicleRecord[]> {
  await ensureVehiclesTable(env)
  const rows = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_vehicles ORDER BY created_at ASC, id ASC`).all<VehicleRow>()
  return rows.results.map(toRecord).filter((r): r is CustomVehicleRecord => r !== null)
}

export async function getStoreVehicle(env: Env, id: string): Promise<CustomVehicleRecord | null> {
  await ensureVehiclesTable(env)
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_vehicles WHERE id = ?`).bind(id).first<VehicleRow>()
  return row ? toRecord(row) : null
}

export async function insertStoreVehicle(env: Env, id: string, name: string, spec: CustomVehicleSpec, model: { type: string; bytes: number }, wheel: { type: string; bytes: number } | null, createdBy: string) {
  await ensureVehiclesTable(env)
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO maplestreet_vehicles (id, name, spec, model_type, model_bytes, wheel_type, wheel_bytes, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(id, name, JSON.stringify(spec), model.type, model.bytes, wheel?.type ?? null, wheel?.bytes ?? null, createdBy, now, now)
    .run()
}

export async function updateStoreVehicle(env: Env, id: string, changes: { active?: boolean; name?: string; spec?: CustomVehicleSpec }) {
  await ensureVehiclesTable(env)
  const sets: string[] = []
  const values: unknown[] = []
  if (changes.active !== undefined) { sets.push('active = ?'); values.push(changes.active ? 1 : 0) }
  if (changes.name !== undefined) { sets.push('name = ?'); values.push(changes.name) }
  if (changes.spec !== undefined) { sets.push('spec = ?'); values.push(JSON.stringify(changes.spec)) }
  if (!sets.length) return 0
  sets.push('updated_at = ?')
  values.push(Date.now(), id)
  const result = await env.DB.prepare(`UPDATE maplestreet_vehicles SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run()
  return result.meta.changes
}
