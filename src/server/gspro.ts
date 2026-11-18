import { z } from 'zod'
import type { Env } from './env.js'
import { normalizeClub } from '../lib/gspro/clubs.js'
import type { BridgeStatus, GsproSession, GsproShot, ShotInput, ShotSource } from '../lib/gspro/types.js'

const MPS_TO_MPH = 2.23694
const METRE_TO_YARD = 1.09361
export const SESSION_GAP_MS = 30 * 60_000

const schema = [
  `CREATE TABLE IF NOT EXISTS gspro_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, source TEXT NOT NULL, started_at INTEGER NOT NULL, last_shot_at INTEGER NOT NULL, shot_count INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS gspro_sessions_user_idx ON gspro_sessions (user_id, last_shot_at)`,
  `CREATE TABLE IF NOT EXISTS gspro_shots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, session_id TEXT NOT NULL, shot_ref TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, source TEXT NOT NULL, club TEXT, handed TEXT NOT NULL DEFAULT 'RH', ball_speed REAL NOT NULL, launch REAL NOT NULL, direction REAL NOT NULL, total_spin REAL NOT NULL, spin_axis REAL NOT NULL, carry REAL, club_speed REAL, attack_angle REAL, path REAL, face REAL, dynamic_loft REAL, lie REAL, impact_h REAL, impact_v REAL, excluded INTEGER NOT NULL DEFAULT 0, raw TEXT)`,
  `CREATE INDEX IF NOT EXISTS gspro_shots_user_idx ON gspro_shots (user_id, id)`,
  `CREATE INDEX IF NOT EXISTS gspro_shots_session_idx ON gspro_shots (session_id, id)`,
  `CREATE TABLE IF NOT EXISTS gspro_bridge (user_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, key_hint TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER, status TEXT)`,
]

let ready: Promise<void> | null = null

export function ensureGsproTables(env: Env) {
  ready ??= env.DB.batch(schema.map(sql => env.DB.prepare(sql))).then(() => undefined).catch(error => { ready = null; throw error })
  return ready
}

const finite = z.number().finite()
const optionalNumber = finite.nullable().optional().transform(value => value ?? null)

export const shotInputSchema = z.object({
  ref: z.string().min(1).max(80),
  at: z.number().int().positive(),
  club: z.string().max(12).nullable().optional().transform(value => normalizeClub(value ?? null)),
  handed: z.enum(['RH', 'LH']).default('RH'),
  ballSpeed: finite.min(1).max(250),
  launch: finite.min(-30).max(90),
  direction: finite.min(-90).max(90),
  totalSpin: finite.min(0).max(20000),
  spinAxis: finite.min(-90).max(90),
  carry: optionalNumber,
  clubSpeed: optionalNumber,
  attackAngle: optionalNumber,
  path: optionalNumber,
  face: optionalNumber,
  dynamicLoft: optionalNumber,
  lie: optionalNumber,
  impactH: optionalNumber,
  impactV: optionalNumber,
})

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null

/**
 * GSPro Open Connect v1 shot JSON (`BallData`, `ClubData`, `Units`) to a stored shot. Speeds are mph and distances yards
 * unless `Units` is "Meters" (then m/s and metres). Spin comes from TotalSpin/SpinAxis or from BackSpin/SideSpin.
 */
export function shotFromOpenConnect(payload: Record<string, unknown>, extra: { ref: string; at: number; club: string | null; handed: 'RH' | 'LH' }): ShotInput | null {
  const ball = (payload.BallData ?? {}) as Record<string, unknown>
  const club = (payload.ClubData ?? {}) as Record<string, unknown>
  const metric = typeof payload.Units === 'string' && /met/i.test(payload.Units)
  const speed = (value: unknown) => { const n = num(value); return n === null ? null : metric ? n * MPS_TO_MPH : n }
  const ballSpeed = speed(ball.Speed)
  const launch = num(ball.VLA)
  if (ballSpeed === null || ballSpeed <= 0 || launch === null) return null
  const back = num(ball.BackSpin)
  const side = num(ball.SideSpin)
  let totalSpin = num(ball.TotalSpin)
  let spinAxis = num(ball.SpinAxis)
  if ((totalSpin === null || totalSpin === 0) && back !== null) totalSpin = Math.hypot(back, side ?? 0)
  if (spinAxis === null && back !== null && side !== null && (back !== 0 || side !== 0)) spinAxis = (Math.atan2(side, back) * 180) / Math.PI
  const carryRaw = num(ball.CarryDistance)
  const clubSpeed = speed(club.Speed)
  const parsed = shotInputSchema.safeParse({
    ref: extra.ref,
    at: extra.at,
    club: extra.club,
    handed: extra.handed,
    ballSpeed,
    launch,
    direction: num(ball.HLA) ?? 0,
    totalSpin: totalSpin ?? 0,
    spinAxis: spinAxis ?? 0,
    carry: carryRaw !== null && carryRaw > 0 ? (metric ? carryRaw * METRE_TO_YARD : carryRaw) : null,
    clubSpeed: clubSpeed !== null && clubSpeed > 0 ? clubSpeed : null,
    attackAngle: num(club.AngleOfAttack),
    path: num(club.Path),
    face: num(club.FaceToTarget),
    dynamicLoft: num(club.Loft),
    lie: num(club.Lie),
    impactH: num(club.HorizontalFaceImpact),
    impactV: num(club.VerticalFaceImpact),
  })
  return parsed.success ? parsed.data : null
}

