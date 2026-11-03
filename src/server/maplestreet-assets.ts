import { z } from 'zod'
import { ASSET_STATUSES, type AssetStatus } from '../../modules-src/maplestreet/shared/Assets'
import type { Env } from './env'

export const ASSET_KINDS = ['item', 'vehicle', 'garment', 'accessory', 'prop', 'building'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]
export { ASSET_STATUSES }
export type { AssetStatus }
export const assetStatusSchema = z.enum(ASSET_STATUSES)

export type AssetFile = { key: string; type: string; bytes: number }
export type AssetFiles = Record<string, AssetFile>

export type AssetRow = {
  id: string
  kind: AssetKind
  name: string
  status: AssetStatus
  spec: unknown
  files: AssetFiles
  version: number
  createdAt: number
  updatedAt: number
}

const TABLE = `CREATE TABLE IF NOT EXISTS maplestreet_assets (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
  spec TEXT NOT NULL, files TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
const INDEX = 'CREATE INDEX IF NOT EXISTS maplestreet_assets_kind_idx ON maplestreet_assets (kind, created_at)'

const LEGACY_ITEMS = `CREATE TABLE IF NOT EXISTS maplestreet_items (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, room TEXT NOT NULL, func TEXT NOT NULL,
  indoor INTEGER NOT NULL, solid INTEGER NOT NULL, scale_x REAL NOT NULL, scale_y REAL NOT NULL, scale_z REAL NOT NULL, yaw INTEGER NOT NULL, width INTEGER NOT NULL,
  depth INTEGER NOT NULL, height REAL NOT NULL, model_type TEXT NOT NULL, model_bytes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
const LEGACY_VEHICLES = `CREATE TABLE IF NOT EXISTS maplestreet_vehicles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL, model_type TEXT NOT NULL,
  model_bytes INTEGER NOT NULL, wheel_type TEXT, wheel_bytes INTEGER, active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

export const COPY_LEGACY_ITEMS = `INSERT OR IGNORE INTO maplestreet_assets (id, kind, name, status, spec, files, version, created_by, created_at, updated_at)
  SELECT id, 'item', name, CASE active WHEN 1 THEN 'published' ELSE 'retired' END,
    json_object('price', price, 'room', room, 'func', func, 'indoor', json(CASE indoor WHEN 1 THEN 'true' ELSE 'false' END),
      'solid', json(CASE solid WHEN 1 THEN 'true' ELSE 'false' END), 'scale', json_object('x', scale_x, 'y', scale_y, 'z', scale_z),
      'yaw', yaw, 'w', width, 'd', depth, 'h', height),
    json_object('model', json_object('key', 'maplestreet-item/' || id, 'type', model_type, 'bytes', model_bytes)),
    1, created_by, created_at, updated_at
  FROM maplestreet_items`
export const COPY_LEGACY_VEHICLES = `INSERT OR IGNORE INTO maplestreet_assets (id, kind, name, status, spec, files, version, created_by, created_at, updated_at)
  SELECT id, 'vehicle', name, CASE active WHEN 1 THEN 'published' ELSE 'retired' END, spec,
    CASE WHEN wheel_type IS NULL
      THEN json_object('model', json_object('key', 'maplestreet-vehicle/' || id, 'type', model_type, 'bytes', model_bytes))
      ELSE json_object('model', json_object('key', 'maplestreet-vehicle/' || id, 'type', model_type, 'bytes', model_bytes),
        'wheel', json_object('key', 'maplestreet-vehicle/' || id || '/wheel', 'type', wheel_type, 'bytes', wheel_bytes))
    END,
    1, created_by, created_at, updated_at
  FROM maplestreet_vehicles`

let tableReady: Promise<unknown> | null = null

/**
 * Creates the shared asset table on first use and copies anything published
 * through the older per-kind tables into it. The copy is INSERT OR IGNORE, so
 * running it again never duplicates or overwrites a record.
 */
export function ensureAssetsTable(env: Env) {
  tableReady ??= (async () => {
    await env.DB.batch([env.DB.prepare(TABLE), env.DB.prepare(INDEX), env.DB.prepare(LEGACY_ITEMS), env.DB.prepare(LEGACY_VEHICLES)])
    await env.DB.batch([env.DB.prepare(COPY_LEGACY_ITEMS), env.DB.prepare(COPY_LEGACY_VEHICLES)])
  })().catch(error => { tableReady = null; throw error })
  return tableReady
}

type Row = { id: string; kind: string; name: string; status: string; spec: string; files: string; version: number; created_at: number; updated_at: number }
const COLUMNS = 'id, kind, name, status, spec, files, version, created_at, updated_at'

function parse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

function toAsset(row: Row): AssetRow | null {
  if (!(ASSET_KINDS as readonly string[]).includes(row.kind) || !(ASSET_STATUSES as readonly string[]).includes(row.status)) return null
  return {
    id: row.id,
    kind: row.kind as AssetKind,
    name: row.name,
    status: row.status as AssetStatus,
    spec: parse<unknown>(row.spec, null),
    files: parse<AssetFiles>(row.files, {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAssets(env: Env, kind: AssetKind, options: { drafts?: boolean } = {}): Promise<AssetRow[]> {
  await ensureAssetsTable(env)
  const filter = options.drafts ? '' : " AND status != 'draft'"
  const rows = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_assets WHERE kind = ?${filter} ORDER BY created_at ASC, id ASC`).bind(kind).all<Row>()
  return rows.results.map(toAsset).filter((asset): asset is AssetRow => asset !== null)
}

