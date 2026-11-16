/**
 * Replays the World Editor's edits on Montello's map (renderer-free, deterministic): the grids (ground, water, cover,
 * canopy, the pavement field, the trees) and the document (roads, buildings, lots, bridges, and `extras` for rails,
 * lights and walls). `TelloLand` runs it after Tello's own street fixes and before anything is built, so every builder,
 * the physics, the maps and the routes see the edited world; the editor runs it on its own copy to show the result.
 */
import { COVER, treeUnits, type BuildingData, type LotData, type MapDoc, type MapGrids, type RoadData } from '../data/MapData'
import { isTownStreet, STREET_HALF } from '../data/Streets'
import {
  boxOf, centroidOf, curveOf, densify, distToLine, hashString, inRing, lineLength, noise2, offsetCurve, rng, shapeBox, shapeField, simplify, unionBox, weightAt,
  type Box, type Field, type GridSpec,
} from './Geom'
import { clipLotRing } from './LotClip'
import {
  emptyExtras, isOn,
  type BuildingOp, type BuildingSetOp, type EditOp, type Flat, type LotClipOp, type LotOp, type LotSetOp, type RiverOp, type RoadOp, type RoadSetOp, type Shape,
  type TerrainOp, type TreesOp, type WaterOp, type WorldEdits, type WorldExtras,
} from './WorldEdits'

export interface EditReport {
  applied: number
  skipped: { id: string; why: string }[]
}

/** The most nodes one water fill may flood (about 48 km² of the 4 m grid). */
export const FILL_CAP = 3_000_000
/** How far round a changed feature the pavement field is worked out again (it holds distances up to about 32 m). */
const PAVE_REACH = 32
const CM = 100

interface TreeAdd { x: number; z: number; kind: number; h: number; gone: boolean }

/**
 * One pass of edits over a map. `apply` one op at a time (the editor adds new ones this way), then `finish` to write the
 * trees back into the grids. `dirty` collects the map area every op since the last reset changed.
 */
export class EditSession {
  readonly g4: GridSpec
  readonly g2: GridSpec
  readonly extras: WorldExtras
  readonly report: EditReport = { applied: 0, skipped: [] }
  dirty: Box | null = null
  private readonly bakedX: Uint16Array
  private readonly bakedZ: Uint16Array
  private readonly bakedS: Uint8Array
  private readonly bakedH: Uint8Array
  private readonly treeGone: Uint8Array
  private readonly treeAdds: TreeAdd[] = []
  private readonly units: number
  private treesTouched = false
  /** The road each bridge carries, by id, so bridges follow their roads when roads are removed. */
  private bridgeRoads: (string | undefined)[]

  constructor(readonly doc: MapDoc, readonly grids: MapGrids) {
    const f = doc.frame
    this.g4 = { x0: f.x0, z0: f.z0, cell: f.cell, side: grids.side }
    this.g2 = { x0: f.x0, z0: f.z0, cell: f.fine, side: grids.fineSide }
    assignIds(doc)
    this.bridgeRoads = doc.bridges.map((b) => doc.roads[b.r]?.id)
    this.extras = doc.extras ?? emptyExtras()
    doc.extras = this.extras
    this.bakedX = grids.treeX
    this.bakedZ = grids.treeZ
    this.bakedS = grids.treeS
    this.bakedH = grids.treeH
    this.treeGone = new Uint8Array(grids.treeX.length)
    this.units = treeUnits(f)
  }

  /** Applies one op (switched-off ops are passed over). Problems are noted in `report.skipped`, never thrown. */
  apply(op: EditOp): void {
    if (!isOn(op)) return
    try {
      const why = this.run(op)
      if (why) this.report.skipped.push({ id: op.id, why })
      else this.report.applied++
    } catch (error) {
      this.report.skipped.push({ id: op.id, why: error instanceof Error ? error.message : 'Could not apply' })
    }
  }

  /** Writes the trees (baked, less the cleared, plus the planted) back into the grids. */
  finish(): void {
    if (!this.treesTouched) return
    let keep = 0
    for (let i = 0; i < this.treeGone.length; i++) if (!this.treeGone[i]) keep++
    for (const t of this.treeAdds) if (!t.gone) keep++
    const X = new Uint16Array(keep), Z = new Uint16Array(keep), S = new Uint8Array(keep), H = new Uint8Array(keep)
    let o = 0
    for (let i = 0; i < this.treeGone.length; i++) {
      if (this.treeGone[i]) continue
      X[o] = this.bakedX[i]; Z[o] = this.bakedZ[i]; S[o] = this.bakedS[i]; H[o] = this.bakedH[i]
      o++
    }
    const f = this.doc.frame
    for (const t of this.treeAdds) {
      if (t.gone) continue
      X[o] = Math.max(0, Math.min(65535, Math.round((t.x - f.x0) * this.units)))
      Z[o] = Math.max(0, Math.min(65535, Math.round((t.z - f.z0) * this.units)))
      S[o] = (t.kind << 6) | (hashString(`${t.x},${t.z}`) & 63)
      H[o] = Math.max(4, Math.min(255, Math.round(t.h * 4)))
      o++
    }
    this.grids.treeX = X
    this.grids.treeZ = Z
    this.grids.treeS = S
    this.grids.treeH = H
  }

  private touch(box: Box | null): void {
    this.dirty = unionBox(this.dirty, box)
  }

