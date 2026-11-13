/**
 * A Fox Lake home drawn the way The Hood draws it (`hood/src/models/House.ts` and `Features.ts`), into the town's
 * merged builders: two-tone cladding with a wainscot over a footing, inside walls, trim and corner boards, doors in
 * five styles with lanterns and steps, windows with grids, shutters, flower boxes and curtains, floors, the
 * generated hip, gable or flat roof with fascia, gutters and gable ends, and every feature (canopies, porch roofs on
 * posts, pergolas with string lights, fences and gates, chimneys). Everything is laid out in The Hood's grid metres
 * and turned onto the lot by the home's frame; colliders come back in town metres.
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Material } from '@babylonjs/core/Materials/material'
import { MeshBuilder, hexRGB, type RGB } from '../fp/core/Geo'
import type { Mats } from '../fp/core/Tex'
import { FLOOR_MATERIALS } from '../../hood/shared/Catalog'
import { outsideSide } from '../../hood/shared/Build'
import { LotGrid, W, edgeKey, featureEdges, inLot, type Edge } from '../../hood/shared/Lot'
import { PAINTS, WAINSCOTS, type Cladding, type HouseStyle } from '../../hood/shared/Style'
import { frameYaw, type FoxHome, type HomeFrame } from '../../maplestreet/shared/HoodHomes'
import { ROOF_BASE, WALL_HEIGHT, buildRoof, eaveHeight, roofOverhang } from './HoodRoof'

const THICK = 0.08
const LOW = 0.32
const DOOR_TOP = 2.15
const SILL = 0.9
const HEAD = 2.05
const FOOTING = 0.24
const CANOPY_WIDTHS = [1.4, 2.2, 3.2]
/** The house stands this far above the lot's lawn. */
export const HOME_BASE_Y = 0.02

export type WallMode = 'up' | 'cut' | 'down'
export interface HomeView { walls: WallMode; roof: boolean; camera?: { gx: number; gz: number } }
export const STANDING: HomeView = { walls: 'up', roof: true }

export type GetBuilder = (m: Material) => MeshBuilder
export type Collide = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, prop?: boolean) => void

type TexKind = Parameters<Mats['textured']>[1]

const CLADDING: Record<Cladding, [TexKind, number]> = {
  lap: ['siding', 2], board: ['boards', 2], shake: ['shingles', 1.6], brick: ['brick', 1.2], stone: ['stone', 1.4], stucco: ['stucco', 2], panel: ['woodPanel', 2.4],
}
const FLOORS: [TexKind, number][] = [
  ['planks', 2.4], ['planks', 2.4], ['tile', 1.2], ['tile', 1.2], ['carpet', 1.5], ['patio', 1.8], ['deck', 3.2], ['brick', 1],
  ['stone', 2.2], ['concrete', 2], ['gravel', 1.2], ['herringbone', 1.6], ['tile', 0.8], ['marble', 1.4], ['tile', 1],
]
const ROOFING: Record<HouseStyle['roofMaterial'], [TexKind, number, number, number]> = {
  shingle: ['shingles', 1.6, 0.12, 0], metal: ['metal', 2.4, 0.6, 0.55], clay: ['shingles', 1.1, 0.25, 0], slate: ['slate', 1.2, 0.4, 0],
}

const paint = (index: number): RGB => hexRGB(PAINTS[index]?.color ?? PAINTS[0].color)
const scaleRGB = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]
const WHITE: RGB = [1, 1, 1]

const _v = new Vector3()

export class HomeMesher {
  constructor(private readonly mats: Mats) {}

  private tex(kind: TexKind, tile: number, gloss?: number, metal?: number): Material {
    return this.mats.textured(`hd-${kind}-${tile}${gloss !== undefined ? `-${gloss}` : ''}`, kind, { vcolor: true, tile, ...(gloss !== undefined ? { gloss } : {}), ...(metal ? { metal } : {}) })
  }
  private get paintMat() { return this.mats.plain('hd-paint', { vcolor: true, gloss: 0.28 }) }
  private get glossMat() { return this.mats.plain('hd-gloss', { vcolor: true, gloss: 0.62 }) }

  /**
   * Draws `home` into `get`'s builders (each gets the lot transform while this runs, then none again) and reports
   * its solid parts to `collide` in town metres.
   */
  mesh(home: FoxHome, frame: HomeFrame, get: GetBuilder, collide: Collide | null, view: HomeView = STANDING): void {
    const lotM = Matrix.RotationY(frameYaw(frame)).multiply(Matrix.Translation(frame.ox, HOME_BASE_Y, frame.oz))
    const used = new Set<MeshBuilder>()
    const at = (m: Material) => {
      const mb = get(m)
      if (!used.has(mb)) { used.add(mb); mb.transform(lotM) }
      return mb
    }
    const solid: Collide = (x0, y0, z0, x1, y1, z1, prop) => {
      if (!collide) return
      const ax = frame.ox + frame.sx * x0, bx = frame.ox + frame.sx * x1, az = frame.oz + frame.sz * z0, bz = frame.oz + frame.sz * z1
      collide(Math.min(ax, bx), y0 + HOME_BASE_Y, Math.min(az, bz), Math.max(ax, bx), y1 + HOME_BASE_Y, Math.max(az, bz), prop)
    }
    const grid = new LotGrid(home)
    this.floors(home, at)
    const roof = buildRoof(grid, home.style)
    this.walls(home, grid, at, solid, view)
    if (roof && view.roof) this.roof(home.style, roof, at)
    this.features(home, grid, at, solid, lotM, view.roof, roof ? ROOF_BASE + roof.top : WALL_HEIGHT + 1)
    for (const mb of used) mb.transform(null)
  }

