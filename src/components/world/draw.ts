import type { BuildingData, MapDoc, RoadData } from '../../../modules-src/tello/data/MapData'
import type { TelloLand } from '../../../modules-src/tello/region'
import type { Shape, WallStyle, WorldExtras } from '../../../modules-src/tello/edits/WorldEdits'
import { treeUnits } from '../../../modules-src/tello/data/MapData'
import { ROAD_STYLE, buildingFill } from '../../../modules-src/tello/town/MapBase'
import { boxOf } from './hit'

export interface View { cx: number; cz: number; s: number; w: number; h: number }

export const toSX = (v: View, x: number) => (x - v.cx) * v.s + v.w / 2
export const toSY = (v: View, z: number) => (v.cz - z) * v.s + v.h / 2
export const toMX = (v: View, px: number) => (px - v.w / 2) / v.s + v.cx
export const toMZ = (v: View, py: number) => v.cz - (py - v.h / 2) / v.s

export function viewBox(v: View, pad = 0): [number, number, number, number] {
  return [toMX(v, -pad), toMZ(v, v.h + pad), toMX(v, v.w + pad), toMZ(v, -pad)]
}

function visible(box: [number, number, number, number], vb: [number, number, number, number]): boolean {
  return box[2] >= vb[0] && box[0] <= vb[2] && box[3] >= vb[1] && box[1] <= vb[3]
}

