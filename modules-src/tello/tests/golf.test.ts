import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { DRIVEWAY_CLASS, isGzip, parseGrids, type MapDoc } from '../data/MapData'
import { TelloLand } from '../region'
import { pointInRing } from '../world/Poly'
import { junctionFills } from '../world/JunctionShapes'
import { clipBand } from '../world/GolfCourse'
import { Forest, TREE_STAND } from '../world/Forest'
import { inThinnedWoods, ringDist, TEE_CLEAR, THIN_EDGE, THIN_GAP } from '../data/GolfFixes'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const grids = parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed)
const land = new TelloLand(doc, grids)
const MILE = 1609.344

function centre(ring: number[]): [number, number] {
  let x = 0, z = 0
  for (let k = 0; k < ring.length; k += 2) {
    x += ring[k]
    z += ring[k + 1]
  }
  return [x / (ring.length / 2), z / (ring.length / 2)]
}

test('the playable area reaches a mile round White Lake', () => {
  const lake = doc.pois.find((p) => p.n === 'White Lake' && p.k === 'water')
  assert.ok(lake, 'White Lake is on the map')
  const edge = doc.frame.x0 + doc.frame.size - doc.limits.seen
  let checked = 0
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    for (const r of [0.25, 0.6, 0.92]) {
      const x = lake.x + Math.sin(a) * MILE * r
      const z = lake.z + Math.cos(a) * MILE * r
      if (x > edge - 60) continue
      assert.ok(land.playable(x, z), `(${x.toFixed(0)}, ${z.toFixed(0)}) is playable`)
      checked++
    }
  }
  assert.ok(checked > 60)
})

test('White Lake Golf Club is laid out hole by hole', () => {
  const course = doc.golf?.find((c) => c.n === 'White Lake Golf Club')
  assert.ok(course, 'the course is in the map')
  assert.equal(course.holes.length, 18)
  assert.deepEqual(course.holes.map((h) => h.n), Array.from({ length: 18 }, (_v, i) => i + 1))
  let fairways = 0
  for (const hole of course.holes) {
    assert.ok([3, 4, 5].includes(hole.par), `hole ${hole.n} par ${hole.par}`)
    assert.ok(hole.len > 60 && hole.len < 600, `hole ${hole.n} is ${hole.len} m`)
    assert.ok(pointInRing(hole.green, hole.pin[0], hole.pin[1]), `hole ${hole.n}'s pin is on its green`)
    const [tx, tz] = centre(hole.box)
    assert.ok(Math.hypot(tx - hole.tee[0], tz - hole.tee[1]) < 15, `hole ${hole.n}'s tee box is at its tee`)
    assert.ok(land.playable(hole.pin[0], hole.pin[1]) && land.playable(hole.tee[0], hole.tee[1]), `hole ${hole.n} is playable`)
    assert.equal(land.depthAt(hole.pin[0], hole.pin[1]), 0, `hole ${hole.n}'s green is dry`)
    if (hole.par > 3) assert.ok(hole.fw.length > 0, `hole ${hole.n} has a fairway`)
    fairways += hole.fw.length
  }
  assert.ok(fairways >= 10)
  assert.ok(doc.pois.some((p) => p.n === course.n), 'the course is a place on the map')
})

test('a fairway stripe is the part of the outline between two lines', () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10]
  const band = clipBand(square, [1, 0], 2, 5)
  const xs = band.filter((_v, k) => k % 2 === 0)
  assert.equal(Math.min(...xs), 2)
  assert.equal(Math.max(...xs), 5)
})

