import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc, type MapGrids } from '../data/MapData'
import { TelloLand } from '../region'
import { EditSession, applyWorldEdits, assignIds } from '../edits/Apply'
import { curveOf, offsetCurve, filletLine, splineLine, lineLength } from '../edits/Geom'
import { clipLotRing, traceMask } from '../edits/LotClip'
import { emptyEdits, type EditOp, type WorldEdits } from '../edits/WorldEdits'

const dir = 'public/modules/tello/'
const docText = readFileSync(`${dir}montello.json`, 'utf8')
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const raw = isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed

function freshLand(edits?: WorldEdits): TelloLand {
  const doc = JSON.parse(docText) as MapDoc
  const grids = parseGrids(raw.slice())
  return new TelloLand(doc, grids, undefined, edits)
}

const base = freshLand()
assignIds(base.doc)

function hashGrid(a: ArrayLike<number>): number {
  let h = 0
  for (let i = 0; i < a.length; i += 7) h = (h * 31 + a[i]) | 0
  return h
}

function edits(...ops: EditOp[]): WorldEdits {
  return { ...emptyEdits(), ops }
}

type Draft<T> = T extends EditOp ? Omit<T, 'ts'> & { ts?: number } : never
const op = (o: Draft<EditOp>): EditOp => ({ ts: 1, ...o }) as EditOp

function maxTurn(p: number[]): number {
  let worst = 0
  for (let k = 2; k + 3 < p.length; k += 2) {
    const a = Math.atan2(p[k + 1] - p[k - 1], p[k] - p[k - 2])
    const b = Math.atan2(p[k + 3] - p[k + 1], p[k + 2] - p[k])
    let d = Math.abs(b - a)
    if (d > Math.PI) d = 2 * Math.PI - d
    worst = Math.max(worst, d)
  }
  return worst
}

test('plotted corners become smooth curves: arcs and splines turn a little at a time', () => {
  const pts = [0, 0, 100, 0, 100, 100, 0, 120]
  const arcs = filletLine(pts, 30)
  assert.ok(maxTurn(arcs) < 0.16, `arcs turn ${maxTurn(arcs)}`)
  const spline = splineLine(pts)
  assert.ok(maxTurn(spline) < 0.2, `spline turns ${maxTurn(spline)}`)
  // A spline runs through every plotted point.
  for (let k = 0; k < pts.length; k += 2) assert.ok(spline.some((_v, i) => i % 2 === 0 && Math.hypot(spline[i] - pts[k], spline[i + 1] - pts[k + 1]) < 0.05))
  // Sidewalks stay parallel: every point of the offset is the offset distance from the centre curve.
  const centre = curveOf(pts, 30, 'arcs')
  const left = offsetCurve(pts, 7, 30, 'arcs')
  for (let i = 0; i < left.length; i += 6) {
    let best = Infinity
    for (let k = 0; k + 3 < centre.length; k += 2) {
      const ax = centre[k], az = centre[k + 1], bx = centre[k + 2], bz = centre[k + 3]
      const dx = bx - ax, dz = bz - az
      const t = Math.max(0, Math.min(1, ((left[i] - ax) * dx + (left[i + 1] - az) * dz) / (dx * dx + dz * dz || 1)))
      best = Math.min(best, Math.hypot(left[i] - ax - dx * t, left[i + 1] - az - dz * t))
    }
    assert.ok(Math.abs(best - 7) < 0.35, `offset ${best}`)
  }
  assert.ok(lineLength(arcs) < lineLength(pts))
})

test('a new road with sidewalks joins the map, levels its bed and is paved in the field', () => {
  const pts = [600, -900, 700, -880, 760, -820]
  const land = freshLand(edits(op({ id: 'road1', type: 'road', pts, curve: 40, w: 8, k: 1, n: 'Test Road', walk: { left: true, right: true, w: 1.8, gap: 1 }, grade: { shoulder: 2, falloff: 8, smooth: 40 } })))
  const road = land.doc.roads.find((r) => r.id === 'road1')!
  assert.ok(road && road.n === 'Test Road')
  assert.ok(land.doc.roads.some((r) => r.id === 'road1:L' && r.k === 4))
  assert.ok(land.doc.roads.some((r) => r.id === 'road1:R' && r.k === 4))
  assert.equal(land.edits?.skipped.length, 0)
  const mid = road.p.length / 2 >> 1
  const x = road.p[mid * 2], z = road.p[mid * 2 + 1]
  assert.ok(land.clearAt(x, z) < 0, 'the road is pavement')
  // Flat across: the ground either side of the centre within the pavement is within a few centimetres.
  const dx = road.p[mid * 2 + 2] - road.p[mid * 2 - 2], dz = road.p[mid * 2 + 3] - road.p[mid * 2 - 1]
  const len = Math.hypot(dx, dz)
  const nx = -dz / len, nz = dx / len
  assert.ok(Math.abs(land.groundAt(x + nx * 3, z + nz * 3) - land.groundAt(x - nx * 3, z - nz * 3)) < 0.25)
})