  private run(op: EditOp): string | null {
    switch (op.type) {
      case 'terrain': return this.terrain(op)
      case 'water': return this.water(op)
      case 'river': return this.river(op)
      case 'road': return this.road(op)
      case 'roadRemove': return this.removeRoads(op.ids)
      case 'roadSet': return this.setRoad(op)
      case 'building': return this.addBuilding(op)
      case 'buildingRemove': return this.removeBuildings(op.ids)
      case 'buildingSet': return this.setBuilding(op)
      case 'lot': return this.addLot(op)
      case 'lotRemove': return this.removeLots(op.ids)
      case 'lotSet': return this.setLot(op)
      case 'lotClip': return this.clipLots(op)
      case 'trees': return this.trees(op)
      case 'rail': {
        if (op.pts.length < 4) return 'A guardrail needs two points'
        this.extras.rails.push({ side: op.side, pts: densify(op.pts, 3) })
        this.touch(boxOf(op.pts, 2))
        return null
      }
      case 'railCut': {
        this.extras.railCuts.push(op.shape)
        this.extras.rails = cutRails(this.extras.rails, op.shape)
        this.touch(shapeBox(op.shape))
        return null
      }
      case 'lights': {
        const n = op.pts.length / 2
        if (!n) return 'No lights placed'
        for (let i = 0; i < n; i++) this.extras.lights.push({ style: op.style, x: op.pts[i * 2], z: op.pts[i * 2 + 1], yaw: op.yaw[i] ?? 0, h: op.h })
        this.touch(boxOf(op.pts, 4))
        return null
      }
      case 'lightCut': {
        this.extras.lightCuts.push(op.shape)
        this.extras.lights = this.extras.lights.filter((l) => !inShape(op.shape, l.x, l.z))
        this.touch(shapeBox(op.shape))
        return null
      }
      case 'wall': {
        if (op.pts.length < 4) return 'A wall needs two points'
        this.extras.walls.push({ pts: [...op.pts], h: op.h, th: op.th, style: op.style, posts: op.posts, cap: op.cap, closed: !!op.closed })
        const line = op.closed ? [...op.pts, op.pts[0], op.pts[1]] : op.pts
        this.markLine(line, op.th / 2)
        this.touch(boxOf(op.pts, 2))
        return null
      }
    }
  }

  // ------------------------------------------------------------ sampling

