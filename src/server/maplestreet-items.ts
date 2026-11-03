import { z } from 'zod'
import { CATALOG_FUNCS, CATALOG_ROOMS } from '../../modules-src/maplestreet/shared/Catalog'
import { CUSTOM_LIMITS, type CustomItemRecord } from '../../modules-src/maplestreet/shared/CustomItems'
import type { Env } from './env'
import { getAsset, insertAsset, listAssets, statusFrom, updateAsset, type AssetRow, type AssetStatus } from './maplestreet-assets'

export const ITEM_MODEL_KEY = (id: string) => `maplestreet-item/${id}`
export const itemModelUrl = (id: string) => `/api/maplestreet-items?model=${id}`

const scaleComponent = z.number().finite().min(CUSTOM_LIMITS.scaleMin).max(CUSTOM_LIMITS.scaleMax)

export const storeItemSchema = z.object({
  name: z.string().trim().min(CUSTOM_LIMITS.nameMin).max(CUSTOM_LIMITS.nameMax).regex(/^[\p{L}\p{N} .,'&()+#/-]+$/u, 'Use letters, numbers and simple punctuation in the name.'),
  price: z.coerce.number().int().min(CUSTOM_LIMITS.priceMin).max(CUSTOM_LIMITS.priceMax),
  scale: z.object({ x: scaleComponent, y: scaleComponent, z: scaleComponent }).strict(),
  room: z.enum(CATALOG_ROOMS),
  func: z.enum(CATALOG_FUNCS),
  indoor: z.boolean(),
  solid: z.boolean(),
  yaw: z.number().int().min(0).max(3),
  w: z.number().int().min(1).max(CUSTOM_LIMITS.footprintMax),
  d: z.number().int().min(1).max(CUSTOM_LIMITS.footprintMax),
  h: z.number().finite().min(0).max(CUSTOM_LIMITS.heightMax),
}).strict()

export type StoreItemInput = z.infer<typeof storeItemSchema>

export const itemSpecSchema = storeItemSchema.omit({ name: true })
type ItemSpec = z.infer<typeof itemSpecSchema>

function toRecord(asset: AssetRow): CustomItemRecord | null {
  const parsed = itemSpecSchema.safeParse(asset.spec)
  if (!parsed.success) return null
  const spec: ItemSpec = parsed.data
  return {
    id: asset.id,
    name: asset.name,
    price: spec.price,
    room: spec.room,
    func: spec.func,
    indoor: spec.indoor,
    solid: spec.solid,
    scale: { ...spec.scale },
    yaw: spec.yaw,
    w: spec.w,
    d: spec.d,
    h: spec.h,
    modelUrl: itemModelUrl(asset.id),
    active: asset.status !== 'retired',
    status: asset.status,
    updatedAt: asset.updatedAt,
  }
}

const present = (record: CustomItemRecord | null): record is CustomItemRecord => record !== null

export async function listStoreItems(env: Env, options: { drafts?: boolean } = {}): Promise<CustomItemRecord[]> {
  return (await listAssets(env, 'item', options)).map(toRecord).filter(present)
}

export async function getStoreItem(env: Env, id: string): Promise<CustomItemRecord | null> {
  const asset = await getAsset(env, 'item', id)
  return asset ? toRecord(asset) : null
}

export async function insertStoreItem(env: Env, id: string, input: StoreItemInput, model: { type: string; bytes: number }, createdBy: string, status: AssetStatus = 'published') {
  const { name, ...spec } = input
  await insertAsset(env, { id, kind: 'item', name, status, spec, files: { model: { key: ITEM_MODEL_KEY(id), type: model.type, bytes: model.bytes } }, createdBy })
}

export async function updateStoreItem(env: Env, id: string, changes: { active?: boolean; status?: AssetStatus; name?: string; price?: number }) {
  let spec: ItemSpec | undefined
  if (changes.price !== undefined) {
    const current = await getAsset(env, 'item', id)
    const parsed = current ? itemSpecSchema.safeParse(current.spec) : null
    if (!parsed?.success) return 0
    spec = { ...parsed.data, price: changes.price }
  }
  return updateAsset(env, 'item', id, { name: changes.name, status: statusFrom(changes), spec })
}
