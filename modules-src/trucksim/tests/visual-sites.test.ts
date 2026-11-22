import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MaterialLibrary } from '../render/Materials'
import { LotRenderer } from '../render/Lots'
import { BUILDINGS } from '../shared/Catalog'
import type { BuildItem } from '../shared/Lots'
import { itemFootprint } from '../shared/Lots'
import { LOTS } from '../shared/WorldLayout'
import { getTerrain } from '../shared/Terrain'
import { CHUNK_SIZE, SITES, SITE_BY_ID } from '../shared/WorldLayout'
import type { Zone } from '../shared/WorldLayout'
import { DEALER_DISPLAY_SPOTS, SiteLayer, planSite, siteStaticBoxes } from '../render/world/Sites'
import { SceneryBatch } from '../render/lots/Batch'
import { nearestRoadPoint, rectHitsStrip } from '../render/world/sites/Plan'
import type { Rect } from '../render/world/sites/Plan'
import type { ChunkContext } from '../render/world/WorldRenderer'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'

class FakeCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext(): unknown {
    return new Proxy({ measureText: () => ({ width: 10 }) } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : () => undefined), set: () => true })
  }
}
;(globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas

interface Counts {
  meshes: number
  materials: number
  geometries: number
  textures: number
  nodes: number
}

function counts(scene: Scene): Counts {
  return { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length, textures: scene.textures.length, nodes: scene.transformNodes.length }
}

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  new PBRMaterial('prime', scene).dispose()
  return { engine, scene }
}

function itemFor(index: number, seed: number): BuildItem {
  const def = BUILDINGS[index % BUILDINGS.length]
  const rot = (seed % 4) as 0 | 1 | 2 | 3
  const odd = rot % 2 === 1
  const w = def.mode === 'line' ? 6 + (seed % 5) * 4 : def.w
  const d = def.d
  const x = 4 + (index * 7 + seed * 3) % 40
  const z = 4 + (index * 5 + seed * 2) % 30
  return { id: `i${index}-${seed}`, def: def.id, x, z, w: def.mode === 'line' ? w : odd ? d : w, d: def.mode === 'line' ? d : odd ? w : d, rot, color: def.defaultColor, color2: def.defaultColor2 }
}

test('LotRenderer builds one of every def, rebuilds 20 times and returns to the baseline', () => {
  const { engine, scene } = makeScene()
  const base = counts(scene)
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('lots', scene)
  const lots = new LotRenderer(scene, parent, mats, getTerrain())
  const lot = LOTS[0]
  const all = BUILDINGS.map((_, index) => itemFor(index, 0))
  lots.setLot(lot, { name: 'driver', company: 'Prairie Haul Co' }, all)
  assert.ok(lots.meshes(lot.index).length > 4)
  assert.ok(lots.staticBoxes(lot.index).length >= 14)
  const warm = counts(scene)
  for (let round = 1; round <= 20; round++) {
    const items = BUILDINGS.map((_, index) => itemFor(index + round, round))
    lots.setLot(lot, round % 2 === 0 ? { name: 'driver', company: `Company ${round}` } : null, items)
  }
  const after = counts(scene)
  assert.deepEqual(after, warm)
  lots.setLot(LOTS[3], null, [])
  lots.clear(LOTS[3].index)
  lots.clear(lot.index)
  assert.equal(lots.staticBoxes(lot.index).length, 0)
  lots.dispose()
  mats.dispose()
  parent.dispose()
  assert.deepEqual(counts(scene), base)
  scene.dispose()
  engine.dispose()
})

