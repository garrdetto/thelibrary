import type { Env } from './env.js'
import { parseStored } from './http.js'
import { defaultProfile, normalizeProfile } from '../../modules-src/angler/shared/Profile'
import type { AnglerProfile } from '../../modules-src/angler/shared/Profile'
import { isLakeId } from '../../modules-src/angler/shared/Lakes'
import type { LakeId } from '../../modules-src/angler/shared/Lakes'
import type { Rig } from '../../modules-src/angler/shared/Gear'

export interface AnglerSession {
  lake: LakeId
  x: number
  z: number
  rig: Rig
  anchoredAt: number
  lastSeen: number
  nextBiteAt: number
  lastBiteAt: number
  lastProgressAt: number
  lastSocialAt?: number
}

let tablesReady: Promise<unknown> | null = null

export function ensureAnglerTables(env: Env) {
  tablesReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS angler_profiles (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS angler_sessions (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS angler_catches (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, lake TEXT NOT NULL, spot TEXT NOT NULL, species TEXT NOT NULL,
      weight INTEGER NOT NULL, length INTEGER NOT NULL, tier TEXT NOT NULL, landed INTEGER NOT NULL, rig TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS angler_catches_species_weight_idx ON angler_catches (species, landed, weight DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS angler_catches_user_idx ON angler_catches (user_id, created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS angler_catches_lake_species_idx ON angler_catches (lake, species, landed, weight DESC)'),
  ]).catch(error => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

export async function loadProfile(env: Env, userId: string, username: string): Promise<AnglerProfile> {
  const row = await env.DB.prepare('SELECT data FROM angler_profiles WHERE user_id = ?').bind(userId).first<{ data: string }>()
  if (!row) {
    const profile = defaultProfile()
    await saveProfile(env, userId, username, profile)
    return profile
  }
  return normalizeProfile(parseStored(row.data, {}))
}

export async function saveProfile(env: Env, userId: string, username: string, profile: AnglerProfile) {
  await env.DB.prepare('INSERT INTO angler_profiles (user_id, username, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, data = excluded.data, updated_at = excluded.updated_at')
    .bind(userId, username, JSON.stringify(profile), Date.now()).run()
}

export async function loadSession(env: Env, userId: string): Promise<AnglerSession | null> {
  const row = await env.DB.prepare('SELECT data FROM angler_sessions WHERE user_id = ?').bind(userId).first<{ data: string }>()
  const s = parseStored<Partial<AnglerSession> | null>(row?.data, null)
  if (!s || !isLakeId(s.lake) || !s.rig) return null
  return {
    lake: s.lake, x: Number(s.x) || 0, z: Number(s.z) || 0, rig: s.rig, anchoredAt: Number(s.anchoredAt) || 0, lastSeen: Number(s.lastSeen) || 0,
    nextBiteAt: Number(s.nextBiteAt) || 0, lastBiteAt: Number(s.lastBiteAt) || 0, lastProgressAt: Number(s.lastProgressAt) || 0, lastSocialAt: Number(s.lastSocialAt) || 0,
  }
}

export async function saveSession(env: Env, userId: string, session: AnglerSession) {
  await env.DB.prepare('INSERT INTO angler_sessions (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(userId, JSON.stringify(session), Date.now()).run()
}
