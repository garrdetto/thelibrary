import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CARGOS, TRAILERS } from '../shared/Catalog'
import type { CargoVisual, TrailerModel } from '../shared/Catalog'
import { ALL_ZONES, SITES } from '../shared/WorldLayout'
import type { BodyPose, ExcavatorPose, LoaderPose, TrailerPose, WheelPose } from '../sim/types'
import { MaterialLibrary } from '../render/Materials'
import { buildTrailerVisual } from '../render/models/TrailerVisual'
import { buildExcavator, buildForklift, buildWheelLoader } from '../render/models/MachineVisual'
import { FallingMaterial } from '../render/models/CargoVisual'
import { createWorkZones } from '../render/work/WorkZones'
import type { ZoneActivity } from '../game/Procedures'

function setup() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('parent', scene)
  return { engine, scene, mats, parent }
}

function counts(scene: Scene) {
  return { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length, textures: scene.textures.length, nodes: scene.transformNodes.length }
}

function wheelsFor(model: TrailerModel, spin: number): WheelPose[] {
  const out: WheelPose[] = []
  for (const z of model.axles) {
    for (const side of [1, -1]) out.push({ x: side * (model.width / 2 - 0.35), y: model.wheelRadius, z, steer: 0, spin, radius: model.wheelRadius, dual: true, lifted: false })
  }
  return out
}

function poseFor(model: TrailerModel, patch: Partial<TrailerPose> = {}): TrailerPose {
  return {
    position: { x: 10, y: 0, z: -20 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    wheels: wheelsFor(model, 0),
    landingGear: 1,
    gooseneck: null,
    doors: 0,
    brakeLights: false,
    ...patch,
  }
}

function box(meshes: readonly { getBoundingInfo(): { boundingBox: { centerWorld: { x: number; y: number; z: number } } }; computeWorldMatrix(force?: boolean): unknown }[]): { x: number; y: number; z: number } {
  let x = 0
  let y = 0
  let z = 0
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true)
    const c = mesh.getBoundingInfo().boundingBox.centerWorld
    x += c.x
    y += c.y
    z += c.z
  }
  return { x: x / meshes.length, y: y / meshes.length, z: z / meshes.length }
}

