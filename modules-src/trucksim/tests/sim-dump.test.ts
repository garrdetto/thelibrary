import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRUCK_BY_ID } from '../shared/Catalog'
import { DumpBody, FLOW_START_DEG, HOIST_DEG_PER_S, MAX_FLOW_KG_S, TAILGATE_OPEN_DEG } from '../sim/Dump'
import { LoaderAI } from '../sim/LoaderAI'
import type { LoaderPhase } from '../sim/LoaderAI'
import { FlatWorld } from '../sim/SimWorld'
import { TruckRig } from '../sim/TruckRig'
import { emptyInput } from '../sim/types'

const SPEC = TRUCK_BY_ID['ridgeline-rd10'].dump!
const H = 1 / 60

function run(seconds: number, fn: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) fn()
}

test('the dump bed loads to capacity, hoists at 6°/s, opens the tailgate past 8° and flows out past 28°', () => {
  const bed = new DumpBody(SPEC)
  assert.equal(bed.add(9000, 'gravel'), 9000)
  assert.equal(bed.add(2000, 'sand'), 0, 'no mixing materials')
  assert.equal(bed.add(9000, 'gravel'), SPEC.capacityKg - 9000, 'stops at capacity')
  assert.equal(bed.fill, 1)
  bed.target = 1
  run(1, () => bed.update(H))
  assert.ok(Math.abs(bed.angleDeg - HOIST_DEG_PER_S) < 0.01, `1 s of hoist: ${bed.angleDeg.toFixed(2)}°`)
  assert.equal(bed.tailgate, 0, 'tailgate shut below 8°')
  let dumped = 0
  run((FLOW_START_DEG - 6) / HOIST_DEG_PER_S - 0.05, () => {
    dumped += bed.update(H)
  })
  assert.ok(bed.angleDeg > TAILGATE_OPEN_DEG + 12 && bed.tailgate > 0.999, 'tailgate hangs open')
  assert.equal(dumped, 0, 'nothing slides out below 28°')
  let peak = 0
  run(20, () => {
    const kg = bed.update(H)
    peak = Math.max(peak, kg / H)
    dumped += kg
  })
  assert.ok(Math.abs(dumped - SPEC.capacityKg) < 1e-6, `dumped ${dumped}`)
  assert.equal(bed.loadKg, 0)
  assert.equal(bed.material, null)
  assert.ok(peak <= MAX_FLOW_KG_S + 1e-6 && peak > MAX_FLOW_KG_S * 0.9, `peak flow ${peak.toFixed(0)} kg/s`)
  assert.ok(Math.abs(bed.angle - bed.maxAngle) < 1e-9, 'stops at the maximum angle')
  bed.target = -1
  run(10, () => bed.update(H))
  assert.equal(bed.angle, 0)
  assert.ok(bed.lowered && bed.tailgate === 0)
})

test('a loaded dump truck empties when the bed is raised and its mass follows the load', async () => {
  const world = await FlatWorld.create()
  const model = TRUCK_BY_ID['ridgeline-rd10']
  const truck = new TruckRig(world, model, { x: 0, z: 0, heading: 0 })
  truck.dump!.add(SPEC.capacityKg, 'gravel')
  const input = emptyInput()
  input.parkingBrake = true
  const tick = (): void => world.tick((h) => truck.update(h, input))
  run(1, tick)
  assert.equal(truck.payloadKg, SPEC.capacityKg)
  assert.ok(Math.abs(truck.body.mass() - model.massKg - SPEC.capacityKg) < 1)
  truck.dump!.target = 1
  let dumped = 0
  let angle = 0
  run(25, () => {
    tick()
    dumped += truck.lastDumpKg
    angle = Math.max(angle, truck.pose().dumpAngle)
  })
  assert.ok(Math.abs(dumped - SPEC.capacityKg) < 1, `dumped ${dumped.toFixed(0)} kg`)
  assert.equal(truck.payloadKg, 0)
  assert.ok(Math.abs(truck.body.mass() - model.massKg) < 1)
  assert.ok(angle > (SPEC.maxAngleDeg - 1) * (Math.PI / 180), 'bed went all the way up')
  assert.ok(truck.pose().tailgate > 0.99)
  const pos = truck.body.translation()
  assert.ok(Math.hypot(pos.x, pos.z) < 0.1, 'parked truck did not move while dumping')
  truck.dump!.target = -1
  run(10, tick)
  assert.equal(truck.pose().dumpAngle, 0)
  truck.dispose()
  world.dispose()
})

