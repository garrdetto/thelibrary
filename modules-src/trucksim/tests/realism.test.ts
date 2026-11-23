import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MaterialLibrary } from '../render/Materials'
import { BEAM_INTENSITY, HeadBeam } from '../render/models/HeadBeam'
import { buildExcavator } from '../render/models/MachineVisual'
import { RoadEdgeLayer, planRoadEdges, railBoxes } from '../render/world/RoadEdges'
import { chunkTreeObstacles } from '../render/world/PropsPlacement'
import { planSite } from '../render/world/Sites'
import { qualitySettings } from '../render/Quality'
import type { ChunkContext } from '../render/world/WorldRenderer'
import { CHUNK_SIZE, LOTS, SITES, SITE_BY_ID } from '../shared/WorldLayout'
import { getTerrain } from '../shared/Terrain'
import { SimWorld } from '../sim/SimWorld'
import type { ExcavatorPose } from '../sim/types'

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  return { engine, scene, parent: new TransformNode('frame', scene), mats: new MaterialLibrary(scene) }
}

test('the headlight beam fades on and off by intensity, never toggling the light, and is removed with the truck', () => {
  const { engine, scene, parent } = makeScene()
  const beam = new HeadBeam(scene, parent, 3.4, 1.15)
  assert.equal(scene.lights.length, 1)
  assert.equal(beam.light.intensity, 0)
  assert.ok(beam.light.direction.y < 0 && beam.light.direction.z > 0, 'aimed down the road ahead')
  for (let i = 0; i < 30; i++) beam.update(true, 1 / 60)
  assert.equal(beam.light.intensity, BEAM_INTENSITY)
  assert.equal(beam.light.isEnabled(), true)
  for (let i = 0; i < 30; i++) beam.update(false, 1 / 60)
  assert.equal(beam.light.intensity, 0)
  assert.equal(beam.light.isEnabled(), true, 'switched by intensity so no shader recompiles')
  beam.dispose()
  assert.equal(scene.lights.length, 0)
  engine.dispose()
})

