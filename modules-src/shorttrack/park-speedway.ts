/** Thrill Park Speedway's surroundings: the saved Thrill Park 2 park (`data/park.json`, made by `tools/park-scenery.mjs`) built in a worker by the Demo Derby's `parkSceneryBuild.ts` and put together here with classic three.js materials, which the next renderer's bridge mirrors. Flat rides turn on their own ride cycles with Thrill Park's own animation. */
import * as THREE from 'three'
import { flatRideModel, type RideAnim, type RideModel } from '../../src/lib/park/models'
import { decorateRide } from '../../src/lib/park/rideNeon'
import { waterRideModel } from '../../src/lib/park/waterRides'
import { wavePoolModel } from '../../src/lib/park/waterModels'
import type { PackedGeometry, SceneryPayload } from '../demoderby/models/parkSceneryBuild'

export type ParkSpeedway = {
  root: THREE.Group
  name: string
  update(dt: number): void
  setNight(night: boolean): void
}

/** The park map's edges in track metres (lot centre 256, 448 park metres, quarter turn 2); outside it the module's own flat ground continues. */
export const PARK_MAP = { x0: -256, x1: 256, z0: -448, z1: 64 }

type Bucket = 'matte' | 'metal' | 'glow'

/** Splits a packed mesh into matte, metal and glowing triangles (the bridge has no per-vertex roughness or glow). */
function split(packed: PackedGeometry, tintOnly?: boolean): Map<string, THREE.BufferGeometry> {
  const { position, normal, color, pbr, index } = packed
  const groups = new Map<string, number[]>()
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]
    const glow = pbr[a * 3 + 2], metal = pbr[a * 3 + 1]
    const tinted = glow >= 5
    const key = `${(glow % 10) > 0.05 && !tintOnly ? 'glow' : metal > 0.5 ? 'metal' : 'matte'}${tintOnly !== undefined ? (tinted ? ':t' : ':u') : ''}`
    let list = groups.get(key)
    if (!list) groups.set(key, (list = []))
    list.push(a, index[t + 1], index[t + 2])
  }
  const out = new Map<string, THREE.BufferGeometry>()
  for (const [key, tris] of groups) {
    const remap = new Map<number, number>()
    const idx = new Uint32Array(tris.length)
    tris.forEach((v, i) => {
      let n = remap.get(v)
      if (n === undefined) remap.set(v, (n = remap.size))
      idx[i] = n
    })
    const p = new Float32Array(remap.size * 3), nm = new Float32Array(remap.size * 3), c = new Float32Array(remap.size * 3)
    for (const [v, n] of remap) for (let k = 0; k < 3; k++) {
      p[n * 3 + k] = position[v * 3 + k]
      nm[n * 3 + k] = normal[v * 3 + k]
      c[n * 3 + k] = color[v * 3 + k]
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nm, 3))
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    g.setIndex(new THREE.BufferAttribute(remap.size > 65535 ? idx : Uint16Array.from(idx), 1))
    g.computeBoundingSphere()
    out.set(key, g)
  }
  return out
}

function rideModel(kind: string, size: [number, number], wave: string | null): RideModel {
  const [w, h] = size
  return decorateRide(kind, kind === 'wavePool' ? wavePoolModel(w, h, wave ?? 'rolling') : waterRideModel(kind, w, h) ?? flatRideModel(kind, w, h), w, h)
}

function rideClock(id: number, ride: number, load: number) {
  const anim: RideAnim = { spin: 0, phase: 'running', timer: 0, running: true, speed: 0 }
  let clock = (id * 7.31) % (ride + load)
  return {
    anim,
    step(dt: number) {
      clock = (clock + dt) % (ride + load)
      const running = clock < ride
      anim.phase = running ? 'running' : 'loading'
      anim.running = running
      anim.timer = running ? clock : clock - ride
      anim.speed = running ? Math.min(1, anim.speed + dt * 0.25) : Math.max(0, anim.speed - dt * 0.6)
      anim.spin += dt * anim.speed
    },
  }
}

