import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { HALVARD_INTERNATIONAL } from '../shared/Airports'
import { World } from '../game/World'

test('the floating origin keeps world meshes in place and airports stream in and out', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  const world = new World(scene)
  try {
    world.updateAirports(0, 0)
    assert.equal(world.stats.airports, 2, 'Harrow and Millbrook are in range of Harrow')
    const hub = HALVARD_INTERNATIONAL
    world.follow(hub.x + 150, hub.z - 220)
    world.updateAirports(hub.x, hub.z)
    assert.equal(world.stats.originX, Math.round((hub.x + 150) / 1000) * 1000)
    assert.equal(world.stats.originZ, Math.round((hub.z - 220) / 1000) * 1000)
    const loaded = [...world.loadedAirports].map((renderer) => renderer.airport.id)
    assert.ok(loaded.includes('halvard') && !loaded.includes('harrow'), loaded.join(','))
    const renderer = [...world.loadedAirports].find((r) => r.airport.id === 'halvard')!
    const pavement = renderer.root.getChildMeshes(false).find((mesh) => mesh.name === 'takeflight-pavement')!
    const centre = pavement.getBoundingInfo().boundingBox.centerWorld
    assert.ok(Math.abs(centre.x + world.originX - hub.runways[0].cx) < 600 && Math.abs(centre.z + world.originZ - hub.runways[0].cz) < 600, `pavement at ${centre.x}, ${centre.z}`)
    assert.ok(Math.abs(centre.x) < 2000 && Math.abs(centre.z) < 2000, 'drawn near the scene origin')
    assert.equal(world.follow(hub.x + 900, hub.z), false, 'small moves keep the origin')
  } finally {
    world.dispose()
    scene.dispose()
    engine.dispose()
  }
})