test('driveways run from a building to the edge of a road, never over it', () => {
  const drives = doc.roads.filter((r) => r.c === DRIVEWAY_CLASS)
  assert.ok(drives.length > 300, `${drives.length} driveways`)
  assert.ok(drives.some((r) => r.k === 3) && drives.some((r) => r.k === 2), 'both gravel and paved')
  const streets = doc.roads.filter((r) => r.k <= 3 && r.c !== DRIVEWAY_CLASS)
  const inside = (x: number, z: number) => {
    let best = -Infinity
    for (const s of streets) {
      const p = s.p
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
        if (x < Math.min(ax, ax + dx) - 40 || x > Math.max(ax, ax + dx) + 40 || z < Math.min(az, az + dz) - 40 || z > Math.max(az, az + dz) + 40) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
        best = Math.max(best, s.w / 2 - Math.hypot(x - ax - dx * t, z - az - dz * t))
      }
    }
    return best
  }
  let over = 0, checked = 0
  for (const d of drives.slice(0, 400)) {
    const p = d.p
    for (let k = 0; k + 2 < p.length - 2; k += 2) {
      checked++
      if (inside(p[k], p[k + 1]) > 0.5) over++
    }
    const n = p.length / 2
    assert.ok(inside(p[(n - 1) * 2], p[(n - 1) * 2 + 1]) > -0.6, 'a drive ends on a road edge')
  }
  assert.ok(over <= checked * 0.01, `${over} of ${checked} driveway points lie on a road`)
})

test('a driveway meeting a road gets no end cap reaching into it', () => {
  const drive = doc.roads.find((r) => r.c === DRIVEWAY_CLASS)
  assert.ok(drive)
  const n = drive.p.length / 2
  const ex = drive.p[(n - 1) * 2], ez = drive.p[(n - 1) * 2 + 1]
  const capped = junctionFills(doc).some((f) => f.tris.length && Math.hypot(f.tris[0] - ex, f.tris[1] - ez) < 0.01)
  assert.equal(capped, false)
})

function forestRound(points: [number, number][]): Forest {
  const sink = { addStaticBox: () => null, addStaticCylinder: () => null, addHeightfield: () => {}, removeStatic: () => {} }
  const forest = new Forest(land, () => {}, sink)
  const done = new Set<string>()
  for (const [x, z] of points) {
    for (const [dx, dz] of [[-60, -60], [60, -60], [-60, 60], [60, 60], [0, 0]]) {
      const ci = Math.floor(land.toSceneX(x + dx) / TREE_STAND), cj = Math.floor(land.toSceneZ(z + dz) / TREE_STAND)
      if (done.has(`${ci},${cj}`)) continue
      done.add(`${ci},${cj}`)
      forest.infill(ci, cj)
    }
  }
  return forest
}

test('every tee box is clear of trees, hole 2 included', () => {
  const course = doc.golf!.find((c) => c.n === 'White Lake Golf Club')!
  const forest = forestRound(course.holes.map((h) => [h.tee[0], h.tee[1]]))
  for (let i = 0; i < forest.treeCount; i++) {
    const x = forest.treeX(i), z = forest.treeZ(i)
    for (const hole of course.holes) assert.ok(ringDist(hole.box, x, z) > TEE_CLEAR, `a tree stands ${ringDist(hole.box, x, z).toFixed(1)} m from hole ${hole.n}'s tee box`)
  }
})

test("hole 9's woods between the fairway and the green are thinned", () => {
  const hole = doc.golf!.find((c) => c.n === 'White Lake Golf Club')!.holes[8]
  assert.equal(hole.n, 9)
  const forest = forestRound([[hole.pin[0], hole.pin[1]], [hole.line[hole.line.length - 4], hole.line[hole.line.length - 3]]])
  const inside: [number, number][] = []
  for (let i = 0; i < forest.treeCount; i++) {
    const x = forest.treeX(i), z = forest.treeZ(i)
    if (!inThinnedWoods(hole, x, z)) continue
    assert.ok(i < forest.bakedCount, `infill grew at (${x.toFixed(0)}, ${z.toFixed(0)})`)
    assert.ok(ringDist(hole.green, x, z) > THIN_EDGE && hole.fw.every((fw) => ringDist(fw, x, z) > THIN_EDGE), `a tree crowds the fairway or green at (${x.toFixed(0)}, ${z.toFixed(0)})`)
    for (const [ox, oz] of inside) assert.ok(Math.hypot(ox - x, oz - z) >= THIN_GAP, 'thinned trees stand apart')
    inside.push([x, z])
  }
  assert.ok(inside.length > 0, 'some trees still stand round hole 9')
})
