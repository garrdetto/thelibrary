import { test } from 'node:test'
import assert from 'node:assert/strict'
import RAPIER from '@dimforge/rapier3d-compat'
import { TRUCK_BY_ID, trailerForKind } from '../shared/Catalog'
import { SURFACE_GRIP, getTerrain } from '../shared/Terrain'
import { CHUNK_SIZE, DEFAULT_SPAWN, ROADS } from '../shared/WorldLayout'
import { FIXED_DT, MAX_STEPS, SimWorld } from '../sim/SimWorld'
import { TruckRig } from '../sim/TruckRig'
import { TrailerRig } from '../sim/TrailerRig'
import { ExcavatorRig } from '../sim/ExcavatorRig'
import { couple } from '../sim/Coupling'
import { emptyInput, emptyMachineInput, toWorld } from '../sim/types'

const terrain = getTerrain()

function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return s / 4294967296
  }
}

test('streamed heightfield chunks match the terrain under raycasts', async () => {
  const world = await SimWorld.create(terrain)
  const at = [{ x: DEFAULT_SPAWN.x, z: DEFAULT_SPAWN.z }, { x: 700, z: -1300 }]
  const loaded = world.stream(at)
  assert.equal(loaded, 18, 'nine chunks around each point')
  world.tick()
  const rand = random(7)
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  let worst = 0
  for (let i = 0; i < 400; i++) {
    const centre = at[i % 2]
    const x = centre.x + (rand() - 0.5) * (CHUNK_SIZE * 2 - 12)
    const z = centre.z + (rand() - 0.5) * (CHUNK_SIZE * 2 - 12)
    ray.origin = { x, y: 200, z }
    const hit = world.world.castRay(ray, 400, true)
    assert.ok(hit, `ground under ${x.toFixed(0)}, ${z.toFixed(0)}`)
    const error = Math.abs(200 - hit.timeOfImpact - terrain.heightAt(x, z))
    worst = Math.max(worst, error)
  }
  console.log(`  heightfield vs terrain: worst ${worst.toFixed(3)} m over 400 rays`)
  assert.ok(worst < 0.15, `worst error ${worst.toFixed(3)} m`)
  world.dispose()
})

test('streaming loads the ring around each point, unloads what is left behind and respects a load budget', async () => {
  const world = await SimWorld.create(terrain)
  world.stream([{ x: 10, z: 10 }])
  assert.equal(world.loadedChunks, 9)
  assert.ok(world.hasChunk(0, 0) && world.hasChunk(-1, -1) && world.hasChunk(1, 1))
  world.stream([{ x: 10 + CHUNK_SIZE * 2, z: 10 }])
  assert.equal(world.loadedChunks, 12, 'chunks up to two rings away stay loaded')
  assert.equal(world.hasChunk(-1, 0), false, 'three rings away unloads')
  world.stream([{ x: 10 + CHUNK_SIZE * 4, z: 10 }])
  assert.equal(world.hasChunk(0, 0), false, 'left-behind chunks unload')
  assert.equal(world.hasChunk(1, 0), false)
  assert.equal(world.hasChunk(4, 0), true)
  const budget = world.stream([{ x: -1500, z: 1500 }], 2)
  assert.equal(budget, 2)
  assert.ok(world.hasChunk(SimWorld.chunkOf(-1500), SimWorld.chunkOf(1500)), 'nearest chunk first')
  world.stream([{ x: 2040, z: 2040 }])
  assert.equal(world.loadedChunks, 4, 'no chunks past the world edge')
  world.dispose()
})

