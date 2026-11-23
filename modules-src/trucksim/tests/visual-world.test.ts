import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SHOULDER, Terrain } from '../shared/Terrain'
import { CHUNK_SIZE, LOTS, MAX_LAND_STRIPS, ROADS, SITES, inRect, lotExtent } from '../shared/WorldLayout'
import { MemoryGuard } from '../systems/MemoryGuard'
import type { PressureLevel } from '../systems/MemoryGuard'
import { QUALITY, lowerTier, resolveTier } from '../render/Quality'
import { createAtmosphere } from '../render/world/Atmosphere'
import { computeSkyState, createSkyState } from '../render/world/AtmosphereSky'
import { createPipeline } from '../render/world/Pipeline'
import { NEAR_ENTER, NEAR_EXIT, buildTerrainArrays, terrainGrid } from '../render/world/TerrainChunks'
import { ROAD_LIFT, buildRoadArrays, getRoadNetwork } from '../render/world/RoadsGeometry'
import { CONDUCTORS, LOT_CLEARANCE, SITE_CLEARANCE, TREE_ROAD_CLEARANCE, allSignSpots, placeChunkProps } from '../render/world/PropsPlacement'
import { broadleafModel, pineModel, poleModel, triangleCount } from '../render/world/PropsModels'
import { MIN_RADIUS, RESTORE_AFTER_MS, createWorldRenderer, maxLoadedFor } from '../render/world/WorldRenderer'
import type { ChunkContext, ChunkLayer } from '../render/world/WorldRenderer'

const terrain = new Terrain()

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  return { engine, scene }
}

function counts(scene: Scene) {
  return { meshes: scene.meshes.length, materials: scene.materials.length, geometries: scene.geometries.length, textures: scene.textures.filter((texture) => texture !== scene.environmentBRDFTexture).length, nodes: scene.transformNodes.length, lights: scene.lights.length }
}

function heightOf(arrays: ReturnType<typeof buildTerrainArrays>, ix: number, iz: number): number {
  return arrays.positions[(iz * arrays.verts + ix) * 3 + 1]
}

test('quality tiers resolve from ?quality=, the saved pick, then medium (low on weak devices)', () => {
  assert.equal(resolveTier('?quality=ultra', 'webgl2', {}, null), 'ultra')
  assert.equal(resolveTier('?quality=med', 'webgpu', {}, 'high'), 'medium')
  assert.equal(resolveTier('', 'webgpu', {}, null), 'medium')
  assert.equal(resolveTier('', 'webgl2', {}, null), 'medium')
  assert.equal(resolveTier('', 'webgpu', { memoryGb: 16, cores: 16 }, null), 'medium')
  assert.equal(resolveTier('', 'webgpu', { mobile: true }, null), 'low')
  assert.equal(resolveTier('', 'webgpu', { cores: 2 }, null), 'low')
  assert.equal(resolveTier('', 'webgpu', { mobile: true }, 'high'), 'high')
  assert.equal(resolveTier('', 'webgl2', {}, 'nonsense'), 'medium')
  assert.equal(resolveTier('?quality=nonsense', 'webgl2', { memoryGb: 2 }, null), 'low')
  assert.equal(lowerTier('low'), 'low')
  for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
    const q = QUALITY[tier]
    assert.ok(q.msaa === 1 || q.msaa === 4, `${tier} msaa`)
    assert.equal(q.ssao, tier === 'high' || tier === 'ultra')
    assert.equal(q.shadows, tier === 'low' ? 'off' : tier === 'medium' ? 'single' : 'cascaded')
  }
})

