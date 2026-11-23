import { test } from 'node:test'
import assert from 'node:assert/strict'
import RAPIER from '@dimforge/rapier3d-compat'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { DEFAULT_SPAWN, ROADS } from '../shared/WorldLayout'
import { getTerrain } from '../shared/Terrain'
import { KINDS, SPEED_LIMIT, Traffic, buildLanes, sampleLane } from '../sim/Traffic'
import { DEFAULT_GROUPS } from '../sim/PhysicsHost'
import { MaterialLibrary } from '../render/Materials'
import { TrafficVisuals } from '../render/TrafficVisuals'

const terrain = getTerrain()
const heightAt = (x: number, z: number) => terrain.heightAt(x, z)
const focus = { x: DEFAULT_SPAWN.x, z: DEFAULT_SPAWN.z }

test('traffic keeps its lanes moving: under the limit, never closer than a standstill gap, turning at junctions', () => {
  const lanes = buildLanes(ROADS)
  assert.ok(lanes.reduce((n, l) => n + l.junctions.length, 0) > 20, 'the roads meet at junctions')
  const traffic = new Traffic(lanes, heightAt, 7, 20)
  let turns = 0
  let moving = 0
  const lastLane = new Map<number, number>()
  for (let i = 0; i < 60 * 180; i++) {
    traffic.update(1 / 60, focus)
    for (const a of traffic.agents) {
      if (lastLane.has(a.id) && lastLane.get(a.id) !== a.lane) turns++
      lastLane.set(a.id, a.lane)
      assert.ok(Number.isFinite(a.x + a.y + a.z + a.heading + a.roll + a.pitch))
      assert.ok(a.v <= lanes[a.lane].limit * 1.03, `${a.kind} at ${a.v.toFixed(1)} m/s on a ${lanes[a.lane].limit.toFixed(1)} m/s road`)
      if (i % 600 !== 0) continue
      for (const b of traffic.agents) {
        if (b === a || b.lane !== a.lane || b.dir !== a.dir) continue
        const gap = Math.abs(b.s - a.s) - (a.spec.length + b.spec.length) / 2
        assert.ok(gap > 1, `${a.kind} and ${b.kind} ${gap.toFixed(1)} m apart`)
      }
    }
  }
  for (const a of traffic.agents) if (a.v > 2) moving++
  assert.equal(traffic.agents.length, 20)
  assert.ok(turns >= 10, `${turns} turns in three minutes`)
  assert.ok(moving >= 14, `${moving} of 20 still moving (no dead-end jams)`)
})

test('traffic brakes smoothly to a stop behind the player rig and leaves a gap', () => {
  const traffic = new Traffic(buildLanes(ROADS), heightAt, 3, 12)
  for (let i = 0; i < 60 * 20; i++) traffic.update(1 / 60, focus)
  const clearRun = (a: (typeof traffic.agents)[number]) => {
    const lane = traffic.lanes[a.lane]
    const room = lane.loop ? Infinity : a.dir > 0 ? lane.length - a.s : a.s
    return room > 140 && lane.junctions.every((j) => { const d = (j.s - a.s) * a.dir; return d < 0 || d > 140 })
  }
  let car = traffic.agents.find((a) => a.v > 8 && clearRun(a))
  for (let i = 0; i < 60 * 60 && !car; i++) {
    traffic.update(1 / 60, focus)
    car = traffic.agents.find((a) => a.v > 8 && clearRun(a))
  }
  if (!car) throw new Error('no car with a clear run')
  assert.ok(car, 'a car at speed')
  const lane = traffic.lanes[car.lane]
  const at = sampleLane(lane, car.s + car.dir * 90, { x: 0, z: 0, dx: 0, dz: 1, curve: 0 })
  const rig = { x: at.x - at.dz * car.dir * lane.offset, z: at.z + at.dx * car.dir * lane.offset, vx: 0, vz: 0, half: 8 }
  let hardest = 0
  for (let i = 0; i < 60 * 30; i++) {
    traffic.update(1 / 60, focus, [rig])
    hardest = Math.min(hardest, car.accel)
  }
  const distance = Math.hypot(car.x - rig.x, car.z - rig.z)
  assert.ok(car.v < 0.3, `stopped (${car.v.toFixed(2)} m/s)`)
  assert.ok(distance > rig.half + car.spec.length / 2 + 1, `a gap is left (${distance.toFixed(1)} m between centres)`)
  assert.ok(hardest > -6, `no panic stop (${hardest.toFixed(1)} m/s²)`)
})

test('bodies lean out in curves and dive under braking; semis are slower to pull away', () => {
  assert.ok(KINDS.semi.accel < KINDS.sedan.accel && KINDS.semi.headway > KINDS.sedan.headway)
  assert.ok(SPEED_LIMIT.highway > SPEED_LIMIT.street)
  const lanes = buildLanes(ROADS)
  const highway = lanes.find((l) => l.road.kind === 'highway')!
  const probe = { x: 0, z: 0, dx: 0, dz: 1, curve: 0 }
  let corner = { x: 0, z: 0, curve: 0 }
  for (let s = 0; s < highway.length; s += 5) {
    sampleLane(highway, s, probe)
    if (Math.abs(probe.curve) > corner.curve) corner = { x: probe.x, z: probe.z, curve: Math.abs(probe.curve) }
  }
  const traffic = new Traffic(lanes, heightAt, 11, 20)
  let rolled = 0, dived = 0
  for (let i = 0; i < 60 * 120; i++) {
    traffic.update(1 / 60, corner)
    for (const a of traffic.agents) {
      if (Math.abs(a.roll) > 0.004) rolled++
      if (a.accel < -0.8 && a.pitch < 0) dived++
    }
  }
  assert.ok(rolled > 0, 'bodies roll in curves')
  assert.ok(dived > 0, 'noses dive under braking')
})

test('traffic visuals and bodies follow the agents and dispose back to the baseline', async () => {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const host = { rapier: RAPIER, world, groups: DEFAULT_GROUPS, heightAt, gripAt: () => 1 }
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const parent = new TransformNode('frame', scene)
  const mats = new MaterialLibrary(scene)
  const traffic = new Traffic(buildLanes(ROADS), heightAt, 5, 10, 0.4)
  const visuals = new TrafficVisuals(scene, parent, mats, host, traffic)
  const baseline = scene.meshes.length
  for (let i = 0; i < 60 * 5; i++) {
    traffic.update(1 / 60, focus)
    visuals.sync(1 / 60, false)
    world.step()
  }
  assert.equal(visuals.count, traffic.agents.length)
  assert.ok(traffic.agents.some((a) => a.kind === 'semi'), 'semis drive too')
  assert.ok(world.bodies.len() >= traffic.agents.length, 'every vehicle is solid')
  traffic.agents.length = 0
  visuals.sync(1 / 60, false)
  assert.equal(visuals.count, 0)
  assert.equal(world.bodies.len(), 0)
  mats.trim(0)
  assert.equal(scene.meshes.length, baseline)
  visuals.dispose()
  mats.dispose()
  engine.dispose()
})
