import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { AirportRenderer } from '../render/AirportRenderer'
import { FLIGHT_QUALITY } from '../render/Quality'
import { TerrainRenderer } from '../render/TerrainRenderer'
import { HARROW_FIELD } from '../shared/Airports'

/** Node has no canvas: towns with lit windows paint a DynamicTexture, so give it a 2D context that ignores drawing. */
if (typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas === 'undefined') {
  const pixels = (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
  const context = new Proxy({}, { get: (_target, name) => (name === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => pixels(w, h) : name === 'createImageData' ? (w: number, h: number) => pixels(w, h) : () => undefined), set: () => true })
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext() {
      return context
    }
  }
}

function counts(scene: Scene) {
  return { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, geometries: scene.geometries.length, nodes: scene.transformNodes.length }
}

test('the airport loads and unloads 50 times back to the baseline', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  new AirportRenderer(scene, HARROW_FIELD).dispose()
  const baseline = counts(scene)
  for (let i = 0; i < 50; i++) {
    const airport = new AirportRenderer(scene, HARROW_FIELD)
    assert.ok(scene.meshes.length > baseline.meshes)
    airport.dispose()
    assert.deepEqual(counts(scene), baseline, `after cycle ${i}`)
  }
  scene.dispose()
  engine.dispose()
})

test('terrain streaming across the region keeps a bounded cache and frees everything', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  new TerrainRenderer(scene, FLIGHT_QUALITY.low).dispose()
  const baseline = counts(scene)
  for (let cycle = 0; cycle < 3; cycle++) {
    const terrain = new TerrainRenderer(scene, { ...FLIGHT_QUALITY.low, viewDistance: 9000, treeRange: 1200 })
    for (let step = 0; step < 30; step++) terrain.update(-30000 + step * 2000, 900, step * 700, Infinity)
    assert.ok(terrain.stats.tiles <= 420, `cache grew to ${terrain.stats.tiles}`)
    terrain.dispose()
    assert.deepEqual(counts(scene), baseline, `after cycle ${cycle}`)
  }
  scene.dispose()
  engine.dispose()
})

test('every airport loads and unloads 50 times back to the baseline', async () => {
  const { AIRPORTS } = await import('../shared/Airports')
  const engine = new NullEngine()
  const scene = new Scene(engine)
  for (const spec of AIRPORTS) new AirportRenderer(scene, spec).dispose()
  const baseline = counts(scene)
  for (const spec of AIRPORTS) {
    for (let i = 0; i < 50; i++) {
      const airport = new AirportRenderer(scene, spec)
      airport.dispose()
    }
    assert.deepEqual(counts(scene), baseline, `after 50 cycles of ${spec.id}`)
  }
  scene.dispose()
  engine.dispose()
})

test('a 30-minute scripted route across the region keeps the world bounded and frees everything', async () => {
  const { World } = await import('../game/World')
  const { AIRPORTS } = await import('../shared/Airports')
  const engine = new NullEngine()
  const scene = new Scene(engine)
  new TerrainRenderer(scene, FLIGHT_QUALITY.low).dispose()
  const baseline = counts(scene)
  const world = new World(scene)
  const terrain = new TerrainRenderer(scene, { ...FLIGHT_QUALITY.low, viewDistance: 9000, treeRange: 1200 }, world.root)
  const route = [...AIRPORTS, AIRPORTS[0]]
  let peakMeshes = 0
  const speed = 120
  let leg = 0
  let travelled = 0
  for (let second = 0; second < 30 * 60; second += 2) {
    const a = route[leg % (route.length - 1)]
    const b = route[(leg % (route.length - 1)) + 1]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    travelled += speed * 2
    if (travelled > length) {
      travelled -= length
      leg++
    }
    const t = Math.min(1, travelled / length)
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    world.follow(x, z)
    world.updateAirports(x, z)
    world.updateTowns(x, z, second % 600 > 400 ? 1 : 0)
    terrain.update(x, 1500, z, Infinity)
    peakMeshes = Math.max(peakMeshes, scene.meshes.length)
    assert.ok(world.stats.airports <= 4, `${world.stats.airports} airports loaded at ${second} s`)
    assert.ok(terrain.stats.tiles <= 420, `terrain cache ${terrain.stats.tiles} at ${second} s`)
  }
  assert.ok(leg >= 3, `flew ${leg} legs`)
  assert.ok(peakMeshes < 6000, `peak ${peakMeshes} meshes`)
  terrain.dispose()
  world.dispose()
  assert.deepEqual(counts(scene), baseline, 'after the route')
  scene.dispose()
  engine.dispose()
})