test('terrain chunk vertices sit exactly on heightAt, with normals from the height function', () => {
  const chunks: [number, number, string][] = [[2, -1, 'Heavy Iron Rentals and Main Street'], [0, -1, 'the Main Street and County Road crossing'], [-4, 0, 'Haulers Row'], [1, 4, 'Bluestone Quarry'], [-8, 7, 'the world corner']]
  for (const [cx, cz, label] of chunks) {
    for (const lod of ['near', 'far'] as const) {
      const arrays = buildTerrainArrays(terrain, cx, cz, lod)
      const { verts, spacing } = terrainGrid(lod)
      assert.equal(arrays.verts, verts)
      let worst = 0
      for (let iz = 0; iz < verts; iz++) {
        for (let ix = 0; ix < verts; ix++) {
          const at = (iz * verts + ix) * 3
          const x = cx * CHUNK_SIZE + arrays.positions[at]
          const z = cz * CHUNK_SIZE + arrays.positions[at + 2]
          assert.equal(arrays.positions[at], ix * spacing)
          worst = Math.max(worst, Math.abs(arrays.positions[at + 1] - terrain.heightAt(x, z)))
        }
      }
      assert.ok(worst < 1e-3, `${label} ${lod}: worst height error ${worst}`)
      for (const [ix, iz] of [[0, 0], [verts - 1, 3], [7, verts - 1], [verts >> 1, verts >> 1]]) {
        const at = (iz * verts + ix) * 3
        const expected = terrain.normalAt(cx * CHUNK_SIZE + ix * spacing, cz * CHUNK_SIZE + iz * spacing, spacing)
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(arrays.normals[at + k] - expected[k]) < 1e-5, `${label} ${lod} normal`)
      }
      const skirtY = arrays.positions[(verts * verts) * 3 + 1]
      assert.ok(skirtY < heightOf(arrays, 0, 0) - 1, 'skirt hangs below the edge')
    }
  }
})

test('neighbouring chunks share identical edge positions and normals', () => {
  for (const lod of ['near', 'far'] as const) {
    const { verts } = terrainGrid(lod)
    const a = buildTerrainArrays(terrain, 2, -1, lod)
    const east = buildTerrainArrays(terrain, 3, -1, lod)
    const north = buildTerrainArrays(terrain, 2, 0, lod)
    for (let i = 0; i < verts; i++) {
      const aEdge = (i * verts + verts - 1) * 3
      const bEdge = (i * verts) * 3
      assert.equal(a.x0 + a.positions[aEdge], east.x0 + east.positions[bEdge])
      assert.equal(a.positions[aEdge + 1], east.positions[bEdge + 1])
      assert.equal(a.z0 + a.positions[aEdge + 2], east.z0 + east.positions[bEdge + 2])
      for (let k = 0; k < 3; k++) assert.equal(a.normals[aEdge + k], east.normals[bEdge + k])
      const aTop = ((verts - 1) * verts + i) * 3
      const bBottom = i * 3
      assert.equal(a.z0 + a.positions[aTop + 2], north.z0 + north.positions[bBottom + 2])
      assert.equal(a.positions[aTop + 1], north.positions[bBottom + 1])
      for (let k = 0; k < 3; k++) assert.equal(a.normals[aTop + k], north.normals[bBottom + k])
    }
  }
})