  /** Height in metres from a grid of centimetres, on the ground mesh's own triangles. */
  heightOf(grid: ArrayLike<number>, x: number, z: number): number {
    const g = this.g4, n = g.side
    const gx = Math.min(n - 1.0001, Math.max(0, (x - g.x0) / g.cell))
    const gz = Math.min(n - 1.0001, Math.max(0, (z - g.z0) / g.cell))
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i], d = grid[(j + 1) * n + i + 1]
    if (fx + fz <= 1) return (a + (b - a) * fx + (c - a) * fz) / CM
    return (d + (c - d) * (1 - fx) + (b - d) * (1 - fz)) / CM
  }

  groundAt(x: number, z: number): number {
    return this.heightOf(this.grids.ground, x, z)
  }

  private nodeAt(x: number, z: number): number {
    const g = this.g4
    const i = Math.min(g.side - 1, Math.max(0, Math.round((x - g.x0) / g.cell)))
    const j = Math.min(g.side - 1, Math.max(0, Math.round((z - g.z0) / g.cell)))
    return j * g.side + i
  }

  private wet(k: number): boolean {
    const w = this.grids.water[k]
    return w !== 0 && w > this.grids.ground[k]
  }

  private fieldBox(g: GridSpec, f: Field): Box {
    return { x0: g.x0 + f.i0 * g.cell, z0: g.z0 + f.j0 * g.cell, x1: g.x0 + (f.i0 + f.w - 1) * g.cell, z1: g.z0 + (f.j0 + f.h - 1) * g.cell }
  }

  // ------------------------------------------------------------ terrain

  private terrain(op: TerrainOp): string | null {
    if (op.mode === 'grade' && (op.shape.k !== 'path' || !op.heights || op.heights.length !== op.shape.pts.length / 2)) return 'A grade needs a height at every point of its path'
    if (op.mode === 'flatten' && op.height === undefined) return 'Flatten needs a height'
    const field = shapeField(this.g4, op.shape, Math.max(0, op.falloff), op.mode === 'grade')
    if (!field) return 'Outside the map'
    const heights = op.mode === 'grade' && op.shape.k === 'path' ? alongHeights(op.shape.pts, op.heights!) : null
    this.shapeGround(field, op, heights)
    return null
  }

  /** The one place the ground changes: every node the field reaches, with the carry of what stands on it. */
  private shapeGround(field: Field, op: Pick<TerrainOp, 'mode' | 'falloff' | 'amount' | 'height' | 'strength' | 'size' | 'carry' | 'id'>, heights: ((s: number) => number) | null): void {
    const g = this.g4, n = g.side
    const ground = this.grids.ground, water = this.grids.water
    const strength = Math.max(0, Math.min(1, op.strength ?? 1))
    const carry = op.carry !== false
    const box = this.fieldBox(g, field)
    const standing = carry ? this.standingIn(box) : null
    let blur: Float32Array | null = null
    let bx0 = 0, bz0 = 0, bw = 0
    if (op.mode === 'smooth') {
      const radius = Math.max(1, Math.round((op.size ?? 12) / g.cell))
      bx0 = Math.max(0, field.i0 - radius * 2); bz0 = Math.max(0, field.j0 - radius * 2)
      const bx1 = Math.min(n - 1, field.i0 + field.w - 1 + radius * 2), bz1 = Math.min(n - 1, field.j0 + field.h - 1 + radius * 2)
      bw = bx1 - bx0 + 1
      const bh = bz1 - bz0 + 1
      blur = new Float32Array(bw * bh)
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) blur[j * bw + i] = ground[(bz0 + j) * n + bx0 + i]
      boxBlur(blur, bw, bh, radius)
      boxBlur(blur, bw, bh, radius)
    }
    const seed = hashString(op.id)
    const amount = (op.amount ?? 0) * CM
    for (let jj = 0; jj < field.h; jj++) {
      const j = field.j0 + jj
      for (let ii = 0; ii < field.w; ii++) {
        const o = jj * field.w + ii
        const w = weightAt(field.d[o], op.falloff)
        if (w <= 0) continue
        const i = field.i0 + ii
        const k = j * n + i
        const old = ground[k]
        let v = old
        switch (op.mode) {
          case 'raise': v = old + amount * w; break
          case 'lower': v = old - amount * w; break
          case 'flatten': v = old + ((op.height ?? 0) * CM - old) * w * strength; break
          case 'smooth': v = old + (blur![(j - bz0) * bw + (i - bx0)] - old) * w * strength; break
          case 'grade': v = old + (heights!(field.at![o]) * CM - old) * w * strength; break
          case 'noise': v = old + noise2(seed, g.x0 + i * g.cell, g.z0 + j * g.cell, op.size ?? 40) * amount * w * strength; break
        }
        const next = Math.max(1, Math.min(65535, Math.round(v)))
        if (next === old) continue
        ground[k] = next
        if (carry && water[k] !== 0) water[k] = Math.max(1, Math.min(65535, water[k] + next - old))
      }
    }
    if (standing) this.carryStanding(standing)
    this.touch(box)
  }

  /** What stands in a box and the ground under it now, so it can move with the ground. */
  private standingIn(box: Box): { b: BuildingData[]; bg: number[]; l: LotData[]; lg: number[]; br: number[]; brg: number[] } {
    const inBox = (x: number, z: number) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1
    const out = { b: [] as BuildingData[], bg: [] as number[], l: [] as LotData[], lg: [] as number[], br: [] as number[], brg: [] as number[] }
    for (const b of this.doc.buildings) {
      if (b.x) continue
      const [x, z] = centroidOf(b.p)
      if (inBox(x, z)) { out.b.push(b); out.bg.push(this.groundAt(x, z)) }
    }
    for (const l of this.doc.lots) {
      const [x, z] = centroidOf(l.p)
      if (inBox(x, z)) { out.l.push(l); out.lg.push(this.groundAt(x, z)) }
    }
    this.doc.bridges.forEach((b, i) => {
      const [x, z] = centroidOf(b.p)
      if (inBox(x, z)) { out.br.push(i); out.brg.push(this.groundAt(x, z)) }
    })
    return out
  }

  private carryStanding(s: ReturnType<EditSession['standingIn']>): void {
    const r2 = (v: number) => Math.round(v * 100) / 100
    s.b.forEach((b, i) => {
      const [x, z] = centroidOf(b.p)
      const d = this.groundAt(x, z) - s.bg[i]
      if (Math.abs(d) < 0.005) return
      b.f = r2(b.f + d)
      b.l = r2(b.l + d)
    })
    s.l.forEach((l, i) => {
      const [x, z] = centroidOf(l.p)
      const d = this.groundAt(x, z) - s.lg[i]
      if (Math.abs(d) >= 0.005) l.f = r2(l.f + d)
    })
    s.br.forEach((index, i) => {
      const b = this.doc.bridges[index]
      const [x, z] = centroidOf(b.p)
      const d = this.groundAt(x, z) - s.brg[i]
      if (Math.abs(d) >= 0.005) b.y = r2(b.y + d)
    })
  }

  // ------------------------------------------------------------ water

  private water(op: WaterOp): string | null {
    const level = op.level !== undefined ? Math.round(op.level * CM) : 0
    switch (op.mode) {
      case 'fill': {
        if (!op.at || op.level === undefined) return 'Fill needs a spot and a level'
        const seed = this.nodeAt(op.at[0], op.at[1])
        if (this.grids.ground[seed] >= level) return 'The ground there is already above that level'
        const flooded = this.flood([seed], level, op.shape ?? null)
        if (!flooded) return `That would flood more than ${Math.round((FILL_CAP * this.g4.cell * this.g4.cell) / 1e6)} km²: draw a limit or pick a lower level`
        this.setWater(flooded, level)
        return null
      }
      case 'level': {
        if (!op.at || op.level === undefined) return 'Set level needs a spot and a level'
        const seed = this.nodeAt(op.at[0], op.at[1])
        if (!this.wet(seed)) return 'There is no water there'
        const body = this.body(seed)
        if (!body) return 'That water is too large to change at once'
        if (level >= this.grids.water[seed]) {
          const flooded = this.flood(body, level, op.shape ?? null)
          if (!flooded) return 'Raising it that far would flood too much: draw a limit or pick a lower level'
          this.setWater(flooded, level)
        } else {
          const ground = this.grids.ground, water = this.grids.water, cover = this.grids.cover
          for (const k of body) {
            if (ground[k] < level) water[k] = level
            else { water[k] = 0; if (cover[k] === COVER.water) cover[k] = COVER.bare }
          }
          this.normaliseWater(this.nodesBox(body))
        }
        return null
      }
      case 'paint': {
        if (!op.shape || op.level === undefined) return 'Paint needs a shape and a level'
        const field = shapeField(this.g4, op.shape, this.g4.cell)
        if (!field) return 'Outside the map'
        const n = this.g4.side, ground = this.grids.ground, water = this.grids.water, cover = this.grids.cover
        const bed = level - Math.round((op.dig ?? 0) * CM)
        for (let jj = 0; jj < field.h; jj++) {
          for (let ii = 0; ii < field.w; ii++) {
            if (field.d[jj * field.w + ii] > 0) continue
            const k = (field.j0 + jj) * n + field.i0 + ii
            if ((op.dig ?? 0) > 0 && ground[k] > bed) ground[k] = Math.max(1, bed)
            if (ground[k] < level) { water[k] = level; cover[k] = COVER.water }
          }
        }
        const box = this.fieldBox(this.g4, field)
        this.normaliseWater(box)
        this.touch(box)
        return null
      }
      case 'drain': {
        if (!op.shape) return 'Drain needs a shape'
        const field = shapeField(this.g4, op.shape, this.g4.cell)
        if (!field) return 'Outside the map'
        const n = this.g4.side, water = this.grids.water, cover = this.grids.cover, ground = this.grids.ground
        const fill = op.fill !== false
        for (let jj = 0; jj < field.h; jj++) {
          for (let ii = 0; ii < field.w; ii++) {
            if (field.d[jj * field.w + ii] > 0) continue
            const k = (field.j0 + jj) * n + field.i0 + ii
            if (water[k] === 0) continue
            if (fill && water[k] > ground[k]) ground[k] = Math.min(65535, water[k] + 15)
            water[k] = 0
            if (cover[k] === COVER.water) cover[k] = fill ? COVER.bare : COVER.marsh
          }
        }
        const box = this.fieldBox(this.g4, field)
        this.normaliseWater(box)
        this.touch(box)
        return null
      }
    }
  }

  /** The low ground below `level` joined to the seeds (4-way), inside `limit` when given; null past `FILL_CAP`. */
  private flood(seeds: number[], level: number, limit: Shape | null): number[] | null {
    const n = this.g4.side, ground = this.grids.ground
    const limitField = limit ? shapeField(this.g4, limit, 0) : null
    const inLimit = (k: number) => {
      if (!limitField) return true
      const i = (k % n) - limitField.i0, j = Math.floor(k / n) - limitField.j0
      if (i < 0 || j < 0 || i >= limitField.w || j >= limitField.h) return false
      return limitField.d[j * limitField.w + i] <= 0
    }
    const seen = new Set<number>()
    const queue: number[] = []
    for (const s of seeds) if (!seen.has(s) && ground[s] < level) { seen.add(s); queue.push(s) }
    for (let q = 0; q < queue.length; q++) {
      if (queue.length > FILL_CAP) return null
      const k = queue[q]
      const i = k % n, j = (k - i) / n
      const next = [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, j > 0 ? k - n : -1, j < n - 1 ? k + n : -1]
      for (const m of next) {
        if (m < 0 || seen.has(m)) continue
        if (ground[m] >= level || !inLimit(m)) continue
        seen.add(m)
        queue.push(m)
      }
    }
    return queue
  }

  /** The wet nodes of one water body (within half a metre of the seed's level), 4-way. */
  private body(seed: number): number[] | null {
    const n = this.g4.side, water = this.grids.water
    const lvl = water[seed]
    const seen = new Set<number>([seed])
    const queue = [seed]
    for (let q = 0; q < queue.length; q++) {
      if (queue.length > FILL_CAP) return null
      const k = queue[q]
      const i = k % n, j = (k - i) / n
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, j > 0 ? k - n : -1, j < n - 1 ? k + n : -1]) {
        if (m < 0 || seen.has(m) || !this.wet(m) || Math.abs(water[m] - lvl) > 50) continue
        seen.add(m)
        queue.push(m)
      }
    }
    return queue
  }

  private setWater(nodes: number[], level: number): void {
    const water = this.grids.water, cover = this.grids.cover
    for (const k of nodes) {
      water[k] = level
      cover[k] = COVER.water
    }
    this.normaliseWater(this.nodesBox(nodes))
  }

  private nodesBox(nodes: number[]): Box {
    const g = this.g4, n = g.side
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity
    for (const k of nodes) {
      const i = k % n, j = (k - i) / n
      if (i < i0) i0 = i
      if (i > i1) i1 = i
      if (j < j0) j0 = j
      if (j > j1) j1 = j
    }
    return { x0: g.x0 + i0 * g.cell, z0: g.z0 + j0 * g.cell, x1: g.x0 + i1 * g.cell, z1: g.z0 + j1 * g.cell }
  }

  /**
   * Keeps the water grid's convention round every shore: dry nodes next to water carry its level (so the surface meets
   * the bank between them), stray levels with no water beside them are cleared, and the cover follows the water.
   */
  private normaliseWater(box: Box): void {
    const g = this.g4, n = g.side
    const i0 = Math.max(0, Math.floor((box.x0 - g.x0) / g.cell) - 2), i1 = Math.min(n - 1, Math.ceil((box.x1 - g.x0) / g.cell) + 2)
    const j0 = Math.max(0, Math.floor((box.z0 - g.z0) / g.cell) - 2), j1 = Math.min(n - 1, Math.ceil((box.z1 - g.z0) / g.cell) + 2)
    const water = this.grids.water, cover = this.grids.cover, ground = this.grids.ground
    const w = i1 - i0 + 1, h = j1 - j0 + 1
    const wet = new Uint8Array(w * h)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) wet[(j - j0) * w + i - i0] = this.wet(j * n + i) ? 1 : 0
    const wetAt = (i: number, j: number) => {
      if (i >= i0 && i <= i1 && j >= j0 && j <= j1) return wet[(j - j0) * w + i - i0] === 1
      return i >= 0 && j >= 0 && i < n && j < n && this.wet(j * n + i)
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i
        if (wet[(j - j0) * w + i - i0]) { cover[k] = COVER.water; continue }
        let best = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if ((di || dj) && wetAt(i + di, j + dj)) best = Math.max(best, water[(j + dj) * n + i + di])
          }
        }
        if (best === 0) water[k] = 0
        else if (ground[k] >= best) water[k] = best
        else if (water[k] !== 0 && water[k] <= ground[k]) water[k] = 0
        if (cover[k] === COVER.water) cover[k] = COVER.bare
      }
    }
    this.touch(box)
  }

  private river(op: RiverOp): string | null {
    if (op.pts.length < 4) return 'A river needs two points'
    const line = curveOf(op.pts, op.curve, op.fit, 2)
    const total = Math.max(1, lineLength(line))
    const half = Math.max(1, op.w / 2)
    const bank = Math.max(0, op.bank)
    const field = shapeField(this.g4, { k: 'path', pts: line, r: half }, bank + this.g4.cell, true)
    if (!field) return 'Outside the map'
    const n = this.g4.side, ground = this.grids.ground, water = this.grids.water, cover = this.grids.cover
    for (let jj = 0; jj < field.h; jj++) {
      for (let ii = 0; ii < field.w; ii++) {
        const o = jj * field.w + ii
        const d = field.d[o]
        if (d > bank + this.g4.cell) continue
        const k = (field.j0 + jj) * n + field.i0 + ii
        const level = Math.round((op.levels[0] + ((op.levels[1] - op.levels[0]) * field.at![o]) / total) * CM)
        if (d <= 0) {
          const across = Math.min(1, (d + half) / half)
          const bed = level - Math.round(op.depth * CM * (1 - 0.7 * across ** 3))
          if (ground[k] > bed) ground[k] = Math.max(1, bed)
          water[k] = level
          cover[k] = COVER.water
        } else {
          const lip = level + 14
          const top = lip + (ground[k] - lip) * Math.min(1, d / Math.max(0.5, bank))
          let v = Math.min(ground[k], Math.round(top))
          if (d <= this.g4.cell) v = Math.max(v, lip)
          ground[k] = Math.max(1, v)
        }
      }
    }
    const box = this.fieldBox(this.g4, field)
    this.normaliseWater(box)
    this.touch(box)
    return null
  }

  // ------------------------------------------------------------ roads

  private road(op: RoadOp): string | null {
    if (op.pts.length < 4) return 'A road needs at least two points'
    if (op.replaces?.length) this.removeRoads(op.replaces)
    const fit = op.fit ?? 'arcs'
    const main = simplify(curveOf(op.pts, op.curve, fit, 2), 0.04)
    const roads: RoadData[] = [{ k: op.k, w: op.w, n: op.n, c: '', p: round2(main), id: op.id }]
    const walk = op.walk && (op.walk.left || op.walk.right) ? op.walk : null
    if (walk) {
      const d = op.w / 2 + walk.gap + walk.w / 2
      if (walk.left) roads.push({ k: 4, w: walk.w, n: '', c: '', p: round2(simplify(offsetCurve(op.pts, d, op.curve, fit, 2), 0.04)), id: `${op.id}:L` })
      if (walk.right) roads.push({ k: 4, w: walk.w, n: '', c: '', p: round2(simplify(offsetCurve(op.pts, -d, op.curve, fit, 2), 0.04)), id: `${op.id}:R` })
    }
    if (op.grade) {
      const reach = op.w / 2 + (walk ? walk.gap + walk.w : 0) + Math.max(0, op.grade.shoulder)
      this.gradeAlong(densify(main, 2), reach, Math.max(0, op.grade.falloff), Math.max(2, op.grade.smooth), op.id)
    }
    for (const r of roads) {
      this.doc.roads.push(r)
      this.markLine(r.p, r.w / 2)
    }
    this.touch(boxOf(main, op.w / 2 + 30))
    return null
  }

  /**
   * Levels the ground under a line: its height along the line is the ground's own averaged over `smooth` metres
   * (raised over water so the road crosses on a fill), flat across `reach` each side, fading out over `falloff`.
   */
  gradeAlong(stations: number[], reach: number, falloff: number, smooth: number, id: string): void {
    const n = stations.length / 2
    if (n < 2) return
    const raw: number[] = []
    for (let i = 0; i < n; i++) {
      const x = stations[i * 2], z = stations[i * 2 + 1]
      const k = this.nodeAt(x, z)
      let h = this.groundAt(x, z)
      if (this.wet(k)) h = Math.max(h, this.grids.water[k] / CM + 0.6)
      raw.push(h)
    }
    const window = Math.max(1, Math.round(smooth / 4))
    let prof = movingAverage(raw, window)
    prof = movingAverage(prof, window)
    for (let i = 0; i < n; i++) {
      const k = this.nodeAt(stations[i * 2], stations[i * 2 + 1])
      if (this.wet(k)) prof[i] = Math.max(prof[i], this.grids.water[k] / CM + 0.6)
    }
    const field = shapeField(this.g4, { k: 'path', pts: stations, r: reach }, falloff, true)
    if (!field) return
    this.shapeGround(field, { id, mode: 'grade', falloff, strength: 1, carry: false }, alongHeights(stations, prof))
    const water = this.grids.water, ground = this.grids.ground, side = this.g4.side
    for (let jj = 0; jj < field.h; jj++) {
      for (let ii = 0; ii < field.w; ii++) {
        if (field.d[jj * field.w + ii] > 0) continue
        const k = (field.j0 + jj) * side + field.i0 + ii
        if (water[k] !== 0 && water[k] <= ground[k]) water[k] = 0
      }
    }
    this.normaliseWater(this.fieldBox(this.g4, field))
  }

  private removeRoads(ids: string[]): string | null {
    const want = new Set(ids)
    const gone = this.doc.roads.filter((r) => r.id !== undefined && want.has(r.id))
    if (!gone.length) return 'Those roads are not on the map any more'
    this.doc.roads = this.doc.roads.filter((r) => !(r.id !== undefined && want.has(r.id)))
    for (const r of gone) this.repaveLine(r.p, r.w / 2)
    this.reindexBridges(want)
    return null
  }

  /** Drops the bridges of removed roads and points the rest at their roads' new places in the list. */
  private reindexBridges(removed: Set<string>): void {
    const bridges = this.doc.bridges
    const keep: typeof bridges = []
    const roads: (string | undefined)[] = []
    bridges.forEach((b, i) => {
      const id = this.bridgeRoads[i]
      if (id !== undefined && removed.has(id)) {
        this.touch(boxOf(b.p, b.w + 4))
        return
      }
      if (id !== undefined) {
        const at = this.doc.roads.findIndex((r) => r.id === id)
        if (at >= 0) b.r = at
      }
      keep.push(b)
      roads.push(id)
    })
    this.doc.bridges = keep
    this.bridgeRoads = roads
  }

  private setRoad(op: RoadSetOp): string | null {
    const road = this.doc.roads.find((r) => r.id === op.ref)
    if (!road) return 'That road is not on the map any more'
    const wider = op.w !== undefined && op.w > road.w
    const narrower = op.w !== undefined && op.w < road.w
    if (op.w !== undefined) road.w = op.w
    if (op.k !== undefined) road.k = op.k
    if (op.n !== undefined) road.n = op.n
    if (narrower) this.repaveLine(road.p, road.w / 2)
    if (wider) this.markLine(road.p, road.w / 2)
    this.touch(boxOf(road.p, road.w / 2 + 4))
    return null
  }

  // ------------------------------------------------------------ buildings

  private findBuilding(id: string): BuildingData | undefined {
    return this.doc.buildings.find((b) => b.id === id && !b.x)
  }

  private removeBuildings(ids: string[]): string | null {
    let any = false
    for (const id of ids) {
      const b = this.findBuilding(id)
      if (!b) continue
      b.x = 1
      any = true
      this.repaveBox(boxOf(b.p, PAVE_REACH))
    }
    return any ? null : 'Those buildings are not on the map any more'
  }

  private setBuilding(op: BuildingSetOp): string | null {
    const b = this.findBuilding(op.ref)
    if (!b) return 'That building is not on the map any more'
    const before = boxOf(b.p, PAVE_REACH)
    const moved = !!(op.dx || op.dz || op.yaw)
    if (moved) {
      const [cx, cz] = centroidOf(b.p)
      const yaw = op.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw)
      const dx = op.dx ?? 0, dz = op.dz ?? 0
      const move = (x: number, z: number): [number, number] => {
        const rx = x - cx, rz = z - cz
        return [cx + rx * c - rz * s + dx, cz + rx * s + rz * c + dz]
      }
      for (let k = 0; k < b.p.length; k += 2) {
        const [x, z] = move(b.p[k], b.p[k + 1])
        b.p[k] = Math.round(x * 100) / 100
        b.p[k + 1] = Math.round(z * 100) / 100
      }
      for (const r of b.r) {
        const [x, z] = move(r[0], r[1])
        r[0] = x
        r[1] = z
        r[4] += yaw
      }
      if (op.f === undefined) this.seatBuilding(b)
    }
    if (op.h !== undefined) {
      const lift = op.h - b.h
      b.h = op.h
      for (const r of b.r) { r[6] += lift; r[7] += lift }
    }
    if (op.roof !== undefined) for (const r of b.r) { r[5] = op.roof; if (op.roof === 0) r[7] = r[6] }
    if (op.ridge !== undefined) for (const r of b.r) r[7] = r[6] + (r[5] === 0 ? 0 : Math.max(0, op.ridge))
    if (op.k !== undefined) b.k = op.k
    if (op.rc !== undefined) b.rc = op.rc
    if (op.n !== undefined) b.n = op.n || undefined
    if (op.f !== undefined) {
      b.f = op.f
      b.l = Math.min(b.l, b.f)
    }
    if (op.h !== undefined || op.roof !== undefined || op.ridge !== undefined) b.m = 1
    if (moved) {
      this.repaveBox(before)
      this.repaveBox(boxOf(b.p, PAVE_REACH))
    }
    this.touch(unionBox(before, boxOf(b.p, 4)))
    return null
  }

  /** Sets a building's floor on the ground under its corners (the highest, a little over) and its lowest wall foot. */
  private seatBuilding(b: BuildingData): void {
    const hs: number[] = []
    for (let k = 0; k < b.p.length; k += 2) hs.push(this.groundAt(b.p[k], b.p[k + 1]))
    b.f = Math.round((Math.max(...hs) + 0.12) * 100) / 100
    b.l = Math.round(Math.min(...hs) * 100) / 100
  }

  private addBuilding(op: BuildingOp): string | null {
    const ring = rectRing(op.x, op.z, op.w / 2, op.d / 2, op.yaw)
    if (op.level) {
      const hs: number[] = []
      for (let k = 0; k < ring.length; k += 2) hs.push(this.groundAt(ring[k], ring[k + 1]))
      const pad = rectRing(op.x, op.z, op.w / 2 + 1.5, op.d / 2 + 1.5, op.yaw)
      const field = shapeField(this.g4, { k: 'area', ring: pad }, 5)
      if (field) this.shapeGround(field, { id: op.id, mode: 'flatten', falloff: 5, height: Math.max(...hs), strength: 1, carry: false }, null)
    }
    const flat = op.roof === 0
    const b: BuildingData = {
      k: op.k,
      h: op.h,
      f: 0,
      l: 0,
      s: hashString(op.id) % 100000,
      p: round2(ring),
      r: [[op.x, op.z, op.w / 2, op.d / 2, op.yaw, op.roof, op.h, op.h + (flat ? 0 : Math.max(0, op.ridge))]],
      m: 1,
      id: op.id,
    }
    if (op.rc) b.rc = op.rc
    if (op.n) b.n = op.n
    this.seatBuilding(b)
    this.doc.buildings.push(b)
    this.markArea(b.p, -8)
    this.touch(boxOf(ring, 8))
    return null
  }

  // ------------------------------------------------------------ lots

  private addLot(op: LotOp): string | null {
    if (op.ring.length < 6) return 'A lot needs at least three corners'
    const lot: LotData = { f: op.f ?? this.lotFloor(op.ring), p: round2(op.ring), id: op.id }
    if (op.n) lot.n = op.n
    if (op.stripes === false) lot.ns = 1
    this.doc.lots.push(lot)
    this.markArea(lot.p, -1)
    this.touch(boxOf(op.ring, 4))
    return null
  }

  private lotFloor(ring: ArrayLike<number>): number {
    let top = -Infinity
    for (let k = 0; k + 1 < ring.length; k += 2) top = Math.max(top, this.groundAt(ring[k], ring[k + 1]))
    return Math.round((top + 0.02) * 100) / 100
  }

  private removeLots(ids: string[]): string | null {
    const want = new Set(ids)
    const gone = this.doc.lots.filter((l) => l.id !== undefined && want.has(l.id))
    if (!gone.length) return 'Those lots are not on the map any more'
    this.doc.lots = this.doc.lots.filter((l) => !(l.id !== undefined && want.has(l.id)))
    for (const l of gone) this.repaveBox(boxOf(l.p, PAVE_REACH))
    return null
  }

  private setLot(op: LotSetOp): string | null {
    const lot = this.doc.lots.find((l) => l.id === op.ref)
    if (!lot) return 'That lot is not on the map any more'
    const before = boxOf(lot.p, PAVE_REACH)
    if (op.ring && op.ring.length >= 6) lot.p = round2(op.ring)
    if (op.f !== undefined) lot.f = op.f
    if (op.n !== undefined) lot.n = op.n || undefined
    if (op.stripes !== undefined) lot.ns = op.stripes ? undefined : 1
    if (op.ring) {
      this.repaveBox(before)
      this.repaveBox(boxOf(lot.p, PAVE_REACH))
    }
    this.touch(unionBox(before, boxOf(lot.p, 4)))
    return null
  }

  private clipLots(op: LotClipOp): string | null {
    const margin = Math.max(0, op.margin)
    const want = op.ids === 'all' ? null : new Set(op.ids)
    const roads = this.doc.roads.filter((r) => r.k <= 1).map((r) => ({ p: r.p, half: isTownStreet(r) ? Math.max(r.w / 2, STREET_HALF) : r.w / 2 }))
    const next: LotData[] = []
    const boxes: Box[] = []
    let changed = 0
    for (const lot of this.doc.lots) {
      if (want && !(lot.id && want.has(lot.id))) { next.push(lot); continue }
      const pieces = clipLotRing(lot.p, roads, margin)
      if (pieces.length === 1 && pieces[0].length === lot.p.length && pieces[0].every((v, i) => v === lot.p[i])) { next.push(lot); continue }
      changed++
      boxes.push(boxOf(lot.p, PAVE_REACH))
      pieces.forEach((ring, i) => next.push({ ...lot, p: round2(ring), id: i === 0 ? lot.id : `${op.id}:${lot.id}:${i}` }))
    }
    this.doc.lots = next
    for (const b of boxes) this.repaveBox(b)
    return changed ? null : 'No parking lot overlaps a road'
  }

  // ------------------------------------------------------------ trees

  private trees(op: TreesOp): string | null {
    this.treesTouched = true
    const box = shapeBox(op.shape, 2)
    if (op.mode === 'remove') {
      const f = this.doc.frame
      for (let i = 0; i < this.bakedX.length; i++) {
        if (this.treeGone[i]) continue
        const x = f.x0 + this.bakedX[i] / this.units
        if (x < box.x0 || x > box.x1) continue
        const z = f.z0 + this.bakedZ[i] / this.units
        if (z < box.z0 || z > box.z1) continue
        if (inShape(op.shape, x, z)) this.treeGone[i] = 1
      }
      for (const t of this.treeAdds) if (!t.gone && inShape(op.shape, t.x, t.z)) t.gone = true
      this.paintFloor(op.shape, false)
      this.touch(box)
      return null
    }
    const density = Math.max(0, op.density ?? 0)
    if (density <= 0) return 'Pick how many trees a hectare'
    const spacing = Math.sqrt(10000 / density)
    const mix = op.mix ?? [1, 1, 0.3]
    const total = mix[0] + mix[1] + mix[2] || 1
    const [hMin, hMax] = op.height ?? [10, 20]
    const random = rng(hashString(`${op.id}:${op.seed ?? 0}`))
    const field = shapeField(this.g4, op.shape, 0)
    if (!field) return 'Outside the map'
    let planted = 0
    const cols = Math.ceil((box.x1 - box.x0) / spacing), rows = Math.ceil((box.z1 - box.z0) / spacing)
    if (cols * rows > 2_000_000) return 'Too many trees at once: plant a smaller area or fewer a hectare'
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = box.x0 + (c + 0.5 + (random() - 0.5) * 0.9) * spacing
        const z = box.z0 + (r + 0.5 + (random() - 0.5) * 0.9) * spacing
        const pick = random() * total
        const kind = pick < mix[0] ? 0 : pick < mix[0] + mix[1] ? 1 : 2
        const h = hMin + (hMax - hMin) * random()
        if (!inShape(op.shape, x, z)) continue
        const k = this.nodeAt(x, z)
        if (this.wet(k) || this.clearAt(x, z) < 1.5) continue
        this.treeAdds.push({ x, z, kind, h, gone: false })
        planted++
      }
    }
    if (op.floor !== false) this.paintFloor(op.shape, true)
    this.touch(box)
    return planted ? null : 'No room for trees there (water or pavement)'
  }

  /** Woods on the ground under a planted stand (canopy just under what grows infill), or open meadow where trees were cleared. */
  private paintFloor(shape: Shape, woods: boolean): void {
    const field = shapeField(this.g4, shape, 0)
    if (!field) return
    const n = this.g4.side, cover = this.grids.cover, canopy = this.grids.canopy
    for (let jj = 0; jj < field.h; jj++) {
      for (let ii = 0; ii < field.w; ii++) {
        if (field.d[jj * field.w + ii] > 0) continue
        const k = (field.j0 + jj) * n + field.i0 + ii
        if (this.wet(k) || cover[k] === COVER.lot) continue
        if (woods) {
          cover[k] = COVER.woods
          canopy[k] = Math.min(139, Math.max(canopy[k], 120))
        } else {
          if (cover[k] === COVER.woods) cover[k] = COVER.meadow
          canopy[k] = 0
        }
      }
    }
  }

  // ------------------------------------------------------------ the pavement field

  clearAt(x: number, z: number): number {
    const g = this.g2, n = g.side
    const i = Math.min(n - 1, Math.max(0, Math.round((x - g.x0) / g.cell)))
    const j = Math.min(n - 1, Math.max(0, Math.round((z - g.z0) / g.cell)))
    return this.grids.clear[j * n + i] / 4
  }

  /** Marks a new paved line (a road, a walk, a wall) in the pavement field. */
  private markLine(p: ArrayLike<number>, half: number): void {
    const field = shapeField(this.g2, { k: 'path', pts: Array.from(p), r: half }, 8)
    if (field) this.mergeClear(field)
  }

  /** Marks a new paved area (a lot, a building's walls) in the pavement field, at most `inside` quarter metres inside it. */
  private markArea(ring: ArrayLike<number>, inside: number): void {
    const field = shapeField(this.g2, { k: 'area', ring: Array.from(ring) }, 8)
    if (!field) return
    for (let o = 0; o < field.d.length; o++) if (field.d[o] <= 0) field.d[o] = Math.max(field.d[o], inside / 4)
    this.mergeClear(field)
  }

  private mergeClear(field: Field): void {
    const n = this.g2.side, clear = this.grids.clear
    for (let jj = 0; jj < field.h; jj++) {
      for (let ii = 0; ii < field.w; ii++) {
        const d = field.d[jj * field.w + ii]
        if (!Number.isFinite(d) && d > 0) continue
        const k = (field.j0 + jj) * n + field.i0 + ii
        const v = Math.max(-127, Math.min(127, Math.round((Number.isFinite(d) ? d : -32) * 4)))
        if (v < clear[k]) clear[k] = v
      }
    }
  }

  /** Works the pavement field out again along a line that lost pavement, in pieces so a long road stays cheap. */
  private repaveLine(p: ArrayLike<number>, half: number): void {
    const pts = densify(p, 4)
    const piece = 30
    for (let s = 0; s < pts.length / 2; s += piece) {
      const part = pts.slice(s * 2, Math.min(pts.length, (s + piece + 1) * 2))
      this.repaveBox(boxOf(part, half + PAVE_REACH))
    }
  }

  /** Works the pavement field out from scratch inside a box: distance to every road, lot and standing building near it. */
  private repaveBox(box: Box): void {
    const g = this.g2, n = g.side
    const i0 = Math.max(0, Math.floor((box.x0 - g.x0) / g.cell)), i1 = Math.min(n - 1, Math.ceil((box.x1 - g.x0) / g.cell))
    const j0 = Math.max(0, Math.floor((box.z0 - g.z0) / g.cell)), j1 = Math.min(n - 1, Math.ceil((box.z1 - g.z0) / g.cell))
    if (i1 < i0 || j1 < j0) return
    const w = i1 - i0 + 1, h = j1 - j0 + 1
    const best = new Float32Array(w * h).fill(PAVE_REACH)
    const reach = PAVE_REACH
    const near = (b: Box) => b.x1 >= box.x0 - reach && b.x0 <= box.x1 + reach && b.z1 >= box.z0 - reach && b.z0 <= box.z1 + reach
    const merge = (f: Field | null) => {
      if (!f) return
      for (let jj = 0; jj < f.h; jj++) {
        const j = f.j0 + jj - j0
        if (j < 0 || j >= h) continue
        for (let ii = 0; ii < f.w; ii++) {
          const i = f.i0 + ii - i0
          if (i < 0 || i >= w) continue
          const d = f.d[jj * f.w + ii]
          const v = d === -Infinity ? -reach : d
          if (v < best[j * w + i]) best[j * w + i] = v
        }
      }
    }
    const clip = { x0: box.x0 - 4, z0: box.z0 - 4, x1: box.x1 + 4, z1: box.z1 + 4 }
    for (const r of this.doc.roads) {
      const rb = boxOf(r.p, r.w / 2)
      if (!near(rb)) continue
      merge(clippedPath(g, r.p, r.w / 2, reach, clip))
    }
    for (const l of this.doc.lots) if (near(boxOf(l.p))) merge(shapeField(g, { k: 'area', ring: l.p }, reach))
    for (const b of this.doc.buildings) if (!b.x && near(boxOf(b.p))) merge(shapeField(g, { k: 'area', ring: b.p }, reach))
    for (const wall of this.extras.walls) if (near(boxOf(wall.pts))) merge(clippedPath(g, wall.closed ? [...wall.pts, wall.pts[0], wall.pts[1]] : wall.pts, wall.th / 2, reach, clip))
    const clear = this.grids.clear
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) clear[(j0 + j) * n + i0 + i] = Math.max(-127, Math.min(127, Math.round(best[j * w + i] * 4)))
    this.touch(box)
  }
}

