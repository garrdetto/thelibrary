/**
 * Montello's maps as clip-art tiles painted at the zoom they are shown at, so the corner map and the full map stay
 * sharp: flat ground colours with smooth edges and outlined shores and woods, every lidar tree as a crown, outlined
 * buildings with shadows, roads with casings and centre lines. Tiles are 128 px squares on a ladder of levels from a
 * quarter metre to 32 m a pixel; a view uses the finest level it needs, shows a coarser cached tile while a missing one
 * is painted (a few per frame), and the least recently used tiles are dropped. Map coordinates (x east, z north).
 */
import type { BuildingData, LotData, RoadData } from '../data/MapData'
import { treeUnits } from '../data/MapData'
import type { TelloLand } from '../region'
import { isBlocked } from '../world/Clearance'
import { ROAD_STYLE, ring } from './MapBase'

const TILE = 128
const PAD = 2
const FINEST = 0.25
const LEVELS = 8
const KEEP = 320
const BUCKET = 128

const COVER: readonly (readonly [number, number, number])[] = [
  [168, 196, 104],
  [150, 204, 104],
  [92, 150, 78],
  [140, 172, 118],
  [222, 202, 150],
  [190, 182, 166],
  [222, 200, 116],
  [92, 168, 216],
]
const WOODS = [88, 146, 74] as const
const WOODS_EDGE = [52, 98, 50] as const
const SHALLOW = [112, 186, 228] as const
const DEEP = [76, 154, 210] as const
const SHORE = [38, 96, 140] as const
const ROOFS = ['#d9866a', '#9aa6b2', '#c9a476', '#8aa0bd', '#b97d68', '#dcc49a', '#a0b08c']
const CROWNS: readonly { base: string; lit: string }[] = [
  { base: '#3f7a46', lit: '#5c9a5a' },
  { base: '#4f9446', lit: '#74b65e' },
  { base: '#7fae5a', lit: '#a5cc7c' },
]

interface Tile { canvas: HTMLCanvasElement; level: number }
export interface TileView { cx: number; cz: number; s: number; rot: number; W: number; H: number }

/** A per-feature bucket index (features listed in every 128 m bucket their box touches). */
class Buckets {
  private readonly cells = new Map<number, number[]>()

  constructor(private readonly x0: number, private readonly z0: number) {}