test('roads cut back at junctions and paint gives way at their mouths', () => {
  const network = getRoadNetwork()
  const path = (id: string) => network.paths.find((candidate) => candidate.road.id === id)!
  const county = path('county')
  const main = path('main')
  const crossing = county.cuts.find(([from, to]) => from < 1500 && to > 1500)
  assert.ok(crossing, 'County Road is cut where it crosses Main Street')
  assert.ok(Math.abs(crossing[1] - crossing[0] - 2 * (main.half + SHOULDER)) < 0.05, `cut width ${crossing[1] - crossing[0]}`)
  const mainMouth = main.mouths.find((mouth) => mouth.from < 1500 && mouth.to > 1500)
  assert.ok(mainMouth && mainMouth.side === 0, 'Main Street drops its lines across the crossing')
  const haulers = path('haulers')
  assert.ok(haulers.cuts.some(([from, to]) => from === 0 && Math.abs(to - (main.half + SHOULDER)) < 0.05), 'Haulers Row starts at the Main Street shoulder')
  const tee = main.mouths.find((mouth) => mouth.from < 600 && mouth.to > 600)
  assert.ok(tee && tee.side === -1, 'the Haulers Row mouth is on the north (right-hand) side of Main Street')
  const loop = path('loop')
  assert.ok(loop.mouths.length >= 8, 'the highway has mouths where roads join it')
  for (const [cx, cz] of [[0, 0], [-1, -1], [0, -1], [-4, 0], [5, 3], [-6, 4]]) {
    const arrays = buildRoadArrays(terrain, network, cx, cz)
    assert.ok(arrays, `roads in chunk ${cx},${cz}`)
    assert.equal(arrays.positions.length / 3, arrays.normals.length / 3)
    assert.equal(arrays.positions.length / 3, arrays.colors.length / 4)
    for (let i = 0; i < arrays.indices.length; i++) assert.ok(arrays.indices[i] < arrays.positions.length / 3)
    for (let v = 0; v < arrays.positions.length / 3; v += 7) {
      const x = cx * CHUNK_SIZE + arrays.positions[v * 3]
      const z = cz * CHUNK_SIZE + arrays.positions[v * 3 + 2]
      const y = arrays.positions[v * 3 + 1]
      assert.ok(Number.isFinite(y))
      assert.ok(Math.abs(y - ROAD_LIFT - terrain.heightAt(x, z)) < 0.06, `road vertex off the ground by ${y - terrain.heightAt(x, z)} at ${x},${z}`)
    }
  }
  assert.equal(buildRoadArrays(terrain, network, -8, 7), null)
})

test('props stand clear of roads, sites and lots, with poles and wires along the roads', () => {
  let trees = 0
  let poles = 0
  let wires = 0
  for (let cz = -8; cz < 8; cz += 3) {
    for (let cx = -8; cx < 8; cx += 2) {
      const props = placeChunkProps(terrain, cx, cz, 1)
      for (const batch of [props.oak, props.pine]) {
        for (let i = 0; i < batch.count; i++) {
          const x = batch.matrices[i * 16 + 12]
          const z = batch.matrices[i * 16 + 14]
          assert.ok(x >= cx * CHUNK_SIZE && x < (cx + 1) * CHUNK_SIZE && z >= cz * CHUNK_SIZE && z < (cz + 1) * CHUNK_SIZE, 'tree belongs to its chunk')
          for (const site of SITES) assert.ok(!inRect(site, x, z, SITE_CLEARANCE - 0.01), `tree inside ${site.name}`)
          for (const spec of LOTS) {
            const lot = lotExtent(spec, MAX_LAND_STRIPS)
            assert.ok(!(x > lot.x - LOT_CLEARANCE + 0.01 && x < lot.x + lot.w + LOT_CLEARANCE - 0.01 && z > lot.z - LOT_CLEARANCE + 0.01 && z < lot.z + lot.d + LOT_CLEARANCE - 0.01), 'tree inside a fully grown lot')
          }
          const road = terrain.roadAt(x, z)
          assert.ok(!road || road.distance >= road.half + SHOULDER + TREE_ROAD_CLEARANCE - 0.01, 'tree too close to a road')
          assert.ok(Math.abs(batch.matrices[i * 16 + 13] - terrain.heightAt(x, z)) < 0.5, 'tree on the ground')
        }
        trees += batch.count
      }
      for (let i = 0; i < props.pole.count; i++) {
        const x = props.pole.matrices[i * 16 + 12]
        const z = props.pole.matrices[i * 16 + 14]
        for (const site of SITES) assert.ok(!inRect(site, x, z, SITE_CLEARANCE - 0.01), `pole inside ${site.name}`)
        const road = terrain.roadAt(x, z)
        assert.ok(road && road.distance > road.half + SHOULDER, 'pole stands off the road')
      }
      poles += props.pole.count
      wires += props.wires.length / 6
    }
  }
  assert.ok(trees > 2000, `trees placed: ${trees}`)
  assert.ok(poles > 40, `poles placed: ${poles}`)
  assert.ok(wires >= poles * CONDUCTORS.length * 0.6, `wires: ${wires} for ${poles} poles`)
  const corner = placeChunkProps(terrain, -8, -8, 1)
  assert.ok(corner.oak.count + corner.pine.count > 200, 'woods grow along the edge of the world')
  const fullCount = placeChunkProps(terrain, 3, 2, 1).oak.count
  const lowCount = placeChunkProps(terrain, 3, 2, 0.45).oak.count
  assert.ok(lowCount <= fullCount, 'a lower density keeps fewer trees')
  const signs = allSignSpots(terrain)
  for (const site of SITES) assert.ok(signs.some((sign) => sign.site === site), `${site.name} has a sign`)
  assert.ok(signs.filter((sign) => sign.site.kind === 'town').length >= 4, 'Millbrook is signed on every road into town')
  assert.ok(triangleCount(broadleafModel(true)) < 600 && triangleCount(broadleafModel(false)) < 120)
  assert.ok(triangleCount(pineModel(true)) < 200 && triangleCount(pineModel(false)) < 40)
  assert.ok(triangleCount(poleModel()) < 160)
  assert.equal(ROADS.length, getRoadNetwork().paths.length)
})