export async function getAsset(env: Env, kind: AssetKind, id: string): Promise<AssetRow | null> {
  await ensureAssetsTable(env)
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM maplestreet_assets WHERE id = ? AND kind = ?`).bind(id, kind).first<Row>()
  return row ? toAsset(row) : null
}

export async function insertAsset(env: Env, input: { id: string; kind: AssetKind; name: string; status: AssetStatus; spec: unknown; files: AssetFiles; createdBy: string }) {
  await ensureAssetsTable(env)
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO maplestreet_assets (id, kind, name, status, spec, files, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(input.id, input.kind, input.name, input.status, JSON.stringify(input.spec), JSON.stringify(input.files), input.createdBy, now, now)
    .run()
}

export async function updateAsset(env: Env, kind: AssetKind, id: string, changes: { name?: string; status?: AssetStatus; spec?: unknown }) {
  await ensureAssetsTable(env)
  const sets: string[] = []
  const values: unknown[] = []
  if (changes.name !== undefined) { sets.push('name = ?'); values.push(changes.name) }
  if (changes.status !== undefined) { sets.push('status = ?'); values.push(changes.status) }
  if (changes.spec !== undefined) { sets.push('spec = ?'); values.push(JSON.stringify(changes.spec)) }
  if (!sets.length) return 0
  sets.push('version = version + 1', 'updated_at = ?')
  values.push(Date.now(), id, kind)
  const result = await env.DB.prepare(`UPDATE maplestreet_assets SET ${sets.join(', ')} WHERE id = ? AND kind = ?`).bind(...values).run()
  return result.meta.changes
}

/** Maps the editors' older `active` flag onto a status, so both kinds of request keep working. */
export function statusFrom(changes: { active?: boolean; status?: AssetStatus }): AssetStatus | undefined {
  if (changes.status) return changes.status
  if (changes.active === undefined) return undefined
  return changes.active ? 'published' : 'retired'
}

/** Drafts are listed only to the administrator, and only when asked for. */
export async function wantsDrafts(request: Request, env: Env, isAdmin: (request: Request, env: Env) => Promise<boolean>) {
  if (new URL(request.url).searchParams.get('drafts') !== '1') return false
  return isAdmin(request, env)
}
