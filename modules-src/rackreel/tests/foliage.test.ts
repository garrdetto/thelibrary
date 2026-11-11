import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import {
  BIRCH_COLORS, FloatBatch, GRASS, GRASS_CELL, GRASS_CELLS, GRASS_CHUNK_CAPACITY, GrassBuilder, HARDWOOD_COLORS, composeInstance, crownColor, grassChunkDistance, grassChunkKey,
  grassFade, hash, orderBlades, windWeight, writeTint,
} from '../world/FoliagePlacement'
import type { GrassChunkData } from '../world/FoliagePlacement'
import { HIGHWAY, Terrain, forestDensity, highwayCoord } from '../world/Terrain'

const terrain = new Terrain()

function chunk(): GrassChunkData {
  return { matrices: new Float32Array(GRASS_CHUNK_CAPACITY * 16), colors: new Float32Array(GRASS_CHUNK_CAPACITY * 4), count: 0, minY: 0, maxY: 0 }
}

function chunkAt(x: number, z: number): [number, number] {
  return [Math.floor(x / GRASS.chunk), Math.floor(z / GRASS.chunk)]
}

test('the scatter hash is stable, so trees, rocks and logs stay where they were', () => {
  assert.equal(hash(-448, -448, 1), hash(-448, -448, 1))
  assert.ok(Math.abs(hash(12, -7, 3) - 0.317146607208997) < 1e-12, String(hash(12, -7, 3)))
  assert.ok(Math.abs(hash(-448.5, 213.25, 5) - 0.6768030333332717) < 1e-12, String(hash(-448.5, 213.25, 5)))
  let low = 1
  let high = 0
  for (let i = 0; i < 5000; i++) {
    const v = hash(i * 6.5, -i * 3.2, 4)
    low = Math.min(low, v)
    high = Math.max(high, v)
  }
  assert.ok(low >= 0 && high < 1 && low < 0.01 && high > 0.99)
})

test('instance matrices match Babylon\'s Matrix.Compose', () => {
  const out = new Float32Array(32)
  const expected = new Matrix()
  const q = new Quaternion()
  for (let i = 0; i < 200; i++) {
    const r = (k: number) => hash(i, k, 77)
    const [x, y, z] = [r(1) * 900 - 450, r(2) * 40, r(3) * 900 - 450]
    const [yaw, tiltX, tiltZ] = [r(4) * 6.283, (r(5) - 0.5) * 0.06, (r(6) - 0.5) * 0.06]
    const [sx, sy] = [0.72 + r(7) * 0.55, 0.6 + r(8)]
    composeInstance(out, 16, x, y, z, yaw, sx, sy, sx, tiltX, tiltZ)
    Quaternion.FromEulerAnglesToRef(tiltX, yaw, tiltZ, q)
    Matrix.ComposeToRef(new Vector3(sx, sy, sx), q, new Vector3(x, y, z), expected)
    for (let k = 0; k < 16; k++) assert.ok(Math.abs(out[16 + k] - expected.m[k]) < 1e-4, `matrix ${i} element ${k}: ${out[16 + k]} vs ${expected.m[k]}`)
  }
})

test('a float batch grows without losing what was written', () => {
  const batch = new FloatBatch(4)
  for (let i = 0; i < 100; i++) {
    const at = batch.reserve(16)
    batch.data[at] = i
    batch.data[at + 15] = -i
  }
  const data = batch.toArray()
  assert.equal(data.length, 1600)
  for (let i = 0; i < 100; i++) {
    assert.equal(data[i * 16], i)
    assert.equal(data[i * 16 + 15], -i)
  }
  batch.reset()
  assert.equal(batch.toArray().length, 0)
})

test('wind leaves roots anchored and bends tips the most', () => {
  assert.equal(windWeight(0, 0.03, 0.5), 0)
  assert.equal(windWeight(0.03, 0.03, 0.5), 0)
  assert.equal(windWeight(-0.3, 1.2, 15), 0)
  assert.ok(Math.abs(windWeight(0.53, 0.03, 0.5) - 1) < 1e-9)
  let last = 0
  for (let y = 0.03; y <= 0.53; y += 0.05) {
    const w = windWeight(y, 0.03, 0.5)
    assert.ok(w >= last)
    last = w
  }
  assert.ok(windWeight(0.28, 0.03, 0.5) < 0.3, 'the middle of a blade moves much less than the tip')
})