/** A path's field limited to the segments near a box (long roads are cut down to the part that matters). */
function clippedPath(g: GridSpec, p: ArrayLike<number>, half: number, reach: number, clip: Box): Field | null {
  const pad = half + reach
  const runs: number[][] = []
  let cur: number[] = []
  for (let k = 0; k + 3 < p.length; k += 2) {
    const sx0 = Math.min(p[k], p[k + 2]) - pad, sx1 = Math.max(p[k], p[k + 2]) + pad
    const sz0 = Math.min(p[k + 1], p[k + 3]) - pad, sz1 = Math.max(p[k + 1], p[k + 3]) + pad
    if (sx1 < clip.x0 || sx0 > clip.x1 || sz1 < clip.z0 || sz0 > clip.z1) {
      if (cur.length >= 4) runs.push(cur)
      cur = []
      continue
    }
    if (!cur.length) cur.push(p[k], p[k + 1])
    cur.push(p[k + 2], p[k + 3])
  }
  if (cur.length >= 4) runs.push(cur)
  if (p.length === 2) runs.push([p[0], p[1]])
  let out: Field | null = null
  for (const run of runs) {
    const f = shapeField(g, { k: 'path', pts: run, r: half }, reach)
    if (!f) continue
    out = out ? mergeFields(out, f) : f
  }
  return out
}

