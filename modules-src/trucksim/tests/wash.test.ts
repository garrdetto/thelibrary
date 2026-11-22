import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MaterialLibrary } from '../render/Materials'
import { LotRenderer } from '../render/Lots'
import { createDirtLayer, dirtRegions } from '../render/models/DirtLayer'
import { truckLayout } from '../render/models/truck/Layout'
import { TRUCKS } from '../shared/Catalog'
import { getTerrain } from '../shared/Terrain'
import { LAND_STRIP_M, LOTS, MAX_LAND_STRIPS, lotExtent } from '../shared/WorldLayout'

class FakeCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext(): unknown {
    return new Proxy({ measureText: () => ({ width: 10 }) } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : () => undefined), set: () => true })
  }
}
;(globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  return { engine, scene }
}

function counts(scene: Scene) {
  return { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.filter((texture) => texture !== scene.environmentBRDFTexture).length, nodes: scene.transformNodes.length }
}

test('grime sits on the bodywork of every truck, inside its width', () => {
  for (const model of TRUCKS) {
    const layout = truckLayout(model)
    const regions = dirtRegions(layout)
    assert.ok(regions.some((region) => region.strip === 'left') && regions.some((region) => region.strip === 'right') && regions.some((region) => region.strip === 'rear'), model.id)
    for (const region of regions) {
      assert.ok(region.a1 > region.a0 && region.y1 > region.y0, `${model.id} region has an area`)
      assert.ok(region.y0 >= 0 && region.y1 < layout.roofY, `${model.id} grime stays below the roof`)
      if (region.strip !== 'rear') assert.ok(Math.abs(region.plane) <= model.width / 2 + 0.06, `${model.id} grime hugs the side`)
    }
  }
})

test('spraying the side takes the mud off around the jet, and a miss takes nothing', () => {
  const { engine, scene } = makeScene()
  const root = new TransformNode('truck', scene)
  root.position.set(40, 2, -15)
  root.rotation.y = 0.7
  root.computeWorldMatrix(true)
  const model = TRUCKS[0]
  const layout = truckLayout(model)
  const layer = createDirtLayer(scene, root, layout)
  layer.setDirt(80)
  assert.equal(layer.level, 80)
  assert.ok(Math.abs(layer.remaining - 1) < 1e-6)
  const target = Vector3.TransformCoordinates(new Vector3(model.width / 2 + 0.04, layout.wheelR, 0), root.getWorldMatrix())
  const origin = Vector3.TransformCoordinates(new Vector3(model.width / 2 + 5, layout.wheelR + 0.5, 0), root.getWorldMatrix())
  const direction = target.subtract(origin).normalize()
  let removed = 0
  for (let i = 0; i < 30; i++) removed += layer.scrub(origin, direction, 1 / 30)?.removed ?? 0
  assert.ok(removed > 0, 'the jet took mud off')
  assert.ok(layer.remaining < 1 && layer.remaining > 0.5, `one spot only: ${layer.remaining}`)
  const hit = layer.scrub(origin, direction, 0.01)
  assert.ok(hit && Vector3.Distance(hit.point, target) < 0.3, 'the jet hits where it is aimed')
  assert.equal(layer.scrub(origin, direction.scale(-1), 1), null)
  layer.resetMud()
  assert.ok(Math.abs(layer.remaining - 1) < 1e-6)
  layer.dispose()
  root.dispose()
  scene.dispose()
  engine.dispose()
})

test('scrubbing every strip end to end cleans the whole truck', () => {
  const { engine, scene } = makeScene()
  const root = new TransformNode('truck', scene)
  const model = TRUCKS.find((truck) => truck.id.startsWith('kestrel')) ?? TRUCKS[0]
  const layout = truckLayout(model)
  const layer = createDirtLayer(scene, root, layout)
  for (const region of dirtRegions(layout)) {
    for (let a = region.a0; a <= region.a1; a += 0.1) {
      for (let y = region.y0; y <= region.y1; y += 0.1) {
        const rear = region.strip === 'rear'
        const point = rear ? new Vector3(a, y, region.plane) : new Vector3(region.plane, y, a)
        const out = rear ? new Vector3(0, 0, -3) : new Vector3(Math.sign(region.plane) * 3, 0, 0)
        layer.scrub(point.add(out), out.scale(-1).normalize(), 1)
      }
    }
  }
  assert.ok(layer.remaining < 0.03, `left over: ${layer.remaining}`)
  layer.dispose()
  scene.dispose()
  engine.dispose()
})

test('the dirt layer and a grown lot dispose back to the baseline', () => {
  const { engine, scene } = makeScene()
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('frame', scene)
  const lots = new LotRenderer(scene, parent, mats, getTerrain())
  const baseline = counts(scene)
  const root = new TransformNode('truck', scene)
  const layer = createDirtLayer(scene, root, truckLayout(TRUCKS[0]))
  layer.setDirt(50)
  root.dispose()
  layer.dispose()
  const lot = LOTS[0]
  const grown = lotExtent(lot, MAX_LAND_STRIPS)
  assert.equal(grown.w, lot.w + MAX_LAND_STRIPS * LAND_STRIP_M)
  lots.setLot(grown, { name: 'driver', company: 'Test Hauling' }, [
    { id: 'a', def: 'pave-gravel', x: 2, z: 2, w: 40, d: 30, rot: 0, color: '#8a847a' },
    { id: 'b', def: 'pave-asphalt', x: 50, z: 2, w: 40, d: 30, rot: 0, color: '#2f3134' },
  ])
  assert.ok(lots.meshes(lot.index).length > 0)
  lots.previewLand({ x: grown.x - LAND_STRIP_M, z: grown.z, w: LAND_STRIP_M, d: grown.d })
  lots.previewLand(null)
  lots.clear(lot.index)
  lots.dispose()
  mats.dispose()
  parent.dispose()
  const after = counts(scene)
  assert.ok(after.meshes <= baseline.meshes && after.textures <= baseline.textures && after.nodes <= baseline.nodes, JSON.stringify({ baseline, after }))
  scene.dispose()
  engine.dispose()
})