test('raising land carries the buildings, lots and water standing on it', () => {
  const b = base.doc.buildings.find((x) => !x.x && x.k === 'house')!
  const [cx, cz] = [b.r[0][0], b.r[0][1]]
  const land = freshLand(edits(op({ id: 't1', type: 'terrain', mode: 'raise', shape: { k: 'path', pts: [cx, cz], r: 60 }, falloff: 20, amount: 3 })))
  const moved = land.doc.buildings.find((x) => x.id === b.id)!
  assert.ok(Math.abs(moved.f - (b.f + 3)) < 0.05, `floor ${b.f} → ${moved.f}`)
  assert.ok(Math.abs(land.groundAt(cx, cz) - (base.groundAt(cx, cz) + 3)) < 0.05)
  // Untouched far away.
  assert.equal(land.groundAt(cx + 400, cz + 400), base.groundAt(cx + 400, cz + 400))
})

test('flatten, smooth and grade change only what they reach, and the same edits always give the same land', () => {
  const ops: EditOp[] = [
    op({ id: 'f1', type: 'terrain', mode: 'flatten', shape: { k: 'area', ring: [-400, 400, -200, 400, -200, 600, -400, 600] }, falloff: 30, height: 20 }),
    op({ id: 's1', type: 'terrain', mode: 'smooth', shape: { k: 'path', pts: [-300, 700], r: 80 }, falloff: 20, size: 16 }),
    op({ id: 'g1', type: 'terrain', mode: 'grade', shape: { k: 'path', pts: [-600, 100, -500, 100], r: 6 }, heights: [15, 25], falloff: 10 }),
    op({ id: 'n1', type: 'terrain', mode: 'noise', shape: { k: 'path', pts: [-900, 900], r: 50 }, falloff: 10, amount: 2 }),
  ]
  const a = freshLand(edits(...ops))
  const b = freshLand(edits(...ops))
  assert.equal(hashGrid(a.grids.ground), hashGrid(b.grids.ground))
  assert.ok(Math.abs(a.groundAt(-300, 500) - 20) < 0.02)
  assert.ok(Math.abs(a.groundAt(-550, 100) - 20) < 0.3, `grade middle ${a.groundAt(-550, 100)}`)
})

test('water fills low ground up to a level, and a water body can be raised and drained', () => {
  // Lake Montello's own level: find a wet node and raise that body by 30 cm within a limit.
  const g = base.grids
  let at: [number, number] | null = null
  for (let k = 0; k < g.water.length && !at; k += 997) {
    if (g.water[k] && g.water[k] > g.ground[k] && Math.abs(g.water[k] / 100 - 10.71) < 0.05) {
      const i = k % base.side, j = (k - i) / base.side
      at = [base.x0 + i * base.cell, base.z0 + j * base.cell]
    }
  }
  assert.ok(at, 'found Lake Montello')
  const limit = { k: 'area' as const, ring: [at![0] - 300, at![1] - 300, at![0] + 300, at![1] - 300, at![0] + 300, at![1] + 300, at![0] - 300, at![1] + 300] }
  const land = freshLand(edits(op({ id: 'w1', type: 'water', mode: 'level', at: at!, level: 11.01, shape: limit })))
  assert.ok(Math.abs((land.waterAt(at![0], at![1]) ?? 0) - 11.01) < 0.02)
  const dry = freshLand(edits(op({ id: 'w2', type: 'water', mode: 'drain', shape: { k: 'path', pts: at!, r: 20 } })))
  assert.equal(dry.waterAt(at![0], at![1]), null)
  // Dig a pond on dry land and fill it.
  const spot: [number, number] = [-1500, -1500]
  const pond = freshLand(edits(
    op({ id: 'p1', type: 'terrain', mode: 'lower', shape: { k: 'path', pts: spot, r: 30 }, falloff: 10, amount: 4 }),
    op({ id: 'p2', type: 'water', mode: 'fill', at: spot, level: base.groundAt(...spot) - 1, shape: { k: 'path', pts: spot, r: 45 } }),
  ))
  assert.deepEqual(pond.edits?.skipped, [])
  assert.ok(pond.depthAt(...spot) > 2, `pond depth ${pond.depthAt(...spot)}`)
  assert.ok(pond.waterAt(spot[0] + 60, spot[1]) === null)
})