function mergeFields(a: Field, b: Field): Field {
  const i0 = Math.min(a.i0, b.i0), j0 = Math.min(a.j0, b.j0)
  const i1 = Math.max(a.i0 + a.w, b.i0 + b.w), j1 = Math.max(a.j0 + a.h, b.j0 + b.h)
  const w = i1 - i0, h = j1 - j0
  const d = new Float32Array(w * h).fill(Infinity)
  for (const f of [a, b]) {
    for (let jj = 0; jj < f.h; jj++) {
      for (let ii = 0; ii < f.w; ii++) {
        const o = (f.j0 + jj - j0) * w + (f.i0 + ii - i0)
        const v = f.d[jj * f.w + ii]
        if (v < d[o]) d[o] = v
      }
    }
  }
  return { i0, j0, w, h, d }
}

/** Heights along a path from heights at its points, by distance along it. */
function alongHeights(pts: ArrayLike<number>, heights: readonly number[]): (s: number) => number {
  const cum = [0]
  for (let k = 2; k + 1 < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]))
  return (s: number) => {
    if (s <= 0 || cum.length < 2) return heights[0]
    if (s >= cum[cum.length - 1]) return heights[heights.length - 1]
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= s) lo = mid
      else hi = mid
    }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1)
    return heights[lo] + (heights[hi] - heights[lo]) * t
  }
}