test('the excavator shows its load in the bucket and pours from the bucket lip', () => {
  const { engine, scene, parent, mats } = makeScene()
  const exc = buildExcavator(scene, parent, mats)
  const base: ExcavatorPose = { position: { x: 10, y: 0, z: 4 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, swing: 0, boom: 0.4, stick: 1.1, bucket: 0.5, trackL: 0, trackR: 0 }
  const load = scene.getTransformNodeByName('exc-load') as TransformNode
  exc.update({ ...base, fill: 0 })
  assert.equal(load.isEnabled(), false, 'an empty bucket shows nothing')
  exc.update({ ...base, fill: 1 })
  assert.equal(load.isEnabled(), true, 'a full bucket shows its load')
  const lip = exc.bucketLip(new Vector3())
  exc.update({ ...base, fill: 1, swing: 1.4 })
  const swung = exc.bucketLip(new Vector3())
  assert.ok(Vector3.Distance(lip, swung) > 3, 'the lip swings with the house')
  assert.ok(lip.y > 0.5, 'the lip is up in the air with the boom raised')
  exc.dispose()
  mats.dispose()
  engine.dispose()
})

test('roads get guardrails on fills and highway bends, curbs in town, never across a lot gate or site entrance', () => {
  const terrain = getTerrain()
  const runs = planRoadEdges(terrain)
  const rails = runs.filter((r) => r.kind === 'rail')
  const curbs = runs.filter((r) => r.kind === 'curb')
  assert.ok(rails.length >= 20, `${rails.length} guardrail runs`)
  assert.ok(curbs.length >= 10, `${curbs.length} curb runs`)
  const town = SITE_BY_ID.town
  for (const run of curbs) for (let k = 0; k < run.pts.length; k += 2) {
    assert.ok(Math.abs(run.pts[k] - town.x) <= town.w / 2 + 2 && Math.abs(run.pts[k + 1] - town.z) <= town.d / 2 + 2, 'curbs only in town')
  }
  for (const run of rails) {
    assert.ok(run.pts.length / 2 >= 8, 'rails are at least 16 m long')
    for (let k = 0; k < run.pts.length; k += 2) {
      const x = run.pts[k], z = run.pts[k + 1]
      assert.ok(!LOTS.some((l) => Math.hypot(l.gate.x - x, l.gate.z - z) < 20), 'no rail at a lot gate')
      assert.ok(!SITES.some((s) => s.kind !== 'town' && s.kind !== 'lotDistrict' && Math.abs(x - s.x) < s.w / 2 + 5 && Math.abs(z - s.z) < s.d / 2 + 5), 'no rail across a site')
    }
  }
  const boxes = railBoxes(terrain)
  assert.equal(boxes.length, rails.reduce((n, r) => n + r.pts.length / 2 - 1, 0))
  for (const box of boxes) assert.ok(box.hz > 0.04 && box.hz < 2.5 && Number.isFinite(box.rotY), `rail box half length ${box.hz}`)
})

test('the road edge layer builds a chunk and disposes back to the baseline', () => {
  const { engine, scene, parent, mats } = makeScene()
  const terrain = getTerrain()
  const layer = new RoadEdgeLayer(scene, mats, terrain)
  const rail = planRoadEdges(terrain).find((r) => r.kind === 'rail')!
  const cx = Math.floor(rail.pts[0] / CHUNK_SIZE), cz = Math.floor(rail.pts[1] / CHUNK_SIZE)
  const count = () => scene.meshes.length + scene.geometries.length
  const before = count()
  const root = new TransformNode('chunk', scene)
  root.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
  const casters: unknown[] = []
  const ctx: ChunkContext = { scene, parent, root, terrain, quality: qualitySettings('medium'), cx, cz, x0: cx * CHUNK_SIZE, z0: cz * CHUNK_SIZE, size: CHUNK_SIZE, distance: 0, addShadowCaster: (m) => casters.push(m), countInstances: () => {} }
  for (let round = 0; round < 3; round++) {
    const part = layer.build(cx, cz, ctx)
    assert.ok(part, 'the chunk has a guardrail')
    assert.ok(count() > before)
    part.dispose()
    assert.equal(count(), before, `round ${round}`)
  }
  root.dispose()
  layer.dispose()
  mats.dispose()
  engine.dispose()
})

test('tree trunks are solid: colliders stream with the ground chunks at the drawn density', async () => {
  const terrain = getTerrain()
  const world = await SimWorld.create(terrain)
  let cx = 0, cz = 0, trees: ReturnType<typeof chunkTreeObstacles> = []
  for (let x = -6; x <= 6 && trees.length === 0; x++) for (let z = -6; z <= 6 && trees.length === 0; z++) {
    const found = chunkTreeObstacles(terrain, x, z, 0.75)
    if (found.length > 20) { cx = x; cz = z; trees = found }
  }
  assert.ok(trees.length > 20, 'a wooded chunk')
  assert.deepEqual(chunkTreeObstacles(terrain, cx, cz, 0.75), trees, 'the same trees every time')
  assert.ok(chunkTreeObstacles(terrain, cx, cz, 0.45).length <= trees.length, 'a lower density keeps fewer trees')
  world.setObstacleSource((x, z) => chunkTreeObstacles(terrain, x, z, 0.75))
  world.loadChunk(cx, cz)
  assert.equal(world.obstacleCount, trees.length)
  world.setObstacleSource((x, z) => chunkTreeObstacles(terrain, x, z, 0.45))
  assert.equal(world.obstacleCount, chunkTreeObstacles(terrain, cx, cz, 0.45).length, 'a tier change rebuilds them')
  world.unloadChunk(cx, cz)
  assert.equal(world.obstacleCount, 0, 'unloading the chunk removes its trunks')
  world.dispose()
})

test('the quarry has a stacker conveyor feeding a stockpile beside the crusher', () => {
  const quarry = SITES.find((s) => s.kind === 'quarry')!
  const names = planSite(quarry).pieces.map((p) => p.name)
  assert.ok(names.includes('crusher plant'))
  assert.ok(names.includes('stacker'), names.join(', '))
  assert.ok(names.filter((n) => n.startsWith('stockpile') || n === 'stacker pile').length >= 4)
})