test('a river cuts its channel and carries water falling along its length', () => {
  const land = freshLand(edits(op({ id: 'rv', type: 'river', pts: [-2000, 1000, -1800, 1050, -1600, 1000], curve: 60, w: 12, depth: 2, bank: 6, levels: [18, 16] })))
  assert.equal(land.edits?.skipped.length, 0)
  const start = land.waterAt(-1990, 1002)
  const end = land.waterAt(-1610, 1002)
  assert.ok(start !== null && end !== null)
  assert.ok(start! > end!)
  assert.ok(land.depthAt(-1800, 1047.5) > 1, `river depth ${land.depthAt(-1800, 1047.5)}`)
})

test('roads and buildings can be removed, changed and added', () => {
  const road = base.doc.roads.find((r) => r.k === 1 && r.p.length > 6)!
  const b = base.doc.buildings.find((x) => !x.x && x.k === 'house')!
  const lot = base.doc.lots[0]
  const land = freshLand(edits(
    op({ id: 'rr', type: 'roadRemove', ids: [road.id!] }),
    op({ id: 'bs', type: 'buildingSet', ref: b.id!, h: b.h + 4, roof: 3, rc: '#334455' }),
    op({ id: 'bn', type: 'building', x: -1200, z: -1200, w: 12, d: 9, yaw: 0.3, k: 'house', h: 5, ridge: 2.5, roof: 1, level: true }),
    op({ id: 'lr', type: 'lotRemove', ids: [lot.id!] }),
  ))
  assert.ok(!land.doc.roads.some((r) => r.id === road.id))
  const changed = land.doc.buildings.find((x) => x.id === b.id)!
  assert.equal(changed.h, b.h + 4)
  assert.equal(changed.r[0][5], 3)
  assert.equal(changed.rc, '#334455')
  const added = land.doc.buildings.find((x) => x.id === 'bn')!
  assert.ok(added && added.p.length === 8 && added.f > 0)
  assert.ok(land.clearAt(-1200, -1200) < 0, 'the new building is walls in the pavement field')
  assert.ok(!land.doc.lots.some((l) => l.id === lot.id))
  assert.equal(land.edits?.skipped.length, 0)
})

test('parking lots are trimmed off the roads that run over them', () => {
  const square = [0, 0, 40, 0, 40, 40, 0, 40]
  const pieces = clipLotRing(square, [{ p: [20, -10, 20, 50], half: 4 }], 0.5)
  assert.equal(pieces.length, 2)
  for (const p of pieces) for (let k = 0; k < p.length; k += 2) assert.ok(Math.abs(p[k] - 20) >= 4, `left a corner on the road at ${p[k]}`)
  const mask = new Uint8Array(25)
  mask[6] = mask[7] = mask[11] = mask[12] = 1
  assert.equal(traceMask(mask, 5, 5).length, 1)
  const land = freshLand(edits(op({ id: 'lc', type: 'lotClip', ids: 'all', margin: 0.3 })))
  for (const l of land.doc.lots) for (const r of land.doc.roads) {
    if (r.k > 1) continue
    for (let k = 0; k < l.p.length; k += 2) {
      let best = Infinity
      for (let q = 0; q + 3 < r.p.length; q += 2) {
        const ax = r.p[q], az = r.p[q + 1], dx = r.p[q + 2] - ax, dz = r.p[q + 3] - az
        const t = Math.max(0, Math.min(1, ((l.p[k] - ax) * dx + (l.p[k + 1] - az) * dz) / (dx * dx + dz * dz || 1)))
        best = Math.min(best, Math.hypot(l.p[k] - ax - dx * t, l.p[k + 1] - az - dz * t))
      }
      assert.ok(best > r.w / 2 - 0.6, `a lot corner sits ${best.toFixed(2)} m from a road ${r.w} m wide`)
    }
  }
})

