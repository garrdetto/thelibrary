import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STOCK_BOUNDS, bakeLivery, parseRegions } from '../shared/carRepaint'
import { buildLiveryGeo, decalWeight, fitDecal, planAtlas, upsamplePlan, wheelOccluder, wrapContext } from '../shared/liveryWrap'
import type { GeoPart } from '../shared/liveryWrap'

const REGIONS = parseRegions([
  ['L', [0.006, 0.006, 0.988, 0.208], 0, 2.5727, -2.7352, 1, 1.222, 0.0031],
  ['R', [0.006, 0.226, 0.988, 0.208], 0, -2.7352, 2.5727, 1, 1.222, 0.0031],
  ['T', [0.006, 0.446, 0.988, 0.348], 0, -2.7352, 2.5727, 2, -1.0952, 1.0959],
  ['B', [0.006, 0.806, 0.588, 0.188], 2, -1.0952, 1.0959, 1, 1.222, 0.0031],
  ['F', [0.606, 0.806, 0.388, 0.188], 2, 1.0959, -1.0952, 1, 1.222, 0.0031],
])

/** A quad as two triangles (corners in order round the face). */
const quad = (a: number[], b: number[], c: number[], d: number[], paint = true): GeoPart => ({ positions: [...a, ...b, ...c, ...d], index: [0, 1, 2, 0, 2, 3], paint })

/** A box body the size of the stock car: right side, left side, top, nose, tail. */
function boxCar(): GeoPart[] {
  const [x0, y0, z0] = STOCK_BOUNDS.min, [x1, y1, z1] = STOCK_BOUNDS.max
  return [
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
  ]
}

test('a logo over a wheel opening moves onto the panel; one already on it stays put', () => {
  // the wheel stands proud of the side, like a tyre seen through the arch
  const geo = buildLiveryGeo([...boxCar(), wheelOccluder(-1.45, 0.35, STOCK_BOUNDS.max[2] + 0.02, 0.36)], REGIONS)
  const stay = fitDecal(geo, 'R', 0, 0.6, 0.9, 0.3)
  assert.deepEqual(stay, { x: 0, y: 0.6, k: 1 })
  const moved = fitDecal(geo, 'R', -1.6, 0.54, 0.95, 0.3)
  // somewhere else, at a size that now sits on the panel (fitting it again leaves it alone), not over the wheel
  assert.notDeepEqual(moved, { x: -1.6, y: 0.54, k: 1 })
  assert.deepEqual(fitDecal(geo, 'R', moved.x, moved.y, 0.95 * moved.k, 0.3 * moved.k), { x: moved.x, y: moved.y, k: 1 })
  assert.ok(Math.hypot(moved.x + 1.45, moved.y - 0.35) > 0.36, JSON.stringify(moved))
  assert.ok(moved.k >= 0.55)
  // the race number is never covered
  const avoid = fitDecal(geo, 'R', -1.6, 0.54, 0.95, 0.3, [{ x: -0.6, y: 0.6, w: 1.4, h: 1.2 }])
  assert.ok(avoid.x + 0.95 * avoid.k / 2 <= 0.1 - 1.3 || avoid.x - 0.95 * avoid.k / 2 >= 0.1 || avoid.y - 0.15 * avoid.k >= 1.2, JSON.stringify(avoid))
})

test('decals land on the outer surface facing them, never on hidden or far-side panels', () => {
  const inner = quad([-1, 0.2, 0.7], [1, 0.2, 0.7], [1, 0.9, 0.7], [-1, 0.9, 0.7])
  const geo = buildLiveryGeo([...boxCar(), inner], REGIONS)
  const px = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  const ctx = wrapContext({ regions: REGIONS, base: px, decals: null, geo, bounds: STOCK_BOUNDS })
  const z1 = STOCK_BOUNDS.max[2]
  assert.equal(decalWeight(ctx, 'R', [0, 0.5, z1], [0, 0, 1]), 1)
  assert.equal(decalWeight(ctx, 'R', [0, 0.5, 0.7], [0, 0, 1]), 0)       // the inner panel behind it
  assert.equal(decalWeight(ctx, 'L', [0, 0.5, z1], [0, 0, 1]), 0)        // the other side's logo
  assert.ok(decalWeight(ctx, 'R', [0, 0.5, z1], [0, 0.8, 0.6]) > 0.5)   // over a rounded shoulder
  assert.equal(decalWeight(ctx, 'R', [0, 0.5, z1], [0, 0.97, 0.24]), 0) // but not onto the flat top
})

