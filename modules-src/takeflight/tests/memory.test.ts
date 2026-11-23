import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { AirportRenderer } from '../render/AirportRenderer'
import { FLIGHT_QUALITY } from '../render/Quality'
import { TerrainRenderer } from '../render/TerrainRenderer'
import { HARROW_FIELD } from '../shared/Airports'

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
