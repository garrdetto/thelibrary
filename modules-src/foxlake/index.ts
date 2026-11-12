/**
 * Fox Lake boot: who you are (your library username, or this browser's Fox
 * Plains guest name), the admin-published Fox Plains vehicles and Buy items
 * registered with the shared rules, then Rack & Reel's game with the Fox
 * Plains town mounted north of the lake country. `?solo=1` plays the town on
 * this device instead of the shared world.
 */
import { Game } from '../rackreel/game/Game'
import { Terrain } from '../rackreel/world/Terrain'
import { guestName } from '../maplestreet/src/net/WorldTransport'
import { store } from '../maplestreet/src/core/Storage'
import { isValidVehicleRecord, registerCustomVehicles, type CustomVehicleRecord } from '../maplestreet/shared/CustomVehicles'
import { isValidRecord, registerCustomItems, type CustomItemRecord } from '../maplestreet/shared/CustomItems'
import { FOX_LAKE_SHAPE } from './region'
import { FoxLakeTown } from './town/FoxLakeTown'

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
  ])
  if (vehicles) store.set(VK, JSON.stringify(vehicles))
  if (items) store.set(IK, JSON.stringify(items))
  registerCustomVehicles(vehicles ?? (store.json<unknown[]>(VK) ?? []).filter(isValidVehicleRecord))
  registerCustomItems(items ?? (store.json<unknown[]>(IK) ?? []).filter(isValidRecord))
}

function postRoom(code: string): void {
  try {
    if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin)
  } catch {
    /* standalone */
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Missing #scene')
  const [name] = await Promise.all([signedInName(), registerPublished()])
  const solo = new URLSearchParams(location.search).has('solo')
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
  })
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return
    if (roomCode) postRoom(roomCode)
    else inviteRequested = true
  })
  const game = new Game(canvas, { terrain: new Terrain(FOX_LAKE_SHAPE), extension: town, bowfishAnyHour: true })
  window.__foxlake = { game, town }
  await game.start()
}

boot().catch((error: unknown) => {
  const status = document.getElementById('load-text')
  if (status) status.textContent = 'Fox Lake could not start on this device. It needs WebGPU or WebGL2.'
  console.error(error)
})
