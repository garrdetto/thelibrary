import { z } from 'zod'
import { BUNDLED_VEHICLES } from '../../modules-src/maplestreet/shared/BundledVehicles'
import { BRAND_PATTERN, DRIVE_TEMPLATES, MAX_DOOR_ROWS, TRAFFIC_COUNT_MAX, TRAFFIC_ROUTES, VEHICLE_LIMITS, type CustomVehicleRecord, type CustomVehicleSpec } from '../../modules-src/maplestreet/shared/CustomVehicles'
import { isValidShape, LAMP_SIZE_LIMITS, SHAPE_LIMITS } from '../../modules-src/maplestreet/shared/Shapes'
import type { Env } from './env'
import { getAsset, insertAsset, listAssets, statusFrom, updateAsset, type AssetFiles, type AssetRow, type AssetStatus } from './maplestreet-assets'

export const VEHICLE_MODEL_KEY = (id: string) => `maplestreet-vehicle/${id}`
export const VEHICLE_WHEEL_KEY = (id: string) => `maplestreet-vehicle/${id}/wheel`
/** The version keeps the immutable cache honest when the admin saves a new model over a vehicle. */
export const vehicleModelUrl = (id: string, version = 1) => `/api/maplestreet-vehicles?model=${id}&v=${version}`
export const vehicleWheelUrl = (id: string, version = 1) => `/api/maplestreet-vehicles?wheel=${id}&v=${version}`
export const BUNDLED_ID_PATTERN = /^bundled-[a-z0-9-]{1,60}$/

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

const shapeSchema = z.array(z.object({ u: n(0, 1), v: n(0, 1) }).strict()).min(SHAPE_LIMITS.minPoints).max(SHAPE_LIMITS.maxPoints).refine(isValidShape, 'That outline is too small or not a closed shape.')

const lampSize = z.object({ w: n(LAMP_SIZE_LIMITS.min, LAMP_SIZE_LIMITS.max), h: n(LAMP_SIZE_LIMITS.min, LAMP_SIZE_LIMITS.max) }).strict()

const partBox = z.object({ front: n(-10, 10), back: n(-10, 10), bottom: n(-10, 10), top: n(-10, 10), drop: z.boolean().optional(), shape: shapeSchema.optional() }).strict().refine(b => b.front > b.back && b.top > b.bottom, 'A part box needs its front ahead of its back and its top above its bottom.')

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
  traffic: z.object({
    enabled: z.boolean(),
    driver: plainText(40).refine(noBrand, BRAND_MESSAGE),
    route: z.enum(TRAFFIC_ROUTES),
    mph: n(3, 60),
    count: z.number().int().min(1).max(TRAFFIC_COUNT_MAX).optional(),
    routes: z.array(z.enum(TRAFFIC_ROUTES)).max(TRAFFIC_COUNT_MAX).optional(),
    colors: z.array(hex).max(TRAFFIC_COUNT_MAX).optional(),
  }).strict(),
  wheelsRemoved: z.boolean(),
  parts: z.object({
    doors: z.array(partBox).max(MAX_DOOR_ROWS),
    hood: partBox.nullable(),
    trunk: partBox.nullable(),
  }).strict().optional(),
  lampShapes: z.object({ head: shapeSchema.optional(), tail: shapeSchema.optional(), headSize: lampSize.optional(), tailSize: lampSize.optional() }).strict().optional(),
}).strict()

export const bundledVehicle = (id: string) => BUNDLED_VEHICLES.find(vehicle => vehicle.id === id) ?? null

export function bundledSpec(vehicle: CustomVehicleRecord): CustomVehicleSpec {
  return { template: vehicle.template, model: vehicle.model, physics: vehicle.physics, lights: vehicle.lights, paint: vehicle.paint, targets: vehicle.targets, dealer: vehicle.dealer, traffic: vehicle.traffic, wheelsRemoved: vehicle.wheelsRemoved, ...(vehicle.parts ? { parts: vehicle.parts } : {}), ...(vehicle.lampShapes ? { lampShapes: vehicle.lampShapes } : {}) }
}

function toRecord(asset: AssetRow): CustomVehicleRecord | null {
  const parsed = vehicleSpecSchema.safeParse(asset.spec)
  if (!parsed.success) return null
  const bundled = bundledVehicle(asset.id)
  return {
    ...(parsed.data as CustomVehicleSpec),
    id: asset.id,
    name: asset.name,
    modelUrl: asset.files.model ? vehicleModelUrl(asset.id, asset.version) : bundled ? bundled.modelUrl : vehicleModelUrl(asset.id, asset.version),
    wheelUrl: asset.files.wheel ? vehicleWheelUrl(asset.id, asset.version) : bundled ? bundled.wheelUrl : null,
    active: asset.status !== 'retired',
    status: asset.status,
    updatedAt: asset.updatedAt,
  }
}

const present = (record: CustomVehicleRecord | null): record is CustomVehicleRecord => record !== null

export async function listStoreVehicles(env: Env, options: { drafts?: boolean } = {}): Promise<CustomVehicleRecord[]> {
  return (await listAssets(env, 'vehicle', options)).map(toRecord).filter(present)
}

export async function getStoreVehicle(env: Env, id: string): Promise<CustomVehicleRecord | null> {
  const asset = await getAsset(env, 'vehicle', id)
  return asset ? toRecord(asset) : null
}

export async function insertStoreVehicle(env: Env, id: string, name: string, spec: CustomVehicleSpec, model: { type: string; bytes: number }, wheel: { type: string; bytes: number } | null, createdBy: string, status: AssetStatus = 'published') {
  const files: AssetFiles = { model: { key: VEHICLE_MODEL_KEY(id), type: model.type, bytes: model.bytes } }
  if (wheel) files.wheel = { key: VEHICLE_WHEEL_KEY(id), type: wheel.type, bytes: wheel.bytes }
  await insertAsset(env, { id, kind: 'vehicle', name, status, spec, files, createdBy })
}

export async function ensureBundledOverride(env: Env, id: string, createdBy: string) {
  const bundled = bundledVehicle(id)
  if (!bundled || await getAsset(env, 'vehicle', id)) return
  await insertAsset(env, { id, kind: 'vehicle', name: bundled.name, status: 'published', spec: bundledSpec(bundled), files: {}, createdBy })
}

export async function updateStoreVehicle(env: Env, id: string, changes: { active?: boolean; status?: AssetStatus; name?: string; spec?: CustomVehicleSpec }) {
  return updateAsset(env, 'vehicle', id, { name: changes.name, status: statusFrom(changes), spec: changes.spec })
}

/** Saves a new model (and optionally a new wheel) over an existing vehicle along with its name, spec and status. */
export async function replaceStoreVehicle(env: Env, id: string, name: string, spec: CustomVehicleSpec, model: { type: string; bytes: number }, wheel: { type: string; bytes: number } | null, status: AssetStatus) {
  const asset = await getAsset(env, 'vehicle', id)
  if (!asset) return 0
  const files: AssetFiles = { ...asset.files, model: { key: VEHICLE_MODEL_KEY(id), type: model.type, bytes: model.bytes } }
  if (wheel) files.wheel = { key: VEHICLE_WHEEL_KEY(id), type: wheel.type, bytes: wheel.bytes }
  return updateAsset(env, 'vehicle', id, { name, spec, status, files })
}
