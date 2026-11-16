import type { TelloLand } from '../../../modules-src/tello/region'
import type { Box } from '../../../modules-src/tello/edits/Geom'
import { COVER_RGB } from '../../../modules-src/tello/town/MapBase'
import { LAKE_LEVEL } from '../../../modules-src/foxlake/lake/Rebase'

export type BaseMode = 'map' | 'height'

export const TILE = 256

interface Tile { canvas: HTMLCanvasElement; used: number }

/** A tile's square on the map: level L samples every 2^L nodes, tile (ti, tj) counted from the south-west. */
export function tileBox(land: TelloLand, level: number, ti: number, tj: number): Box {
  const step = 1 << level
  const span = TILE * step * land.cell
  return { x0: land.x0 + ti * span, z0: land.z0 + tj * span, x1: land.x0 + (ti + 1) * span, z1: land.z0 + (tj + 1) * span }
}

/**
 * The shaded land under the vectors, in 256-pixel tiles at several levels of detail, painted on demand from the
 * working grids and repainted where edits change them.
 */
export class TileCache {
  mode: BaseMode = 'map'
  private tiles = new Map<string, Tile>()
  private queue: string[] = []
  private queued = new Set<string>()
  private clock = 0
  private land: TelloLand | null = null

  setLand(land: TelloLand | null): void {
    if (land !== this.land) {
      this.land = land
      this.clear()
    }
  }

  setMode(mode: BaseMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.clear()
  }

  clear(): void {
    this.tiles.clear()
    this.queue = []
    this.queued.clear()
  }

  /** Drops the tiles a changed area touches (they are painted again when next drawn). */
  invalidate(box: Box | 'all'): void {
    if (box === 'all') {
      this.markAllStale()
      return
    }
    const land = this.land
    if (!land) return
    for (const key of [...this.tiles.keys()]) {
      const [, l, i, j] = key.split(':')
      const b = tileBox(land, Number(l), Number(i), Number(j))
      if (b.x1 >= box.x0 && b.x0 <= box.x1 && b.z1 >= box.z0 && b.z0 <= box.z1) this.stale.add(key)
    }
  }

  /** Tiles to repaint; until they are, the old picture is shown. */
  private stale = new Set<string>()

  private markAllStale(): void {
    for (const key of this.tiles.keys()) this.stale.add(key)
  }

  key(level: number, ti: number, tj: number): string {
    return `${this.mode}:${level}:${ti}:${tj}`
  }

  /** The tile's picture if painted (stale or not); asks for it to be painted when missing or stale. */
  get(level: number, ti: number, tj: number): HTMLCanvasElement | null {
    const key = this.key(level, ti, tj)
    const tile = this.tiles.get(key)
    if (!tile || this.stale.has(key)) {
      if (!this.queued.has(key)) {
        this.queued.add(key)
        this.queue.push(key)
      }
    }
    if (tile) tile.used = ++this.clock
    return tile?.canvas ?? null
  }

  /** The tile's picture if painted, without asking for it. */
  peek(level: number, ti: number, tj: number): HTMLCanvasElement | null {
    return this.tiles.get(this.key(level, ti, tj))?.canvas ?? null
  }

  /** Paints waiting tiles for up to `ms`; true when any were painted. */
  paint(ms: number): boolean {
    const land = this.land
    if (!land || !this.queue.length) return false
    const until = performance.now() + ms
    let any = false
    while (this.queue.length && performance.now() < until) {
      const key = this.queue.pop()!
      this.queued.delete(key)
      const [mode, l, i, j] = key.split(':')
      if (mode !== this.mode) continue
      const old = this.tiles.get(key)
      const canvas = old?.canvas ?? document.createElement('canvas')
      paintTile(canvas, land, this.mode, Number(l), Number(i), Number(j))
      this.tiles.set(key, { canvas, used: ++this.clock })
      this.stale.delete(key)
      any = true
    }
    if (this.tiles.size > 260) {
      const list = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used)
      for (const [k] of list.slice(0, this.tiles.size - 220)) {
        this.tiles.delete(k)
        this.stale.delete(k)
      }
    }
    return any
  }

  get pending(): number {
    return this.queue.length
  }
}