test('the excavator cycles idle → waiting → dig → swing → dump → return → done, one bucket at a time', () => {
  const loader = new LoaderAI({ kind: 'excavator', bucketKg: 2000, side: -1 })
  const seen: LoaderPhase[] = [loader.phase]
  const note = (): void => {
    if (seen[seen.length - 1] !== loader.phase) seen.push(loader.phase)
  }
  run(2, () => {
    loader.update(H, false, 0)
    note()
  })
  assert.equal(loader.phase, 'idle')
  run(3, () => {
    loader.update(H, false, 5000)
    note()
  })
  assert.equal(loader.phase, 'waiting', 'waits for the truck to be ready')
  let load = 0
  let biggest = 0
  let swingSide = 0
  run(120, () => {
    const poured = loader.update(H, true, 5000 - load)
    load += poured
    biggest = Math.max(biggest, loader.bucketLoad)
    if (loader.phase === 'dump') swingSide = loader.armPose().swing
    note()
  })
  assert.ok(Math.abs(load - 5000) < 1e-6, `delivered ${load}`)
  assert.equal(loader.phase, 'done')
  assert.ok(biggest <= 2000 + 1e-9)
  assert.ok(swingSide < -1.4, 'swings to the truck on its right')
  assert.deepEqual(seen.slice(0, 7), ['idle', 'waiting', 'dig', 'swing', 'dump', 'return', 'dig'])
  assert.equal(seen[seen.length - 1], 'done')
  loader.reset()
  assert.equal(loader.phase, 'idle')
})

test('the loader holds a full bucket until the truck is ready again', () => {
  const loader = new LoaderAI({ kind: 'loader', bucketKg: 6000 })
  let poured = 0
  run(1, () => loader.update(H, true, 10000))
  assert.equal(loader.phase, 'dig')
  run(loader.timing.dig + 0.1, () => {
    poured += loader.update(H, true, 10000)
  })
  assert.equal(loader.phase, 'swing')
  run(loader.timing.swing + 3, () => {
    poured += loader.update(H, false, 10000)
  })
  assert.equal(loader.phase, 'swing', 'holds over the truck')
  assert.equal(poured, 0)
  assert.equal(loader.armPose().fill, 1)
  assert.ok(loader.armPose().travel > 0.99, 'drove to the truck')
  run(0.5, () => {
    poured += loader.update(H, true, 10000)
  })
  assert.equal(loader.phase, 'dump')
})

test('the loader fills a parked dump truck to capacity and the truck carries the weight', async () => {
  const world = await FlatWorld.create()
  const model = TRUCK_BY_ID['ironhaul-dx']
  const truck = new TruckRig(world, model, { x: 0, z: 0, heading: 0 })
  const loader = new LoaderAI({ kind: 'loader', bucketKg: 6500 })
  const input = emptyInput()
  input.parkingBrake = true
  const bed = truck.dump!
  let seconds = 0
  while (loader.phase !== 'done' && seconds < 300) {
    world.tick((h) => {
      const ready = input.parkingBrake && Math.abs(truck.speed) < 0.1
      const poured = loader.update(h, ready, bed.capacityKg - bed.loadKg)
      if (poured > 0) bed.add(poured, 'limestone')
      truck.update(h, input)
    })
    seconds += H
  }
  console.log(`  wheel loader filled ${(bed.loadKg / 1000).toFixed(1)} t in ${seconds.toFixed(0)} s`)
  assert.equal(loader.phase, 'done')
  assert.ok(Math.abs(bed.loadKg - bed.capacityKg) < 1e-6, `loaded ${bed.loadKg}`)
  world.tick((h) => truck.update(h, input))
  assert.equal(truck.payloadKg, bed.capacityKg)
  assert.equal(truck.liftAxlesDown, true, 'lift axle came down under the load')
  assert.ok(Math.abs(truck.body.mass() - model.massKg - bed.capacityKg) < 1)
  truck.dispose()
  world.dispose()
})
