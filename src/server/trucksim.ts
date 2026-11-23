import type { Env } from './env.js'
import { parseStored } from './http.js'
import { defaultProfile, normalizeProfile } from '../../modules-src/trucksim/shared/Economy'
import type { Profile } from '../../modules-src/trucksim/shared/Economy'
import { COUNTY } from '../../modules-src/trucksim/shared/RoadGraph'
import type { HaulWorld } from '../../modules-src/trucksim/shared/HaulWorld'
import type { PublicLot } from '../../modules-src/trucksim/shared/Lots'
import type { LotSpec } from '../../modules-src/trucksim/shared/WorldLayout'
import { MONTELLO } from '../../modules-src/trucksim/shared/montello/MontelloWorld'

export const LOT_RELEASE_MS = 45 * 24 * 60 * 60 * 1000

let tablesReady: Promise<unknown> | null = null

export function ensureTrucksimTables(env: Env) {
  tablesReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS trucksim_profiles (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS trucksim_lots (lot_index INTEGER PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, seen_at INTEGER NOT NULL)'),
  ]).catch((error) => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

/** The haul worlds the Worker knows. Life Sim will add `lifesim` here with its own profile key and shared wallet. */
export const HAUL_WORLDS: Record<string, { world: HaulWorld; profileKey(userId: string): string }> = {
  county: { world: COUNTY, profileKey: (userId) => userId },
  montello: { world: MONTELLO, profileKey: (userId) => `montello:${userId}` },
}

export async function loadTrucksimProfile(env: Env, key: string, username: string): Promise<{ profile: Profile; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT data, updated_at FROM trucksim_profiles WHERE user_id = ?').bind(key).first<{ data: string; updated_at: number }>()
  if (!row) {
    const profile = defaultProfile()
    const updatedAt = Date.now()
    await env.DB.prepare('INSERT OR IGNORE INTO trucksim_profiles (user_id, username, data, updated_at) VALUES (?, ?, ?, ?)').bind(key, username, JSON.stringify(profile), updatedAt).run()
    const stored = await env.DB.prepare('SELECT data, updated_at FROM trucksim_profiles WHERE user_id = ?').bind(key).first<{ data: string; updated_at: number }>()
    return stored ? { profile: normalizeProfile(parseStored(stored.data, {})), updatedAt: stored.updated_at } : { profile, updatedAt }
  }
  return { profile: normalizeProfile(parseStored(row.data, {})), updatedAt: row.updated_at }
}

/** Saves `profile` only if nobody saved since `updatedAt`. Returns false when another request got there first. */
export async function saveTrucksimProfileIfUnchanged(env: Env, key: string, username: string, profile: Profile, updatedAt: number, now: number): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE trucksim_profiles SET username = ?, data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?')
    .bind(username, JSON.stringify(profile), now, key, updatedAt).run()
  return (result.meta?.changes ?? 0) > 0
}

async function releaseStaleLots(env: Env, now: number) {
  await env.DB.prepare('DELETE FROM trucksim_lots WHERE seen_at < ?').bind(now - LOT_RELEASE_MS).run()
}

/**
 * Marks the player as seen and returns their lot in a world, giving the first free one of `lots` when they have none (lots unseen
 * for 45 days are released first). `userId` is the world's profile key, so a driver holds one lot per world. Returns null when
 * every lot is taken.
 */
export async function assignLot(env: Env, userId: string, username: string, now: number, lots: readonly LotSpec[]): Promise<number | null> {
  await releaseStaleLots(env, now)
  const own = await env.DB.prepare('UPDATE trucksim_lots SET seen_at = ?, username = ? WHERE user_id = ?').bind(now, username, userId).run()
  if ((own.meta?.changes ?? 0) > 0) {
    const row = await env.DB.prepare('SELECT lot_index FROM trucksim_lots WHERE user_id = ?').bind(userId).first<{ lot_index: number }>()
    if (row) return row.lot_index
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { results } = await env.DB.prepare('SELECT lot_index FROM trucksim_lots').all<{ lot_index: number }>()
    const taken = new Set((results ?? []).map((row) => row.lot_index))
    const free = lots.find((lot) => !taken.has(lot.index))
    if (!free) return null
    const inserted = await env.DB.prepare('INSERT OR IGNORE INTO trucksim_lots (lot_index, user_id, username, seen_at) VALUES (?, ?, ?, ?)').bind(free.index, userId, username, now).run()
    if ((inserted.meta?.changes ?? 0) > 0) return free.index
    const mine = await env.DB.prepare('SELECT lot_index FROM trucksim_lots WHERE user_id = ?').bind(userId).first<{ lot_index: number }>()
    if (mine) return mine.lot_index
  }
  return null
}

/** True when the lot is unclaimed (or already this player's). */
export async function lotIsFree(env: Env, userId: string, index: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT user_id FROM trucksim_lots WHERE lot_index = ?').bind(index).first<{ user_id: string }>()
  return !row || row.user_id === userId
}

/** Moves the player's claim to `index` if it is free. Returns false when someone else holds it. */
export async function claimLot(env: Env, userId: string, username: string, index: number, now: number): Promise<boolean> {
  const moved = await env.DB.prepare('UPDATE trucksim_lots SET lot_index = ?, seen_at = ?, username = ? WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM trucksim_lots WHERE lot_index = ?)').bind(index, now, username, userId, index).run()
  if ((moved.meta?.changes ?? 0) > 0) return true
  const row = await env.DB.prepare('SELECT lot_index FROM trucksim_lots WHERE user_id = ?').bind(userId).first<{ lot_index: number }>()
  if (row) return row.lot_index === index
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO trucksim_lots (lot_index, user_id, username, seen_at) VALUES (?, ?, ?, ?)').bind(index, userId, username, now).run()
  return (inserted.meta?.changes ?? 0) > 0
}

/** Every claimed, recently seen lot of a world with its owner's company and build. User ids are never included. */
export async function loadPublicLots(env: Env, now: number, lots: readonly LotSpec[]): Promise<PublicLot[]> {
  const wanted = new Set(lots.map((lot) => lot.index))
  const { results } = await env.DB.prepare(
    'SELECT l.lot_index AS lot_index, l.username AS username, p.data AS data FROM trucksim_lots l LEFT JOIN trucksim_profiles p ON p.user_id = l.user_id WHERE l.seen_at >= ? ORDER BY l.lot_index',
  ).bind(now - LOT_RELEASE_MS).all<{ lot_index: number; username: string; data: string | null }>()
  return (results ?? []).filter((row) => wanted.has(row.lot_index)).map((row) => {
    const profile = normalizeProfile(parseStored(row.data, {}))
    return { index: row.lot_index, owner: row.username, company: profile.company, land: profile.land, build: profile.build }
  })
}
