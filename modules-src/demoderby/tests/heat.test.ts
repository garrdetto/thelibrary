/** Runs whole heats headlessly (AI only, no renderer): cars stay inside the barriers and on the ground, hits deal damage and dents, and every heat ends with one placed winner. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three/webgpu'
import { PhysicsWorld } from '../../../engine'
import { bodyById, config } from '../config'
import { createBrain, driveAi, type AiBrain } from '../systems/Ai'
import { Heat } from '../systems/Heat'
import { opponentLook } from '../systems/Look'
import { Vehicle } from '../systems/Vehicle'
import type { StubCarModel } from './CarBodyStub'

function percentiles(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0)
  return { n: sorted.length, p10: at(0.1), p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) }
}

async function runHeat(seed: number, opponents: number, maxSeconds: number) {
  const physics = await PhysicsWorld.create(config.engine.physics)
  const { rapier, world } = physics
  const events = new rapier.EventQueue(true)
  const halfL = config.arena.length / 2
  const halfW = config.arena.width / 2
  world.createCollider(rapier.ColliderDesc.cuboid(110, 0.5, 110).setTranslation(0, -0.5, 0).setFriction(1))
  const walls: [number, number, number, number][] = [
    [0, -halfW, halfL + 0.3, 0.3],
    [0, halfW, halfL + 0.3, 0.3],
    [-halfL, 0, 0.3, halfW + 0.3],
    [halfL, 0, 0.3, halfW + 0.3],
  ]
  for (const [x, z, hx, hz] of walls) world.createCollider(rapier.ColliderDesc.cuboid(hx, 0.45, hz).setTranslation(x, 0.45, z))
  const cars: Vehicle[] = []
  const brains = new Map<number, AiBrain>()
  const colliders = new Set<number>()
  const count = opponents + 1
  const taken = new Set<string>()
  for (let i = 0; i < count; i++) {
    const look = opponentLook(seed * 31 + i, taken)
    taken.add(look.number)
    const angle = (i / count) * Math.PI * 2 + Math.PI / count
    const position = new THREE.Vector3(Math.cos(angle) * halfL * config.heat.spawnRing, 0, Math.sin(angle) * halfW * config.heat.spawnRing)
    const car = new Vehicle(i + 1, look, bodyById(look.body), i === 0, physics, config.vehicle, position, Math.atan2(-position.x, -position.z))
    cars.push(car)
    colliders.add(car.collider.handle)
    brains.set(car.id, createBrain(config.ai[2], seed * 977 + i))
  }
  const heat = new Heat(cars, config.damage, config.scoring, 0.5, 1)
  heat.forceLog = []
  const filter = (collider: { handle: number }) => !colliders.has(collider.handle)
  const dt = 1 / 60
  let steps = 0
  let maxHeight = 0
  let flips = 0
  while (heat.state.phase !== 'finished' && steps < maxSeconds * 60) {
    for (const car of cars) {
      const brain = brains.get(car.id)
      if (brain && heat.running) driveAi(brain, car, cars, { halfL, halfW }, dt)
      if (car.alive && car.flippedFor > config.vehicle.flipRecoverSeconds) {
        car.rightSelf()
        flips++
      }
      car.update(dt, filter)
    }
    physics.step(dt, events)
    heat.resolveContacts(events)
    heat.tick(dt)
    for (const car of cars) {
      const p = car.pos
      maxHeight = Math.max(maxHeight, p.y)
      assert.ok(Math.abs(p.x) < halfL + 2 && Math.abs(p.z) < halfW + 2, `car ${car.id} left the arena at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} on step ${steps}`)
      assert.ok(p.y > -1, `car ${car.id} fell through the floor`)
    }
    steps++
  }
  const summary = {
    seconds: Math.round(steps / 60),
    phase: heat.state.phase,
    winner: heat.state.winner?.id ?? null,
    maxHeight: Number(maxHeight.toFixed(2)),
    flips,
    hits: cars.map((car) => car.hitsLanded),
    health: cars.map((car) => Math.round(car.health)),
    engine: cars.map((car) => Math.round(car.engine)),
    places: cars.map((car) => car.place),
    reasons: cars.map((car) => car.outReason),
    dents: cars.map((car) => (car.model as StubCarModel).dentCount),
    points: cars.map((car) => car.points),
    forces: percentiles(heat.forceLog ?? []),
  }
  for (const car of cars) car.dispose()
  events.free()
  physics.dispose()
  return summary
}

test('a six-car heat ends with one winner, real damage and dents', async () => {
  const result = await runHeat(1, 5, 600)
  console.log(JSON.stringify(result))
  assert.equal(result.phase, 'finished')
  assert.ok(result.winner !== null, 'someone wins')
  assert.ok(result.hits.reduce((a, b) => a + b, 0) > 10, 'cars land hits')
  assert.ok(result.dents.reduce((a, b) => a + b, 0) > 10, 'hits leave dents')
  assert.ok(result.places.every((place) => place >= 1), 'every car is placed')
  assert.equal(new Set(result.places).size, result.places.length, 'places are unique')
  assert.ok(result.maxHeight < 3, `cars stay near the ground (max ${result.maxHeight})`)
})

test('a ten-car veteran heat also finishes', async () => {
  const result = await runHeat(7, 9, 600)
  console.log(JSON.stringify(result))
  assert.equal(result.phase, 'finished')
  assert.ok(result.points.some((points) => points >= config.scoring.winPoints), 'the winner collects the win bonus')
})
