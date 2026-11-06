import { MeshBuilder } from './gl'
import type { Vec3 } from './gl'
import type { RideModel } from './models'
import { decodeRideMesh } from './rideMesh'
import type { RideMesh } from './rideMesh'
import { rideMatrices } from './ridePieces'
import type { Mat4 } from './gl'
import type { MotionClock } from './rideMotion'
import { registerCustomRides } from '../../../server/park/index.mjs'
import type { FlatRideDef } from '../../../server/park/index.mjs'
import { fetchParkRideCatalog, parkRideMeshUrl, parkRideThumbUrl } from '../park-rides'

const REFRESH_MS = 60_000
let loaded: Promise<void> | null = null
let loadedAt = 0

/**
 * Registers the admin's published rides into FLAT_RIDES before a park opens, so
 * saves that own one load it and the build menu lists it. A failed fetch never
 * blocks the game: built-in rides still work and the next open retries.
 */
export function ensureCustomRides(force = false): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (!force && loaded && Date.now() - loadedAt < REFRESH_MS) return loaded
  loadedAt = Date.now()
  loaded = fetchParkRideCatalog()
    .then(list => { registerCustomRides(list) })
    .catch(error => { console.warn('Custom rides unavailable', error); loadedAt = 0 })
  return loaded
}

type MeshEntry = { state: 'loading' } | { state: 'ready'; mesh: RideMesh } | { state: 'error' }
const meshes = new Map<string, MeshEntry>()

function meshFor(def: FlatRideDef): RideMesh | null | 'error' {
  const info = def.custom!
  const key = `${info.id}:${info.meshVersion}`
  const entry = meshes.get(key)
  if (entry?.state === 'ready') return entry.mesh
  if (entry?.state === 'error') return 'error'
  if (!entry) {
    meshes.set(key, { state: 'loading' })
    fetch(parkRideMeshUrl(info.id, info.meshVersion), { credentials: 'same-origin' })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer() })
      .then(buffer => { meshes.set(key, { state: 'ready', mesh: decodeRideMesh(buffer) }) })
      .catch(error => { console.warn('Ride model failed to load', info.id, error); meshes.set(key, { state: 'error' }) })
  }
  return null
}

/** Cache key that changes when the ride's model arrives. */
export function customModelKey(kind: string, def: FlatRideDef) {
  const info = def.custom!
  const entry = meshes.get(`${info.id}:${info.meshVersion}`)
  return `${kind}:custom:${info.meshVersion}:${entry?.state ?? 'new'}:${JSON.stringify(info.motion)}`
}

export const customRideThumb = (def: FlatRideDef) => def.custom?.thumb ? parkRideThumbUrl(def.custom.id, def.custom.meshVersion) : null

/** A dashed-outline crate shown while the real model downloads (or if it fails). */
function placeholder(def: FlatRideDef): RideModel {
  const base = new MeshBuilder()
  const w = def.size[0] * 4 - 0.6, h = def.size[1] * 4 - 0.6, top = Math.min(def.height, 8)
  const pad: Vec3 = [0.62, 0.6, 0.56], post: Vec3 = [0.85, 0.7, 0.32]
  base.box(null, 0, 0, 0, w, h, 0.3, pad)
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) base.box(null, x * (w / 2 - 0.3), y * (h / 2 - 0.3), 0.3, 0.4, 0.4, top, post)
  base.box(null, 0, 0, top, w, h, 0.25, post)
  return { base, parts: [] }
}

/** Builds the park model for a published custom ride from its baked mesh. */
export function customRideModel(def: FlatRideDef): RideModel {
  const mesh = meshFor(def)
  if (!mesh || mesh === 'error') return placeholder(def)
  const builders = Array.from({ length: 2 + mesh.instances.length }, () => new MeshBuilder())
  const P = mesh.positions, N = mesh.normals, C = mesh.colors
  const v = (i: number, a: Float32Array): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
  for (let t = 0; t < mesh.triangles; t++) {
    const a = t * 3, b = a + 1, c = a + 2
    const target = builders[mesh.parts[a]] ?? builders[1]
    target.smoothTri(null, null, v(a, P), v(b, P), v(c, P), v(a, N), v(b, N), v(c, N), v(a, C), v(b, C), v(c, C))
  }
  const motion = def.custom!.motion
  let lastKey = '', last: Mat4[] = []
  const matrices = (clock: MotionClock) => {
    const key = `${clock.spin}|${clock.timer}|${clock.running}|${clock.speed}`
    if (key !== lastKey) { lastKey = key; last = rideMatrices(motion, mesh.instances, clock, def.rideTime, mesh.height) }
    return last
  }
  const parts = builders.slice(1).map((builder, i) => ({ builder, part: i + 1 })).filter(p => p.builder.count)
    .map(({ builder, part }) => ({ builder, anim: (clock: MotionClock) => matrices(clock)[part] }))
  return { base: builders[0], parts }
}