test('trees are planted at the asked density and cleared from an area', () => {
  const area = { k: 'area' as const, ring: [-3000, -2000, -2900, -2000, -2900, -1900, -3000, -1900] }
  const before = base.grids.treeX.length
  const land = freshLand(edits(op({ id: 'tr', type: 'trees', mode: 'add', shape: area, density: 200, mix: [1, 1, 0], height: [12, 18] })))
  const added = land.grids.treeX.length - before
  assert.ok(added > 120 && added <= 220, `planted ${added} on a hectare at 200/ha`)
  const cleared = freshLand(edits(
    op({ id: 'tr', type: 'trees', mode: 'add', shape: area, density: 200 }),
    op({ id: 'tc', type: 'trees', mode: 'remove', shape: area }),
  ))
  assert.ok(cleared.grids.treeX.length <= before)
})

test('rails, lights and walls are left on the map for the builders, and cuts take them down', () => {
  const land = freshLand(edits(
    op({ id: 'ra', type: 'rail', pts: [0, 0, 30, 0, 60, 0], side: 1 }),
    op({ id: 'rc', type: 'railCut', shape: { k: 'path', pts: [30, 0], r: 5 } }),
    op({ id: 'li', type: 'lights', style: 'cobra', pts: [0, 10, 30, 10], yaw: [0, 0], h: 9 }),
    op({ id: 'lc', type: 'lightCut', shape: { k: 'path', pts: [30, 10], r: 2 } }),
    op({ id: 'wa', type: 'wall', pts: [0, 20, 20, 20], h: 1.8, th: 0.3, style: 'brick', posts: 3, cap: true }),
  ))
  const x = land.doc.extras!
  assert.equal(x.rails.length, 2)
  assert.equal(x.railCuts.length, 1)
  assert.equal(x.lights.length, 1)
  assert.equal(x.walls.length, 1)
  assert.ok(land.clearAt(10, 20) < 0.2)
})

test('ops that no longer match the map are skipped, not thrown, and switched-off ops do nothing', () => {
  const land = freshLand(edits(
    op({ id: 'x1', type: 'roadRemove', ids: ['r999999'] }),
    op({ id: 'x2', type: 'terrain', mode: 'raise', shape: { k: 'path', pts: [0, 0], r: 10 }, falloff: 0, amount: 5, on: false }),
  ))
  assert.equal(land.edits?.skipped.length, 1)
  assert.equal(land.groundAt(0, 0), base.groundAt(0, 0))
})

test('an editor session gives the same land adding ops one by one as the game does replaying them', () => {
  const ops: EditOp[] = [
    op({ id: 'a', type: 'terrain', mode: 'raise', shape: { k: 'path', pts: [200, 200, 260, 220], r: 20 }, falloff: 10, amount: 2 }),
    op({ id: 'b', type: 'road', pts: [150, 150, 250, 250], curve: 10, w: 6, k: 2, n: '' }),
  ]
  const doc = JSON.parse(docText) as MapDoc
  const grids: MapGrids = parseGrids(raw.slice())
  const land = new TelloLand(doc, grids)
  const session = new EditSession(land.doc, land.grids)
  for (const o of ops) { session.apply(o); session.finish() }
  const game = freshLand(edits(...ops))
  assert.equal(hashGrid(land.grids.ground), hashGrid(game.grids.ground))
  assert.equal(hashGrid(land.grids.clear), hashGrid(game.grids.clear))
  assert.equal(land.doc.roads.length, game.doc.roads.length)
  void applyWorldEdits
})

test('removing a road takes its bridge with it and the other bridges keep their roads', () => {
  const b = base.doc.bridges.find((x) => base.doc.roads[x.r]?.id)!
  const road = base.doc.roads[b.r]
  const others = base.doc.bridges.filter((x) => x !== b).map((x) => base.doc.roads[x.r]?.id)
  const land = freshLand(edits(op({ id: 'rb', type: 'roadRemove', ids: [road.id!] })))
  assert.equal(land.doc.bridges.length, base.doc.bridges.length - base.doc.bridges.filter((x) => base.doc.roads[x.r]?.id === road.id).length)
  assert.deepEqual(land.doc.bridges.map((x) => land.doc.roads[x.r]?.id), others.filter((id) => id !== road.id))
})
