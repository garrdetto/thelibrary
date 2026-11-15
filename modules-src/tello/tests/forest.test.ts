import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { COVER, isGzip, parseGrids, treeUnits, type MapDoc } from '../data/MapData'
import { TelloLand } from '../region'
import { Forest, INFILL_GAP, INFILL_ROAD, TREE_STAND, type TreeSpot } from '../world/Forest'
import { resample } from '../world/Poly'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const grids = parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed)
const land = new TelloLand(doc, grids)
const units = treeUnits(doc.frame)

function forestWith(planted: TreeSpot[][]): Forest {
  const sink = { addStaticBox: () => null, addStaticCylinder: () => null, addHeightfield: () => {}, removeStatic: () => {} }
  return new Forest(land, (spots) => planted.push([...spots]), sink)
}

test('baked trees keep off pavement: no trunk stands on a road, a lot or a wall, and the 1.3 m margin holds', () => {
  let onPavement = 0
  let tooClose = 0
  for (let i = 0; i < grids.treeX.length; i++) {
    const x = land.x0 + grids.treeX[i] / units
    const z = land.z0 + grids.treeZ[i] / units
    const clear = land.clearAt(x, z)
    if (clear < 0) onPavement++
    else if (clear < 1) tooClose++
  }
  assert.ok(onPavement <= grids.treeX.length * 0.0005, `${onPavement} trunks stand on pavement`)
  assert.ok(tooClose <= grids.treeX.length * 0.003, `${tooClose} trunks within a metre of pavement`)
})