test('grass shrinks away smoothly at the edge of the ring', () => {
  assert.equal(grassFade(0, GRASS.fadeStart, GRASS.fadeEnd), 1)
  assert.equal(grassFade(GRASS.fadeStart, GRASS.fadeStart, GRASS.fadeEnd), 1)
  assert.equal(grassFade(GRASS.fadeEnd, GRASS.fadeStart, GRASS.fadeEnd), 0)
  assert.equal(grassFade(GRASS.fadeEnd + 50, GRASS.fadeStart, GRASS.fadeEnd), 0)
  let last = 1
  for (let d = GRASS.fadeStart; d <= GRASS.fadeEnd; d += 1) {
    const k = grassFade(d, GRASS.fadeStart, GRASS.fadeEnd)
    assert.ok(k <= last + 1e-12)
    last = k
  }
  assert.ok(GRASS.release > GRASS.fadeEnd, 'chunks are only dropped after their grass has faded out')
})

test('chunk keys are unique and chunk distance is to the nearest edge', () => {
  const seen = new Set<number>()
  for (let cx = -40; cx <= 40; cx++) for (let cz = -40; cz <= 40; cz++) seen.add(grassChunkKey(cx, cz))
  assert.equal(seen.size, 81 * 81)
  assert.equal(grassChunkDistance(0, 0, 8, 8), 0)
  assert.equal(grassChunkDistance(0, 0, -4, 8), 4)
  assert.ok(Math.abs(grassChunkDistance(1, 1, 13, 12) - 5) < 1e-9)
})

test('a grass chunk is deterministic, stays inside its square and on dry land', () => {
  const builder = new GrassBuilder(terrain, [])
  const [cx, cz] = chunkAt(-64, -192)
  const a = chunk()
  const b = chunk()
  builder.build(cx, cz, a)
  builder.build(cx + 3, cz - 2, b)
  builder.build(cx, cz, b)
  assert.ok(a.count > 400, `meadow chunk holds ${a.count} clumps`)
  assert.ok(a.count <= GRASS_CHUNK_CAPACITY)
  assert.equal(a.count, b.count)
  for (let i = 0; i < a.count * 16; i++) assert.equal(a.matrices[i], b.matrices[i])
  for (let i = 0; i < a.count * 4; i++) assert.equal(a.colors[i], b.colors[i])
  const size = GRASS.chunk
  for (let i = 0; i < a.count; i++) {
    const x = a.matrices[i * 16 + 12]
    const y = a.matrices[i * 16 + 13]
    const z = a.matrices[i * 16 + 14]
    assert.ok(x >= cx * size && x <= (cx + 1) * size + 1e-3 && z >= cz * size && z <= (cz + 1) * size + 1e-3, `clump ${i} at ${x}, ${z}`)
    assert.ok(Math.abs(y - (terrain.heightAt(x, z) - 0.03)) < 1e-3, 'clumps sit on the terrain')
    assert.ok(terrain.heightAt(x, z) >= GRASS.minHeight)
    assert.ok(y >= a.minY - 1e-6 && y <= a.maxY)
    for (let k = 0; k < 3; k++) assert.ok(a.colors[i * 4 + k] > 0.3 && a.colors[i * 4 + k] < 1.6, 'tints stay subtle')
    assert.ok(a.colors[i * 4 + 3] >= 0 && a.colors[i * 4 + 3] < 1)
  }
  assert.ok(Math.abs(GRASS_CELLS * GRASS_CELL - GRASS.chunk) < 1e-9, 'cells tile the chunk exactly')
})

test('no two neighbouring clumps are identical in scale, turn and tint', () => {
  const builder = new GrassBuilder(terrain, [])
  const [cx, cz] = chunkAt(-64, -192)
  const a = chunk()
  builder.build(cx, cz, a)
  const looks = new Set<string>()
  for (let i = 0; i < a.count; i++) looks.add([a.matrices[i * 16], a.matrices[i * 16 + 5], a.matrices[i * 16 + 2], a.colors[i * 4], a.colors[i * 4 + 1]].map((v) => v.toFixed(4)).join(','))
  assert.equal(looks.size, a.count)
})

