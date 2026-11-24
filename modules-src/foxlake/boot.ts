/**
 * Life Sim boot (`index.ts` here, and the Truck Simulator page with `trucking`): who you are (your library username, or this browser's Fox
 * Plains guest name), the admin-published Fox Plains vehicles and Buy items
 * registered with the shared rules, the baked map of Montello with the World
 * Editor's edits replayed on it and Lake Montello at y = 0, then Rack & Reel's
 * game with Montello as its world and the lake gameplay on Lake Montello.
 * `?solo=1` plays on this device instead of the shared world; `?edits=draft`
 * loads the administrator's draft edits and `?edits=none` none; `?at=x,z`
 * starts on foot at that Montello map point.
 */
import { Game } from '../rackreel/game/Game'
import { guestName } from '../maplestreet/src/net/WorldTransport'
import { store } from '../maplestreet/src/core/Storage'
import { isValidVehicleRecord, registerCustomVehicles, type CustomVehicleRecord } from '../maplestreet/shared/CustomVehicles'
import { isValidRecord, registerCustomItems, type CustomItemRecord } from '../maplestreet/shared/CustomItems'
import { forLifeSim } from './vehicles/LifeSimVehicles'
import { applyPublishedTuning, fetchTuning } from './vehicles/TuningClient'
import { FOX_LAKE_LOOK, FOX_LAKE_SHADOWS, FOX_LAKE_SHADOW_MAP } from './look'
import { setShadowProxies } from './fp/core/Geo'
import { loadMap } from '../tello/data/MapData'
import { WORLD_EDITS_VERSION, WORLD_ID, emptyEdits, type WorldEdits } from '../tello/edits/WorldEdits'
import { TRUCK_EDIT_PREFIX, clearTruckGround, truckEdits } from './trucks/TruckEdits'
import { TelloTerrain } from '../tello/region'
import type { TelloLand } from '../tello/region'
import { foxLakeLand } from './lake/Land'
import { MAP_PACK_DIR, type MapPackManifest } from './lake/MapPack'
import { findLakeSite, type LakeSite } from './lake/LakeSite'
import { FoxLakeTown } from './town/FoxLakeTown'
import { MONTELLO_SPAWN } from '../trucksim/shared/montello/MontelloWorld'

declare global {
  interface Window {
    __foxlake?: { game: Game; town: FoxLakeTown }
  }
}

const online = location.protocol === 'https:' || location.protocol === 'http:'

function tagColor(name: string): string {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = h % 360
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const v = 0.5 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

async function signedInName(): Promise<string> {
  if (!online) return guestName()
  try {
    const res = await fetch('/api/pool-account', { credentials: 'same-origin', cache: 'no-store' })
    if (!res.ok) return guestName()
    const data = (await res.json()) as { username?: unknown }
    return typeof data.username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(data.username) ? data.username : guestName()
  } catch {
    return guestName()
  }
}

async function fetchList<T>(url: string, field: string, valid: (r: unknown) => r is T): Promise<T[] | null> {
  if (!online) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    const list = data[field]
    return Array.isArray(list) ? list.filter(valid).filter((r) => (r as { status?: string }).status !== 'draft') : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Published vehicles and items, with the same offline caches as Fox Plains. */
async function registerPublished(): Promise<void> {
  const VK = 'maplestreet/custom-vehicles/v1'
  const IK = 'maplestreet/custom-items/v1'
  const [vehicles, items] = await Promise.all([
    fetchList<CustomVehicleRecord>('/api/maplestreet-vehicles', 'vehicles', isValidVehicleRecord),
    fetchList<CustomItemRecord>('/api/maplestreet-items', 'items', isValidRecord),
    fetchTuning(),
  ])
  if (vehicles) store.set(VK, JSON.stringify(vehicles))
  if (items) store.set(IK, JSON.stringify(items))
  registerCustomVehicles(forLifeSim(vehicles ?? (store.json<unknown[]>(VK) ?? []).filter(isValidVehicleRecord)))
  applyPublishedTuning()
  registerCustomItems(items ?? (store.json<unknown[]>(IK) ?? []).filter(isValidRecord))
}

/**
 * Montello's map as the build baked it for Fox Lake (`lake/MapPack.ts`): streets already fixed and a smaller
 * download. The World Editor's edits and the move down to Lake Montello's level still run here, on the surveyed heights.
 * Null when the page was built without it, and Tello's own files are read instead.
 */
async function loadPacked(): Promise<Awaited<ReturnType<typeof loadMap>> | null> {
  const base = new URL(`./${MAP_PACK_DIR}/`, location.href).href
  let manifest: MapPackManifest
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' })
    if (!res.ok) return null
    manifest = (await res.json()) as MapPackManifest
    if (typeof manifest.doc !== 'string' || typeof manifest.grids !== 'string') return null
  } catch {
    return null
  }
  return loadMap(base, { doc: manifest.doc, grids: manifest.grids })
}

const EDITS_KEY = 'foxlake/world-edits/v1'

function isWorldEdits(v: unknown): v is WorldEdits {
  if (!v || typeof v !== 'object') return false
  const e = v as { v?: unknown; world?: unknown; ops?: unknown }
  return e.v === WORLD_EDITS_VERSION && e.world === WORLD_ID && Array.isArray(e.ops)
}

/** One read of `/api/world-edits`: the edits, null when there are none, or undefined when they could not be read. */
async function fetchEdits(url: string): Promise<WorldEdits | null | undefined> {
  if (!online) return undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) return undefined
    const data = (await res.json()) as { edits?: unknown }
    if (data.edits === null) return null
    return isWorldEdits(data.edits) ? data.edits : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The World Editor's edits to replay on Montello: the published ones, kept on this device for when the site can't be
 * reached; with `?edits=draft` the administrator's draft (the published ones if it can't be read); none with
 * `?edits=none`.
 */
