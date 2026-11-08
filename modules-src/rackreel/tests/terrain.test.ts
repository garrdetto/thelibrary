import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LAKE_CENTER, PLAY_LIMIT, Terrain, forestDensity, lakeCoord } from '../world/Terrain'

const terrain = new Terrain()

test('the lake holds water and the shore rises out of it', () => {
  assert.ok(terrain.heightAt(LAKE_CENTER.x, LAKE_CENTER.z) < -6, 'deep basin in the middle')
  let land = 0
  let water = 0
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    const x = LAKE_CENTER.x + Math.cos(a) * 330
    const z = LAKE_CENTER.z + Math.sin(a) * 330
    if (terrain.heightAt(x, z) > 0.5) land++
    const x2 = LAKE_CENTER.x + Math.cos(a) * 60
    const z2 = LAKE_CENTER.z + Math.sin(a) * 60
    if (terrain.heightAt(x2, z2) < -0.5) water++
  }
  assert.ok(land > 55, `ring of land ${land}`)
  assert.ok(water > 55, `ring of water ${water}`)
})

test('heights are finite everywhere the player can reach and match the grid', () => {
  for (let x = -PLAY_LIMIT; x <= PLAY_LIMIT; x += 37) {
    for (let z = -PLAY_LIMIT; z <= PLAY_LIMIT; z += 41) {
      const h = terrain.heightAt(x, z)
      assert.ok(Number.isFinite(h))
      assert.ok(h > -25 && h < 90, `${x},${z} = ${h}`)
    }
  }
})

test('forest covers a real share of the land but not the lake', () => {
  let forest = 0
  let samples = 0
  for (let x = -460; x < 460; x += 20) {
    for (let z = -460; z < 460; z += 20) {
      if (lakeCoord(x, z).s < 1) {
        assert.equal(forestDensity(x, z), 0)
        continue
      }
      samples++
      if (forestDensity(x, z) > 0.42) forest++
    }
  }
  const share = forest / samples
  assert.ok(share > 0.15 && share < 0.75, `forest share ${share}`)
})