test('the sky model runs a full day from dawn to night', () => {
  const state = createSkyState()
  computeSkyState(state, 13)
  assert.ok(state.sun[1] > 0.8 && state.night === 0, 'midday sun is high')
  assert.ok(state.sun[2] < 0, 'the midday sun is in the south (-z)')
  assert.ok(state.keyIntensity > 2)
  computeSkyState(state, 7)
  assert.ok(state.sun[0] < 0, 'the morning sun is in the east (-x)')
  assert.ok(state.sunColor[2] < state.sunColor[0] * 0.8, 'low sun is warm')
  computeSkyState(state, 1)
  assert.ok(state.night === 1 && state.sun[1] < 0)
  assert.ok(state.keyIntensity < 0.2 && state.exposure > 1.5)
  computeSkyState(state, 25)
  assert.equal(state.hours, 1)
})

test('the atmosphere builds, runs the clock and disposes cleanly on every tier', () => {
  const { engine, scene } = makeScene()
  const camera = new UniversalCamera('eye', new Vector3(0, 2, 0), scene)
  camera.maxZ = 6000
  const baseline = counts(scene)
  for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
    const atmosphere = createAtmosphere(scene, { tier, camera })
    assert.equal(atmosphere.shadows === null, tier === 'low')
    const fogColors: string[] = []
    for (const hours of [0, 5.6, 6.6, 9, 12, 15, 18.6, 19.6, 21, 24]) {
      atmosphere.setTime(hours)
      atmosphere.update(camera.position)
      fogColors.push(scene.fogColor.toHexString())
      assert.ok(atmosphere.night >= 0 && atmosphere.night <= 1)
      assert.ok(Number.isFinite(scene.imageProcessingConfiguration.exposure))
    }
    atmosphere.setTime(12)
    assert.equal(atmosphere.night, 0)
    assert.ok(atmosphere.sun.direction.y < -0.5, 'the noon sun shines down')
    atmosphere.setTime(0.5)
    assert.equal(atmosphere.night, 1)
    assert.ok(new Set(fogColors).size > 4, 'the fog follows the time of day')
    const caster = scene.meshes.find((mesh) => mesh.name === 'trucksim-sky') as Mesh
    atmosphere.addCaster(caster)
    if (atmosphere.shadows) assert.ok(atmosphere.shadows.getShadowMap()!.renderList!.includes(caster))
    atmosphere.removeCaster(caster)
    atmosphere.setQuality(tier === 'low' ? 'high' : 'low')
    atmosphere.dispose()
    assert.deepEqual(counts(scene), baseline, `${tier} left something behind`)
  }
  scene.dispose()
  engine.dispose()
})