  // ------------------------------------------------------------ floors

  private floors(home: FoxHome, at: GetBuilder) {
    const byMat = new Map<number, Set<number>>()
    for (const [index, mat] of home.floors) {
      let set = byMat.get(mat)
      if (!set) byMat.set(mat, (set = new Set()))
      set.add(index)
    }
    for (const [mat, tiles] of byMat) {
      const [kind, tile] = FLOORS[mat] ?? FLOORS[0]
      const color = scaleRGB(hexRGB(FLOOR_MATERIALS[mat]?.color ?? '#999999'), 1.15)
      const mb = at(this.tex(kind, tile))
      for (const r of rects(tiles)) mb.box(r.x0, 0, r.z0, r.x1, 0.03, r.z1, { skipBottom: true, color })
    }
  }

  // ------------------------------------------------------------ walls

  private walls(home: FoxHome, grid: LotGrid, at: GetBuilder, solid: Collide, view: HomeView) {
    const style = home.style
    const upper = paint(style.upperColor), lower = paint(style.lowerColor), interior = paint(style.interiorColor), trimC = paint(style.trimColor)
    const trimWidth = [0.05, 0.08, 0.12][style.trimWidth] ?? 0.08
    const wainscot = (WAINSCOTS[style.wainscot] ?? 0) * WALL_HEIGHT
    const windowSet = new Set(home.windows.map(([x, z, v]) => edgeKey(x, z, v)))
    const clad = (kind: Cladding) => { const [k, t] = CLADDING[kind]; return at(this.tex(k, t)) }
    const inside = at(this.paintMat)
    const footing = style.foundation === 'brick' ? { m: at(this.tex('brick', 1.2)), c: hexRGB('#b0604a') } : style.foundation === 'concrete' ? { m: at(this.tex('concrete', 1.5)), c: hexRGB('#c9c6bf') } : { m: at(this.tex('stone', 1.4)), c: hexRGB('#c9c2b6') }
    const trim = at(this.paintMat)
    const shutters = at(this.paintMat)
    const shutterC = paint(style.shutterColor)
    const doorLeaf = at(this.glossMat)
    const doorC = paint(style.doorColor)
    const knobs = at(this.mats.plain('hd-brass', { color: 0xc9a24a, gloss: 0.78, metal: 0.9 }))
    const steps = at(this.tex('concrete', 1.5))
    const glass = at(this.mats.glass('hd-glass', 0x9fc1d6, 0.42))
    const curtains = at(this.tex('carpet', 1))
    const planters = at(this.tex('woodPanel', 0.9))
    const blooms = at(this.paintMat)
    const lamps = at(this.mats.glow('hd-lamp', 0xffcf7a, 5))
    const lampFrames = at(this.mats.plain('hd-iron', { color: 0x1f2124, gloss: 0.6, metal: 0.6 }))
    const bloomColors = ['#e86f9a', '#f2d24b', '#ffffff', '#c44e3f', '#9b7bd8'].map((c) => hexRGB(c))
    const leaf = hexRGB('#4f8a3f')
    const darker = scaleRGB(shutterC, 0.78)

    const onEdge = (mb: MeshBuilder, c: RGB, edge: Edge, along: number, width: number, y0: number, y1: number, out: number, depth: number) => {
      const [x, z, v] = edge
      if (y1 - y0 <= 0.001) return
      if (v === 0) mb.box(x + 0.5 + along - width / 2, y0, z + out - depth / 2, x + 0.5 + along + width / 2, y1, z + out + depth / 2, { color: c })
      else mb.box(x + out - depth / 2, y0, z + 0.5 + along - width / 2, x + out + depth / 2, y1, z + 0.5 + along + width / 2, { color: c })
    }
    const edgeBox = (edge: Edge, along0: number, along1: number, y0: number, y1: number, half: number, prop = false) => {
      const [x, z, v] = edge
      if (v === 0) solid(x + along0, y0, z - half, x + along1, y1, z + half, prop)
      else solid(x - half, y0, z + along0, x + half, y1, z + along1, prop)
    }
    const sideTile = (edge: Edge, side: -1 | 1): [number, number] => {
      const [x, z, v] = edge
      return v === 0 ? (side < 0 ? [x, z - 1] : [x, z]) : (side < 0 ? [x - 1, z] : [x, z])
    }
    const isIn = (tile: [number, number]) => inLot(...tile) && grid.isInside(...tile)

    const drawShutter = (edge: Edge, along: number, out: number) => {
      const w = 0.34, y0 = SILL - 0.02, y1 = HEAD + 0.02
      const depthOut = out + Math.sign(out) * 0.012
      if (style.shutters === 'panel') {
        onEdge(shutters, shutterC, edge, along, w, y0, y1, out, 0.035)
        for (const [a, b] of [[y0 + 0.08, (y0 + y1) / 2 - 0.04], [(y0 + y1) / 2 + 0.04, y1 - 0.08]]) onEdge(shutters, darker, edge, along, w - 0.1, a, b, depthOut, 0.02)
      } else if (style.shutters === 'louvered') {
        for (const a of [-w / 2 + 0.025, w / 2 - 0.025]) onEdge(shutters, shutterC, edge, along + a, 0.05, y0, y1, out, 0.04)
        onEdge(shutters, shutterC, edge, along, w, y0, y0 + 0.05, out, 0.04)
        onEdge(shutters, shutterC, edge, along, w, y1 - 0.05, y1, out, 0.04)
        for (let k = 1; k < 12; k++) {
          const y = y0 + 0.05 + k * (y1 - y0 - 0.1) / 12
          onEdge(shutters, k % 2 ? shutterC : darker, edge, along, w - 0.08, y - 0.018, y + 0.018, out, 0.03)
        }
      } else if (style.shutters === 'board') {
        for (const a of [-0.11, 0, 0.11]) onEdge(shutters, shutterC, edge, along + a, 0.1, y0, y1, out, 0.035)
        for (const y of [y0 + 0.18, y1 - 0.18]) onEdge(shutters, darker, edge, along, w, y - 0.04, y + 0.04, depthOut, 0.02)
      }
    }

    const heights = new Map<string, number>()
    for (const edge of home.walls) {
      const [x, z, v] = edge
      let height = WALL_HEIGHT
      if (view.walls === 'down') height = LOW
      else if (view.walls === 'cut' && view.camera) {
        const cameraLow = v === 0 ? view.camera.gz < z : view.camera.gx < x
        const far: [number, number] = v === 0 ? (cameraLow ? [x, z] : [x, z - 1]) : (cameraLow ? [x, z] : [x - 1, z])
        if (isIn(far)) height = LOW
      }
      heights.set(edgeKey(x, z, v), height)
      const door = grid.isDoor(x, z, v)
      const window = !door && windowSet.has(edgeKey(x, z, v))
      for (const side of [-1, 1] as const) {
        const out = !isIn(sideTile(edge, side))
        const offset = side * THICK / 2
        const spans: [number, number][] = door ? [[DOOR_TOP, height]] : window ? [[0, Math.min(SILL, height)], [HEAD, height]] : [[0, height]]
        for (const [y0, y1] of spans) {
          if (!out) { onEdge(inside, interior, edge, 0, 1, y0, y1, offset, THICK); continue }
          if (wainscot > 0 && y0 < wainscot) onEdge(clad(style.lower), lower, edge, 0, 1, y0, Math.min(y1, wainscot), offset, THICK)
          if (y1 > wainscot) onEdge(clad(style.upper), upper, edge, 0, 1, Math.max(y0, wainscot), y1, offset, THICK)
        }
        if (!out) continue
        if (height > FOOTING + 0.1 && !door && !(wainscot > 0 && (style.lower === 'brick' || style.lower === 'stone'))) onEdge(footing.m, footing.c, edge, 0, 1, 0, FOOTING, side * (THICK / 2 + 0.012), THICK + 0.024)
        if (wainscot > 0 && height > wainscot + 0.05 && !door && !(window && wainscot > SILL && wainscot < HEAD)) onEdge(trim, trimC, edge, 0, 1, wainscot - 0.03, wainscot + 0.03, side * (THICK / 2 + 0.02), 0.05)
        if (height >= WALL_HEIGHT && home.style.roofStyle !== 'flat') onEdge(trim, trimC, edge, 0, 1, WALL_HEIGHT - 0.16, WALL_HEIGHT, side * (THICK / 2 + 0.015), 0.035)
        if (door) {
          onEdge(steps, WHITE, edge, 0, 1.3, 0, 0.14, side * (THICK + 0.3), 0.6)
          if (style.porchLights && height > DOOR_TOP) for (const along of [-0.62, 0.62]) {
            onEdge(lamps, WHITE, edge, along, 0.12, 1.62, 1.86, side * (THICK / 2 + 0.11), 0.12)
            onEdge(lampFrames, WHITE, edge, along, 0.15, 1.86, 1.9, side * (THICK / 2 + 0.11), 0.15)
            onEdge(lampFrames, WHITE, edge, along, 0.05, 1.7, 1.78, side * (THICK / 2 + 0.03), 0.06)
          }
        }
      }
      if (door && height > DOOR_TOP) {
        const leafH = DOOR_TOP - 0.03
        onEdge(doorLeaf, doorC, edge, 0, 0.84, 0, leafH, 0, 0.05)
        for (const side of [-1, 1]) {
          const o = side * 0.03
          switch (style.doorStyle) {
            case 'panel':
              for (const [y0, y1] of [[0.25, 0.95], [1.15, 1.95]]) for (const a of [-0.19, 0.19]) onEdge(doorLeaf, scaleRGB(doorC, 0.86), edge, a, 0.3, y0, y1, o, 0.014)
              break
            case 'craftsman':
              for (const a of [-0.24, 0, 0.24]) onEdge(glass, WHITE, edge, a, 0.18, 1.5, 1.92, o, 0.01)
              onEdge(doorLeaf, doorC, edge, 0, 0.7, 1.38, 1.44, o, 0.03)
              for (const a of [-0.19, 0.19]) onEdge(doorLeaf, scaleRGB(doorC, 0.86), edge, a, 0.3, 0.22, 1.25, o, 0.014)
              break
            case 'glass':
              onEdge(glass, WHITE, edge, 0, 0.56, 0.3, 1.9, o, 0.01)
              break
            case 'farmhouse':
              onEdge(glass, WHITE, edge, 0, 0.6, 1.25, 1.92, o, 0.01)
              for (const a of [-0.3, -0.15, 0, 0.15, 0.3]) onEdge(doorLeaf, scaleRGB(doorC, 0.8), edge, a, 0.02, 0.15, 1.1, o, 0.012)
              onEdge(doorLeaf, doorC, edge, 0, 0.7, 1.12, 1.2, o, 0.02)
              break
            case 'modern':
              onEdge(glass, WHITE, edge, 0.3, 0.1, 0.2, 1.95, o, 0.01)
              onEdge(knobs, WHITE, edge, -0.28, 0.03, 0.7, 1.5, side * 0.07, 0.03)
              break
          }
          if (style.doorStyle !== 'modern') onEdge(knobs, WHITE, edge, 0.32, 0.06, 0.98, 1.04, side * 0.05, 0.05)
        }
        for (const along of [-0.46, 0.46]) onEdge(trim, trimC, edge, along, trimWidth, 0, DOOR_TOP + trimWidth, 0, THICK + 0.05)
        onEdge(trim, trimC, edge, 0, 1 + trimWidth, DOOR_TOP, DOOR_TOP + trimWidth + 0.04, 0, THICK + 0.05)
      } else if (door) onEdge(doorLeaf, doorC, edge, 0, 0.84, 0, height, 0, 0.05)
      if (window && height > HEAD) {
        const outSide = !isIn(sideTile(edge, -1)) ? -1 : !isIn(sideTile(edge, 1)) ? 1 : 0
        onEdge(glass, WHITE, edge, 0, 0.88, SILL, HEAD, 0, 0.02)
        onEdge(trim, trimC, edge, 0, 1.0 + trimWidth, SILL - 0.05, SILL, outSide * 0.04, THICK + 0.1)
        onEdge(trim, trimC, edge, 0, 0.96 + trimWidth, HEAD, HEAD + trimWidth, 0, THICK + 0.04)
        for (const along of [-0.46, 0.46]) onEdge(trim, trimC, edge, along, trimWidth * 0.8, SILL, HEAD, 0, THICK + 0.04)
        const mid = (SILL + HEAD) / 2
        if (style.windowGrid === 'cross') {
          onEdge(trim, trimC, edge, 0, 0.03, SILL, HEAD, 0, 0.035)
          onEdge(trim, trimC, edge, 0, 0.88, mid - 0.015, mid + 0.015, 0, 0.035)
        } else if (style.windowGrid === 'colonial') {
          for (const a of [-0.15, 0.15]) onEdge(trim, trimC, edge, a, 0.025, SILL, HEAD, 0, 0.035)
          for (const y of [SILL + (HEAD - SILL) / 3, SILL + (HEAD - SILL) * 2 / 3]) onEdge(trim, trimC, edge, 0, 0.88, y - 0.012, y + 0.012, 0, 0.035)
        } else if (style.windowGrid === 'prairie') {
          for (const a of [-0.3, 0.3]) onEdge(trim, trimC, edge, a, 0.025, SILL, HEAD, 0, 0.035)
          for (const y of [SILL + 0.16, HEAD - 0.16]) onEdge(trim, trimC, edge, 0, 0.88, y - 0.012, y + 0.012, 0, 0.035)
        }
        if (outSide) {
          if (style.shutters !== 'none') for (const along of [-0.66, 0.66]) drawShutter(edge, along, outSide * (THICK / 2 + 0.025))
          if (style.windowBoxes) {
            onEdge(planters, hexRGB('#8a5d38'), edge, 0, 0.9, SILL - 0.28, SILL - 0.06, outSide * (THICK / 2 + 0.13), 0.22)
            for (let k = 0; k < 7; k++) onEdge(blooms, k % 3 === 1 ? leaf : bloomColors[k % bloomColors.length], edge, -0.36 + k * 0.12, 0.1, SILL - 0.08, SILL + 0.04 + (k % 2) * 0.04, outSide * (THICK / 2 + 0.13 + ((k % 3) - 1) * 0.04), 0.1)
          }
        }
        const curtainSide = outSide ? -outSide : 1
        for (const along of [-0.34, 0.34]) onEdge(curtains, hexRGB('#efe7d6'), edge, along, 0.22, SILL + 0.05, HEAD - 0.02, curtainSide * (THICK / 2 + 0.04), 0.025)
      }
      if (door) {
        if (height > DOOR_TOP) edgeBox(edge, 0, 1, DOOR_TOP, height, THICK)
        edgeBox(edge, 0, 0.06, 0, height, THICK)
        edgeBox(edge, 0.94, 1, 0, height, THICK)
      } else edgeBox(edge, 0, 1, 0, height, THICK)
    }
    const ends = new Map<string, { at: [number, number]; h: number; v: number }>()
    for (const [x, z, v] of home.walls) {
      for (const p of [[x, z], v === 0 ? [x + 1, z] : [x, z + 1]] as [number, number][]) {
        const k = `${p[0]},${p[1]}`
        const e = ends.get(k) ?? { at: p, h: 0, v: 0 }
        if (v === 0) e.h++
        else e.v++
        ends.set(k, e)
      }
    }
    for (const e of ends.values()) {
      if ((e.h === 2 && e.v === 0) || (e.v === 2 && e.h === 0)) continue
      const [px, pz] = e.at
      let height = 0
      for (const k of [edgeKey(px, pz, 0), edgeKey(px - 1, pz, 0), edgeKey(px, pz, 1), edgeKey(px, pz - 1, 1)]) height = Math.max(height, heights.get(k) ?? 0)
      if (!height) continue
      const s = style.cornerBoards ? (THICK + trimWidth + 0.05) / 2 : (THICK + 0.005) / 2
      if (style.cornerBoards) trim.box(px - s, 0, pz - s, px + s, height, pz + s, { color: trimC })
      else clad(style.upper).box(px - s, 0, pz - s, px + s, height, pz + s, { color: upper })
    }
  }