test('rot turns the building and its collision box', () => {
  const { engine, scene } = makeScene()
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('lots', scene)
  const lots = new LotRenderer(scene, parent, mats, getTerrain())
  const lot = LOTS[1]
  for (const rot of [0, 1, 2, 3] as const) {
    const odd = rot % 2 === 1
    const item: BuildItem = { id: 's', def: 'shop-steel', x: 20, z: 10, w: odd ? 24 : 16, d: odd ? 16 : 24, rot, color: '#8d969e', color2: '#2b4f7a' }
    lots.setLot(lot, null, [item])
    const box = lots.staticBoxes(lot.index)[0]
    const foot = itemFootprint(item)
    assert.ok(Math.abs(box.x - (lot.x + foot.x + foot.w / 2)) < 1e-6)
    assert.ok(Math.abs(box.z - (lot.z + foot.z + foot.d / 2)) < 1e-6)
    assert.ok(Math.abs(box.hx - foot.w / 2) < 1e-6 && Math.abs(box.hz - foot.d / 2) < 1e-6)
  }
  lots.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('the preview ghost is reused while def and size stay the same', () => {
  const { engine, scene } = makeScene()
  const mats = new MaterialLibrary(scene)
  const parent = new TransformNode('lots', scene)
  const lots = new LotRenderer(scene, parent, mats, getTerrain())
  const lot = LOTS[2]
  const item: BuildItem = { id: 'g', def: 'pole-barn', x: 10, z: 10, w: 14, d: 20, rot: 0, color: '#8e2f25', color2: '#ece8df' }
  lots.preview(lot, item, true)
  const first = lots.previewMesh
  assert.ok(first)
  const during = counts(scene)
  lots.preview(lot, { ...item, x: 30, z: 22 }, false)
  lots.preview(lot, { ...item, x: 31, z: 22, rot: 0 }, true)
  assert.equal(lots.previewMesh, first)
  assert.deepEqual(counts(scene), during)
  lots.preview(lot, { ...item, w: 18 }, true)
  assert.notEqual(lots.previewMesh, first)
  lots.preview(null, null, true)
  assert.equal(scene.getTransformNodeByName('lot-ghost')?.isEnabled(), false)
  lots.dispose()
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

function makeContext(scene: Scene, cx: number, cz: number): ChunkContext {
  const root = new TransformNode(`chunk-${cx}-${cz}`, scene)
  root.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
  const parent = new TransformNode('county', scene)
  return {
    scene,
    parent,
    root,
    terrain: getTerrain(),
    quality: {} as ChunkContext['quality'],
    cx,
    cz,
    x0: cx * CHUNK_SIZE,
    z0: cz * CHUNK_SIZE,
    size: CHUNK_SIZE,
    distance: 0,
    addShadowCaster: (_mesh: AbstractMesh) => undefined,
    countInstances: () => undefined,
  }
}

function chunksOfSite(site: (typeof SITES)[number]): [number, number][] {
  const out: [number, number][] = []
  for (let cx = Math.floor((site.x - site.w / 2) / CHUNK_SIZE); cx <= Math.floor((site.x + site.w / 2 - 0.001) / CHUNK_SIZE); cx++) {
    for (let cz = Math.floor((site.z - site.d / 2) / CHUNK_SIZE); cz <= Math.floor((site.z + site.d / 2 - 0.001) / CHUNK_SIZE); cz++) out.push([cx, cz])
  }
  return out
}

test('every site builds through the layer and disposes back to the baseline', () => {
  const { engine, scene } = makeScene()
  const base = counts(scene)
  const mats = new MaterialLibrary(scene)
  const layer = new SiteLayer(scene, mats, getTerrain())
  const chunks = new Map<string, [number, number]>()
  for (const site of SITES) for (const [cx, cz] of chunksOfSite(site)) chunks.set(`${cx},${cz}`, [cx, cz])
  const buildAll = (): number => {
    let made = 0
    for (const [cx, cz] of chunks.values()) {
      const ctx = makeContext(scene, cx, cz)
      const part = layer.build(cx, cz, ctx)
      if (part) {
        made++
        part.dispose()
      }
      ctx.root.dispose()
      ctx.parent.dispose()
    }
    return made
  }
  assert.ok(buildAll() >= SITES.length - 1)
  const warm = counts(scene)
  for (let round = 0; round < 3; round++) buildAll()
  assert.deepEqual(counts(scene), warm)
  layer.dispose()
  mats.dispose()
  assert.deepEqual(counts(scene), base)
  scene.dispose()
  engine.dispose()
})

function keepout(zone: Zone, margin: number): Rect {
  const rect = { x0: zone.x - zone.w / 2 - margin, z0: zone.z - zone.d / 2 - margin, x1: zone.x + zone.w / 2 + margin, z1: zone.z + zone.d / 2 + margin }
  if (zone.dock) {
    if (zone.dock.z >= zone.z) rect.z1 = zone.z + zone.d / 2
    else rect.z0 = zone.z - zone.d / 2
  }
  return rect
}

function hits(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1
}

test('no building touches a work zone, its drive lane or leaves its site', () => {
  for (const site of SITES) {
    const plan = planSite(site)
    if (site.kind !== 'lotDistrict') assert.ok(plan.pieces.length >= 8, `${site.id} has buildings`)
    const bounds = { x0: site.x - site.w / 2, z0: site.z - site.d / 2, x1: site.x + site.w / 2, z1: site.z + site.d / 2 }
    for (const piece of plan.pieces) {
      for (const box of piece.boxes) {
        const rect = { x0: box.x - box.hx, z0: box.z - box.hz, x1: box.x + box.hx, z1: box.z + box.hz }
        for (const zone of site.zones) assert.ok(!hits(rect, keepout(zone, 4)), `${site.id} ${piece.name} box meets ${zone.id}`)
      }
      for (const area of piece.areas) {
        assert.ok(area.x0 >= bounds.x0 - 0.01 && area.x1 <= bounds.x1 + 0.01 && area.z0 >= bounds.z0 - 0.01 && area.z1 <= bounds.z1 + 0.01, `${site.id} ${piece.name} inside the site`)
        for (const zone of site.zones) {
          assert.ok(!hits(area, keepout(zone, 6)), `${site.id} ${piece.name} meets ${zone.id} plus 6 m`)
          const entry = nearestRoadPoint(zone.x, zone.z)
          if (entry.distance > 1) assert.ok(!rectHitsStrip(area, { ax: entry.x, az: entry.z, bx: zone.x, bz: zone.z, half: 7 }), `${site.id} ${piece.name} blocks the lane to ${zone.id}`)
        }
      }
    }
    const lost = plan.rejected.filter((name) => name !== 'fence' && name !== 'light pole')
    assert.deepEqual(lost, [], `${site.id} dropped buildings`)
  }
})

test('dock warehouses sit exactly on the dock line with doors at each dock', () => {
  const { engine, scene } = makeScene()
  const mats = new MaterialLibrary(scene)
  for (const id of ['cold', 'dc']) {
    const site = SITE_BY_ID[id]
    const piece = planSite(site).pieces.find((p) => p.name === 'dock warehouse')
    assert.ok(piece, `${id} warehouse`)
    const box = piece.boxes[0]
    const dockZ = site.zones[0].dock?.z ?? 0
    assert.ok(Math.abs(box.z - box.hz - dockZ) < 1e-6)
    const batch = new SceneryBatch()
    batch.frame(piece.x, piece.ground, piece.z, piece.rot * (Math.PI / 2))
    piece.build(batch, { sign: () => null })
    const parent = new TransformNode('dock', scene)
    const meshes = batch.build(scene, id, parent, () => mats.get('darkSteel'))
    const door = meshes.find((m) => m.name.endsWith('-darkSteel'))
    assert.ok(door)
    const positions = door.getVerticesData(VertexBuffer.PositionKind) ?? []
    for (const zone of site.zones) {
      const dockX = zone.dock?.x ?? zone.x
      let left = false
      let right = false
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i + 2] - dockZ) > 0.06) continue
        if (Math.abs(positions[i] - (dockX - 1.55)) < 0.01) left = true
        if (Math.abs(positions[i] - (dockX + 1.55)) < 0.01) right = true
      }
      assert.ok(left && right, `${id} door at ${dockX}`)
    }
    for (const mesh of meshes) mesh.dispose()
    parent.dispose()
  }
  mats.dispose()
  scene.dispose()
  engine.dispose()
})

test('the dealership has display spots on pads and every site lists collision boxes', () => {
  const pads = planSite(SITE_BY_ID.dealer).pieces.filter((p) => p.name === 'display pad')
  assert.equal(pads.length, DEALER_DISPLAY_SPOTS.length)
  for (const spot of DEALER_DISPLAY_SPOTS) assert.ok(pads.some((pad) => pad.areas.some((a) => spot.x >= a.x0 && spot.x <= a.x1 && spot.z >= a.z0 && spot.z <= a.z1)))
  for (const site of SITES) {
    if (site.kind === 'lotDistrict') continue
    assert.ok(siteStaticBoxes(site.id).length > 0, site.id)
  }
  assert.deepEqual(siteStaticBoxes('nowhere'), [])
})
