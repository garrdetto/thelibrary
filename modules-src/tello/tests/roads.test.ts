import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc, type RoadData } from '../data/MapData'
import { BUILDING_MARGIN, FROZEN, guardrailRuns, isFrozen, WallIndex } from '../data/RoadFixes'
import { halfAt, townProfiles } from '../data/Streets'
import { TelloLand } from '../region'
import { junctionFills, junctionNodes } from '../world/JunctionShapes'
import { postsAlong, POST_SPACING } from '../world/Guardrails'
import { resample } from '../world/Poly'
import { groundSink } from '../world/Ground'
import { stationsOf } from '../world/Roads'
import { hasHighwayLines } from '../world/StreetPaint'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const grids = parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed)
const land = new TelloLand(doc, grids)
const walls = new WallIndex(doc.buildings)

const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`
const joints = new Set<string>()
for (const r of doc.roads) {
  if (r.k > 3) continue
  joints.add(key(r.p[0], r.p[1]))
  joints.add(key(r.p[r.p.length - 2], r.p[r.p.length - 1]))
}

function pointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

test('no street or highway runs through a building, and a squeezed street is the only exception', () => {
  const bad: string[] = []
  doc.roads.forEach((road, i) => {
    if (road.k > 1 || road.p.length < 4) return
    const half = road.w / 2
    const pts = resample(road.p, 2)
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], z = pts[k + 1]
      if (isFrozen(x, z)) continue
      const hit = walls.nearest(x, z, half + 0.5)
      if (!hit || (!hit.inside && hit.d >= half - 0.05)) continue
      const away = Math.hypot(x - hit.x, z - hit.z) || 1
      const sx = hit.inside ? hit.x - x : x - hit.x, sz = hit.inside ? hit.z - z : z - hit.z
      const other = walls.nearest(x + (sx / away) * (half + BUILDING_MARGIN), z + (sz / away) * (half + BUILDING_MARGIN), half + BUILDING_MARGIN)
      if (other && (other.inside || other.d < half + BUILDING_MARGIN)) continue
      bad.push(`${i} ${road.n || road.c} at ${x.toFixed(0)},${z.toFixed(0)}`)
      break
    }
  })
  assert.ok(bad.length <= 3, `roads through buildings: ${bad.join('; ')}`)
})

test('the corner by the fire station: the street bends round the house and clears it by a sidewalk', () => {
  const house = doc.buildings.find((b) => b.k === 'house' && b.p.some((v, k) => k % 2 === 0 && Math.abs(v + 68.9) < 0.6) && b.p.some((v, k) => k % 2 === 1 && Math.abs(v + 22.4) < 0.6))
  assert.ok(house, 'the house on the corner is still mapped')
  const index = new WallIndex([house])
  for (const name of ['Underwood Avenue', 'West Montello Street']) {
    const road = doc.roads.find((r) => r.n === name && r.p.some((v, k) => k % 2 === 0 && Math.abs(v + 83.8) < 1 && Math.abs(r.p[k + 1] + 21.4) < 1))
    assert.ok(road, `${name} meets the corner`)
    let gap = Infinity
    const pts = resample(road.p, 1)
    for (let k = 0; k < pts.length; k += 2) {
      const hit = index.nearest(pts[k], pts[k + 1], 30)
      if (hit) gap = Math.min(gap, hit.inside ? -hit.d : hit.d)
    }
    const need = name === 'West Montello Street' ? 1.4 : 1
    assert.ok(gap >= road.w / 2 + need, `${name} clears the house by ${gap.toFixed(2)} m with half width ${road.w / 2}`)
  }
})

test('no two roads lie on top of each other: no stretch of 12 m of one road within a metre of another', () => {
  const cells = new Map<string, { road: number; a: number[] }[]>()
  const G = 16
  doc.roads.forEach((r, ri) => {
    if (r.k > 3) return
    for (let k = 0; k + 3 < r.p.length; k += 2) {
      for (let gx = Math.floor(Math.min(r.p[k], r.p[k + 2]) / G); gx <= Math.floor(Math.max(r.p[k], r.p[k + 2]) / G); gx++) {
        for (let gz = Math.floor(Math.min(r.p[k + 1], r.p[k + 3]) / G); gz <= Math.floor(Math.max(r.p[k + 1], r.p[k + 3]) / G); gz++) {
          const id = `${gx},${gz}`
          let list = cells.get(id)
          if (!list) cells.set(id, (list = []))
          list.push({ road: ri, a: [r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]] })
        }
      }
    }
  })
  const worst: string[] = []
  doc.roads.forEach((r, ri) => {
    if (r.k > 3) return
    const pts = resample(r.p, 2)
    const runs = new Map<number, number>()
    const best = new Map<number, number>()
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], z = pts[k + 1]
      const hit = new Set<number>()
      for (const e of cells.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) {
        if (e.road === ri || hit.has(e.road)) continue
        if (pointToSegment(x, z, e.a[0], e.a[1], e.a[2], e.a[3]) < 1) hit.add(e.road)
      }
      for (const other of new Set([...runs.keys(), ...hit])) {
        if (hit.has(other)) {
          const run = (runs.get(other) ?? 0) + 2
          runs.set(other, run)
          best.set(other, Math.max(best.get(other) ?? 0, run))
        } else runs.set(other, 0)
      }
    }
    for (const [other, run] of best) if (run >= 12) worst.push(`${ri}+${other} ${run} m at ${pts[0].toFixed(0)},${pts[1].toFixed(0)}`)
  })
  assert.deepEqual(worst, [], `overlapping roads: ${worst.join('; ')}`)
})

test('road lines are smooth: no street or highway turns sharply except at a junction or downtown', () => {
  const sharp: string[] = []
  doc.roads.forEach((road, i) => {
    if (road.k > 1) return
    const p = road.p
    for (let k = 2; k + 3 < p.length; k += 2) {
      if (isFrozen(p[k], p[k + 1]) || joints.has(key(p[k], p[k + 1]))) continue
      const ax = p[k] - p[k - 2], az = p[k + 1] - p[k - 1], bx = p[k + 2] - p[k], bz = p[k + 3] - p[k + 1]
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz)
      if (la < 1 || lb < 1) continue
      const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb))))
      if (turn > 0.7) sharp.push(`${i} ${road.n || road.c} ${((turn * 180) / Math.PI).toFixed(0)} deg at ${p[k].toFixed(0)},${p[k + 1].toFixed(0)}`)
    }
  })
  assert.ok(sharp.length <= 12, `sharp corners left: ${sharp.length}: ${sharp.slice(0, 6).join('; ')}`)
})

test('ribbons keep their width round bends: station normals are unit length and the miter is capped', () => {
  for (const road of doc.roads.slice(0, 200)) {
    for (const s of stationsOf(road, townProfiles(doc).get(road))) {
      assert.ok(Math.abs(Math.hypot(s.sx, s.sz) - 1) < 1e-6)
      assert.ok(s.miter >= 1 - 1e-9 && s.miter <= 1.6 + 1e-9)
    }
  }
})

test('every notch between two arms of a junction is filled and every road end is capped', () => {
  const nodes = junctionNodes(doc)
  const fills = junctionFills(doc)
  assert.ok(nodes.length > 200 && fills.length > 100, `${nodes.length} junctions, ${fills.length} fills`)
  for (const f of fills) {
    assert.equal(f.tris.length % 6, 0)
    for (let k = 0; k < f.tris.length; k += 6) {
      const area = ((f.tris[k + 2] - f.tris[k]) * (f.tris[k + 5] - f.tris[k + 1]) - (f.tris[k + 4] - f.tris[k]) * (f.tris[k + 3] - f.tris[k + 1])) / 2
      assert.ok(Number.isFinite(area) && Math.abs(area) > 1e-6, 'no degenerate triangle')
    }
  }
  const inTri = (x: number, z: number, t: number[], k: number) => {
    const s = (ax: number, az: number, bx: number, bz: number) => (bx - ax) * (z - az) - (bz - az) * (x - ax)
    const d1 = s(t[k], t[k + 1], t[k + 2], t[k + 3]), d2 = s(t[k + 2], t[k + 3], t[k + 4], t[k + 5]), d3 = s(t[k + 4], t[k + 5], t[k], t[k + 1])
    return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6))
  }
  let checked = 0
  let open = 0
  for (const node of nodes) {
    if (node.arms.length < 3) continue
    const arms = node.arms.map((a) => ({ ...a, angle: Math.atan2(a.dz, a.dx) })).sort((a, b) => a.angle - b.angle)
    const near = fills.filter((f) => Math.hypot(f.tris[0] - node.x, f.tris[1] - node.z) < 1e-6)
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length]
      let gap = b.angle - a.angle
      if (gap <= 0) gap += Math.PI * 2
      if (gap < (Math.PI * 100) / 180 || gap > (Math.PI * 170) / 180) continue
      const mid = a.angle + gap / 2
      const r = Math.min(a.half, b.half) * 0.8
      const px = node.x + Math.cos(mid) * r, pz = node.z + Math.sin(mid) * r
      const armCovers = node.arms.some((arm) => pointToSegment(px, pz, node.x, node.z, node.x + arm.dx * 30, node.z + arm.dz * 30) <= arm.half)
      const filled = near.some((f) => { for (let k = 0; k < f.tris.length; k += 6) if (inTri(px, pz, f.tris, k)) return true; return false })
      checked++
      if (!armCovers && !filled) open++
    }
  }
  assert.ok(checked > 50)
  assert.equal(open, 0, `${open} of ${checked} junction notches are open`)
})

test('the ground never stands through a road ribbon: ribbon samples sit over the drawn ground', () => {
  const side = land.side, cell = land.cell
  const node = (i: number, j: number) => {
    const x = land.x0 + i * cell, z = land.z0 + j * cell
    return land.groundAt(x, z) - groundSink(land.clearAt(x, z))
  }
  const groundMesh = (x: number, z: number) => {
    const gx = (x - land.x0) / cell, gz = (z - land.z0) / cell
    const i = Math.min(side - 2, Math.floor(gx)), j = Math.min(side - 2, Math.floor(gz))
    const fx = gx - i, fz = gz - j
    const a = node(i, j), b = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1)
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)
  }
  const profiles = townProfiles(doc)
  let samples = 0
  let poke = 0
  let worst = 0
  let where = ''
  doc.roads.forEach((road, ri) => {
    if (road.k > 2 || !land.playable((road.p[0] + road.p[road.p.length - 2]) / 2, (road.p[1] + road.p[road.p.length - 1]) / 2, -2000)) return
    if (ri % 3) return
    const stations = stationsOf(road, profiles.get(road), profiles.has(road))
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = stations[i], b = stations[i + 1]
      if (!land.playable(a.x, a.z, 20)) continue
      for (const t of [0.5]) {
        for (const across of [-1, -0.5, 0, 0.5, 1]) {
          const h0 = halfAt(profiles, road, a.x, a.z)
          const ax = a.x + a.sx * across * h0 * a.miter, az = a.z + a.sz * across * h0 * a.miter
          const bx = b.x + b.sx * across * h0 * b.miter, bz = b.z + b.sz * across * h0 * b.miter
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t
          if (land.deckAt(x, z) !== null || land.depthAt(x, z) > 0.2) continue
          const ribbon = (land.heightAt(ax, az) + land.heightAt(bx, bz)) / 2 + 0.04
          samples++
          const over = groundMesh(x, z) - ribbon
          if (over > 0) {
            poke++
            if (over > worst) {
              worst = over
              where = `${road.n || road.c} at ${x.toFixed(0)},${z.toFixed(0)}`
            }
          }
        }
      }
    }
  })
  assert.ok(samples > 1000, `${samples} samples`)
  assert.ok(poke / samples < 0.0001, `${poke} of ${samples} ribbon samples sit under the ground (worst ${worst.toFixed(3)} m, ${where})`)
})

test('guardrails stand on the west side of Main Street where the river touches the road, as solid W-beam', () => {
  const runs = guardrailRuns(doc, land)
  assert.ok(runs.length >= 1)
  const main = runs.filter((r) => doc.roads[r.road].n === 'Main Street')
  assert.ok(main.length >= 1, 'Main Street has a rail')
  const west = main.find((r) => r.pts[0] < doc.roads[r.road].p[0] && r.pts.length / 2 * 3 >= 60)
  assert.ok(west, 'a run of at least 60 m on the west side')
  const zs = west.pts.filter((_v, k) => k % 2 === 1)
  assert.ok(Math.min(...zs) < -230 && Math.max(...zs) > -190, `covers ${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)}`)
  for (const run of runs) {
    const posts = postsAlong(run.pts, POST_SPACING)
    for (let k = 2; k + 3 < posts.length; k += 2) {
      const d = Math.hypot(posts[k + 2] - posts[k], posts[k + 3] - posts[k + 1])
      assert.ok(d <= POST_SPACING + 0.01 && d > 0.2)
    }
  }
})

test('residential streets carry no painted lines; highways and county roads do', () => {
  const residential = doc.roads.filter((r) => r.k === 1)
  assert.ok(residential.length > 100)
  assert.ok(residential.every((r) => !hasHighwayLines(r)))
  assert.ok(doc.roads.filter((r: RoadData) => hasHighwayLines(r)).length > 30)
})

test('the frozen downtown block still holds Main Street and the light', () => {
  assert.ok(FROZEN.x0 < 0 && FROZEN.x1 > 150 && FROZEN.z0 < -100 && FROZEN.z1 > 30)
})