  // ------------------------------------------------------------ roof

  private roof(style: HouseStyle, roof: NonNullable<ReturnType<typeof buildRoof>>, at: GetBuilder) {
    const [kind, tile, gloss, metal] = ROOFING[style.roofMaterial]
    const roofUv = (x: number, z: number, nx: number, nz: number): [number, number] => {
      const l = Math.hypot(nx + 0.0001, nz + 0.0001)
      const dx = (nx + 0.0001) / l, dz = (nz + 0.0001) / l
      return [x * dz - z * dx, -(x * dx + z * dz)]
    }
    tris(at(this.tex(kind, tile, gloss, metal)), roof.roof, paint(style.roofColor), roofUv)
    tris(at(this.paintMat), roof.fascia, paint(style.trimColor), (x, z) => [x + z, 0])
    tris(at(this.mats.plain('hd-gutter', { color: 0xd9dcdf, gloss: 0.6, metal: 0.5 })), roof.gutters, WHITE, (x, z) => [x + z, 0])
    const [ck, ct] = CLADDING[style.upper]
    tris(at(this.tex(ck, ct)), roof.gables, paint(style.upperColor), (x, z) => [x + z, 0], true)
  }

  // ------------------------------------------------------------ features

  private features(home: FoxHome, grid: LotGrid, at: GetBuilder, solid: Collide, lotM: Matrix, roofShown: boolean, roofTop: number) {
    const style = home.style
    const trimC = paint(style.trimColor)
    const trim = this.paintMat
    const [rk, rt] = ROOFING[style.roofMaterial]
    const roofMat = this.tex(rk, Math.min(1.4, rt))
    const bulb = this.mats.glow('hd-bulb', 0xffd27a, 7)
    const overhang = roofOverhang(style)
    const eaveY = eaveHeight(style)
    const prism = new Part(at, lotM)
    const porches = home.features.filter((f) => f.kind === 'porch').map((f) => [Math.min(f.x, f.x2 ?? f.x), Math.min(f.z, f.z2 ?? f.z), Math.max(f.x, f.x2 ?? f.x), Math.max(f.z, f.z2 ?? f.z)] as const)
    for (const f of home.features) {
      const color = paint(f.color)
      if (f.kind === 'canopy' && f.v !== undefined) {
        const side = outsideSide(grid, [f.x, f.z, f.v])
        if (!side) continue
        const front: [number, number] = f.v === 0 ? [f.x, side > 0 ? f.z : f.z - 1] : [side > 0 ? f.x : f.x - 1, f.z]
        if (porches.some(([a, b, c, d]) => front[0] >= a && front[0] <= c && front[1] >= b && front[1] <= d)) continue
        const cx = f.v === 0 ? f.x + 0.5 : f.x, cz = f.v === 0 ? f.z : f.z + 0.5
        prism.frame(cx, cz, f.v === 0 ? (side > 0 ? 0 : Math.PI) : side * Math.PI / 2)
        const width = CANOPY_WIDTHS[(f.width ?? 1) - 1] ?? 1.4
        const base = grid.isDoor(f.x, f.z, f.v) ? 2.38 : 2.22
        const depth = f.style === 'awning' ? 1.0 : 0.95
        const t = 0.04
        const bracket = (along: number) => {
          prism.box(trim, trimC, along, base - 0.28, 0.12, 0.06, 0.06, 0.22)
          prism.box(trim, trimC, along, base - 0.18, depth * 0.42, 0.05, 0.05, depth * 0.95, Math.atan2(0.45, depth * 0.9))
        }
        switch (f.style) {
          case 'shed': {
            const slope = 0.32
            prism.box(roofMat, color, 0, base + 0.16, depth / 2 + 0.05, width, t * 2, depth + 0.1, slope)
            prism.box(trim, trimC, 0, base + 0.16 - Math.sin(slope) * (depth / 2 + 0.05) - 0.06, depth + 0.07, width + 0.02, 0.14, 0.04)
            bracket(-width / 2 + 0.1); bracket(width / 2 - 0.1)
            break
          }
          case 'gable': {
            const pitch = 0.6, half = width / 2, run = half / Math.cos(pitch)
            for (const s of [-1, 1]) prism.box(roofMat, color, s * half / 2, base + 0.22 + Math.tan(pitch) * half / 2, depth / 2 + 0.06, run + 0.06, t * 2, depth + 0.12, 0, 0, -s * pitch)
            prism.triangle(trim, trimC, half - 0.05, Math.tan(pitch) * (half - 0.05), base + 0.2, depth + 0.02, 0.04)
            prism.box(trim, trimC, 0, base + 0.16, depth / 2 + 0.06, width - 0.05, 0.1, depth + 0.06)
            bracket(-half + 0.1); bracket(half - 0.1)
            break
          }
          case 'arch':
            prism.arch(roofMat, color, width / 2, base + 0.1, 0, depth + 0.1)
            prism.box(trim, trimC, 0, base + 0.08, depth + 0.08, width + 0.04, 0.08, 0.06)
            bracket(-width / 2 + 0.1); bracket(width / 2 - 0.1)
            break
          case 'flat': {
            prism.box(this.mats.plain('hd-canopy-metal', { vcolor: true, gloss: 0.65, metal: 0.5 }), color, 0, base + 0.12, depth / 2 + 0.04, width, 0.09, depth + 0.08)
            for (const s of [-1, 1]) prism.cylinder(this.mats.plain('hd-iron', { color: 0x1f2124, gloss: 0.6, metal: 0.6 }), WHITE, s * (width / 2 - 0.12), base + 0.45, depth * 0.48, 0.022, Math.hypot(depth, 0.7), 0.022, -Math.atan2(depth, 0.7))
            break
          }
          case 'awning': {
            const slope = 0.55
            const fabric = this.tex('stripe', 0.9)
            prism.box(fabric, color, 0, base + 0.1, depth / 2, width, 0.02, depth / Math.cos(slope) + 0.02, slope)
            const lip = base + 0.1 - Math.tan(slope) * depth / 2
            prism.box(fabric, color, 0, lip - 0.11, depth + 0.01, width, 0.22, 0.015)
            for (const s of [-1, 1]) prism.cylinder(this.mats.plain('hd-iron', { color: 0x1f2124, gloss: 0.6, metal: 0.6 }), WHITE, s * (width / 2 - 0.03), lip + 0.05, depth / 2, 0.015, depth * 1.1, 0.015, Math.PI / 2 - slope)
            break
          }
        }
      } else if (f.kind === 'porch' || f.kind === 'pergola') {
        const x0 = Math.min(f.x, f.x2 ?? f.x), x1 = Math.max(f.x, f.x2 ?? f.x) + 1
        const z0 = Math.min(f.z, f.z2 ?? f.z), z1 = Math.max(f.z, f.z2 ?? f.z) + 1
        prism.frame(0, 0, 0)
        const wood = f.kind === 'pergola' ? this.tex('woodPanel', 0.9) : this.paintMat
        const count = (a: number, b: number) => Math.max(1, b - a)
        const run = (n: number, test: (i: number) => boolean) => { let k = 0; for (let i = 0; i < n; i++) if (test(i)) k++; return k }
        const sides: [string, number][] = [
          ['south', run(x1 - x0, (i) => grid.isWall(x0 + i, z0, 0)) / count(x0, x1)],
          ['north', run(x1 - x0, (i) => grid.isWall(x0 + i, z1, 0)) / count(x0, x1)],
          ['west', run(z1 - z0, (i) => grid.isWall(x0, z0 + i, 1)) / count(z0, z1)],
          ['east', run(z1 - z0, (i) => grid.isWall(x1, z0 + i, 1)) / count(z0, z1)],
        ]
        sides.sort((a, b) => b[1] - a[1])
        const house = f.kind === 'porch' && sides[0][1] > 0 ? sides[0][0] : null
        const posts: [number, number][] = []
        const along = (a: number, b: number) => {
          const n = Math.max(1, Math.ceil((b - a) / 3))
          return Array.from({ length: n + 1 }, (_, i) => a + 0.12 + (i / n) * (b - a - 0.24))
        }
        for (const x of along(x0, x1)) {
          if (house !== 'south') posts.push([x, z0 + 0.12])
          if (house !== 'north') posts.push([x, z1 - 0.12])
        }
        for (const z of along(z0, z1)) {
          if (house !== 'west') posts.push([x0 + 0.12, z])
          if (house !== 'east') posts.push([x1 - 0.12, z])
        }
        const unique = [...new Map(posts.map((p) => [`${p[0].toFixed(2)},${p[1].toFixed(2)}`, p])).values()]
        const porchHigh = Math.min(WALL_HEIGHT - 0.05, eaveY - 0.04)
        const porchLow = Math.max(2.28, porchHigh - 0.4)
        const postH = f.kind === 'pergola' ? 2.45 : porchLow - 0.2
        for (const [px, pz] of unique) {
          if (f.kind === 'porch' && f.style === 'round') prism.cylinder(wood, color, px, postH / 2, pz, 0.18, postH, 0.18)
          else if (f.kind === 'porch' && f.style === 'tapered') {
            prism.box(this.tex('stone', 1.2), hexRGB('#c9c2b6'), px, 0.45, pz, 0.32, 0.9, 0.32)
            prism.cylinder(wood, color, px, 0.9 + (postH - 0.9) / 2, pz, 0.24, postH - 0.9, 0.24, 0, 0.64)
          } else prism.box(wood, color, px, postH / 2, pz, 0.16, postH, 0.16)
          solid(px - 0.1, 0, pz - 0.1, px + 0.1, postH, pz + 0.1, true)
        }
        if (f.kind === 'porch') {
          const over = 0.28, tuck = Math.max(0, overhang - 0.08)
          const ex0 = x0 + (house === 'west' ? tuck : -over), ex1 = x1 + (house === 'east' ? -tuck : over)
          const ez0 = z0 + (house === 'south' ? tuck : -over), ez1 = z1 + (house === 'north' ? -tuck : over)
          const w = ex1 - ex0, d = ez1 - ez0
          const run2 = house === 'south' || house === 'north' ? d : house ? w : 0
          const slope = run2 ? Math.atan2(porchHigh - porchLow, run2) : 0
          const mid = (porchHigh + porchLow) / 2 + 0.05
          let rx = 0, rz = 0
          if (house === 'south') rx = slope
          if (house === 'north') rx = -slope
          if (house === 'west') rz = -slope
          if (house === 'east') rz = slope
          const slabW = house === 'west' || house === 'east' ? Math.hypot(w, porchHigh - porchLow) : w
          const slabD = house === 'south' || house === 'north' ? Math.hypot(d, porchHigh - porchLow) : d
          prism.box(roofMat, paint(style.roofColor), (ex0 + ex1) / 2, mid, (ez0 + ez1) / 2, slabW, 0.08, slabD, rx, 0, rz)
          prism.box(trim, hexRGB('#e9e4d8'), (ex0 + ex1) / 2, mid - 0.09, (ez0 + ez1) / 2, slabW - 0.05, 0.02, slabD - 0.05, rx, 0, rz)
          for (const [bx, bz, bw, bd] of [[(x0 + x1) / 2, z0 + 0.12, x1 - x0, 0.14], [(x0 + x1) / 2, z1 - 0.12, x1 - x0, 0.14], [x0 + 0.12, (z0 + z1) / 2, 0.14, z1 - z0], [x1 - 0.12, (z0 + z1) / 2, 0.14, z1 - z0]] as const) {
            prism.box(trim, trimC, bx, postH + 0.08, bz, bw, 0.18, bd)
          }
        } else {
          const alongX = x1 - x0 >= z1 - z0
          for (const s of [0, 1]) {
            if (alongX) prism.box(wood, color, (x0 + x1) / 2, postH + 0.1, s ? z1 - 0.12 : z0 + 0.12, x1 - x0 + 0.5, 0.2, 0.1)
            else prism.box(wood, color, s ? x1 - 0.12 : x0 + 0.12, postH + 0.1, (z0 + z1) / 2, 0.1, 0.2, z1 - z0 + 0.5)
          }
          const span = alongX ? x1 - x0 : z1 - z0
          for (let k = 0; k <= span / 0.4; k++) {
            const a = (alongX ? x0 : z0) + 0.05 + k * 0.4
            if (alongX) prism.box(wood, color, a, postH + 0.26, (z0 + z1) / 2, 0.06, 0.14, z1 - z0 + 0.4)
            else prism.box(wood, color, (x0 + x1) / 2, postH + 0.26, a, x1 - x0 + 0.4, 0.14, 0.06)
          }
          const strands = alongX ? [z0 + 0.12, z1 - 0.12] : [x0 + 0.12, x1 - 0.12]
          for (const line of strands) for (let k = 0; k <= span * 3; k++) {
            const a = (alongX ? x0 : z0) + k / 3
            const sag = Math.sin((k / (span * 3)) * Math.PI) * 0.18
            if (alongX) prism.ball(bulb, WHITE, a, postH - 0.05 - sag, line, 0.06)
            else prism.ball(bulb, WHITE, line, postH - 0.05 - sag, a, 0.06)
          }
        }
      } else if (f.kind === 'fence') {
        const iron = f.style === 'iron'
        const mat = iron ? this.mats.plain('hd-fence-iron', { vcolor: true, gloss: 0.62, metal: 0.5 }) : this.tex('woodPanel', 1.2)
        const boards = this.tex('boards', 1.6)
        for (const [ex, ez, v] of featureEdges(f)) {
          prism.frame(v === 0 ? ex + 0.5 : ex, v === 0 ? ez : ez + 0.5, v === 0 ? 0 : Math.PI / 2)
          const post = (h: number, size: number) => { for (const s of [-0.5, 0.5]) prism.box(mat, color, s, h / 2, 0, size, h, size) }
          let tall = 1.1
          switch (f.style) {
            case 'picket':
            case 'gate': {
              post(1.1, 0.1)
              for (const y of [0.3, 0.8]) prism.box(mat, color, 0, y, 0.04, 1, 0.07, 0.03)
              const span = f.style === 'gate' ? 0.82 : 0.9
              for (let k = 0; k < 7; k++) prism.box(mat, color, -span / 2 + 0.06 + k * (span - 0.12) / 6, 0.5, 0.06, 0.07, 0.95 + (f.style === 'picket' ? 0 : Math.sin((k / 6) * Math.PI) * 0.15), 0.02)
              if (f.style === 'gate') prism.box(mat, color, 0, 0.55, 0.075, 0.9, 0.06, 0.02, 0, 0, Math.atan2(0.5, 0.82))
              break
            }
            case 'privacy':
              tall = 1.9
              post(1.9, 0.12)
              prism.box(boards, color, 0, 0.95, 0, 0.98, 1.8, 0.04)
              prism.box(mat, color, 0, 1.88, 0, 1.04, 0.06, 0.1)
              break
            case 'iron':
              tall = 1.3
              post(1.3, 0.07)
              for (const y of [0.12, 1.15]) prism.box(mat, color, 0, y, 0, 1, 0.035, 0.025)
              for (let k = 0; k < 8; k++) {
                const x = -0.44 + k * 0.125
                prism.box(mat, color, x, 0.62, 0, 0.018, 1.2, 0.018)
                prism.ball(mat, color, x, 1.25, 0, 0.035)
              }
              break
            case 'rail':
              tall = 1.0
              post(1.0, 0.13)
              for (const y of [0.45, 0.85]) prism.cylinder(mat, color, 0, y, 0, 0.07, 1.0, 0.07, 0, 1, Math.PI / 2)
              break
          }
          if (f.style !== 'gate') {
            if (v === 0) solid(ex, 0, ez - 0.06, ex + 1, tall, ez + 0.06, true)
            else solid(ex - 0.06, 0, ez, ex + 0.06, tall, ez + 1, true)
          }
        }
      } else if (f.kind === 'chimney' && roofShown) {
        prism.frame(0, 0, 0)
        const from = WALL_HEIGHT - 0.3, to = roofTop + 0.95
        prism.box(this.tex('brick', 1.2), color, f.x + 0.5, (from + to) / 2, f.z + 0.5, 0.9, to - from, 0.9)
        prism.box(this.tex('concrete', 1), hexRGB('#bdb8ae'), f.x + 0.5, to + 0.06, f.z + 0.5, 1.04, 0.12, 1.04)
        for (const s of [-0.2, 0.2]) prism.cylinder(this.paintMat, hexRGB('#8a5a44'), f.x + 0.5 + s, to + 0.25, f.z + 0.5, 0.16, 0.3, 0.16)
      }
    }
  }
}