async function loadEdits(): Promise<WorldEdits | null> {
  const mode = new URLSearchParams(location.search).get('edits')
  if (mode === 'none') return null
  if (mode === 'draft') {
    const draft = await fetchEdits('/api/world-edits?draft=1')
    if (draft) return draft
  }
  const published = await fetchEdits('/api/world-edits')
  if (published !== undefined) {
    store.set(EDITS_KEY, published ? JSON.stringify(published) : '')
    return published
  }
  const cached = store.json<unknown>(EDITS_KEY)
  return isWorldEdits(cached) ? cached : null
}

/** `?at=<x>,<z>`: a Montello map point (metres) to stand on once play starts. */
function startAt(): { x: number; z: number } | null {
  const parts = (new URLSearchParams(location.search).get('at') ?? '').split(',')
  if (parts.length !== 2) return null
  const [x, z] = parts.map((v) => (v.trim() ? Number(v) : NaN))
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null
}

/** Truck Simulator's lane, lots and sites go in front of the published edits, so the World Editor can still change them. */
function withTruckEdits(edits: WorldEdits | null, truck: WorldEdits['ops']): WorldEdits {
  const base = edits ?? emptyEdits()
  return { ...base, ops: [...truck, ...base.ops.filter((op) => !op.id.startsWith(TRUCK_EDIT_PREFIX))] }
}

/**
 * Montello (Tello's map of the real city and the country three miles round it) with the World Editor's edits replayed
 * on it, and where the lake gameplay stands on it.
 */
async function loadMontello(): Promise<{ land: TelloLand; site: LakeSite }> {
  const [map, edits] = await Promise.all([loadPacked().then((m) => m ?? loadMap(new URL('./tello/', location.href).href)), loadEdits()])
  const land = foxLakeLand(map.doc, map.grids, withTruckEdits(edits, truckEdits(map.doc, map.grids)))
  clearTruckGround(land)
  if (land.edits?.skipped.length) console.warn(`[foxlake] ${land.edits.skipped.length} world edit(s) skipped`, land.edits.skipped)
  return { land, site: findLakeSite(land) }
}

function postRoom(code: string): void {
  try {
    if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin)
  } catch {
    /* standalone */
  }
}

export interface MontelloBoot {
  /** Truck Simulator's page: trucking mode, played on this device, starting at Haulers Lane. */
  trucking?: boolean
}

/** Haulers Lane by State Highway 23 as a Montello map point (map z is north, the town frame's z is south). */
function haulersLane(): { x: number; z: number } {
  return { x: MONTELLO_SPAWN.x, z: -MONTELLO_SPAWN.z }
}

async function boot(options: MontelloBoot): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Missing #scene')
  const [name, montello] = await Promise.all([signedInName(), loadMontello(), registerPublished()])
  const trucking = options.trucking === true
  const solo = trucking || new URLSearchParams(location.search).has('solo')
  let roomCode: string | null = null
  let inviteRequested = false
  const town = new FoxLakeTown({
    name,
    color: tagColor(name),
    mode: solo ? 'offline' : 'world',
    onRoom: (code) => {
      roomCode = code
      if (inviteRequested && code) postRoom(code)
    },
    land: montello.land,
    site: montello.site,
    at: startAt() ?? (trucking ? haulersLane() : null),
    trucking,
  })
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return
    if (roomCode) postRoom(roomCode)
    else inviteRequested = true
  })
  setShadowProxies(FOX_LAKE_SHADOWS)
  const game = new Game(canvas, { terrain: new TelloTerrain(montello.land), extension: town, bowfishAnyHour: true, gearAtCabin: true, profile: 'foxlake', site: montello.site, ridesBought: true, jump: true, homeName: 'the outfitter', look: FOX_LAKE_LOOK, tailored: true, shadowMapSize: FOX_LAKE_SHADOW_MAP, shadows: FOX_LAKE_SHADOWS, reverseDepth: true })
  window.__foxlake = { game, town }
  await game.start()
}

/** Boots Montello: Life Sim, or Truck Simulator with `trucking`. */
export function bootMontello(options: MontelloBoot = {}): void {
  boot(options).catch((error: unknown) => {
    const status = document.getElementById('load-text')
    if (status) status.textContent = `${options.trucking ? 'Truck Simulator' : 'Life Sim'} could not start on this device. It needs WebGPU or WebGL2.`
    console.error(error)
  })
}