  add(i: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (let bx = Math.floor((minX - this.x0) / BUCKET); bx <= Math.floor((maxX - this.x0) / BUCKET); bx++) {
      for (let bz = Math.floor((minZ - this.z0) / BUCKET); bz <= Math.floor((maxZ - this.z0) / BUCKET); bz++) {
        const key = bx * 4096 + bz
        const list = this.cells.get(key)
        if (list) list.push(i)
        else this.cells.set(key, [i])
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, count: number): number[] {
    const seen = new Uint8Array(count)
    const out: number[] = []
    for (let bx = Math.floor((minX - this.x0) / BUCKET); bx <= Math.floor((maxX - this.x0) / BUCKET); bx++) {
      for (let bz = Math.floor((minZ - this.z0) / BUCKET); bz <= Math.floor((maxZ - this.z0) / BUCKET); bz++) {
        const list = this.cells.get(bx * 4096 + bz)
        if (!list) continue
        for (const i of list) {
          if (seen[i]) continue
          seen[i] = 1
          out.push(i)
        }
      }
    }
    return out.sort((a, b) => a - b)
  }
}

function boxOf(p: number[], pad: number): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let k = 0; k < p.length; k += 2) {
    if (p[k] < minX) minX = p[k]
    if (p[k] > maxX) maxX = p[k]
    if (p[k + 1] < minZ) minZ = p[k + 1]
    if (p[k + 1] > maxZ) maxZ = p[k + 1]
  }
  return [minX - pad, minZ - pad, maxX + pad, maxZ + pad]
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class MapTiles {
  private readonly cache = new Map<string, Tile>()
  private readonly roads: RoadData[]
  private readonly buildings: BuildingData[]
  private readonly lots: LotData[]
  private readonly pitches: { p: number[] }[]
  private readonly roadIndex: Buckets
  private readonly buildingIndex: Buckets
  private treeStart: Uint32Array | null = null
  private treeOrder: Uint32Array | null = null
  private readonly treeSide: number

  constructor(private readonly land: TelloLand) {
    const doc = land.doc
    this.roads = doc.roads
    this.buildings = doc.buildings.filter((b) => !isBlocked(land, b))
    this.lots = doc.lots
    this.pitches = doc.pitches ?? []
    this.roadIndex = new Buckets(land.x0, land.z0)
    this.roads.forEach((r, i) => this.roadIndex.add(i, ...boxOf(r.p, r.w * 1.5 + 4)))
    this.buildingIndex = new Buckets(land.x0, land.z0)
    this.buildings.forEach((b, i) => this.buildingIndex.add(i, ...boxOf(b.p, 2)))
    this.treeSide = Math.ceil(land.size / BUCKET)
  }

  /** The finest level a view drawn at `s` pixels a metre needs. */
  private levelFor(s: number): number {
    const mpp = 1 / Math.max(1e-6, s)
    return Math.max(0, Math.min(LEVELS - 1, Math.floor(Math.log2(mpp / FINEST) + 1e-9)))
  }

  /**
   * Draws the tiles under a view into `g` (already transformed so map x, -z land on the screen) and paints missing
   * ones for up to `budgetMs`. Returns true while some tile is still missing.
   */
  draw(g: CanvasRenderingContext2D, v: TileView, budgetMs: number): boolean {
    const land = this.land
    const level = this.levelFor(v.s)
    const mpp = FINEST * 2 ** level
    const span = TILE * mpp
    let hx: number, hz: number
    if (v.rot === 0) {
      hx = v.W / 2 / v.s
      hz = v.H / 2 / v.s
    } else {
      hx = hz = Math.hypot(v.W, v.H) / 2 / v.s
    }
    const count = Math.ceil(land.size / span)
    const ix0 = Math.max(0, Math.floor((v.cx - hx - land.x0) / span)), ix1 = Math.min(count - 1, Math.floor((v.cx + hx - land.x0) / span))
    const iz0 = Math.max(0, Math.floor((v.cz - hz - land.z0) / span)), iz1 = Math.min(count - 1, Math.floor((v.cz + hz - land.z0) / span))
    const want: { ix: number; iz: number; d: number }[] = []
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const mx = land.x0 + (ix + 0.5) * span, mz = land.z0 + (iz + 0.5) * span
        want.push({ ix, iz, d: Math.hypot(mx - v.cx, mz - v.cz) })
      }
    }
    want.sort((a, b) => a.d - b.d)
    const t0 = performance.now()
    let missing = false
    const bleed = 0.6 / v.s
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    for (const w of want) {
      const key = `${level}:${w.ix}:${w.iz}`
      let tile = this.cache.get(key)
      if (!tile && performance.now() - t0 < budgetMs) {
        tile = { canvas: this.paint(level, w.ix, w.iz), level }
        this.cache.set(key, tile)
      }
      const x = land.x0 + w.ix * span, z = land.z0 + w.iz * span
      if (tile) {
        this.cache.delete(key)
        this.cache.set(key, tile)
        const e = bleed / mpp
        g.drawImage(tile.canvas, PAD - e, PAD - e, TILE + 2 * e, TILE + 2 * e, x - bleed, -(z + span) - bleed, span + 2 * bleed, span + 2 * bleed)
        continue
      }
      missing = true
      this.drawCoarser(g, level, x, z, span)
    }
    this.trim(Math.max(KEEP, want.length + 64))
    return missing
  }

  /** Stands in a coarser cached tile's piece for a tile still to be painted. */
  private drawCoarser(g: CanvasRenderingContext2D, level: number, x: number, z: number, span: number): void {
    const land = this.land
    for (let up = level + 1; up < LEVELS; up++) {
      const upSpan = TILE * FINEST * 2 ** up
      const ix = Math.floor((x + span / 2 - land.x0) / upSpan), iz = Math.floor((z + span / 2 - land.z0) / upSpan)
      const tile = this.cache.get(`${up}:${ix}:${iz}`)
      if (!tile) continue
      const k = TILE / upSpan
      const sx = PAD + (x - (land.x0 + ix * upSpan)) * k
      const sy = PAD + (land.z0 + (iz + 1) * upSpan - (z + span)) * k
      g.drawImage(tile.canvas, sx, sy, span * k, span * k, x, -(z + span), span, span)
      return
    }
  }

  /** Drops the least recently used tiles beyond `keep`. */
  trim(keep = KEEP): void {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= keep) break
      this.cache.delete(key)
    }
  }

  private paint(level: number, ix: number, iz: number): HTMLCanvasElement {
    const land = this.land
    const mpp = FINEST * 2 ** level
    const span = TILE * mpp
    const N = TILE + 2 * PAD
    const left = land.x0 + ix * span - PAD * mpp
    const top = land.z0 + (iz + 1) * span + PAD * mpp
    const canvas = document.createElement('canvas')
    canvas.width = N
    canvas.height = N
    const g = canvas.getContext('2d')!
    this.paintLand(g, N, left, top, mpp)
    g.setTransform(1 / mpp, 0, 0, 1 / mpp, -left / mpp, top / mpp)
    g.scale(1, -1)
    const minX = left, maxX = left + N * mpp, maxZ = top, minZ = top - N * mpp
    if (mpp <= 1) this.paintTrees(g, minX, minZ, maxX, maxZ, mpp)
    this.paintVectors(g, minX, minZ, maxX, maxZ, mpp)
    return canvas
  }

  /** Ground cover, water, woods and hill shading, one pass over the tile's pixels, then outlines where they meet. */
  private paintLand(g: CanvasRenderingContext2D, N: number, left: number, top: number, mpp: number): void {
    const land = this.land
    const n = land.side
    const cell = land.cell
    const { cover, ground, water, canopy, play } = land.grids
    const seen = land.doc.limits.seen
    const img = g.createImageData(N, N)
    const data = img.data
    const mask = new Uint8Array(N * N)
    const groundAt = (i: number, j: number) => ground[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))]
    const wet = (k: number) => (water[k] !== 0 && water[k] > ground[k] ? water[k] - ground[k] : -60)
    const slope = (a: number, b: number) => (groundAt(a, b + 1) - groundAt(a, b - 1) - groundAt(a + 1, b) + groundAt(a - 1, b)) / (2 * cell)
    const pr = new Float32Array(4), dp = new Float32Array(4), cr = new Float32Array(4), sl = new Float32Array(4)
    const cv = new Uint8Array(4)
    let lastCell = -1
    let oneCover = true
    for (let py = 0; py < N; py++) {
      const z = top - (py + 0.5) * mpp
      const gz = Math.min(n - 1.0001, Math.max(0, (z - land.z0) / cell))
      const j = Math.floor(gz), fz = gz - j
      for (let px = 0; px < N; px++) {
        const x = left + (px + 0.5) * mpp
        const gx = Math.min(n - 1.0001, Math.max(0, (x - land.x0) / cell))
        const i = Math.floor(gx), fx = gx - i
        const k00 = j * n + i
        if (k00 !== lastCell) {
          lastCell = k00
          const ks = [k00, k00 + 1, k00 + n, k00 + n + 1]
          for (let q = 0; q < 4; q++) {
            const k = ks[q]
            pr[q] = play[k]
            dp[q] = wet(k)
            cr[q] = canopy[k] / 255
            cv[q] = cover[k] === 7 ? 3 : cover[k]
          }
          sl[0] = slope(i, j)
          sl[1] = slope(i + 1, j)
          sl[2] = slope(i, j + 1)
          sl[3] = slope(i + 1, j + 1)
          oneCover = cv[0] === cv[1] && cv[0] === cv[2] && cv[0] === cv[3]
        }
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz
        const o = (py * N + px) * 4
        const room = pr[0] * w00 + pr[1] * w10 + pr[2] * w01 + pr[3] * w11
        if (room * 2 <= -seen) continue
        const depth = dp[0] * w00 + dp[1] * w10 + dp[2] * w01 + dp[3] * w11
        let r: number, gg: number, b: number
        if (depth > 0) {
          const c = depth > 110 ? DEEP : SHALLOW
          r = c[0]; gg = c[1]; b = c[2]
          mask[py * N + px] = 2
        } else {
          const crown = cr[0] * w00 + cr[1] * w10 + cr[2] * w01 + cr[3] * w11
          let c: readonly number[]
          if (crown > 0.45) {
            c = WOODS
            mask[py * N + px] = 1
          } else if (oneCover) {
            c = COVER[cv[0]]
          } else {
            const ws = [w00, w10, w01, w11]
            let best = 0, bestW = -1
            for (let q = 0; q < 4; q++) {
              let sum = 0
              for (let t = 0; t < 4; t++) if (cv[t] === cv[q]) sum += ws[t]
              if (sum > bestW) {
                bestW = sum
                best = cv[q]
              }
            }
            c = COVER[best]
          }
          const shade = Math.max(0.86, Math.min(1.12, 1 + (sl[0] * w00 + sl[1] * w10 + sl[2] * w01 + sl[3] * w11) * 0.011))
          r = c[0] * shade; gg = c[1] * shade; b = c[2] * shade
        }
        const dim = room >= 0 ? 1 : 0.55
        data[o] = r * dim
        data[o + 1] = gg * dim
        data[o + 2] = b * dim
        data[o + 3] = 255
      }
    }
    const reach = mpp <= 0.5 ? 2 : 1
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const m = mask[py * N + px]
        if (m === 0) continue
        let edge = false
        for (let d = 1; d <= reach && !edge; d++) {
          const l = px - d >= 0 ? mask[py * N + px - d] : m
          const rr = px + d < N ? mask[py * N + px + d] : m
          const u = py - d >= 0 ? mask[(py - d) * N + px] : m
          const dn = py + d < N ? mask[(py + d) * N + px] : m
          edge = m === 2 ? l !== 2 || rr !== 2 || u !== 2 || dn !== 2 : l === 0 || rr === 0 || u === 0 || dn === 0
        }
        if (!edge) continue
        const o = (py * N + px) * 4
        if (data[o + 3] === 0) continue
        const c = m === 2 ? SHORE : WOODS_EDGE
        data[o] = c[0]
        data[o + 1] = c[1]
        data[o + 2] = c[2]
      }
    }
    g.putImageData(img, 0, 0)
  }

  /** Every lidar tree in the box as a little clip-art crown: a shadow, the crown and a lit side. */
  private paintTrees(g: CanvasRenderingContext2D, minX: number, minZ: number, maxX: number, maxZ: number, mpp: number): void {
    const land = this.land
    const { treeX, treeZ, treeS, treeH } = land.grids
    if (!treeX || !treeX.length) return
    const units = treeUnits(land.doc.frame)
    if (!this.treeOrder) this.indexTrees(units)
    const start = this.treeStart!, order = this.treeOrder!
    const side = this.treeSide
    const pad = 6
    const bx0 = Math.max(0, Math.floor((minX - pad - land.x0) / BUCKET)), bx1 = Math.min(side - 1, Math.floor((maxX + pad - land.x0) / BUCKET))
    const bz0 = Math.max(0, Math.floor((minZ - pad - land.z0) / BUCKET)), bz1 = Math.min(side - 1, Math.floor((maxZ + pad - land.z0) / BUCKET))
    const xs: number[] = [], zs: number[] = [], rs: number[] = [], ks: number[] = []
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = bz * side + bx
        for (let q = start[b]; q < start[b + 1]; q++) {
          const t = order[q]
          const x = land.x0 + treeX[t] / units, z = land.z0 + treeZ[t] / units
          if (x < minX - pad || x > maxX + pad || z < minZ - pad || z > maxZ + pad) continue
          xs.push(x)
          zs.push(z)
          rs.push(Math.max(1.4, Math.min(4.6, (treeH[t] / 4) * 0.17)))
          ks.push(Math.min(2, treeS[t] >> 6))
        }
      }
    }
    const shadow = Math.max(0.5, 0.9 * mpp)
    g.fillStyle = 'rgba(24,40,20,.35)'
    g.beginPath()
    for (let q = 0; q < xs.length; q++) {
      g.moveTo(xs[q] + shadow + rs[q], zs[q] - shadow)
      g.arc(xs[q] + shadow, zs[q] - shadow, rs[q], 0, Math.PI * 2)
    }
    g.fill()
    for (let kind = 0; kind < 3; kind++) {
      const look = CROWNS[kind]
      g.fillStyle = look.base
      g.strokeStyle = 'rgba(28,52,26,.85)'
      g.lineWidth = Math.max(0.18, 0.7 * mpp)
      g.beginPath()
      for (let q = 0; q < xs.length; q++) {
        if (ks[q] !== kind) continue
        g.moveTo(xs[q] + rs[q], zs[q])
        g.arc(xs[q], zs[q], rs[q], 0, Math.PI * 2)
      }
      g.fill()
      g.stroke()
      if (mpp > 0.5) continue
      g.fillStyle = look.lit
      g.beginPath()
      for (let q = 0; q < xs.length; q++) {
        if (ks[q] !== kind) continue
        const r = rs[q] * 0.5
        const cx = xs[q] - rs[q] * 0.28, cz = zs[q] + rs[q] * 0.28
        g.moveTo(cx + r, cz)
        g.arc(cx, cz, r, 0, Math.PI * 2)
      }
      g.fill()
    }
  }

  private indexTrees(units: number): void {
    const land = this.land
    const { treeX, treeZ } = land.grids
    const side = this.treeSide
    const cells = side * side
    const start = new Uint32Array(cells + 1)
    const bucketOf = (t: number) => {
      const bx = Math.min(side - 1, Math.floor(treeX[t] / units / BUCKET))
      const bz = Math.min(side - 1, Math.floor(treeZ[t] / units / BUCKET))
      return bz * side + bx
    }
    for (let t = 0; t < treeX.length; t++) start[bucketOf(t) + 1]++
    for (let b = 0; b < cells; b++) start[b + 1] += start[b]
    const fill = start.slice(0, cells)
    const order = new Uint32Array(treeX.length)
    for (let t = 0; t < treeX.length; t++) order[fill[bucketOf(t)]++] = t
    this.treeStart = start
    this.treeOrder = order
  }

  /** Lots, sports fields, roads, buildings and the city limits, drawn in map metres. */
  private paintVectors(g: CanvasRenderingContext2D, minX: number, minZ: number, maxX: number, maxZ: number, mpp: number): void {
    const land = this.land
    const px = (x: number) => x
    const pz = (z: number) => z
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.fillStyle = 'rgba(176,168,150,.8)'
    g.strokeStyle = 'rgba(86,80,70,.75)'
    g.lineWidth = Math.max(0.3, mpp)
    for (const lot of this.lots) {
      ring(g, lot.p, px, pz, true)
      g.stroke()
    }
    for (const pitch of this.pitches) {
      g.fillStyle = '#86c866'
      g.strokeStyle = '#f4f8ec'
      g.lineWidth = Math.max(0.4, mpp)
      ring(g, pitch.p, px, pz, true)
      g.stroke()
    }
    const roads = this.roadIndex.query(minX, minZ, maxX, maxZ, this.roads.length).map((i) => this.roads[i])
    const trace = (road: RoadData) => {
      g.beginPath()
      for (let k = 0; k < road.p.length; k += 2) {
        if (k === 0) g.moveTo(road.p[k], road.p[k + 1])
        else g.lineTo(road.p[k], road.p[k + 1])
      }
    }
    const minPx = (kind: number) => (kind <= 1 ? 2.6 : kind <= 3 ? 2 : 1.4)
    for (const pass of [0, 1]) {
      for (const kind of [5, 4, 3, 2, 1, 0]) {
        const style = ROAD_STYLE[kind]
        for (const road of roads) {
          if (road.k !== kind) continue
          const width = Math.max(road.w * style.scale, minPx(kind) * mpp)
          if (pass === 0) {
            g.strokeStyle = style.casing || 'rgba(90,80,64,.7)'
            g.lineWidth = width + Math.max(1.2, 2 * mpp)
          } else {
            g.strokeStyle = style.color
            g.lineWidth = width
          }
          trace(road)
          g.stroke()
        }
      }
    }
    if (mpp <= 0.5) {
      g.setLineDash([3, 4.5])
      g.lineWidth = Math.max(0.18, 1.2 * mpp)
      for (const road of roads) {
        if (road.k > 1) continue
        g.strokeStyle = road.k === 0 ? '#fffdf2' : '#d9b54a'
        trace(road)
        g.stroke()
      }
      g.setLineDash([])
    }
    const buildings = this.buildingIndex.query(minX, minZ, maxX, maxZ, this.buildings.length).map((i) => this.buildings[i])
    if (mpp <= 2) {
      const off = Math.max(0.8, 1.4 * mpp)
      g.save()
      g.translate(off, -off)
      g.fillStyle = 'rgba(20,16,10,.3)'
      for (const b of buildings) ring(g, b.p, px, pz, true)
      g.restore()
    }
    g.strokeStyle = 'rgba(44,32,22,.9)'
    g.lineWidth = Math.max(0.25, 0.9 * mpp)
    buildings.forEach((b, q) => {
      g.fillStyle = roofOf(b, q)
      ring(g, b.p, px, pz, true)
      g.stroke()
    })
    g.setLineDash([10 * mpp, 6 * mpp])
    g.strokeStyle = 'rgba(255,244,214,.85)'
    g.lineWidth = 2 * mpp
    ring(g, land.doc.limits.city, px, pz, false)
    g.stroke()
    g.setLineDash([])
  }
}

function roofOf(b: BuildingData, q: number): string {
  if (b.k === 'store') return '#e6a061'
  if (b.k === 'civic') return '#e8c766'
  if (b.k === 'industrial') return '#b4a8c8'
  if (b.k === 'church') return '#f3efe4'
  if (b.k === 'canopy') return '#d2d6da'
  const seed = Math.round((b.p[0] ?? q) * 7 + (b.p[1] ?? 0) * 13)
  const roof = ROOFS[Math.floor(hash(seed) * ROOFS.length)]
  return b.k === 'shed' || b.k === 'garage' ? lighten(roof) : roof
}

function lighten(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * 0.25)
  return `rgb(${mix((v >> 16) & 255)},${mix((v >> 8) & 255)},${mix(v & 255)})`
}