function movingAverage(v: number[], half: number): number[] {
  const out = new Array<number>(v.length)
  for (let i = 0; i < v.length; i++) {
    let s = 0, c = 0
    for (let k = Math.max(0, i - half); k <= Math.min(v.length - 1, i + half); k++) { s += v[k]; c++ }
    out[i] = s / c
  }
  return out
}

/** In-place box blur of a w × h float grid (rows then columns), radius in cells. */
function boxBlur(a: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(Math.max(w, h))
  for (let j = 0; j < h; j++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += a[j * w + Math.min(w - 1, Math.max(0, i))]
    for (let i = 0; i < w; i++) {
      tmp[i] = s / (2 * r + 1)
      s += a[j * w + Math.min(w - 1, i + r + 1)] - a[j * w + Math.max(0, i - r)]
    }
    for (let i = 0; i < w; i++) a[j * w + i] = tmp[i]
  }
  for (let i = 0; i < w; i++) {
    let s = 0
    for (let j = -r; j <= r; j++) s += a[Math.min(h - 1, Math.max(0, j)) * w + i]
    for (let j = 0; j < h; j++) {
      tmp[j] = s / (2 * r + 1)
      s += a[Math.min(h - 1, j + r + 1) * w + i] - a[Math.max(0, j - r) * w + i]
    }
    for (let j = 0; j < h; j++) a[j * w + i] = tmp[j]
  }
}

