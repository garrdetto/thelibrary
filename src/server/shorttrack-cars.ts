import { z } from 'zod'
import { CAR_BRAND_PATTERN, CAR_LIMITS, type CustomCarRecord, type CustomCarSpec } from '../../modules-src/shorttrack/shared/CustomCars'
import type { Env } from './env'
import { getAsset, insertAsset, listAssets, updateAsset, type AssetFiles, type AssetRow, type AssetStatus } from './maplestreet-assets'

export const CAR_MODEL_KEY = (id: string) => `shorttrack-car/${id}`
/** The version keeps the immutable cache honest when the admin saves a new model over a car. */
export const carModelUrl = (id: string, version = 1) => `/api/shorttrack-cars?model=${id}&v=${version}`

const n = (min: number, max: number) => z.number().finite().min(min).max(max)
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const plainText = (max: number) => z.string().trim().max(max).regex(/^[\p{L}\p{N} .,'&()+#/-]*$/u, 'Use letters, numbers and simple punctuation.')
const noBrand = (value: string) => !CAR_BRAND_PATTERN.test(value)
const BRAND_MESSAGE = 'Cars are original designs: leave real makes, models and racing series out.'

export const carNameSchema = plainText(CAR_LIMITS.nameMax).min(CAR_LIMITS.nameMin).refine(noBrand, BRAND_MESSAGE)

const axleSchema = z.object({
  x: n(-4, 4),
  radius: n(CAR_LIMITS.wheelRadiusMin, CAR_LIMITS.wheelRadiusMax),
  width: n(0.1, 0.8),
  halfTrack: n(0.4, 1.3),
}).strict()

export const carSpecSchema = z.object({
  blurb: plainText(CAR_LIMITS.blurbMax).refine(noBrand, BRAND_MESSAGE),
  model: z.object({ scale: n(0.0001, 10000), yaw: n(-360, 360), x: n(-50, 50), y: n(-50, 50), z: n(-50, 50) }).strict(),
  axles: z.tuple([axleSchema, axleSchema]).refine(([front, rear]) => front.x > rear.x + 1, 'The front axle must sit at least a metre ahead of the rear axle.'),
  wheelsRemoved: z.boolean(),
  paint: z.object({ mode: z.enum(['none', 'material', 'color']), material: z.string().max(120), key: hex, tolerance: n(0.01, 1), color: hex }).strict(),
  numbers: z.object({
    door: z.object({ x: n(-4, 4), y: n(0, 2.5), h: n(0.05, 0.8) }).strict().nullable(),
    roof: z.object({ x: n(-4, 4), h: n(0.05, 0.8) }).strict().nullable(),
    tail: z.object({ y: n(0, 2.5), h: n(0.05, 0.5) }).strict().nullable(),
  }).strict(),
  lights: z.object({ tail: z.object({ x: n(-4, 4), y: n(0, 2.5), z: n(0, 1.5) }).strict().nullable() }).strict(),
}).strict()

function toRecord(asset: AssetRow): CustomCarRecord | null {
  const parsed = carSpecSchema.safeParse(asset.spec)
  if (!parsed.success) return null
  return {
    ...(parsed.data as CustomCarSpec),
    id: asset.id,
    name: asset.name,
    modelUrl: carModelUrl(asset.id, asset.version),
    status: asset.status,
    active: asset.status !== 'retired',
    updatedAt: asset.updatedAt,
  }
}

const present = (record: CustomCarRecord | null): record is CustomCarRecord => record !== null

export async function listCars(env: Env, options: { drafts?: boolean } = {}): Promise<CustomCarRecord[]> {
  return (await listAssets(env, 'stcar', options)).map(toRecord).filter(present)
}

export async function getCar(env: Env, id: string): Promise<CustomCarRecord | null> {
  const asset = await getAsset(env, 'stcar', id)
  return asset ? toRecord(asset) : null
}

const modelFile = (id: string, model: { type: string; bytes: number }): AssetFiles => ({ model: { key: CAR_MODEL_KEY(id), type: model.type, bytes: model.bytes } })

export async function insertCar(env: Env, input: { id: string; name: string; spec: CustomCarSpec; model: { type: string; bytes: number }; status: AssetStatus; createdBy: string }) {
  await insertAsset(env, { id: input.id, kind: 'stcar', name: input.name, status: input.status, spec: input.spec, files: modelFile(input.id, input.model), createdBy: input.createdBy })
}

/** Saves a new model, name, spec and status over an existing car, or just changes some of them. */
export async function updateCar(env: Env, id: string, changes: { name?: string; spec?: CustomCarSpec; status?: AssetStatus; model?: { type: string; bytes: number } }) {
  return updateAsset(env, 'stcar', id, { name: changes.name, spec: changes.spec, status: changes.status, files: changes.model ? modelFile(id, changes.model) : undefined })
}
