import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { homeRects, roadside } from '../shared/Roadside'
import { FIELDS, LOTS, ROADS, SITES, SITE_BY_ID, CHUNK_SIZE, lotExtent, MAX_LAND_STRIPS } from '../shared/WorldLayout'
import { getTerrain } from '../shared/Terrain'
import { placeChunkProps } from '../render/world/PropsPlacement'
import { RoadsideLayer, roadsideBoxes } from '../render/world/Roadside'
import { MaterialLibrary } from '../render/Materials'
import { qualitySettings } from '../render/Quality'
import type { ChunkContext } from '../render/world/WorldRenderer'

class FakeCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext(): unknown {
    return new Proxy({ measureText: () => ({ width: 10 }) } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : () => undefined), set: () => true })
  }
}
;(globalThis as Record<string, unknown>).OffscreenCanvas ??= FakeCanvas

const plan = roadside()
const inside = (r: { x: number; z: number; w: number; d: number }, x: number, z: number, pad = 0) => Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad

function roadDistance(x: number, z: number): number {
  let best = Infinity
  for (const road of ROADS) {
    const pts = road.loop ? [...road.points, road.points[0]] : road.points
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
      const dx = bx - ax, dz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z) - road.width / 2)
    }
  }
  return best
}

test('the roadside has posts, signs, chevrons, farmsteads, bales and parked cars, the same every time', () => {
  assert.ok(plan.posts.length > 300 && plan.signs.length > 20 && plan.chevrons.length > 10)
  assert.ok(plan.homes.length >= 6 && plan.bales.length > 10 && plan.parked.length > 15)
  assert.deepEqual(roadside(), plan)
  assert.ok(plan.signs.every((s) => ['25', '35', '45', '55'].includes(s.text)))
})

test('nothing stands on a site, a lot, a road or (bales aside) a field; parked cars stay in town', () => {
  const lots = LOTS.map((spec) => lotExtent(spec, MAX_LAND_STRIPS)).map((l) => ({ x: l.x + l.w / 2, z: l.z + l.d / 2, w: l.w, d: l.d }))
  for (const spot of [...plan.posts, ...plan.signs, ...plan.chevrons, ...plan.homes]) {
    assert.ok(!SITES.some((s) => s.kind !== 'town' && inside(s, spot.x, spot.z)), 'not on a site')
    assert.ok(!lots.some((l) => inside(l, spot.x, spot.z)), 'not on a lot')
    assert.ok(!FIELDS.some((f) => inside(f, spot.x, spot.z)), 'not in a field')
    assert.ok(roadDistance(spot.x, spot.z) > 0.5, 'off the road')
  }
  for (const home of plan.homes) assert.ok(roadDistance(home.x, home.z) > 20, 'farmsteads are set back')
  for (const bale of plan.bales) assert.ok(FIELDS.some((f) => f.crop === 'wheat' && inside(f, bale.x, bale.z)), 'bales lie in wheat fields')
  const town = SITE_BY_ID.town
  for (const car of plan.parked) assert.ok(inside(town, car.x, car.z), 'parked cars are in Millbrook')
})

test('no tree grows in a farmstead', () => {
  const terrain = getTerrain()
  const rects = homeRects()
  for (const home of plan.homes.slice(0, 6)) {
    const cx = Math.floor(home.x / CHUNK_SIZE), cz = Math.floor(home.z / CHUNK_SIZE)
    const props = placeChunkProps(terrain, cx, cz, 1)
    for (const batch of [props.oak, props.pine]) {
      for (let i = 0; i < batch.count; i++) {
        const x = batch.matrices[i * 16 + 12], z = batch.matrices[i * 16 + 14]
        assert.ok(!rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ), `a tree at ${x.toFixed(0)},${z.toFixed(0)} inside a farmstead`)
      }
    }
  }
})

test('farmsteads, parked vehicles and bales are solid; the layer disposes back to the baseline', () => {
  const terrain = getTerrain()
  const boxes = roadsideBoxes((x, z) => terrain.heightAt(x, z))
  assert.equal(boxes.length, plan.homes.length * 3 + plan.parked.length + plan.bales.length)
  for (const box of boxes) assert.ok(Number.isFinite(box.x + box.y + box.z) && box.hx > 0 && box.hz > 0)
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const parent = new TransformNode('frame', scene)
  const mats = new MaterialLibrary(scene)
  const layer = new RoadsideLayer(scene, mats)
  const home = plan.homes[0]
  const cx = Math.floor(home.x / CHUNK_SIZE), cz = Math.floor(home.z / CHUNK_SIZE)
  const root = new TransformNode('chunk', scene)
  const ctx: ChunkContext = { scene, parent, root, terrain, quality: qualitySettings('medium'), cx, cz, x0: cx * CHUNK_SIZE, z0: cz * CHUNK_SIZE, size: CHUNK_SIZE, distance: 0, addShadowCaster: () => {}, countInstances: () => {} }
  const before = scene.meshes.length + scene.geometries.length
  for (let round = 0; round < 3; round++) {
    const part = layer.build(cx, cz, ctx)
    assert.ok(part)
    part.dispose()
    assert.equal(scene.meshes.length + scene.geometries.length, before, `round ${round}`)
  }
  layer.dispose()
  mats.dispose()
  engine.dispose()
})