test('the HDR pipeline builds where the engine can host it', (t) => {
  const { engine, scene } = makeScene()
  const camera = new UniversalCamera('eye', new Vector3(0, 2, 0), scene)
  let pipeline: ReturnType<typeof createPipeline> | null = null
  try {
    pipeline = createPipeline(scene, camera, 'high', { toneMapping: 'aces' })
  } catch (error) {
    t.skip(`DefaultRenderingPipeline can't run on NullEngine: ${(error as Error).message}`)
    scene.dispose()
    engine.dispose()
    return
  }
  assert.ok(pipeline.rendering.imageProcessing.toneMappingEnabled)
  pipeline.setTier('low')
  assert.equal(pipeline.ssao, null)
  assert.equal(pipeline.rendering.fxaaEnabled, true)
  pipeline.dispose()
  scene.dispose()
  engine.dispose()
})

test('the world streams across the county and back, then disposes to the baseline', () => {
  const { engine, scene } = makeScene()
  const camera = new UniversalCamera('eye', new Vector3(0, 2, 0), scene)
  camera.maxZ = 6000
  const guard = new MemoryGuard(scene, { search: '' })
  const parent = new TransformNode('county-frame', scene)
  const atmosphere = createAtmosphere(scene, { tier: 'medium', camera })
  const baseline = counts(scene)
  let built = 0
  let disposedParts = 0
  const extra: ChunkLayer = {
    name: 'probe',
    build(_cx: number, _cz: number, ctx: ChunkContext) {
      built++
      assert.equal(ctx.root.parent, ctx.parent)
      return { dispose: () => { disposedParts++ } }
    },
  }
  const world = createWorldRenderer(scene, parent, terrain, guard, 'medium', [extra], { atmosphere, clock: () => 0 })
  const start = { x: -897, z: 30 }
  const waypoints: { x: number; z: number }[] = []
  for (let i = 0; i < 20; i++) {
    const t = i / 19
    waypoints.push({ x: start.x + (1700 - start.x) * t, z: start.z + (-1500 - start.z) * t + Math.sin(t * Math.PI) * 600 })
  }
  for (let i = 19; i >= 0; i--) waypoints.push(waypoints[i])
  assert.equal(waypoints.length, 40)
  let peakChunks = 0
  let sawNear = false
  waypoints.forEach((point, index) => {
    world.update(point, index * 16)
    atmosphere.update(new Vector3(point.x, 0, point.z))
    if (index % 5 === 0) guard.sample(index * 2000)
    peakChunks = Math.max(peakChunks, world.loadedChunks)
    assert.ok(world.loadedChunks <= maxLoadedFor(world.radius), 'never over the streamer cap')
    if (scene.meshes.some((mesh) => mesh.name.startsWith('trucksim-terrain-') && mesh.name.includes('-near-'))) sawNear = true
  })
  assert.ok(sawNear, 'nearby chunks switch to the 2 m ground')
  assert.ok(peakChunks > 20, `chunks loaded: ${peakChunks}`)
  assert.ok(built > peakChunks, 'chunks were streamed in and out')
  assert.ok(world.thinInstances > 0)
  const report = guard.report()
  assert.ok(report.gauges.some((gauge) => gauge.name === 'world chunks' && gauge.value === world.loadedChunks))
  assert.ok(report.gauges.some((gauge) => gauge.name === 'world thin instances' && gauge.limit === QUALITY.medium.instanceBudget))
  const shadowList = atmosphere.shadows?.getShadowMap()?.renderList ?? []
  assert.ok(shadowList.length > 0, 'nearby props cast shadows')
  world.dispose()
  assert.equal(built - disposedParts, 0, 'every extra layer part was disposed')
  assert.equal(shadowList.length, 0, 'no shadow casters are left behind')
  assert.deepEqual(counts(scene), baseline)
  assert.equal(guard.report().gauges.length, 0)
  atmosphere.dispose()
  guard.dispose()
  parent.dispose()
  scene.dispose()
  engine.dispose()
})