test('a logo drawn on the side runs over the seam onto the next face in one piece', () => {
  // a right side whose upper half leans in at 45°: flat projection would cut the logo at the crease
  const z1 = 1, crease = 0.7
  const positions = new Float32Array([
    -1, 0.3, z1, 1, 0.3, z1, 1, crease, z1, -1, crease, z1,
    -1, crease, z1, 1, crease, z1, 1, crease + 0.3, z1 - 0.3, -1, crease + 0.3, z1 - 0.3,
  ])
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0.71, 0.71, 0, 0.71, 0.71, 0, 0.71, 0.71, 0, 0.71, 0.71])
  // the model's own UVs: the lower panel in the bottom half of the texture, the leaning one in the top half
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0.5, 0, 0.5, 0, 0.5, 1, 0.5, 1, 0, 0, 0])
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
  const S = 64, A = 256
  const T = { width: S, height: S, data: new Uint8ClampedArray(S * S * 4).fill(150) }
  const base = { width: A, height: A, data: new Uint8ClampedArray(A * A * 4) }
  for (let i = 0; i < base.data.length; i += 4) { base.data[i] = 200; base.data[i + 3] = 255 }
  // decal: an opaque white block over the crease in the R region (x -0.5..0.5, y 0.55..0.9)
  const decals = { width: A, height: A, data: new Uint8ClampedArray(A * A * 4) }
  const R = REGIONS[1], [rx, ry, rw, rh] = R.rect
  for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
    const fu = (x / A - rx) / rw, fv = (y / A - ry) / rh
    if (fu < 0 || fu > 1 || fv < 0 || fv > 1) continue
    const mx = R.u0 + fu * (R.u1 - R.u0), my = R.v0 + fv * (R.v1 - R.v0)
    if (mx > -0.5 && mx < 0.5 && my > 0.55 && my < 0.9) decals.data.set([255, 255, 255, 255], (y * A + x) * 4)
  }
  const parts = [{ positions, normals, uvs, index }]
  const geo = buildLiveryGeo([{ positions, normals, index, paint: true }], REGIONS)
  bakeLivery({ texture: T, livery: base, decals, geo, regions: REGIONS, parts, bounds: STOCK_BOUNDS, flipY: false, weight: () => 1, fallback: [0, 0, 0] })
  const at = (u: number, v: number) => T.data[(Math.floor(v * S) * S + Math.floor(u * S)) * 4 + 2]
  // the middle of the block, just under the crease and just over it, is white on both faces
  assert.ok(at(0.5, 0.55) > 180, `below the crease ${at(0.5, 0.55)}`)
  assert.ok(at(0.5, 0.45) > 180, `above the crease ${at(0.5, 0.45)}`)
  // and the body away from it keeps the base paint
  assert.ok(at(0.1, 0.9) < 40)
})

test('the stock car: the field\'s rear-quarter logos come off the wheel arch and the seams are planned', () => {
  const buf = readFileSync(join(process.cwd(), 'public/modules/shorttrack-car.bin')), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const dv = new DataView(ab), jl = dv.getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, jl)))
  let o = 8 + jl
  const take = <T>(C: { new(b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, n: number) => { const a = new C(ab, o, n); o += Math.ceil((n * C.BYTES_PER_ELEMENT) / 4) * 4; return a }
  const parts: (GeoPart & { uvs: Float32Array; normals: Float32Array })[] = []
  for (const p of meta.parts) {
    const q = take(Int16Array, p.v * 3), n8 = take(Int8Array, p.v * 3); take(Uint8Array, p.v)
    const uv16 = take(Uint16Array, p.v * 2), idx = take(p.i32 ? Uint32Array : Uint16Array, p.i) as ArrayLike<number> & { subarray(a: number, b: number): ArrayLike<number> }
    const pos = new Float32Array(p.v * 3), nor = new Float32Array(p.v * 3), uv = new Float32Array(p.v * 2)
    for (let i = 0; i < p.v; i++) for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = p.lo[k] + ((q[i * 3 + k] + 32768) / 65535) * (p.hi[k] - p.lo[k]) + (p.center ? p.center[k] : 0)
      nor[i * 3 + k] = n8[i * 3 + k] / 127
    }
    for (let i = 0; i < uv.length; i++) uv[i] = uv16[i] / 65535
    for (const [st, ct, mi] of p.groups) parts.push({ positions: pos, normals: nor, uvs: uv, index: idx.subarray(st, st + ct), paint: !p.center && mi === 0 })
  }
  const regions = parseRegions(meta.regions), geo = buildLiveryGeo(parts, regions)
  // the iconic schemes put their side logo at t 0.79, s 0.48: right over the rear wheel on this body
  for (const side of ['L', 'R'] as const) {
    const f = fitDecal(geo, side, -1.62, 0.54, 0.95, 0.3)
    assert.ok(f.x !== -1.62 || f.y !== 0.54 || f.k < 1, `${side} logo not moved`)
    const again = fitDecal(geo, side, f.x, f.y, 0.95 * f.k, 0.3 * f.k)
    assert.deepEqual(again, { x: f.x, y: f.y, k: 1 }, `${side} logo not on the panel`)
    // the door number spot is clean panel already
    assert.deepEqual(fitDecal(geo, side, -0.05, 0.52, 0.6, 0.4), { x: -0.05, y: 0.52, k: 1 })
  }
  const plan = planAtlas(parts.filter(p => p.paint), regions, geo, STOCK_BOUNDS, 256, 256)
  assert.ok(plan.texel.length > 1000 && plan.texel.length < 256 * 256 * 0.6, `${plan.texel.length} seam texels`)
  const big = upsamplePlan(plan, 2)
  assert.equal(big.texel.length, plan.texel.length * 4)
  assert.equal(big.width, 512)
  assert.ok(big.texel.every(t => t >= 0 && t < 512 * 512))
})