const RAMP: [number, [number, number, number]][] = [
  [-12, [38, 70, 104]],
  [-0.01, [86, 128, 150]],
  [0, [116, 150, 86]],
  [8, [146, 168, 92]],
  [18, [196, 186, 112]],
  [30, [176, 134, 84]],
  [45, [150, 112, 92]],
  [60, [236, 232, 226]],
]

function ramp(h: number): [number, number, number] {
  if (h <= RAMP[0][0]) return RAMP[0][1]
  for (let k = 1; k < RAMP.length; k++) {
    if (h <= RAMP[k][0]) {
      const [h0, c0] = RAMP[k - 1]
      const [h1, c1] = RAMP[k]
      const t = (h - h0) / (h1 - h0 || 1)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
    }
  }
  return RAMP[RAMP.length - 1][1]
}

function paintTile(canvas: HTMLCanvasElement, land: TelloLand, mode: BaseMode, level: number, ti: number, tj: number): void {
  canvas.width = TILE
  canvas.height = TILE
  const g = canvas.getContext('2d')!
  const img = g.createImageData(TILE, TILE)
  const d = img.data
  const n = land.side
  const { ground, water, cover, canopy, play } = land.grids
  const step = 1 << level
  const seen = land.doc.limits.seen
  const lake = LAKE_LEVEL * 100
  const interval = (level === 0 ? 1 : level === 1 ? 2 : level === 2 ? 5 : 10) * 100
  const at = (i: number, j: number) => Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))
  for (let py = 0; py < TILE; py++) {
    const j = tj * TILE * step + (TILE - 1 - py) * step
    for (let px = 0; px < TILE; px++) {
      const i = ti * TILE * step + px * step
      const o = (py * TILE + px) * 4
      if (i >= n || j >= n || i < 0 || j < 0) { d[o + 3] = 0; continue }
      const k = j * n + i
      const gk = ground[k]
      const e = ground[at(i + step, j)] - ground[at(i - step, j)]
      const s = ground[at(i, j + step)] - ground[at(i, j - step)]
      const shade = Math.max(0.62, Math.min(1.32, 1 + ((s - e) * 0.0019) / step))
      const wet = water[k] !== 0 && water[k] > gk
      let r: number, gg: number, b: number
      if (mode === 'height') {
        ;[r, gg, b] = ramp((gk - lake) / 100)
        r *= shade; gg *= shade; b *= shade
        if (wet) {
          const depth = Math.min(1, (water[k] - gk) / 400)
          r = r * 0.35 + (70 - depth * 30) * 0.65; gg = gg * 0.35 + (120 - depth * 40) * 0.65; b = b * 0.35 + (170 - depth * 20) * 0.65
        }
        const right = ground[at(i + step, j)], up = ground[at(i, j + step)]
        const band = Math.floor(gk / interval)
        if (band !== Math.floor(right / interval) || band !== Math.floor(up / interval)) {
          const major = Math.floor(Math.max(gk, right, up) / interval) % 5 === 0
          const f = major ? 0.55 : 0.75
          r *= f; gg *= f; b *= f
        }
      } else {
        const c = COVER_RGB[cover[k]] ?? COVER_RGB[0]
        r = c[0]; gg = c[1]; b = c[2]
        if (wet) {
          const depth = Math.min(1, (water[k] - gk) / 300)
          r = 86 - depth * 38; gg = 128 - depth * 44; b = 150 - depth * 30
        } else {
          const f = canopy[k] / 255
          r += (64 - r) * f * 0.6; gg += (98 - gg) * f * 0.6; b += (56 - b) * f * 0.6
          r *= shade; gg *= shade; b *= shade
        }
      }
      const p = play[k] * 2
      const dim = p >= 0 ? 1 : 0.55
      d[o] = r * dim
      d[o + 1] = gg * dim
      d[o + 2] = b * dim
      d[o + 3] = p > -seen ? 255 : 90
    }
  }
  g.putImageData(img, 0, 0)
}