/** Unit primitives placed The Hood's way: a frame (position and yaw on the grid), then position, size and an XYZ turn. */
class Part {
  private frameM = Matrix.Identity()
  constructor(private readonly at: GetBuilder, private readonly lotM: Matrix) {}

  frame(x: number, z: number, yaw: number) {
    this.frameM = Matrix.RotationY(yaw).multiply(Matrix.Translation(x, 0, z))
  }

  private with(m: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number, draw: (mb: MeshBuilder) => void) {
    const mb = this.at(m)
    const local = Matrix.Scaling(sx, sy, sz).multiply(Matrix.RotationZ(rz)).multiply(Matrix.RotationY(ry)).multiply(Matrix.RotationX(rx)).multiply(Matrix.Translation(x, y, z))
    mb.transform(local.multiply(this.frameM).multiply(this.lotM))
    draw(mb)
    mb.transform(this.lotM)
  }

  box(m: Material, c: RGB, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    this.with(m, x, y, z, sx, sy, sz, rx, ry, rz, (mb) => mb.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, { color: c, uv: Math.max(sx, sy, sz) }))
  }

  /** A cylinder (radius 0.5 by height 1 scaled); `top` narrows the top (a tapered column). */
  cylinder(m: Material, c: RGB, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, top = 1, rz = 0) {
    this.with(m, x, y, z, sx, sy, sz, rx, 0, rz, (mb) => mb.cylinder(0, -0.5, 0, 0.5, 0.5 * top, 1, 12, true, c))
  }

  ball(m: Material, c: RGB, x: number, y: number, z: number, r: number) {
    this.with(m, x, y, z, 1, 1, 1, 0, 0, 0, (mb) => mb.blob(0, 0, 0, r, r, r, 1, 0, c, 2))
  }

  /** The gable end of a canopy: a triangle `half` wide each way and `rise` tall at `y`, `thick` deep at `z`. */
  triangle(m: Material, c: RGB, half: number, rise: number, y: number, z: number, thick: number) {
    this.with(m, 0, y, z, 1, 1, 1, 0, 0, 0, (mb) => {
      const pts: [number, number][] = [[-half, 0], [half, 0], [0, rise]]
      for (const [dz, n] of [[thick, 1], [0, -1]] as const) {
        const i = mb.vertexCount
        for (const [px, py] of pts) mb.vertex(px, py, dz, 0, 0, n, px, py, c)
        if (n > 0) mb.tri(i, i + 1, i + 2)
        else mb.tri(i, i + 2, i + 1)
      }
    })
  }

  /** A barrel-vault canopy: a half cylinder of radius `r` over x, its springing at `y`, from `z0` to `z1`. */
  arch(m: Material, c: RGB, r: number, y: number, z0: number, z1: number) {
    this.with(m, 0, y, 0, 1, 1, 1, 0, 0, 0, (mb) => {
      const seg = 16
      const base = mb.vertexCount
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI
        const nx = Math.cos(a), ny = Math.sin(a)
        mb.vertex(nx * r, ny * r, z0, nx, ny, 0, i / seg * Math.PI * r, z0, c)
        mb.vertex(nx * r, ny * r, z1, nx, ny, 0, i / seg * Math.PI * r, z1, c)
      }
      for (let i = 0; i < seg; i++) {
        const a = base + i * 2, b = a + 1, d = a + 2, e = a + 3
        mb.tri(a, d, b); mb.tri(b, d, e)
        mb.tri(a, b, d); mb.tri(b, e, d)
      }
    })
  }
}