test('grip follows the surface and the fixed step keeps time', async () => {
  const world = await SimWorld.create(terrain)
  const [x, z] = ROADS.find((r) => r.kind === 'highway')!.points[0]
  assert.equal(world.gripAt(x, z), SURFACE_GRIP.asphalt)
  assert.equal(world.gripAt(-1800, -1800), SURFACE_GRIP[terrain.surfaceAt(-1800, -1800)])
  assert.equal(world.step(FIXED_DT * 2), 2)
  assert.equal(world.step(FIXED_DT * 0.5), 0)
  assert.ok(Math.abs(world.alpha - 0.5) < 1e-6)
  assert.equal(world.step(1), MAX_STEPS, 'a long frame runs at most five steps')
  let calls = 0
  const off = world.onBeforeStep(() => calls++)
  world.step(FIXED_DT * 3 + 1e-6)
  off()
  world.step(FIXED_DT)
  assert.equal(calls, 3)
  world.dispose()
})

test('a rig on the county terrain rests on its wheels, drives, and disposing leaves nothing behind', async () => {
  const world = await SimWorld.create(terrain)
  world.stream([DEFAULT_SPAWN])
  const box = world.addStaticBox({ x: DEFAULT_SPAWN.x + 40, y: terrain.heightAt(DEFAULT_SPAWN.x + 40, DEFAULT_SPAWN.z) + 3, z: DEFAULT_SPAWN.z, hx: 6, hy: 3, hz: 8, rotY: 0.3 })
  world.tick()
  const model = TRUCK_BY_ID['ridgeline-rd10']
  const truck = new TruckRig(world, model, DEFAULT_SPAWN)
  const tractor = TRUCK_BY_ID['kestrel-cx-day']
  const semi = new TruckRig(world, tractor, { x: DEFAULT_SPAWN.x - 20, z: DEFAULT_SPAWN.z + 0.1 - tractor.fifthWheelZ!, heading: 0 })
  const trailer = new TrailerRig(world, trailerForKind('reefer'), { x: DEFAULT_SPAWN.x - 20, z: DEFAULT_SPAWN.z, heading: 0 })
  const machine = new ExcavatorRig(world, { x: DEFAULT_SPAWN.x + 20, z: DEFAULT_SPAWN.z - 30, heading: 0 })
  const input = emptyInput()
  input.parkingBrake = true
  const control = emptyMachineInput()
  const tick = (): void => world.tick((h) => {
    truck.update(h, input)
    semi.update(h, input)
    trailer.update(h)
    machine.update(h, control)
  })
  for (let i = 0; i < 150; i++) tick()
  const pose = truck.pose()
  assert.equal(pose.wheels.length, model.axles.length * 2)
  for (const wheel of pose.wheels) {
    const hub = toWorld(pose, wheel)
    const gap = hub.y - wheel.radius - terrain.heightAt(hub.x, hub.z)
    assert.ok(Math.abs(gap) < 0.12, `wheel ${gap.toFixed(3)} m off the ground`)
  }
  assert.equal(couple(semi, trailer).ok, true)
  input.parkingBrake = false
  input.throttle = 0.6
  for (let i = 0; i < 600; i++) tick()
  assert.ok(truck.speedKph > 20, `drives on the county road (${truck.speedKph.toFixed(0)} km/h)`)
  world.stream([truck.pose().position])
  const before = world.counts()
  assert.equal(before.bodies, 4)
  assert.equal(before.joints, 1)
  truck.dispose()
  semi.dispose()
  trailer.dispose()
  machine.dispose()
  const after = world.counts()
  assert.deepEqual({ bodies: after.bodies, joints: after.joints }, { bodies: 0, joints: 0 })
  assert.equal(after.colliders, world.loadedChunks + 4 + 1, 'only terrain, walls and the static box remain')
  world.removeStatic(box)
  world.stream([])
  assert.equal(world.loadedChunks, 0)
  assert.equal(world.counts().colliders, 4, 'only the world-edge walls remain')
  const leaked = new TruckRig(world, model, DEFAULT_SPAWN)
  assert.equal(world.counts().bodies, 1)
  leaked.wheels.dispose()
  assert.deepEqual(world.dispose(), { bodies: 0, colliders: 0, joints: 0 }, 'dispose removed the leaked body too')
  assert.equal(world.disposed, true)
  assert.deepEqual(world.counts(), { bodies: 0, colliders: 0, joints: 0 })
})