test('memory pressure gives up a ring and takes it back after a minute at ok', () => {
  const { engine, scene } = makeScene()
  const parent = new TransformNode('county-frame', scene)
  const listeners: ((level: PressureLevel) => void)[] = []
  const gauges = new Map<string, () => number>()
  const fakeGuard = {
    pressure: 'ok' as PressureLevel,
    onPressure(listener: (level: PressureLevel) => void) {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    registerGauge(name: string, read: () => number) {
      gauges.set(name, read)
      return () => gauges.delete(name)
    },
  }
  const emit = (level: PressureLevel) => {
    fakeGuard.pressure = level
    for (const listener of listeners.slice()) listener(level)
  }
  let now = 0
  const world = createWorldRenderer(scene, parent, terrain, fakeGuard as unknown as MemoryGuard, 'high', [], { clock: () => now })
  const base = QUALITY.high.streamRadius
  world.prime(-897, 30)
  assert.equal(world.radius, base)
  assert.equal(world.pendingDetail, 0, 'priming builds the near ground at once')
  emit('warn')
  assert.equal(world.radius, base - 1)
  emit('critical')
  assert.equal(world.radius, Math.max(MIN_RADIUS, base - 2))
  now = 1000
  emit('ok')
  now = 1000 + RESTORE_AFTER_MS - 1
  world.update({ x: -897, z: 30 }, now)
  assert.equal(world.radius, base - 2)
  now = 1000 + RESTORE_AFTER_MS
  world.update({ x: -897, z: 30 }, now)
  assert.equal(world.radius, base - 1)
  now += RESTORE_AFTER_MS
  world.update({ x: -897, z: 30 }, now)
  assert.equal(world.radius, base)
  assert.ok(gauges.has('world chunks') && gauges.has('world thin instances'))
  world.dispose()
  assert.equal(gauges.size, 0)
  assert.equal(listeners.length, 0)
  parent.dispose()
  scene.dispose()
  engine.dispose()
})

test('terrain detail switches with hysteresis', () => {
  assert.ok(NEAR_EXIT > NEAR_ENTER)
  const { engine, scene } = makeScene()
  const parent = new TransformNode('county-frame', scene)
  const world = createWorldRenderer(scene, parent, terrain, null, 'low', [], { clock: () => 0 })
  const lodOf = (cx: number, cz: number) => {
    const prefix = `trucksim-terrain-${cx}-${cz}-`
    return scene.meshes.find((mesh) => mesh.name.startsWith(prefix))?.name.slice(prefix.length).split('-')[0]
  }
  world.update({ x: 128, z: 128 }, 0)
  assert.equal(lodOf(0, 0), 'near')
  assert.equal(lodOf(3, 0), 'far')
  world.update({ x: 128 - NEAR_ENTER - 20, z: 128 }, 0)
  assert.equal(lodOf(-1, 0), 'near')
  world.update({ x: 256 + (NEAR_ENTER + NEAR_EXIT) / 2, z: 128 }, 0)
  assert.equal(lodOf(0, 0), 'near', 'still inside the exit band')
  world.update({ x: 256 + NEAR_EXIT + 10, z: 128 }, 0)
  assert.equal(lodOf(0, 0), 'far')
  const meshNames = scene.meshes.map((mesh) => mesh.name)
  assert.equal(new Set(meshNames.filter((name) => name.startsWith('trucksim-terrain-0-0-'))).size, 1, 'the old level of detail is disposed')
  world.dispose()
  parent.dispose()
  scene.dispose()
  engine.dispose()
})