/** Flat triangles, lit both sides, with UVs from `uv(x, z, nx, nz)` (and y as v when `wallV`). */
function tris(mb: MeshBuilder, list: number[], c: RGB, uv: (x: number, z: number, nx: number, nz: number) => [number, number], wallV = false) {
  for (let i = 0; i + 8 < list.length; i += 9) {
    const ax = list[i], ay = list[i + 1] + ROOF_BASE, az = list[i + 2]
    const bx = list[i + 3], by = list[i + 4] + ROOF_BASE, bz = list[i + 5]
    const cx = list[i + 6], cy = list[i + 7] + ROOF_BASE, cz = list[i + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az
    _v.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    const l = _v.length()
    if (l < 1e-9) continue
    const nx = _v.x / l, ny = _v.y / l, nz = _v.z / l
    for (const s of [1, -1]) {
      const k = mb.vertexCount
      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
        const [u, v] = uv(x, z, nx * s, nz * s)
        mb.vertex(x, y, z, nx * s, ny * s, nz * s, u, wallV ? y : v, c)
      }
      if (s > 0) mb.tri(k, k + 1, k + 2)
      else mb.tri(k, k + 2, k + 1)
    }
  }
}

/** Tile indices on The Hood's grid merged into rectangles (grid metres). */
function rects(tiles: Set<number>): { x0: number; z0: number; x1: number; z1: number }[] {
  const used = new Set<number>()
  const out: { x0: number; z0: number; x1: number; z1: number }[] = []
  const has = (x: number, z: number) => x >= 0 && x < W && tiles.has(x + z * W) && !used.has(x + z * W)
  for (const index of [...tiles].sort((a, b) => a - b)) {
    if (used.has(index)) continue
    const x = index % W, z = Math.floor(index / W)
    let x1 = x
    while (has(x1 + 1, z)) x1++
    let z1 = z
    outer: while (true) { for (let i = x; i <= x1; i++) if (!has(i, z1 + 1)) break outer; z1++ }
    for (let j = z; j <= z1; j++) for (let i = x; i <= x1; i++) used.add(i + j * W)
    out.push({ x0: x, z0: z, x1: x1 + 1, z1: z1 + 1 })
  }
  return out
}