export function tracePath(g: CanvasRenderingContext2D, v: View, p: ArrayLike<number>, close = false): void {
  g.beginPath()
  for (let k = 0; k + 1 < p.length; k += 2) {
    const x = toSX(v, p[k]), y = toSY(v, p[k + 1])
    if (k === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  if (close) g.closePath()
}

const boxCache = new WeakMap<object, [number, number, number, number]>()
function cachedBox(o: { p: number[] }, pad = 0): [number, number, number, number] {
  let b = boxCache.get(o)
  if (!b || (b as unknown as { src?: number[] }).src !== o.p) {
    const raw = boxOf(o.p)
    b = [raw[0] - pad, raw[1] - pad, raw[2] + pad, raw[3] + pad]
    ;(b as unknown as { src?: number[] }).src = o.p
    boxCache.set(o, b)
  }
  return b
}

export interface DrawLayers { roads: boolean; buildings: boolean; lots: boolean; trees: boolean; extras: boolean; labels: boolean }

/** Roads, lots, bridges, buildings and the edit extras, culled to the view. */
export function drawVectors(g: CanvasRenderingContext2D, v: View, land: TelloLand, layers: DrawLayers, blocked: Set<string>, trees: TreeIndex | null): void {
  const doc = land.doc
  const vb = viewBox(v, 20)
  if (layers.lots) {
    g.fillStyle = 'rgba(92,90,86,.78)'
    g.strokeStyle = 'rgba(40,40,40,.55)'
    g.lineWidth = 1
    for (const lot of doc.lots) {
      if (!visible(cachedBox(lot), vb)) continue
      tracePath(g, v, lot.p, true)
      g.fill()
      if (v.s > 0.6) g.stroke()
    }
  }
  if (layers.roads) drawRoads(g, v, doc, vb)
  if (layers.buildings) {
    g.lineWidth = Math.max(0.5, Math.min(1.2, v.s * 0.4))
    for (const b of doc.buildings) {
      if (b.x || !visible(cachedBox(b), vb)) continue
      const hidden = b.id ? blocked.has(b.id) : false
      tracePath(g, v, b.p, true)
      if (hidden) {
        g.setLineDash([3, 3])
        g.strokeStyle = 'rgba(200,60,60,.8)'
        g.stroke()
        g.setLineDash([])
        continue
      }
      g.fillStyle = b.rc ?? buildingFill(b.k)
      g.fill()
      g.strokeStyle = 'rgba(30,26,22,.65)'
      g.stroke()
    }
  }
  if (layers.trees && trees && v.s >= 0.45) trees.draw(g, v, vb)
  if (layers.extras && doc.extras) drawExtras(g, v, doc.extras, vb)
  if (layers.labels && v.s >= 0.9) drawLabels(g, v, doc, vb)
}

function drawRoads(g: CanvasRenderingContext2D, v: View, doc: MapDoc, vb: [number, number, number, number]): void {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const small = v.s < 0.18
  for (const pass of [0, 1]) {
    for (const kind of [5, 4, 3, 2, 1, 0]) {
      if (small && kind >= 2) continue
      const style = ROAD_STYLE[kind]
      if (pass === 0 && !style.casing) continue
      g.strokeStyle = pass === 0 ? style.casing : style.color
      for (const r of doc.roads) {
        if (r.k !== kind || !visible(cachedBox(r, r.w), vb)) continue
        g.lineWidth = Math.max(kind >= 4 ? 0.8 : 1.4, r.w * v.s) + (pass === 0 ? 2 : 0)
        tracePath(g, v, r.p)
        g.stroke()
      }
    }
  }
  g.strokeStyle = 'rgba(60,60,64,.9)'
  for (const b of doc.bridges) {
    g.lineWidth = Math.max(2, (b.w + 2) * v.s)
    tracePath(g, v, b.p)
    g.stroke()
    g.strokeStyle = 'rgba(214,210,200,.95)'
    g.lineWidth = Math.max(1, b.w * v.s)
    g.stroke()
    g.strokeStyle = 'rgba(60,60,64,.9)'
  }
}

export const WALL_COLOR: Record<WallStyle, string> = { brick: '#9c3d2c', stone: '#8a8172', block: '#b8b4aa', wood: '#7a5a3a', iron: '#1d1d1f' }

export function drawExtras(g: CanvasRenderingContext2D, v: View, x: WorldExtras, vb: [number, number, number, number]): void {
  g.lineCap = 'butt'
  for (const w of x.walls) {
    const box = boxOf(w.pts)
    if (!visible([box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2], vb)) continue
    g.strokeStyle = WALL_COLOR[w.style]
    g.lineWidth = Math.max(2, w.th * v.s * 1.4)
    tracePath(g, v, w.pts, w.closed)
    g.stroke()
  }
  for (const r of x.rails) {
    g.strokeStyle = '#d9dde0'
    g.lineWidth = Math.max(1.5, 0.4 * v.s)
    tracePath(g, v, r.pts)
    g.stroke()
    g.strokeStyle = '#4c5256'
    g.lineWidth = 1
    g.stroke()
  }
  for (const l of x.lights) {
    if (l.x < vb[0] || l.x > vb[2] || l.z < vb[1] || l.z > vb[3]) continue
    const px = toSX(v, l.x), py = toSY(v, l.z)
    const arm = Math.max(5, (l.style === 'acorn' ? 0.6 : 2.2) * v.s)
    g.strokeStyle = '#2a2c30'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(px, py)
    g.lineTo(px + Math.cos(l.yaw) * arm, py - Math.sin(l.yaw) * arm)
    if (l.style === 'double') {
      g.moveTo(px, py)
      g.lineTo(px - Math.cos(l.yaw) * arm, py + Math.sin(l.yaw) * arm)
    }
    g.stroke()
    g.fillStyle = '#ffd34d'
    g.strokeStyle = '#3a3010'
    g.beginPath()
    g.arc(px, py, Math.max(2.5, 0.35 * v.s), 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }
}

function drawLabels(g: CanvasRenderingContext2D, v: View, doc: MapDoc, vb: [number, number, number, number]): void {
  g.font = '600 11px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const done = new Set<string>()
  for (const r of doc.roads) {
    if (!r.n || r.k > 1 || done.has(r.n) || r.p.length < 4) continue
    const box = cachedBox(r)
    if (!visible(box, vb)) continue
    const mid = (r.p.length / 2) >> 1
    const k = Math.max(0, Math.min(r.p.length - 4, mid * 2))
    const x = (r.p[k] + r.p[k + 2]) / 2, z = (r.p[k + 1] + r.p[k + 3]) / 2
    if (x < vb[0] || x > vb[2] || z < vb[1] || z > vb[3]) continue
    done.add(r.n)
    let a = Math.atan2(-(r.p[k + 3] - r.p[k + 1]), r.p[k + 2] - r.p[k])
    if (a > Math.PI / 2) a -= Math.PI
    if (a < -Math.PI / 2) a += Math.PI
    g.save()
    g.translate(toSX(v, x), toSY(v, z))
    g.rotate(a)
    g.lineWidth = 3
    g.strokeStyle = 'rgba(255,255,255,.85)'
    g.strokeText(r.n, 0, 0)
    g.fillStyle = '#2b2b2b'
    g.fillText(r.n, 0, 0)
    g.restore()
  }
}

// ---------------------------------------------------------------- highlights

export function highlightRoad(g: CanvasRenderingContext2D, v: View, r: RoadData, color = '#22b8ff'): void {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = color
  g.globalAlpha = 0.55
  g.lineWidth = Math.max(6, r.w * v.s + 6)
  tracePath(g, v, r.p)
  g.stroke()
  g.globalAlpha = 1
  g.lineWidth = 1.5
  g.stroke()
}

export function highlightRing(g: CanvasRenderingContext2D, v: View, p: ArrayLike<number>, color = '#22b8ff'): void {
  tracePath(g, v, p, true)
  g.fillStyle = color + '44'
  g.fill()
  g.strokeStyle = color
  g.lineWidth = 2
  g.stroke()
}

export function highlightBuilding(g: CanvasRenderingContext2D, v: View, b: BuildingData, color = '#22b8ff'): void {
  highlightRing(g, v, b.p, color)
}

/** A shape outline: a brush path with its radius and fade, or an area. */
export function drawShape(g: CanvasRenderingContext2D, v: View, shape: Shape, falloff: number, color: string, fill = true): void {
  if (shape.k === 'area') {
    tracePath(g, v, shape.ring, true)
    if (fill) {
      g.fillStyle = color + '33'
      g.fill()
    }
    g.strokeStyle = color
    g.lineWidth = 1.5
    g.stroke()
    if (falloff > 0) {
      g.setLineDash([4, 4])
      g.strokeStyle = color + 'aa'
      g.lineWidth = Math.max(1, falloff * v.s * 2)
      g.globalAlpha = 0.18
      g.stroke()
      g.globalAlpha = 1
      g.setLineDash([])
    }
    return
  }
  const p = shape.pts.length >= 4 ? shape.pts : [shape.pts[0], shape.pts[1], shape.pts[0] + 0.001, shape.pts[1]]
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (falloff > 0) {
    tracePath(g, v, p)
    g.strokeStyle = color
    g.globalAlpha = 0.12
    g.lineWidth = (shape.r + falloff) * 2 * v.s
    g.stroke()
    g.globalAlpha = 1
  }
  tracePath(g, v, p)
  g.strokeStyle = color
  g.globalAlpha = fill ? 0.3 : 0.15
  g.lineWidth = Math.max(2, shape.r * 2 * v.s)
  g.stroke()
  g.globalAlpha = 1
}

export function drawCursorRing(g: CanvasRenderingContext2D, v: View, x: number, z: number, r: number, falloff: number, color: string): void {
  const px = toSX(v, x), py = toSY(v, z)
  g.strokeStyle = color
  g.lineWidth = 1.5
  g.beginPath()
  g.arc(px, py, Math.max(2, r * v.s), 0, Math.PI * 2)
  g.stroke()
  if (falloff > 0) {
    g.setLineDash([4, 4])
    g.beginPath()
    g.arc(px, py, (r + falloff) * v.s, 0, Math.PI * 2)
    g.stroke()
    g.setLineDash([])
  }
}

export function drawHandles(g: CanvasRenderingContext2D, v: View, pts: ArrayLike<number>, active = -1, color = '#ffffff'): void {
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const x = toSX(v, pts[k]), y = toSY(v, pts[k + 1])
    g.beginPath()
    g.arc(x, y, k / 2 === active ? 6 : 4.5, 0, Math.PI * 2)
    g.fillStyle = k / 2 === active ? '#ffcf3d' : color
    g.fill()
    g.strokeStyle = '#1a1a1a'
    g.lineWidth = 1.5
    g.stroke()
  }
}

// ---------------------------------------------------------------- trees

const TREE_CELL = 64
const TREE_COLOR = ['#2f5a34', '#4f7a35', '#9db06a']

/** Every tree by 64 m cell, drawn as dots when zoomed in. */
export class TreeIndex {
  private cells = new Map<number, number[]>()
  private readonly units: number

  constructor(readonly land: TelloLand) {
    const { treeX, treeZ } = land.grids
    this.units = treeUnits(land.frame)
    for (let i = 0; i < treeX.length; i++) {
      const x = land.x0 + treeX[i] / this.units, z = land.z0 + treeZ[i] / this.units
      const k = this.key(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL))
      const list = this.cells.get(k)
      if (list) list.push(i)
      else this.cells.set(k, [i])
    }
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768)
  }

  get count(): number {
    return this.land.grids.treeX.length
  }

  draw(g: CanvasRenderingContext2D, v: View, vb: [number, number, number, number]): void {
    const { treeX, treeZ, treeS, treeH } = this.land.grids
    const big = v.s >= 1.6
    let drawn = 0
    for (let ci = Math.floor(vb[0] / TREE_CELL); ci <= Math.floor(vb[2] / TREE_CELL); ci++) {
      for (let cj = Math.floor(vb[1] / TREE_CELL); cj <= Math.floor(vb[3] / TREE_CELL); cj++) {
        const list = this.cells.get(this.key(ci, cj))
        if (!list) continue
        for (const i of list) {
          const kind = Math.min(2, treeS[i] >> 6)
          const x = toSX(v, this.land.x0 + treeX[i] / this.units), y = toSY(v, this.land.z0 + treeZ[i] / this.units)
          const r = big ? Math.max(1.5, (treeH[i] / 4) * 0.18 * v.s) : 1.6
          g.fillStyle = TREE_COLOR[kind]
          g.beginPath()
          g.arc(x, y, r, 0, Math.PI * 2)
          g.fill()
          if (++drawn > 60000) return
        }
      }
    }
  }
}