/** Builds the park in a worker; trees and props farther than `reach` metres from the infield are left out. */
export async function createParkSpeedway(reach: number): Promise<ParkSpeedway> {
  const worker = new Worker(new URL('./park-speedway.worker.ts', import.meta.url), { type: 'module' })
  const payload = await new Promise<SceneryPayload>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ payload?: SceneryPayload; error?: string }>) => (event.data.payload ? resolve(event.data.payload) : reject(new Error(event.data.error ?? 'Park scenery failed')))
    worker.onerror = (event) => reject(new Error(event.message || 'Park scenery worker failed'))
    worker.postMessage({ reach })
  }).finally(() => worker.terminate())
  return assembleParkSpeedway(payload)
}

export function assembleParkSpeedway(payload: SceneryPayload): ParkSpeedway {
  const root = new THREE.Group()
  root.name = 'thrill-park'
  const mats: Record<Bucket, THREE.Material> = {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.5 }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.15 }),
  }
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false })
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false })
  const bucketOf = (key: string) => key.split(':')[0] as Bucket

  for (const cell of payload.cells) {
    for (const [key, geometry] of split(cell.geometry)) {
      const mesh = new THREE.Mesh(geometry, cell.kind === 'water' ? water : cell.kind === 'glass' ? glass : mats[bucketOf(key)])
      mesh.receiveShadow = cell.kind !== 'water'
      mesh.castShadow = cell.kind === 'opaque' && cell.near
      if (cell.kind !== 'opaque') mesh.renderOrder = 2
      mesh.matrixAutoUpdate = false
      root.add(mesh)
    }
  }

  for (const item of payload.instanced) {
    for (const [key, geometry] of split(item.geometry, true)) {
      const mesh = new THREE.InstancedMesh(geometry, mats[bucketOf(key)], item.count)
      mesh.instanceMatrix.array.set(item.matrices)
      mesh.instanceMatrix.needsUpdate = true
      if (key.endsWith(':t')) {
        const c = new THREE.Color()
        for (let i = 0; i < item.count; i++) mesh.setColorAt(i, c.setRGB(item.tints[i * 3], item.tints[i * 3 + 1], item.tints[i * 3 + 2]))
        mesh.instanceColor!.needsUpdate = true
      }
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      root.add(mesh)
    }
  }

  const models = new Map<string, RideModel['parts']>()
  const rides: { meshes: THREE.Mesh[][]; anims: RideModel['parts'][number]['anim'][]; base: THREE.Matrix4; clock: ReturnType<typeof rideClock> }[] = []
  for (const ride of payload.rides) {
    const key = `${ride.kind}:${ride.size.join('x')}:${ride.wave ?? ''}`
    let parts = models.get(key)
    if (!parts) models.set(key, (parts = rideModel(ride.kind, ride.size, ride.wave).parts))
    const meshes = ride.parts.map((packed) => {
      if (!packed.index.length) return []
      return [...split(packed)].map(([k, geometry]) => {
        const mesh = new THREE.Mesh(geometry, mats[bucketOf(k)])
        mesh.matrixAutoUpdate = false
        mesh.receiveShadow = true
        mesh.castShadow = true
        root.add(mesh)
        return mesh
      })
    })
    rides.push({ meshes, anims: parts.map((part) => part.anim), base: new THREE.Matrix4().fromArray(ride.base), clock: rideClock(ride.id, ride.rideTime, ride.loadTime) })
  }

  const partMatrix = new THREE.Matrix4()
  const update = (dt: number): void => {
    for (const ride of rides) {
      ride.clock.step(dt)
      ride.meshes.forEach((list, i) => {
        const anim = ride.anims[i]
        if (!list.length || !anim) return
        partMatrix.fromArray(anim(ride.clock.anim, i))
        for (const mesh of list) {
          mesh.matrix.multiplyMatrices(ride.base, partMatrix)
          mesh.matrixWorldNeedsUpdate = true
        }
      })
    }
  }
  update(0)
  const setNight = (night: boolean): void => {
    ;(mats.glow as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.6 : 0.15
  }
  return { root, name: payload.name, update, setNight }
}