test('no trunk stands on a road line: every street, lane and path is free of trees across its width', () => {
  const cell = 16
  const cells = new Map<number, number[]>()
  const key = (x: number, z: number) => (Math.floor(x / cell) + 4096) * 8192 + Math.floor(z / cell) + 4096
  for (let i = 0; i < grids.treeX.length; i++) {
    const k = key(land.x0 + grids.treeX[i] / units, land.z0 + grids.treeZ[i] / units)
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  let checked = 0
  let hits = 0
  let first = ''
  for (const road of doc.roads) {
    if (road.k === 4) continue
    const pts = resample(road.p, 5)
    const half = Math.max(1, road.w / 2 - 0.4)
    for (let k = 0; k + 1 < pts.length; k += 2) {
      const x = pts[k]
      const z = pts[k + 1]
      if (!land.inside(x, z, 10) || !land.seen(x, z, 0)) continue
      checked++
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const t of cells.get(key(x + a * cell, z + b * cell)) ?? []) {
            const d = Math.hypot(land.x0 + grids.treeX[t] / units - x, land.z0 + grids.treeZ[t] / units - z)
            if (d < half) {
              hits++
              if (!first) first = `${road.n || 'a road'} at ${x.toFixed(0)}, ${z.toFixed(0)}`
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 20000, `${checked} road points checked`)
  assert.ok(hits <= checked * 0.0005, `${hits} trunks on the roadway, first on ${first}`)
})

test('infill grows the thinned woods back: only in woods cover and canopy, off pavement and water, with room between trunks, and the same every time', () => {
  const planted: TreeSpot[][] = []
  const forest = forestWith(planted)
  const baked = forest.bakedCount
  assert.equal(forest.treeCount, baked)
  const seenStands = new Set<number>()
  for (let i = 0; i < grids.treeX.length; i += 97) {
    const sx = land.toSceneX(land.x0 + grids.treeX[i] / units)
    const sz = land.toSceneZ(land.z0 + grids.treeZ[i] / units)
    const ci = Math.floor(sx / TREE_STAND)
    const cj = Math.floor(sz / TREE_STAND)
    seenStands.add(ci * 100000 + cj)
  }
  assert.ok(seenStands.size > 100, `${seenStands.size} stands hold trees`)
  let made: number[] = []
  const stands = [...seenStands].map((s) => ({ ci: Math.round(s / 100000), cj: s - Math.round(s / 100000) * 100000 }))
  for (const s of stands.slice(0, 40)) made = made.concat(forest.infill(s.ci, s.cj))
  assert.ok(made.length > 500, `${made.length} trees grown in 40 stands`)
  for (const i of made) {
    const x = forest.treeX(i)
    const z = forest.treeZ(i)
    assert.equal(land.coverAt(x, z), COVER.woods, 'infill grows only in woods')
    assert.ok(land.canopyAt(x, z) >= 0.5, 'and where the canopy is closed')
    assert.equal(land.depthAt(x, z), 0, 'never in water')
    assert.ok(land.clearAt(x, z) >= INFILL_ROAD, `${land.clearAt(x, z)} m from pavement`)
    const r = forest.trunk(i).r
    assert.ok(r > 0.1 && r < 2.2, `trunk radius ${r}`)
  }
  for (const i of made.slice(0, 300)) {
    const x = forest.treeX(i)
    const z = forest.treeZ(i)
    for (const t of forest.treesAround(x, z)) {
      if (t === i) continue
      assert.ok(Math.hypot(forest.treeX(t) - x, forest.treeZ(t) - z) >= INFILL_GAP - 1e-6, 'trunks keep their gap')
    }
  }
  const again = forestWith([])
  let second = 0
  for (const s of stands.slice(0, 40)) second += again.infill(s.ci, s.cj).length
  assert.equal(second, made.length, 'the same stands on a fresh forest grow the same trees')
})

test('open ground stays open: infill never grows on lawns, fields, lots or bare ground', () => {
  const forest = forestWith([])
  let checked = 0
  for (let i = 0; i < grids.treeX.length; i += 4001) {
    const sx = land.toSceneX(land.x0 + grids.treeX[i] / units)
    const sz = land.toSceneZ(land.z0 + grids.treeZ[i] / units)
    for (const i2 of forest.infill(Math.floor(sx / TREE_STAND), Math.floor(sz / TREE_STAND))) {
      const cover = land.coverAt(forest.treeX(i2), forest.treeZ(i2))
      assert.ok(cover !== COVER.lawn && cover !== COVER.field && cover !== COVER.lot && cover !== COVER.bare && cover !== COVER.water && cover !== COVER.meadow, `cover ${cover}`)
      checked++
    }
  }
  assert.ok(checked > 0)
})

test('stands are planted where someone is: the first ring is a few stands, the rest wait, and each stand is planted once with its trees and infill', async () => {
  const planted: TreeSpot[][] = []
  const forest = forestWith(planted)
  const home = { x: 0, z: 0 }
  const count = await forest.plantAround(home.x, home.z, 720)
  assert.ok(planted.length > 0 && planted.length <= 49, `${planted.length} stands in the first ring`)
  assert.ok(count > 1000, `${count} trees in it`)
  assert.ok(forest.plantedStands < forest.standCount / 4, 'most of the map is still unplanted')
  const again = await forest.plantAround(home.x, home.z, 720)
  assert.equal(again, 0, 'a stand is planted once')
  for (const stand of planted) {
    assert.ok(stand.length <= 6000, `${stand.length} trees in one stand`)
    for (const t of stand) assert.ok(Number.isFinite(t.y) && t.scale >= 0.3 && t.scale <= 2.6)
  }
  forest.update(1, land.toSceneX(1500), land.toSceneZ(900))
  assert.ok(forest.plantedStands > planted.length - 1, 'a mover plants the stands ahead of it')
})

test('trunks are solid for cars once something drives near them, and a walker is pushed out of one', () => {
  const added: number[] = []
  const sink = { addStaticBox: () => null, addStaticCylinder: () => { added.push(1); return null }, addHeightfield: () => {}, removeStatic: () => {} }
  const forest = new Forest(land, () => {}, sink)
  let i = 0
  while (i < grids.treeX.length && forest.trunk(i).r < 0.3) i++
  const t = forest.trunk(i)
  forest.solidTrees([{ x: t.x, z: t.z }])
  assert.ok(added.length > 0 && forest.solidCells > 0, `${added.length} trunks solid near a car`)
  const pushed = forest.push(t.x + 0.01, t.z, 0.3)
  assert.ok(pushed && Math.hypot(pushed.x - t.x, pushed.z - t.z) >= t.r + 0.3 - 1e-6, 'a walker is pushed clear of the trunk')
  assert.equal(forest.push(t.x + 400, t.z + 400, 0.3), null)
})