test('grass keeps off the water, the highway and the keep-clear holes, and thins out under the trees', () => {
  const builder = new GrassBuilder(terrain, [])
  const lake = chunk()
  builder.build(...chunkAt(10, 30), lake)
  assert.equal(lake.count, 0, 'nothing grows in the lake basin')
  const road = chunk()
  let onRoad = 0
  for (let t = -300; t <= 300; t += 40) {
    const x = HIGHWAY.x + HIGHWAY.dx * t
    const z = HIGHWAY.z + HIGHWAY.dz * t
    builder.build(...chunkAt(x, z), road)
    for (let i = 0; i < road.count; i++) if (highwayCoord(road.matrices[i * 16 + 12], road.matrices[i * 16 + 14]).across < HIGHWAY.halfWidth + 1.5) onRoad++
  }
  assert.equal(onRoad, 0)
  const [cx, cz] = chunkAt(-64, -192)
  const open = chunk()
  builder.build(cx, cz, open)
  const hole = { x: (cx + 0.5) * GRASS.chunk, z: (cz + 0.5) * GRASS.chunk, r: 5 }
  const holed = chunk()
  new GrassBuilder(terrain, [hole]).build(cx, cz, holed)
  assert.ok(holed.count < open.count)
  for (let i = 0; i < holed.count; i++) assert.ok(Math.hypot(holed.matrices[i * 16 + 12] - hole.x, holed.matrices[i * 16 + 14] - hole.z) >= hole.r)
  let forest: [number, number] = [0, 0]
  let highest = -Infinity
  for (let x = -400; x <= 400; x += 16) {
    for (let z = -400; z <= 400; z += 16) {
      if (terrain.heightAt(x + 8, z + 8) < 2.5 || terrain.slopeAt(x + 8, z + 8) > 0.3) continue
      let d = 0
      for (const [ox, oz] of [[2, 2], [14, 2], [2, 14], [14, 14], [8, 8]]) d += forestDensity(x + ox, z + oz) / 5
      if (d > highest) {
        highest = d
        forest = [x, z]
      }
    }
  }
  assert.ok(highest > 0.7, `thick woods ${highest}`)
  const thin = chunk()
  builder.build(...chunkAt(forest[0] + 8, forest[1] + 8), thin)
  assert.ok(open.count > thin.count * 3, `meadow ${open.count} vs forest ${thin.count}`)
})

test('blades are reordered tallest first so a prefix draws whole blades', () => {
  const positions: number[] = []
  const indices: number[] = []
  const heights = [0.3, 0.5, 0.2, 0.45]
  heights.forEach((h, b) => {
    const base = positions.length / 3
    positions.push(b, 0, 0, b + 0.05, 0, 0, b, h / 2, 0, b + 0.05, h / 2, 0, b + 0.02, h, 0)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4)
  })
  const ordered = orderBlades(positions, indices)
  assert.deepEqual(ordered.ends, [9, 18, 27, 36])
  assert.equal(ordered.indices.length, indices.length)
  const top = (from: number, to: number) => Math.max(...Array.from(ordered.indices.slice(from, to), (i) => positions[i * 3 + 1]))
  assert.deepEqual([top(0, 9), top(9, 18), top(18, 27), top(27, 36)], [0.5, 0.45, 0.3, 0.2])
  assert.deepEqual(Array.from(ordered.indices).sort((a, b) => a - b), indices.slice().sort((a, b) => a - b))
})

test('every tree gets its palette colour with a small wobble, and trunk and crown share a wind phase', () => {
  const trunk = new Float32Array(4)
  const crown = new Float32Array(4)
  for (let i = 0; i < 300; i++) {
    const cx = -512 + i * 6.5
    const cz = 300 - i * 6.5
    const hardwood = crownColor('hardwood', cx, cz)
    assert.ok(HARDWOOD_COLORS.includes(hardwood))
    assert.ok(BIRCH_COLORS.includes(crownColor('birch', cx, cz)))
    assert.deepEqual(crownColor('pine', cx, cz), [1, 1, 1])
    const phase = hash(cx, cz, 50)
    writeTint(trunk, 0, [1, 1, 1], cx, cz, 31, 0.14, phase)
    writeTint(crown, 0, hardwood, cx, cz, 41, 0.12, phase)
    assert.equal(trunk[3], crown[3])
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(trunk[k] - 1) < 0.25)
      assert.ok(Math.abs(crown[k] / hardwood[k] - 1) < 0.2)
    }
  }
})
