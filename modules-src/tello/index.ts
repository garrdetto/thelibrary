/**
 * Tello boot: the baked map of Montello, the bundled and published Fox Plains
 * vehicles registered with the shared rules, then Rack & Reel's game (the
 * same picture Fox Lake uses) with Montello mounted as its host world.
 * `?hour=21` pins the sky.
 */
import { Game } from '../rackreel/game/Game'
import { store } from '../maplestreet/src/core/Storage'
import { isValidVehicleRecord, registerCustomVehicles, type CustomVehicleRecord } from '../maplestreet/shared/CustomVehicles'
import { BUNDLED_VEHICLES } from '../maplestreet/shared/BundledVehicles'
import { loadMap } from './data/MapData'
import { TelloLand, TelloTerrain } from './region'
import { TelloTown } from './town/TelloTown'

declare global {
  interface Window {
    __tello?: { game: Game; town: TelloTown; land: TelloLand }
  }
}

/** Fox Lake's picture: light sun shadows, shaded sides lifted by a stronger sky fill, a night 15 % brighter, and matte characters. */
const LOOK = { shadowDarkness: 0.9, fill: 1.4, nightBrightness: 1.15, matteCharacters: true }
/** Half Rack & Reel's shadow map, as in Fox Lake: a town has far more casters, and the soft shadows hide the coarser texels. */
const SHADOW_MAP = 1024

const online = location.protocol === 'https:' || location.protocol === 'http:'
const BUNDLED_IDS = new Set(BUNDLED_VEHICLES.map((r) => r.id))

/** The game's own bundled vehicles always (as in Fox Lake), plus anything published from the vehicle editor. */
async function registerVehicles(): Promise<void> {
  const KEY = 'maplestreet/custom-vehicles/v1'
  let list: CustomVehicleRecord[] | null = null
  if (online) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch('/api/maplestreet-vehicles', { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      if (res.ok) {
        const data = (await res.json()) as { vehicles?: unknown }
        if (Array.isArray(data.vehicles)) list = data.vehicles.filter(isValidVehicleRecord).filter((r) => (r as { status?: string }).status !== 'draft')
      }
    } catch {
      /* offline: use the cache */
    } finally {
      clearTimeout(timer)
    }
  }
  if (list) store.set(KEY, JSON.stringify(list))
  const known = list ?? (store.json<unknown[]>(KEY) ?? []).filter(isValidVehicleRecord)
  registerCustomVehicles(known.filter((r) => !BUNDLED_IDS.has(r.id)))
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Missing #scene')
  const [map] = await Promise.all([loadMap(new URL('./tello/', location.href).href), registerVehicles()])
  const land = new TelloLand(map.doc, map.grids)
  const town = new TelloTown(land)
  const game = new Game(canvas, { terrain: new TelloTerrain(land), extension: town, gearAtCabin: true, profile: 'tello', look: LOOK, shadowMapSize: SHADOW_MAP })
  window.__tello = { game, town, land }
  await game.start()
}

boot().catch((error: unknown) => {
  const status = document.getElementById('load-text')
  if (status) {
    status.hidden = false
    status.textContent = 'Tello could not start on this device. It needs WebGPU or WebGL2.'
  }
  console.error(error)
})
