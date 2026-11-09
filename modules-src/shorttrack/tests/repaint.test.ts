import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STOCK_BOUNDS, bakeLivery, paintShade, parseRegions, regionFor, tintPixels } from '../shared/carRepaint'
import { baseWeights, wrapContext } from '../shared/liveryWrap'
import { carGarage, paintMode } from '../shared/CustomCars'

const REGIONS = parseRegions([
  ['L', [0.006, 0.006, 0.988, 0.208], 0, 2.5727, -2.7352, 1, 1.222, 0.0031],
  ['R', [0.006, 0.226, 0.988, 0.208], 0, -2.7352, 2.5727, 1, 1.222, 0.0031],
  ['T', [0.006, 0.446, 0.988, 0.348], 0, -2.7352, 2.5727, 2, -1.0952, 1.0959],
  ['B', [0.006, 0.806, 0.588, 0.188], 2, -1.0952, 1.0959, 1, 1.222, 0.0031],
  ['F', [0.606, 0.806, 0.388, 0.188], 2, 1.0959, -1.0952, 1, 1.222, 0.0031],
])

test('every older car can be repainted and allows every Garage option', () => {
  assert.equal(paintMode({ mode: 'none', material: '', key: '#ffffff', tolerance: 0.2, color: '#ff0000' }), 'body')
  assert.deepEqual(carGarage({}), { schemes: true, logos: true, numbers: true })
  assert.deepEqual(carGarage({ garage: { schemes: false, logos: true, numbers: false } }), { schemes: false, logos: true, numbers: false })
})

test('faces take their side from where they sit, not their winding', () => {
  const b = STOCK_BOUNDS
  assert.equal(regionFor([0, 0, 1], [0, 0.5, 1], b), 'R')
  assert.equal(regionFor([0, 0, 1], [0, 0.5, -1], b), 'L')   // flipped face on the left side
  assert.equal(regionFor([0, 1, 0], [0, 1.2, 0], b), 'T')
  assert.equal(regionFor([-1, 0, 0], [-2.7, 0.5, 0], b), 'B')
  const px = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  const ctx = wrapContext({ regions: REGIONS, base: px, decals: null, geo: null, bounds: b })
  const main = (p: [number, number, number], n: [number, number, number]) => baseWeights(ctx, p, n).sort((a, b) => b[1] - a[1])[0]
  // a 45° shoulder stays side paint; a flatter one (60° up) is the top's; a flipped normal changes nothing
  assert.equal(main([0, 1, 0.9], [0, Math.SQRT1_2, Math.SQRT1_2])[0], 'R')
  assert.ok(main([0, 1, 0.9], [0, Math.SQRT1_2, Math.SQRT1_2])[1] > 0.95)
  assert.equal(main([0, 1, -0.9], [0, -Math.SQRT1_2, Math.SQRT1_2])[0], 'L')
  assert.equal(main([0, 1.1, 0.5], [0, 0.87, 0.5])[0], 'T')
  const blend = baseWeights(ctx, [0, 1, 0.9], [0, 0.8, 0.6])
  assert.deepEqual(blend.map(([r]) => r).sort(), ['R', 'T'])
  assert.ok(Math.abs(blend.reduce((a, [, w]) => a + w, 0) - 1) < 1e-9)
})

test('paint is even over blotchy textures and dark parts stay dark', () => {
  assert.ok(paintShade(10, 100) < 0.15)               // glass and tyres
  for (const l of [70, 100, 140, 220]) { const s = paintShade(l, 100); assert.ok(s >= 0.8 && s <= 1.12, `${l} → ${s}`) }
  // a body of mixed greys (a generated texture) comes out within a narrow band of the driver's colour
  const px = new Uint8ClampedArray([60, 60, 60, 255, 95, 95, 95, 255, 140, 140, 140, 255, 8, 8, 8, 255])
  tintPixels(px, [200, 0, 0], () => 1)
  const reds = [px[0], px[4], px[8]]
  assert.ok(Math.max(...reds) - Math.min(...reds) < 70, reds.join())
  assert.ok(px[12] < 30)
})

test('bakes the livery onto a textured quad through its own UVs', () => {
  // the car's right side, one quad covering the whole texture
  const positions = new Float32Array([-2.7, 0.1, 1, 2.5, 0.1, 1, 2.5, 1.2, 1, -2.7, 1.2, 1])
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])
  const index = [0, 1, 2, 0, 2, 3]
  const T = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(128) }
  // livery: R region painted blue, everything else red
  const L = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4, inR = y / 64 >= 0.226 && y / 64 <= 0.434
    L.data[i] = inR ? 0 : 255; L.data[i + 2] = inR ? 255 : 0; L.data[i + 3] = 255
  }
  bakeLivery({ texture: T, livery: L, regions: REGIONS, parts: [{ positions, uvs, index }], bounds: STOCK_BOUNDS, flipY: false, weight: () => 1, fallback: [0, 255, 0] })
  for (let i = 0; i < T.data.length; i += 4) { assert.equal(T.data[i], 0); assert.ok(T.data[i + 2] > 200) }
})
