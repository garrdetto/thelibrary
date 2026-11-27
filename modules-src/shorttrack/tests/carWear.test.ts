import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import * as THREE from 'three'
import { slickWheel, slickMaterial } from '../slick-tire.js'
import { dentParts } from '../body-dents.js'

type Part = { center: number[] | null; geo: THREE.BufferGeometry }

function stockParts(): Part[] {
  const buf = readFileSync(join(process.cwd(), 'public/modules/shorttrack-car.bin')), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const dv = new DataView(ab), jl = dv.getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, jl)))
  let o = 8 + jl
  const take = <T>(C: { new(b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, n: number) => { const a = new C(ab, o, n); o += Math.ceil((n * C.BYTES_PER_ELEMENT) / 4) * 4; return a }
  return meta.parts.map((p: { v: number; i: number; i32?: boolean; lo: number[]; hi: number[]; center: number[] | null; groups: number[][] }) => {
    const q = take(Int16Array, p.v * 3), n8 = take(Int8Array, p.v * 3), c8 = take(Uint8Array, p.v), uv16 = take(Uint16Array, p.v * 2)
    const idx = take(p.i32 ? Uint32Array : Uint16Array, p.i) as Uint16Array | Uint32Array
    const pos = new Float32Array(p.v * 3), nor = new Float32Array(p.v * 3), col = new Float32Array(p.v * 3), uv = new Float32Array(p.v * 2)
    for (let i = 0; i < p.v; i++) {
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = p.lo[k] + ((q[i * 3 + k] + 32768) / 65535) * (p.hi[k] - p.lo[k]); nor[i * 3 + k] = n8[i * 3 + k] / 127 }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c8[i] / 255
    }
    for (let i = 0; i < uv.length; i++) uv[i] = uv16[i] / 65535
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1))
    for (const [st, ct, mi] of p.groups) geo.addGroup(st, ct, mi)
    return { center: p.center, geo }
  })
}

const radial = (p: ArrayLike<number>, v: number) => Math.hypot(p[v * 3], p[v * 3 + 1])

test('stock wheels: the slick is closed, faces out, and no rim triangle reaches the tread', () => {
  for (const part of stockParts().filter((p) => p.center)) {
    const before = part.geo.attributes.position.count
    const geo = slickWheel(THREE, part.geo)
    const { outer, lip } = geo.userData.slick as { outer: number; half: number; lip: number }
    assert.ok(outer > 0.34 && outer < 0.37, `tyre radius ${outer}`)
    assert.ok(geo.attributes.position.count !== before)
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index!.array
    const tire = geo.groups.find((g) => g.materialIndex === 3)!, rim = geo.groups.find((g) => g.materialIndex === 4)!
    assert.ok(tire && rim, 'tyre and rim groups')
    for (let t = rim.start; t < rim.start + rim.count; t++) assert.ok(radial(pos, idx[t]) <= lip * 1.08, `rim vertex at ${radial(pos, idx[t])}`)
    const edges = new Map<string, number>(), key = (v: number) => [0, 1, 2].map((k) => Math.round(pos[v * 3 + k] * 1e4)).join(',')
    let outward = 0, tread = 0
    for (let t = tire.start; t < tire.start + tire.count; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]]
      for (let e = 0; e < 3; e++) { const a = key(tri[e]), b = key(tri[(e + 1) % 3]), k = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(k, (edges.get(k) ?? 0) + 1) }
      for (const v of tri) if (radial(pos, v) > outer - 1e-4) { tread++; if (nor[v * 3] * pos[v * 3] + nor[v * 3 + 1] * pos[v * 3 + 1] > 0) outward++ }
    }
    const open = [...edges.values()].filter((n) => n !== 2).length
    assert.equal(open, 0, `${open} open tyre edges`)
    assert.ok(tread > 0 && outward === tread, `tread normals out ${outward}/${tread}`)
  }
  const m = slickMaterial(THREE)
  assert.equal(m.metalness, 0)
  assert.equal(m.roughness, 1)
  assert.equal(m.specularIntensity, 0)
})

function sheet(n: number, split: boolean) {
  const pos: number[] = [], idx: number[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(-1 + (2 * i) / n, -1 + (2 * j) / n, 0)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d) }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals()
  const g = split ? geo.toNonIndexed() : geo
  if (split) g.computeVertexNormals()
  return { geo: g, orig: Float32Array.from(g.attributes.position.array) }
}

test('dents are smooth: no pits, no faceted seams, decals over the body follow it', () => {
  const body = sheet(40, false), split = sheet(40, true)
  for (let hit = 0; hit < 6; hit++) dentParts([body, split], [0.1 * hit - 0.25, 0.05 * hit, 0.3], [0, 0, -1], 1, 18)
  const n = 40, z = (i: number, j: number) => body.geo.attributes.position.array[(j * (n + 1) + i) * 3 + 2]
  let maxDepth = 0, maxCurv = 0
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) {
    maxDepth = Math.max(maxDepth, -z(i, j))
    maxCurv = Math.max(maxCurv, Math.abs(z(i - 1, j) + z(i + 1, j) + z(i, j - 1) + z(i, j + 1) - 4 * z(i, j)))
  }
  assert.ok(maxDepth > 0.05, `dented ${maxDepth}`)
  assert.ok(maxCurv < maxDepth * 0.08, `pitted: curvature ${maxCurv} for depth ${maxDepth}`)
  const sp = split.geo.attributes.position.array, sn = split.geo.attributes.normal.array, at = new Map<string, number[]>()
  for (let v = 0; v < sp.length / 3; v++) {
    const k = `${split.orig[v * 3].toFixed(4)},${split.orig[v * 3 + 1].toFixed(4)}`, nv = [sn[v * 3], sn[v * 3 + 1], sn[v * 3 + 2]], seen = at.get(k)
    if (seen) for (let c = 0; c < 3; c++) assert.ok(Math.abs(seen[c] - nv[c]) < 1e-5, 'split vertices share a normal')
    else at.set(k, nv)
    const i = Math.round((split.orig[v * 3] + 1) * 20), j = Math.round((split.orig[v * 3 + 1] + 1) * 20)
    assert.ok(Math.abs(sp[v * 3 + 2] - z(i, j)) < 1e-5, 'same dent at the same point')
  }
})
