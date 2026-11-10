/** The Thrill Park around the derby: a saved Thrill Park 2 park (trimmed by `tools/park-scenery.mjs` into `data/park.json`) built in a worker by `parkSceneryBuild.ts` and put together here as three.js meshes: merged terrain, water, paths, track, stalls and ride bases per 64 m cell, instanced trees and props with their own tints, and every flat ride's moving parts animated on its own ride cycle with Thrill Park's own animation (`models.ts`). */
import * as THREE from 'three/webgpu'
import { flatRideModel, type RideAnim, type RideModel } from '../../../src/lib/park/models'
import { decorateRide } from '../../../src/lib/park/rideNeon'
import { waterRideModel } from '../../../src/lib/park/waterRides'
import { wavePoolModel } from '../../../src/lib/park/waterModels'
import type { PackedGeometry, ParkLot, SceneryPayload } from './parkSceneryBuild'

const { attribute, instancedBufferAttribute, mix, step, vec3, vertexColor } = THREE.TSL

export interface ParkScenery {
  root: THREE.Group
  name: string
  owner: string
  /** Where the derby's lot sits, in park and arena metres. */
  lot: ParkLot
  /** Moves every flat ride along its ride cycle. */
  update(dt: number): void
  dispose(): void
}

function geometryOf(packed: PackedGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(packed.position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(packed.normal, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(packed.color, 3))
  geometry.setAttribute('pbr', new THREE.BufferAttribute(packed.pbr, 3))
  const vertices = packed.position.length / 3
  geometry.setIndex(new THREE.BufferAttribute(vertices > 65535 ? packed.index : Uint16Array.from(packed.index), 1))
  geometry.computeBoundingSphere()
  return geometry
}

function bakedMaterial(options: { transparent?: boolean; opacity?: number } = {}): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ transparent: options.transparent ?? false, opacity: options.opacity ?? 1, depthWrite: !options.transparent })
  const pbr = attribute('pbr', 'vec3')
  material.colorNode = vertexColor().rgb
  material.roughnessNode = pbr.x
  material.metalnessNode = pbr.y
  material.emissiveNode = vertexColor().rgb.mul(pbr.z)
  material.envMapIntensity = 0.7
  return material
}

/** The same model Thrill Park draws for a flat ride, for its parts' animation. */
function rideModel(kind: string, size: [number, number], wave: string | null): RideModel {
  const [w, h] = size
  return decorateRide(kind, kind === 'wavePool' ? wavePoolModel(w, h, wave ?? 'rolling') : waterRideModel(kind, w, h) ?? flatRideModel(kind, w, h), w, h)
}

/** One ride's cycle: runs for its ride time, slows to load, starts again, offset per ride so they do not move in step. */
function rideClock(id: number, ride: number, load: number): { anim: RideAnim; step(dt: number): void } {
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

/** Builds the park in a worker and assembles it; `reach` limits trees and props to that many metres from the arena. */
export async function createParkScenery(reach: number): Promise<ParkScenery> {
  const worker = new Worker(new URL('./parkScenery.worker.ts', import.meta.url), { type: 'module' })
  const payload = await new Promise<SceneryPayload>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ payload?: SceneryPayload; error?: string }>) => (event.data.payload ? resolve(event.data.payload) : reject(new Error(event.data.error ?? 'Park scenery failed')))
    worker.onerror = (event) => reject(new Error(event.message || 'Park scenery worker failed'))
    worker.postMessage({ reach })
  }).finally(() => worker.terminate())
  return assembleParkScenery(payload)
}

/** Turns a built payload into meshes (also used by the tests, which build the payload in-process). */
export function assembleParkScenery(payload: SceneryPayload): ParkScenery {
  const root = new THREE.Group()
  root.name = 'thrill-park'
  const disposables: { dispose(): void }[] = []
  const opaque = bakedMaterial()
  const water = bakedMaterial({ transparent: true, opacity: 0.8 })
  const glass = bakedMaterial({ transparent: true, opacity: 0.55 })
  disposables.push(opaque, water, glass)

  for (const cell of payload.cells) {
    const geometry = geometryOf(cell.geometry)
    disposables.push(geometry)
    const mesh = new THREE.Mesh(geometry, cell.kind === 'opaque' ? opaque : cell.kind === 'water' ? water : glass)
    mesh.receiveShadow = cell.kind !== 'water'
    mesh.castShadow = cell.kind === 'opaque' && cell.near
    if (cell.kind !== 'opaque') mesh.renderOrder = 2
    root.add(mesh)
  }

  for (const item of payload.instanced) {
    const geometry = geometryOf(item.geometry)
    const mesh = new THREE.InstancedMesh(geometry, undefined, item.count)
    mesh.instanceMatrix.array.set(item.matrices)
    mesh.instanceMatrix.needsUpdate = true
    const material = bakedMaterial()
    const tint = instancedBufferAttribute(new THREE.InstancedBufferAttribute(item.tints, 3), 'vec3') as unknown as ReturnType<typeof vec3>
    const glowAndTint = attribute('pbr', 'vec3').z
    const base = vertexColor().rgb
    const tinted = mix(base, base.mul(tint), step(5, glowAndTint))
    material.colorNode = tinted
    material.emissiveNode = tinted.mul(glowAndTint.mod(10))
    mesh.material = material
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
    disposables.push(geometry, material, { dispose: () => mesh.dispose() })
    root.add(mesh)
  }

  const rideMaterial = bakedMaterial()
  disposables.push(rideMaterial)
  const models = new Map<string, RideModel['parts']>()
  const rides: { meshes: (THREE.Mesh | null)[]; anims: RideModel['parts'][number]['anim'][]; base: THREE.Matrix4; clock: ReturnType<typeof rideClock> }[] = []
  for (const ride of payload.rides) {
    const key = `${ride.kind}:${ride.size.join('x')}:${ride.wave ?? ''}`
    let parts = models.get(key)
    if (!parts) {
      parts = rideModel(ride.kind, ride.size, ride.wave).parts
      models.set(key, parts)
    }
    const meshes = ride.parts.map((packed) => {
      if (!packed.index.length) return null
      const geometry = geometryOf(packed)
      disposables.push(geometry)
      const mesh = new THREE.Mesh(geometry, rideMaterial)
      mesh.matrixAutoUpdate = false
      mesh.receiveShadow = true
      root.add(mesh)
      return mesh
    })
    rides.push({ meshes, anims: parts.map((part) => part.anim), base: new THREE.Matrix4().fromArray(ride.base), clock: rideClock(ride.id, ride.rideTime, ride.loadTime) })
  }

  const partMatrix = new THREE.Matrix4()
  const update = (dt: number): void => {
    for (const ride of rides) {
      ride.clock.step(dt)
      ride.meshes.forEach((mesh, i) => {
        const anim = ride.anims[i]
        if (!mesh || !anim) return
        partMatrix.fromArray(anim(ride.clock.anim, i))
        mesh.matrix.multiplyMatrices(ride.base, partMatrix)
        mesh.matrixWorldNeedsUpdate = true
      })
    }
  }
  update(0)

  const dispose = (): void => {
    root.removeFromParent()
    for (const resource of disposables) resource.dispose()
  }
  return { root, name: payload.name, owner: payload.owner, lot: payload.lot, update, dispose }
}
