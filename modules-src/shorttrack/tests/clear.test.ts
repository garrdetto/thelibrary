import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CLEAR_GLASS, CLEAR_SPOILER, clearGroups, clearPixels, cutClear, measureGreenhouse, regionAt, spoilerTriangles } from '../shared/carClear'
import { boundsOf } from '../shared/carRepaint'

type V = [number, number, number]

/** A box body with a sloped greenhouse and a spoiler plate on the tail, built from fine grids like a scanned mesh. */
function sampleCar() {
  const pos: number[] = [], index: number[] = []
  const quad = (a: V, b: V, c: V, d: V, n = 8) => {
    const base = pos.length / 3
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const u = i / n, v = j / n
      for (let k = 0; k < 3; k++) pos.push((1 - u) * (1 - v) * a[k] + u * (1 - v) * b[k] + u * v * c[k] + (1 - u) * v * d[k])
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = base + j * (n + 1) + i
      index.push(p, p + 1, p + n + 2, p, p + n + 2, p + n + 1)
    }
    return index.length / 3
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z: number) => {
    quad([x0, y1, -z], [x1, y1, -z], [x1, y1, z], [x0, y1, z], 24)
    for (const s of [-1, 1]) quad([x0, y0, s * z], [x1, y0, s * z], [x1, y1, s * z], [x0, y1, s * z], 24)
    quad([x0, y0, -z], [x0, y1, -z], [x0, y1, z], [x0, y0, z])
    quad([x1, y0, -z], [x1, y1, -z], [x1, y1, z], [x1, y0, z])
  }
  box(-2.5, 2.5, 0.2, 0.9, 1)
  const cab: [number, number][] = [[0.9, 0.9], [0.1, 1.3], [-1.0, 1.3], [-2.0, 0.9]]
  for (let k = 0; k < 3; k++) quad([cab[k][0], cab[k][1], -0.7], [cab[k + 1][0], cab[k + 1][1], -0.7], [cab[k + 1][0], cab[k + 1][1], 0.7], [cab[k][0], cab[k][1], 0.7], 12)
  for (const s of [-1, 1]) {
    quad([0.9, 0.9, s * 0.7], [0.1, 1.3, s * 0.7], [-1.0, 1.3, s * 0.7], [-2.0, 0.9, s * 0.7], 12)
  }
  const spoilerFirst = index.length / 3
  quad([-2.45, 0.9, -0.9], [-2.45, 0.9, 0.9], [-2.45, 1.1, 0.9], [-2.45, 1.1, -0.9])
  return { pos: new Float32Array(pos), index: new Uint32Array(index), spoilerFirst }
}

test('the greenhouse is measured from the roof profile', () => {
  const car = sampleCar()
  const g = measureGreenhouse(car.pos, car.index, boundsOf([car.pos]))
  assert.ok(g)
  assert.ok(Math.abs(g.roofFront - 0.1) < 0.2, `roof front ${g.roofFront}`)
  assert.ok(Math.abs(g.roofRear + 1.0) < 0.2, `roof rear ${g.roofRear}`)
  assert.ok(g.cowl > 0.7 && g.cowl < 1.2, `cowl ${g.cowl}`)
  assert.ok(Math.abs(g.deckY - 0.9) < 0.05, `deck ${g.deckY}`)
})

test('windshield, rear window and spoiler are told apart from paint', () => {
  const car = sampleCar()
  const g = measureGreenhouse(car.pos, car.index, boundsOf([car.pos]))!
  const up: V = [0.45, 0.89, 0], back: V = [-0.37, 0.93, 0], flat: V = [0, 1, 0], aft: V = [-1, 0, 0]
  assert.equal(regionAt(g, [0.5, 1.1, 0], up), 1)
  assert.equal(regionAt(g, [-1.5, 1.1, 0.2], back), 3)
  assert.equal(regionAt(g, [-0.4, 1.3, 0], flat), 0)
  assert.equal(regionAt(g, [1.8, 0.9, 0], flat), 0)
  assert.equal(regionAt(g, [-2.3, 0.9, 0], flat), 0)
  assert.equal(regionAt(g, [0.2, 0.6, 1], [0, 0, 1]), 0)
  assert.equal(regionAt(g, [-2.45, 1.05, 0.3], aft), 2)
})

test('spoiler triangles are only the plate on the tail', () => {
  const car = sampleCar()
  const found = spoilerTriangles(car.pos, car.index, boundsOf([car.pos]), 0, car.index.length / 3)
  assert.ok(found.length > 0)
  assert.ok(found.every((t) => t >= car.spoilerFirst), 'nothing but the plate')
})

test('clear groups keep body and clear triangles drawable side by side', () => {
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const flags = new Uint8Array([1, 2, 3, 2])
  const g = clearGroups(index, flags)
  assert.deepEqual(Array.from(g.index), [3, 4, 5, 9, 10, 11, 6, 7, 8, 0, 1, 2])
  assert.deepEqual(g.body, { start: 0, count: 9 })
  assert.deepEqual(g.clear, { start: 6, count: 6 })
})

test('the clear look is tinted and see-through, and the body is cut out under it', () => {
  const mask = { mask: new Uint8Array([0, CLEAR_GLASS, CLEAR_SPOILER, 0]), triangles: new Uint8Array(0), glass: 1, spoiler: 1 }
  const look = clearPixels(mask, 2, 2)
  assert.equal(look[3], 0)
  assert.ok(look[7] > 0 && look[7] < 255)
  assert.ok(look[11] > 0 && look[11] < look[7])
  const body = new Uint8ClampedArray(16).fill(255)
  cutClear(body, mask)
  assert.deepEqual([body[3], body[7], body[11], body[15]], [255, 0, 0, 255])
})