test('every trailer model builds, updates and disposes cleanly', () => {
  const { engine, scene, mats, parent } = setup()
  for (const model of TRAILERS) {
    const visual = buildTrailerVisual(scene, parent, model, model.defaultColor, mats)
    assert.ok(visual.meshes.length > 4, `${model.id} has meshes`)
    visual.update(poseFor(model))
    assert.equal(visual.root.parent, parent)
    assert.ok(Math.abs(visual.root.position.x - 10) < 1e-9)
    visual.dispose()
  }
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('update moves wheels, landing gear and doors', () => {
  const { engine, scene, mats, parent } = setup()
  const reefer = TRAILERS.find((t) => t.kind === 'reefer') as TrailerModel
  const visual = buildTrailerVisual(scene, parent, reefer, '#eef0f1', mats)
  visual.update(poseFor(reefer, { landingGear: 1, doors: 0 }))
  const node = (name: string) => scene.getTransformNodeByName(name) as TransformNode
  const wheel = node('trailer-wheel-0')
  const leg = node('trailer-leg--1')
  const left = node('trailer-door-left')
  const right = node('trailer-door-right')
  assert.ok(wheel && leg && left && right)
  const legDown = leg.position.y
  const doorShut = box(left.getChildMeshes())
  visual.update(poseFor(reefer, { landingGear: 0, doors: 1, wheels: wheelsFor(reefer, 1.25) }))
  assert.ok(leg.position.y > legDown + 0.4, 'leg retracts')
  assert.ok(Math.abs(wheel.rotation.x - 1.25) < 1e-9, 'wheel spins')
  const doorOpen = box(left.getChildMeshes())
  assert.ok(doorOpen.z - doorShut.z > 0.5, 'left door swings forward along the side')
  assert.ok(left.rotation.y > 1 && right.rotation.y < -1)
  const rightOpen = box(right.getChildMeshes())
  assert.ok(Math.abs(rightOpen.z - doorOpen.z) < 0.05 && rightOpen.x < 10 && doorOpen.x > 10, 'doors mirror each other')
  visual.dispose()

  const grain = TRAILERS.find((t) => t.kind === 'grain') as TrailerModel
  const hopper = buildTrailerVisual(scene, parent, grain, grain.defaultColor, mats)
  hopper.update(poseFor(grain, { doors: 0 }))
  const tarp = scene.getMeshByName('trailer-tarp-tarp') as Mesh
  assert.ok(tarp)
  const closed = tarp.scaling.z
  hopper.update(poseFor(grain, { doors: 1 }))
  assert.ok(tarp.scaling.z < closed * 0.2, 'tarp rolls back')
  hopper.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('the lowboy neck follows pose.gooseneck in world space', () => {
  const { engine, scene, mats, parent } = setup()
  const model = TRAILERS.find((t) => t.kind === 'lowboy') as TrailerModel
  const visual = buildTrailerVisual(scene, parent, model, model.defaultColor, mats)
  const neck = scene.getTransformNodeByName('trailer-gooseneck') as TransformNode
  assert.ok(neck)
  assert.equal(neck.parent, parent)
  visual.update(poseFor(model, { gooseneck: { position: { x: 40, y: 1.5, z: 7 }, rotation: { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) }, attached: false } }))
  assert.ok(Math.abs(neck.position.x - 40) < 1e-9 && Math.abs(neck.position.z - 7) < 1e-9 && Math.abs(neck.position.y - 1.5) < 1e-9)
  assert.ok(Math.abs((neck.rotationQuaternion as { y: number }).y - Math.sin(0.4)) < 1e-9)
  visual.update(poseFor(model, { gooseneck: null }))
  assert.ok(Math.abs(neck.position.x - 10) < 1e-9)
  assert.equal(scene.getTransformNodeByName('trailer-leg-1'), null)
  visual.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('every cargo visual builds at fill 0, 0.5 and 1 and straps show', () => {
  const { engine, scene, mats, parent } = setup()
  const flat = TRAILERS.find((t) => t.kind === 'flatbed') as TrailerModel
  const reefer = TRAILERS.find((t) => t.kind === 'reefer') as TrailerModel
  const tanker = TRAILERS.find((t) => t.kind === 'tanker') as TrailerModel
  const grain = TRAILERS.find((t) => t.kind === 'grain') as TrailerModel
  const lowboy = TRAILERS.find((t) => t.kind === 'lowboy') as TrailerModel
  const visuals = [flat, reefer, tanker, grain, lowboy].map((m) => buildTrailerVisual(scene, parent, m, m.defaultColor, mats))
  const seen = new Set<CargoVisual>()
  for (const cargo of CARGOS) {
    seen.add(cargo.visual)
    for (const visual of visuals) {
      for (const fill of [0, 0.5, 1]) visual.setCargo({ visual: cargo.visual, fill, color: cargo.color })
      visual.setCargo(null)
    }
  }
  for (const v of ['beams', 'coils', 'rebar', 'lumber', 'plywood', 'trusses', 'pipe', 'pallets'] as CargoVisual[]) assert.ok(seen.has(v), `${v} covered by CARGOS`)
  visuals[0].setCargo({ visual: 'beams', fill: 1, color: '#5c4a3f' })
  visuals[0].setStraps(3, 6)
  const enabled = scene.meshes.filter((m) => /^trailer-strap-\d+$/.test(m.name) && m.isEnabled()).length
  assert.equal(enabled, 3)
  const shown = (name: string) => scene.meshes.filter((m) => m.name.startsWith(name) && m.isEnabled()).length
  visuals[0].setCargo({ visual: 'beams', fill: 0.5, color: '#5c4a3f' })
  const half = shown('cargo-beams')
  visuals[0].setCargo({ visual: 'beams', fill: 1, color: '#5c4a3f' })
  assert.ok(shown('cargo-beams') > half)
  for (const v of visuals) v.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

function bodyPose(x = 0, z = 0): BodyPose {
  return { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } }
}

test('excavator, loader and forklift build and update', () => {
  const { engine, scene, mats, parent } = setup()
  const exc = buildExcavator(scene, parent, mats)
  const pose: ExcavatorPose = { ...bodyPose(5, 5), swing: 0.5, boom: 0.4, stick: 1.2, bucket: 0.6, trackL: 1.234, trackR: -0.4 }
  exc.update(pose)
  const rod = scene.getTransformNodeByName('exc-ram-boom-l-rod') as TransformNode
  const before = rod.position.y
  exc.update({ ...pose, boom: -0.3 })
  assert.notEqual(rod.position.y, before, 'ram follows the boom')
  const tread = scene.getTransformNodeByName('exc-tread-bottom--1') as TransformNode
  exc.update({ ...pose, trackL: 0 })
  const z0 = tread.position.z
  exc.update({ ...pose, trackL: 0.1 })
  assert.notEqual(tread.position.z, z0, 'tread scrolls')
  exc.update({ ...pose, trackL: 0.23 })
  assert.ok(Math.abs(tread.position.z - z0) < 1e-6 || Math.abs(Math.abs(tread.position.z - z0) - 0.23) < 1e-6, 'wraps at the link pitch')
  exc.dispose()
  const loader = buildWheelLoader(scene, parent, mats)
  const lp: LoaderPose = { ...bodyPose(), arm: 0.7, bucket: 0.3, spin: 2, steer: 0.4 }
  loader.update(lp)
  assert.ok(Math.abs((scene.getTransformNodeByName('loader-front') as TransformNode).rotation.y - 0.4) < 1e-9)
  loader.dispose()
  const lift = buildForklift(scene, parent, mats)
  lift.update(bodyPose(), 0.05, 2)
  lift.update(bodyPose(0, 1), 0.05, 2.5)
  assert.ok(Math.abs((scene.getTransformNodeByName('forklift-carriage') as TransformNode).position.y - 2.5) < 1e-9)
  lift.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('falling material pools its bits', () => {
  const { engine, scene, mats, parent } = setup()
  const fall = new FallingMaterial(scene, parent, mats, '#8d877d', 16)
  for (let i = 0; i < 60; i++) {
    fall.pour(0.05, 0, 3, 0, 1)
    fall.update(0.05, 0)
  }
  assert.ok(fall.active <= 16)
  for (let i = 0; i < 100; i++) fall.update(0.05, 0)
  assert.equal(fall.active, 0)
  fall.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('work zones build near a site, dispose when focus leaves, and report what they built', () => {
  const { engine, scene, mats, parent } = setup()
  const zones = createWorkZones(scene, parent, mats, ALL_ZONES, () => 0)
  assert.equal(zones.built, 0)
  const activity = new Map<string, ZoneActivity>()
  let total = 0
  for (const site of SITES) {
    if (!site.zones.some((z) => z.kind !== 'fuel' && z.kind !== 'service' && z.kind !== 'dealer')) continue
    zones.setFocus(site.x, site.z)
    zones.update(0.05, activity)
    assert.ok(zones.built > 0, `${site.id} builds`)
    for (const zone of site.zones) activity.set(zone.id, { phase: 'filling', progress: 0.5, arm: 0.5, flow: 1 })
    for (let i = 0; i < 6; i++) zones.update(0.1, activity)
    zones.highlight(new Set(site.zones.map((z) => z.id)))
    total++
    zones.setFocus(9000, 9000)
    zones.update(0.05, activity)
    assert.equal(zones.built, 0, `${site.id} disposed`)
    activity.clear()
  }
  assert.ok(total > 10)
  zones.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('20 build and dispose cycles return to the baseline', () => {
  const { engine, scene, mats, parent } = setup()
  const cycle = () => {
    const visuals = TRAILERS.map((m) => buildTrailerVisual(scene, parent, m, m.defaultColor, mats))
    visuals.forEach((v, i) => {
      v.update(poseFor(TRAILERS[i], { doors: 0.5 }))
      v.setCargo({ visual: i === 1 ? 'pallets' : i === 0 ? 'fuel' : i === 2 ? 'wheat' : 'coils', fill: 0.7, color: '#8f969d' })
      v.setStraps(2, 4)
    })
    const machines = [buildExcavator(scene, parent, mats), buildWheelLoader(scene, parent, mats), buildForklift(scene, parent, mats)]
    const fall = new FallingMaterial(scene, parent, mats, '#d3a93a', 8)
    fall.pour(0.2, 0, 2, 0, 1)
    const zones = createWorkZones(scene, parent, mats, ALL_ZONES, () => 0)
    zones.setFocus(1660, 880)
    zones.update(0.1, new Map())
    zones.setFocus(310, 1150)
    zones.update(0.1, new Map())
    zones.dispose()
    fall.dispose()
    machines.forEach((m) => m.dispose())
    visuals.forEach((v) => v.dispose())
  }
  cycle()
  mats.trim(0)
  const baseline = counts(scene)
  for (let i = 0; i < 20; i++) cycle()
  mats.trim(0)
  assert.deepEqual(counts(scene), baseline)
  mats.dispose()
  scene.dispose()
  engine.dispose()
})
