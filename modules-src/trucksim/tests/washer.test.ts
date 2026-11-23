import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { applyAction } from '../shared/Actions'
import type { ActionContext } from '../shared/Actions'
import { defaultProfile } from '../shared/Economy'
import type { Profile } from '../shared/Economy'
import { footprintGap, itemFootprint, validateItem, washSpots, washerBesideShop } from '../shared/Lots'
import type { BuildItem } from '../shared/Lots'
import { BUILDING_BY_ID, OWN_WASH_WATER, WASHER_SHOP_GAP_M } from '../shared/Catalog'
import { COUNTY } from '../shared/RoadGraph'
import { LOTS } from '../shared/WorldLayout'
import { MaterialLibrary } from '../render/Materials'
import { LotRenderer } from '../render/Lots'
import { HOSE_POINTS, WashGear, hosePath } from '../render/models/WashGear'
import { getTerrain } from '../shared/Terrain'

class FakeCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext(): unknown {
    return new Proxy({ measureText: () => ({ width: 10 }) } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : () => undefined), set: () => true })
  }
}
;(globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas

const ctx: ActionContext = { now: 0, world: COUNTY }
const LOT = LOTS[1]
const shop: BuildItem = { id: 's', def: 'shop-steel', x: 10, z: 10, w: 16, d: 24, rot: 0, color: '#8d969e' }
const washer = (x: number, z: number, id = 'p'): BuildItem => ({ id, def: 'pressure-washer', x, z, w: 1, d: 2, rot: 0, color: '#d8a21c' })
const dirty = (build: BuildItem[], cash = 1_000_000): Profile => {
  const profile = { ...defaultProfile(), cash, lot: 1, build }
  return { ...profile, trucks: profile.trucks.map((truck) => ({ ...truck, dirt: 80 })) }
}

test('the pressure washer is a cheap add-on that washes', () => {
  const def = BUILDING_BY_ID['pressure-washer']
  assert.ok(def)
  assert.equal(def.cost, 2800)
  assert.equal(def.wash, true)
  assert.equal(BUILDING_BY_ID['wash-bay'].wash, true)
})

test('footprintGap measures the straight-line gap between footprints', () => {
  assert.equal(footprintGap({ x: 0, z: 0, w: 2, d: 2 }, { x: 1, z: 1, w: 2, d: 2 }), 0)
  assert.equal(footprintGap({ x: 0, z: 0, w: 2, d: 2 }, { x: 5, z: 0, w: 2, d: 2 }), 3)
  assert.equal(footprintGap({ x: 0, z: 0, w: 2, d: 2 }, { x: 5, z: 6, w: 2, d: 2 }), 5)
})

test('a pressure washer has to stand beside a steel shop', () => {
  const size = { w: LOT.w, d: LOT.d }
  const shopRight = itemFootprint(shop).x + itemFootprint(shop).w
  const near = washer(shopRight + 2, 15)
  const edge = washer(shopRight + WASHER_SHOP_GAP_M, 15)
  const far = washer(shopRight + WASHER_SHOP_GAP_M + 2, 15)
  assert.equal(validateItem(near, [shop], size), null)
  assert.equal(validateItem(edge, [shop], size), null)
  assert.match(validateItem(far, [shop], size) ?? '', /steel shop/)
  assert.match(validateItem(near, [], size) ?? '', /steel shop/)
  assert.equal(washerBesideShop(near, [shop]), true)
  assert.equal(washerBesideShop(far, [shop]), false)
  const built = applyAction({ ...defaultProfile(), cash: 1_000_000, lot: 1 }, { action: 'build', items: [shop, near] }, ctx)
  assert.equal(built.ok, true, built.message)
  const alone = applyAction({ ...defaultProfile(), cash: 1_000_000, lot: 1 }, { action: 'build', items: [near] }, ctx)
  assert.equal(alone.ok, false)
})

test('washSpots lists wash bays and washers next to a shop, not orphaned washers', () => {
  const shopRight = itemFootprint(shop).x + itemFootprint(shop).w
  const near = washer(shopRight + 2, 15)
  const orphan = washer(shopRight + 20, 15, 'o')
  const bay: BuildItem = { id: 'b', def: 'wash-bay', x: 60, z: 10, w: 8, d: 22, rot: 0, color: '#2c6db5' }
  assert.deepEqual(washSpots([shop, near, orphan]).map((item) => item.id), ['p'])
  assert.deepEqual(washSpots([near]).map((item) => item.id), [])
  assert.deepEqual(washSpots([bay]).map((item) => item.id), ['b'])
})

test('washing at your own place needs a wash bay or a washer beside the shop', () => {
  const shopRight = itemFootprint(shop).x + itemFootprint(shop).w
  const none = applyAction(dirty([shop]), { action: 'wash', uid: 't1', cleaned: 1, place: 'own' }, ctx)
  assert.equal(none.ok, false)
  assert.match(none.message, /pressure washer/)
  const orphan = applyAction(dirty([washer(shopRight + 2, 15)]), { action: 'wash', uid: 't1', cleaned: 1, place: 'own' }, ctx)
  assert.equal(orphan.ok, false)
  const washed = applyAction(dirty([shop, washer(shopRight + 2, 15)]), { action: 'wash', uid: 't1', cleaned: 0.5, place: 'own' }, ctx)
  assert.equal(washed.ok, true, washed.message)
  assert.equal(washed.delta, -OWN_WASH_WATER)
  assert.equal(washed.profile.trucks[0].dirt, 40)
})

test('the hose sags between its ends and never sinks into the ground', () => {
  const from = { x: 0, y: 1.1, z: 0 }
  const to = { x: 8, y: 1.4, z: 0 }
  const path = hosePath(from, to, 0)
  assert.equal(path.length, HOSE_POINTS)
  assert.ok(Vector3.Distance(path[0], new Vector3(0, 1.1, 0)) < 1e-9)
  assert.ok(Vector3.Distance(path.at(-1)!, new Vector3(8, 1.4, 0)) < 1e-9)
  const middle = path[Math.floor(HOSE_POINTS / 2)]
  assert.ok(middle.y < 1.1, `sags: ${middle.y}`)
  for (const point of hosePath(from, { x: 30, y: 1.2, z: 0 }, 0)) assert.ok(point.y >= 0.02, `above ground: ${point.y}`)
  const reuse = hosePath(from, to, 0)
  assert.equal(hosePath(from, { x: 2, y: 1, z: 2 }, 0, HOSE_POINTS, reuse), reuse)
})

test('the wand and hose, and a lot with a pressure washer, dispose back to the baseline', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('frame', scene)
  const lots = new LotRenderer(scene, parent, mats, getTerrain())
  const warm = new WashGear(scene, mats, { x: 0, y: 1.1, z: 0 })
  warm.dispose()
  const count = () => ({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometries: scene.geometries.length, materials: scene.materials.length })
  const baseline = count()
  for (let round = 0; round < 3; round++) {
    const gear = new WashGear(scene, mats, round === 1 ? null : { x: 0, y: 1.1, z: 0 })
    assert.ok(gear.meshes.length >= 4)
    for (let k = 0; k < 20; k++) gear.aim(new Vector3(3 + k * 0.1, 1.5, 2), new Vector3(0, 0, 1))
    const tip = gear.wand.position.add(new Vector3(0, 0, 1))
    assert.ok(Vector3.Distance(tip, new Vector3(4.9, 1.5, 2)) < 1e-6, 'the wand ends at the nozzle')
    gear.dispose()
    assert.deepEqual(count(), baseline, `round ${round}`)
  }
  const shopRight = itemFootprint(shop).x + itemFootprint(shop).w
  for (let round = 0; round < 2; round++) {
    lots.setLot(LOT, { name: 'driver', company: 'Test Hauling' }, [shop, washer(shopRight + 2, 15), { ...washer(shopRight + 2, 20, 'q'), rot: 1 }])
    assert.ok(lots.meshes(LOT.index).length > 0)
    lots.clear(LOT.index)
  }
  lots.dispose()
  mats.dispose()
  parent.dispose()
  assert.equal(scene.meshes.length, 0)
  scene.dispose()
  engine.dispose()
})
