import { z } from 'zod'
import { CATALOG_FUNCS, CATALOG_ROOMS } from '../../modules-src/maplestreet/shared/Catalog'
import { CUSTOM_LIMITS, type CustomItemRecord } from '../../modules-src/maplestreet/shared/CustomItems'
import type { Env } from './env'

export const ITEM_MODEL_KEY = (id: string) => `maplestreet-item/${id}`
export const itemModelUrl = (id: string) => `/api/maplestreet-items?model=${id}`

const TABLE = `CREATE TABLE IF NOT EXISTS maplestreet_items (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, room TEXT NOT NULL, func TEXT NOT NULL,
  indoor INTEGER NOT NULL, solid INTEGER NOT NULL, scale_x REAL NOT NULL, scale_y REAL NOT NULL, scale_z REAL NOT NULL, yaw INTEGER NOT NULL, width INTEGER NOT NULL,
  depth INTEGER NOT NULL, height REAL NOT NULL, model_type TEXT NOT NULL, model_bytes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

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

type ItemRow = {
  id: string
  name: string
  price: number
  room: string
  func: string
  indoor: number
  solid: number
  scale_x: number
  scale_y: number
  scale_z: number
  yaw: number
  width: number
  depth: number
  height: number
  active: number
  updated_at: number
}

let tableReady: Promise<unknown> | null = null
export function ensureItemsTable(env: Env) {
  tableReady ??= env.DB.prepare(TABLE).run().catch(error => { tableReady = null; throw error })
  return tableReady
}

function toRecord(row: ItemRow): CustomItemRecord {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    room: row.room as CustomItemRecord['room'],
    func: row.func as CustomItemRecord['func'],
    indoor: row.indoor === 1,
    solid: row.solid === 1,
    scale: { x: row.scale_x, y: row.scale_y, z: row.scale_z },
    yaw: row.yaw,
    w: row.width,
    d: row.depth,
    h: row.height,
    modelUrl: itemModelUrl(row.id),
    active: row.active === 1,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = 'id, name, price, room, func, indoor, solid, scale_x, scale_y, scale_z, yaw, width, depth, height, active, updated_at'

export async function listStoreItems(env: Env): Promise<CustomItemRecord[]> {
  await ensureItemsTable(env)
  const rows = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_items ORDER BY created_at ASC, id ASC`).all<ItemRow>()
  return rows.results.map(toRecord)
}

export async function getStoreItem(env: Env, id: string): Promise<CustomItemRecord | null> {
  await ensureItemsTable(env)
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_items WHERE id = ?`).bind(id).first<ItemRow>()
  return row ? toRecord(row) : null
}

export async function insertStoreItem(env: Env, id: string, input: StoreItemInput, model: { type: string; bytes: number }, createdBy: string) {
  await ensureItemsTable(env)
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO maplestreet_items (id, name, price, room, func, indoor, solid, scale_x, scale_y, scale_z, yaw, width, depth, height, model_type, model_bytes, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(id, input.name, input.price, input.room, input.func, input.indoor ? 1 : 0, input.solid ? 1 : 0, input.scale.x, input.scale.y, input.scale.z, input.yaw, input.w, input.d, input.h, model.type, model.bytes, createdBy, now, now)
    .run()
}

export async function updateStoreItem(env: Env, id: string, changes: { active?: boolean; name?: string; price?: number }) {
  await ensureItemsTable(env)
  const sets: string[] = []
  const values: unknown[] = []
  if (changes.active !== undefined) { sets.push('active = ?'); values.push(changes.active ? 1 : 0) }
  if (changes.name !== undefined) { sets.push('name = ?'); values.push(changes.name) }
  if (changes.price !== undefined) { sets.push('price = ?'); values.push(changes.price) }
  if (!sets.length) return 0
  sets.push('updated_at = ?')
  values.push(Date.now(), id)
  const result = await env.DB.prepare(`UPDATE maplestreet_items SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run()
  return result.meta.changes
}
