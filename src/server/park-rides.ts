import { z } from 'zod'
import { CUSTOM_PIECE_AXES, CUSTOM_PIECE_HANGS, CUSTOM_PIECE_MOTIONS, CUSTOM_PIECE_SPLITS, CUSTOM_RIDE_CATEGORIES, CUSTOM_RIDE_LIMITS as L, CUSTOM_RIDE_MOTIONS } from '../../server/park/index.mjs'
import type { Env } from './env'
import { parseStored } from './http'
import { PARK_RIDE_STATUSES } from '../lib/park-rides'
import type { ParkRideCatalogEntry, ParkRideRecord, ParkRideSpec, ParkRideStatus } from '../lib/park-rides'

export const RIDE_MESH_KEY = (id: string) => `park-ride/${id}/mesh`
export const RIDE_THUMB_KEY = (id: string) => `park-ride/${id}/thumb`
export const RIDE_SOURCE_KEY = (id: string) => `park-ride/${id}/source`
export const rideIdSchema = z.string().regex(/^cr_[a-f0-9]{10}$/)
export const rideStatusSchema = z.enum(PARK_RIDE_STATUSES)

const stat = z.number().min(0).max(L.statMax)
const pieceSchema = z.object({
  type: z.enum(CUSTOM_PIECE_MOTIONS as ['spin', 'swing', 'wobble', 'flip', 'bob', 'level']),
  speed: z.number().min(L.speedMin).max(L.speedMax),
  amount: z.number().min(0).max(1),
  from: z.number().min(0).max(L.heightMax),
  to: z.number().min(0).max(L.heightMax),
  inner: z.number().min(0).max(L.reachMax),
  outer: z.number().min(0).max(L.reachMax),
  split: z.enum(CUSTOM_PIECE_SPLITS as ['pieces', 'sectors']),
  count: z.number().int().min(1).max(L.pieceCountMax),
  hang: z.enum(CUSTOM_PIECE_HANGS as ['top', 'centre', 'bottom']),
  axis: z.enum(CUSTOM_PIECE_AXES as ['radial', 'tangent', 'x', 'y']),
  stagger: z.number().min(0).max(1),
  alternate: z.boolean(),
  on: z.number().int().min(-2).max(L.piecesMax - 1),
}).strict()
export const rideSpecSchema = z.object({
  name: z.string().trim().min(L.nameMin).max(L.nameMax).regex(/^[\p{L}\p{N} .,'&!?()+#/-]+$/u, 'Use letters, numbers and simple punctuation in the name.'),
  description: z.string().trim().max(L.descriptionMax).default(''),
  category: z.enum(CUSTOM_RIDE_CATEGORIES as ['gentle', 'thrill', 'water', 'other']),
  size: z.tuple([z.number().int().min(L.sizeMin).max(L.sizeMax), z.number().int().min(L.sizeMin).max(L.sizeMax)]),
  height: z.number().min(L.heightMin).max(L.heightMax),
  cost: z.number().int().min(L.costMin).max(L.costMax),
  upkeep: z.number().int().min(0).max(L.upkeepMax),
  capacity: z.number().int().min(L.capacityMin).max(L.capacityMax),
  rideTime: z.number().int().min(L.rideTimeMin).max(L.rideTimeMax),
  loadTime: z.number().int().min(L.loadTimeMin).max(L.loadTimeMax),
  price: z.number().min(0).max(L.priceMax),
  stats: z.object({ e: stat, i: stat, n: stat }).strict(),
  motion: z.object({
    type: z.enum(CUSTOM_RIDE_MOTIONS as ['none', 'spin', 'swing', 'wheel', 'drop', 'bob']),
    speed: z.number().min(L.speedMin).max(L.speedMax),
    amount: z.number().min(0).max(1),
    axis: z.enum(['x', 'y']),
    split: z.number().min(0).max(L.heightMax),
    pivot: z.tuple([z.number().min(-30).max(30), z.number().min(-30).max(30), z.number().min(0).max(L.heightMax)]),
    pieces: z.array(pieceSchema).max(L.piecesMax).default([]),
  }).strict().refine(motion => motion.pieces.every((piece, index) => piece.on < index && piece.to >= piece.from && piece.outer >= piece.inner), 'Each moving piece can only ride on a piece listed before it.'),
  bake: z.object({ scale: z.number().min(0.001).max(1000), yaw: z.number().int().min(0).max(3), triangles: z.number().int().min(L.trianglesMin).max(L.trianglesMax) }).strict(),
}).strict()

type Row = { id: string; name: string; status: string; spec: string; mesh_version: number; mesh_bytes: number; has_thumb: number; has_source: number; source_job: string | null; created_at: number; updated_at: number }

const TABLE = `CREATE TABLE IF NOT EXISTS park_custom_rides (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, spec TEXT NOT NULL,
  mesh_version INTEGER NOT NULL DEFAULT 0, mesh_bytes INTEGER NOT NULL DEFAULT 0, has_thumb INTEGER NOT NULL DEFAULT 0, has_source INTEGER NOT NULL DEFAULT 0,
  source_job TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
const INDEX = 'CREATE INDEX IF NOT EXISTS park_custom_rides_status_idx ON park_custom_rides (status, created_at)'
const COLUMNS = 'id, name, status, spec, mesh_version, mesh_bytes, has_thumb, has_source, source_job, created_at, updated_at'

let ready: Promise<unknown> | null = null
export function ensureRideTable(env: Env) {
  ready ??= env.DB.batch([env.DB.prepare(TABLE), env.DB.prepare(INDEX)]).catch(error => { ready = null; throw error })
  return ready
}

export function newRideId() {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return `cr_${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`
}

function toRecord(row: Row): ParkRideRecord | null {
  const spec = rideSpecSchema.safeParse(parseStored<unknown>(row.spec, null))
  if (!spec.success) return null
  return {
    id: row.id, status: rideStatusSchema.catch('draft').parse(row.status), spec: spec.data as ParkRideSpec,
    meshVersion: row.mesh_version, meshBytes: row.mesh_bytes, thumb: row.has_thumb === 1, source: row.has_source === 1, sourceJob: row.source_job,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function toCatalogEntry(record: ParkRideRecord): ParkRideCatalogEntry {
  const { bake: _bake, ...spec } = record.spec
  return { id: record.id, ...spec, meshVersion: record.meshVersion, thumb: record.thumb, active: record.status === 'published' }
}

export async function listRides(env: Env, drafts: boolean) {
  await ensureRideTable(env)
  const where = drafts ? '' : `WHERE status IN ('published', 'retired') AND mesh_version > 0`
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM park_custom_rides ${where} ORDER BY created_at ASC LIMIT 500`).all<Row>()
  return results.map(toRecord).filter((r): r is ParkRideRecord => r !== null)
}

export async function getRide(env: Env, id: string) {
  await ensureRideTable(env)
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM park_custom_rides WHERE id = ?`).bind(id).first<Row>()
  return row ? toRecord(row) : null
}

export async function insertRide(env: Env, input: { id: string; spec: ParkRideSpec; status: ParkRideStatus; meshBytes: number; thumb: boolean; source: boolean; sourceJob: string | null; createdBy: string }) {
  await ensureRideTable(env)
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO park_custom_rides (${COLUMNS}, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, input.spec.name, input.status, JSON.stringify(input.spec), input.meshBytes ? 1 : 0, input.meshBytes, input.thumb ? 1 : 0, input.source ? 1 : 0, input.sourceJob, now, now, input.createdBy).run()
}

export async function updateRide(env: Env, id: string, patch: { spec?: ParkRideSpec; status?: ParkRideStatus; meshBytes?: number; thumb?: boolean; source?: boolean; sourceJob?: string | null }) {
  await ensureRideTable(env)
  const sets: string[] = ['updated_at = ?'], values: unknown[] = [Date.now()]
  if (patch.spec) { sets.push('spec = ?', 'name = ?'); values.push(JSON.stringify(patch.spec), patch.spec.name) }
  if (patch.status) { sets.push('status = ?'); values.push(patch.status) }
  if (patch.meshBytes !== undefined) { sets.push('mesh_version = mesh_version + 1', 'mesh_bytes = ?'); values.push(patch.meshBytes) }
  if (patch.thumb) sets.push('has_thumb = 1')
  if (patch.source) sets.push('has_source = 1')
  if (patch.sourceJob !== undefined) { sets.push('source_job = ?'); values.push(patch.sourceJob) }
  const result = await env.DB.prepare(`UPDATE park_custom_rides SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run()
  return result.meta.changes > 0
}

export async function deleteRideRow(env: Env, id: string) {
  await ensureRideTable(env)
  await env.DB.prepare('DELETE FROM park_custom_rides WHERE id = ?').bind(id).run()
}