type ShotRow = {
  id: number; session_id: string; created_at: number; source: string; club: string | null; handed: string
  ball_speed: number; launch: number; direction: number; total_spin: number; spin_axis: number; carry: number | null
  club_speed: number | null; attack_angle: number | null; path: number | null; face: number | null; dynamic_loft: number | null
  lie: number | null; impact_h: number | null; impact_v: number | null; excluded: number
}

export const shotColumns = 'id, session_id, created_at, source, club, handed, ball_speed, launch, direction, total_spin, spin_axis, carry, club_speed, attack_angle, path, face, dynamic_loft, lie, impact_h, impact_v, excluded'

export function toShot(row: ShotRow): GsproShot {
  return {
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    source: row.source as ShotSource,
    club: row.club,
    handed: row.handed === 'LH' ? 'LH' : 'RH',
    ballSpeed: row.ball_speed,
    launch: row.launch,
    direction: row.direction,
    totalSpin: row.total_spin,
    spinAxis: row.spin_axis,
    carry: row.carry,
    clubSpeed: row.club_speed,
    attackAngle: row.attack_angle,
    path: row.path,
    face: row.face,
    dynamicLoft: row.dynamic_loft,
    lie: row.lie,
    impactH: row.impact_h,
    impactV: row.impact_v,
    excluded: Boolean(row.excluded),
  }
}

type SessionRow = { id: string; label: string; source: string; started_at: number; last_shot_at: number; shot_count: number; closed: number }

export function toSession(row: SessionRow, now = Date.now()): GsproSession {
  return {
    id: row.id,
    label: row.label,
    source: row.source as ShotSource,
    startedAt: row.started_at,
    lastShotAt: row.last_shot_at,
    shotCount: row.shot_count,
    open: row.source === 'bridge' && !row.closed && now - row.last_shot_at < SESSION_GAP_MS,
  }
}

export function sessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `gs_${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function sessionLabel(at: number, prefix = 'Session') {
  const date = new Date(at)
  const text = date.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${prefix} · ${text}`
}

/** Inserts shots into one session (ignoring refs already stored) and refreshes that session's count and last-shot time. */
export async function insertShots(env: Env, userId: string, session: string, source: ShotSource, shots: ShotInput[], raw?: (string | null)[]) {
  if (!shots.length) return 0
  const statements = shots.map((shot, index) => env.DB.prepare(
    `INSERT OR IGNORE INTO gspro_shots (user_id, session_id, shot_ref, created_at, source, club, handed, ball_speed, launch, direction, total_spin, spin_axis, carry, club_speed, attack_angle, path, face, dynamic_loft, lie, impact_h, impact_v, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, session, `${userId}:${shot.ref}`, shot.at, source, shot.club, shot.handed, shot.ballSpeed, shot.launch, shot.direction, shot.totalSpin, shot.spinAxis, shot.carry, shot.clubSpeed, shot.attackAngle, shot.path, shot.face, shot.dynamicLoft, shot.lie, shot.impactH, shot.impactV, raw?.[index] ?? null))
  const results = await env.DB.batch(statements) as { meta?: { changes?: number } }[]
  const added = results.reduce((sum, result) => sum + (result?.meta?.changes ?? 0), 0)
  await refreshSession(env, session)
  return added
}

export async function refreshSession(env: Env, session: string) {
  await env.DB.prepare(`UPDATE gspro_sessions SET shot_count = (SELECT COUNT(*) FROM gspro_shots WHERE session_id = ?1), last_shot_at = COALESCE((SELECT MAX(created_at) FROM gspro_shots WHERE session_id = ?1), last_shot_at) WHERE id = ?1`).bind(session).run()
}

type BridgeRow = { key_hint: string; created_at: number; last_seen_at: number | null; status: string | null }

export function toBridgeStatus(row: BridgeRow | null): BridgeStatus {
  let status: Partial<BridgeStatus> = {}
  try { status = row?.status ? JSON.parse(row.status) as Partial<BridgeStatus> : {} } catch { status = {} }
  return {
    hasKey: Boolean(row),
    keyHint: row?.key_hint ?? null,
    createdAt: row?.created_at ?? null,
    lastSeenAt: row?.last_seen_at ?? null,
    version: typeof status.version === 'string' ? status.version : null,
    gsproConnected: Boolean(status.gsproConnected),
    monitorConnected: Boolean(status.monitorConnected),
    queued: typeof status.queued === 'number' ? status.queued : 0,
    listen: typeof status.listen === 'string' ? status.listen : null,
  }
}