export function rectRing(x: number, z: number, hw: number, hd: number, yaw: number): number[] {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const out: number[] = []
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(x + c * a * hw - s * b * hd, z + s * a * hw + c * b * hd)
  return out
}

/** True when a point is inside a shape (a path's radius or an area). */
export function inShape(shape: Shape, x: number, z: number): boolean {
  if (shape.k === 'area') return inRing(shape.ring, x, z)
  return distToLine(shape.pts, x, z) <= shape.r
}

/** Rails with the parts inside a shape cut out (a run can become two). */
export function cutRails(rails: WorldExtras['rails'], shape: Shape): WorldExtras['rails'] {
  const out: WorldExtras['rails'] = []
  for (const rail of rails) {
    let cur: Flat = []
    for (let k = 0; k + 1 < rail.pts.length; k += 2) {
      if (inShape(shape, rail.pts[k], rail.pts[k + 1])) {
        if (cur.length >= 4) out.push({ side: rail.side, pts: cur })
        cur = []
      } else cur.push(rail.pts[k], rail.pts[k + 1])
    }
    if (cur.length >= 4) out.push({ side: rail.side, pts: cur })
  }
  return out
}

function round2(p: ArrayLike<number>): number[] {
  return Array.from(p, (v) => Math.round(v * 100) / 100)
}

/** Names every road, building and lot that has no id yet by its place in the map (`r12`, `b40`, `l3`). */
export function assignIds(doc: MapDoc): void {
  doc.roads.forEach((r, i) => { if (r.id === undefined) r.id = `r${i}` })
  doc.buildings.forEach((b, i) => { if (b.id === undefined) b.id = `b${i}` })
  doc.lots.forEach((l, i) => { if (l.id === undefined) l.id = `l${i}` })
}

/** Replays a whole edit document on a map (after Tello's fixes). */
export function applyWorldEdits(doc: MapDoc, grids: MapGrids, edits: WorldEdits | null | undefined): EditReport {
  const session = new EditSession(doc, grids)
  if (edits) for (const op of edits.ops) session.apply(op)
  session.finish()
  return session.report
}
