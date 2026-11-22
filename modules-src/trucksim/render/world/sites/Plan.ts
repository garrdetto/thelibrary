/**
 * Planning of a site's buildings. A `SitePlanner` takes pieces (a building, a tank, a canopy, a fence run) as a position, a
 * quarter-turn and a size, and accepts one only when it lies inside the site, keeps every work zone and its equipment spot
 * clear by `ZONE_MARGIN` metres, keeps a 14 m drive lane from the nearest road to each zone clear, stays off the site's roads
 * and does not touch a piece already placed. Reefer docks keep their margin on every side except the building side, where
 * the warehouse face sits exactly on the dock line. `scan` searches the site on a grid for the first free spot. The plan is
 * pure data (no Babylon objects), so physics boxes and tests read it without a scene.
 */

import type { Site, Zone } from '../../../shared/WorldLayout'
import { ROADS } from '../../../shared/WorldLayout'
import type { Terrain } from '../../../shared/Terrain'
import type { StaticBox } from '../../../sim/SimWorld'
import { SceneryBatch } from '../../lots/Batch'
import type { UvRect } from '../../lots/Batch'
import type { LocalBox } from '../../lots/Items'

export const ZONE_MARGIN = 6
export const LANE_WIDTH = 14
export const ROAD_MARGIN = 3
export const PIECE_GAP = 2

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/** What a piece's drawing needs from the layer: the sign atlas. */
export interface DrawEnv {
  sign(text: string): UvRect | null
}

export type PieceBuild = (b: SceneryBatch, env: DrawEnv) => LocalBox[]

export interface Piece {
  name: string
  x: number
  z: number
  rot: 0 | 1 | 2 | 3
  ground: number
  areas: Rect[]
  boxes: StaticBox[]
  build: PieceBuild
  overhead: boolean
}

export interface PlaceSpec {
  name: string
  x: number
  z: number
  rot?: 0 | 1 | 2 | 3
  wl: number
  dl: number
  build: PieceBuild
  solid?: boolean
  overhead?: boolean
  areas?: Rect[]
  gap?: number
  quiet?: boolean
}

export interface ScanSpec extends Omit<PlaceSpec, 'x' | 'z'> {
  region?: Rect
  near?: readonly [number, number]
  far?: readonly [number, number]
  step?: number
}

interface Strip {
  ax: number
  az: number
  bx: number
  bz: number
  half: number
}

const STUB_ENV: DrawEnv = { sign: () => null }

function overlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap
}

/** True when an axis-aligned rectangle touches a strip (a rotated rectangle along a segment). */
export function rectHitsStrip(rect: Rect, strip: Strip): boolean {
  const dx = strip.bx - strip.ax
  const dz = strip.bz - strip.az
  const length = Math.hypot(dx, dz)
  const cx = (strip.ax + strip.bx) / 2
  const cz = (strip.az + strip.bz) / 2
  const rx = (rect.x1 - rect.x0) / 2
  const rz = (rect.z1 - rect.z0) / 2
  const rcx = (rect.x0 + rect.x1) / 2
  const rcz = (rect.z0 + rect.z1) / 2
  const ux = length > 1e-9 ? dx / length : 1
  const uz = length > 1e-9 ? dz / length : 0
  const nx = -uz
  const nz = ux
  const half = length / 2
  const axes: [number, number][] = [[1, 0], [0, 1], [ux, uz], [nx, nz]]
  for (const [ax, az] of axes) {
    const rr = rx * Math.abs(ax) + rz * Math.abs(az)
    const sr = half * Math.abs(ux * ax + uz * az) + strip.half * Math.abs(nx * ax + nz * az)
    if (Math.abs((rcx - cx) * ax + (rcz - cz) * az) > rr + sr) return false
  }
  return true
}

/** The nearest point of any road to (x, z). */
export function nearestRoadPoint(x: number, z: number): { x: number; z: number; distance: number } {
  let best = { x: 0, z: 0, distance: Infinity }
  for (const road of ROADS) {
    const count = road.loop ? road.points.length : road.points.length - 1
    for (let i = 0; i < count; i++) {
      const [ax, az] = road.points[i]
      const [bx, bz] = road.points[(i + 1) % road.points.length]
      const ex = bx - ax
      const ez = bz - az
      const length2 = ex * ex + ez * ez
      const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / length2)) : 0
      const px = ax + ex * t
      const pz = az + ez * t
      const distance = Math.hypot(px - x, pz - z)
      if (distance < best.distance) best = { x: px, z: pz, distance }
    }
  }
  return best
}

function footprint(x: number, z: number, rot: number, wl: number, dl: number): Rect {
  const odd = rot % 2 === 1
  const hx = (odd ? dl : wl) / 2
  const hz = (odd ? wl : dl) / 2
  return { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz }
}

function worldBox(local: LocalBox, rot: number, x: number, z: number, ground: number): StaticBox {
  let lx = local.x
  let lz = local.z
  if (rot === 1) {
    lx = local.z
    lz = -local.x
  } else if (rot === 2) {
    lx = -local.x
    lz = -local.z
  } else if (rot === 3) {
    lx = -local.z
    lz = local.x
  }
  const odd = rot % 2 === 1
  return { x: x + lx, y: ground + local.y, z: z + lz, hx: odd ? local.hz : local.hx, hy: local.hy, hz: odd ? local.hx : local.hz }
}

/** The clear rectangle around a zone: `ZONE_MARGIN` on every side, none on the building side of a reefer dock. */
export function zoneKeepout(zone: Zone): Rect {
  const rect = { x0: zone.x - zone.w / 2 - ZONE_MARGIN, z0: zone.z - zone.d / 2 - ZONE_MARGIN, x1: zone.x + zone.w / 2 + ZONE_MARGIN, z1: zone.z + zone.d / 2 + ZONE_MARGIN }
  if (zone.dock) {
    if (zone.dock.z >= zone.z) rect.z1 = zone.z + zone.d / 2
    else rect.z0 = zone.z - zone.d / 2
  }
  return rect
}

/** Accepts or rejects pieces for one site and remembers what was placed. */
export class SitePlanner {
  readonly pieces: Piece[] = []
  readonly rejected: string[] = []
  readonly keepouts: Rect[] = []
  readonly lanes: Strip[] = []
  readonly roads: Strip[] = []
  readonly bounds: Rect

  constructor(readonly site: Site, private readonly terrain: Terrain) {
    this.bounds = { x0: site.x - site.w / 2, z0: site.z - site.d / 2, x1: site.x + site.w / 2, z1: site.z + site.d / 2 }
    for (const zone of site.zones) {
      this.keepouts.push(zoneKeepout(zone))
      if (zone.equipment) this.keepouts.push({ x0: zone.equipment.x - 5, z0: zone.equipment.z - 5, x1: zone.equipment.x + 5, z1: zone.equipment.z + 5 })
      const entry = nearestRoadPoint(zone.x, zone.z)
      if (entry.distance > 1) this.lanes.push({ ax: entry.x, az: entry.z, bx: zone.x, bz: zone.z, half: LANE_WIDTH / 2 })
    }
    const reach = { x0: this.bounds.x0 - 20, z0: this.bounds.z0 - 20, x1: this.bounds.x1 + 20, z1: this.bounds.z1 + 20 }
    for (const road of ROADS) {
      const count = road.loop ? road.points.length : road.points.length - 1
      for (let i = 0; i < count; i++) {
        const [ax, az] = road.points[i]
        const [bx, bz] = road.points[(i + 1) % road.points.length]
        const strip = { ax, az, bx, bz, half: road.width / 2 + ROAD_MARGIN }
        if (rectHitsStrip(reach, strip)) this.roads.push(strip)
      }
    }
  }

  /** The ground height under a point. */
  groundAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z)
  }

  /** True when the rectangle could hold a piece: inside the site, off zones, lanes and roads, clear of other pieces. */
  fits(areas: readonly Rect[], overhead: boolean, gap: number): boolean {
    for (const area of areas) {
      if (area.x0 < this.bounds.x0 - 0.01 || area.z0 < this.bounds.z0 - 0.01 || area.x1 > this.bounds.x1 + 0.01 || area.z1 > this.bounds.z1 + 0.01) return false
      for (const keep of this.keepouts) if (overlap(area, keep)) return false
      for (const lane of this.lanes) if (rectHitsStrip(area, lane)) return false
      for (const road of this.roads) if (rectHitsStrip(area, road)) return false
      for (const piece of this.pieces) for (const other of piece.areas) if (overlap(area, other, overhead || piece.overhead ? 0 : gap)) return false
    }
    return true
  }

  /** Places one piece if it fits; rejected pieces are only recorded. */
  place(spec: PlaceSpec): boolean {
    const rot = spec.rot ?? 0
    const areas = spec.areas ?? [footprint(spec.x, spec.z, rot, spec.wl, spec.dl)]
    if (!this.fits(areas, spec.overhead === true, spec.gap ?? PIECE_GAP)) {
      if (spec.quiet !== true) this.rejected.push(spec.name)
      return false
    }
    const ground = this.groundAt(spec.x, spec.z)
    const local = spec.build(new SceneryBatch(), STUB_ENV)
    const boxes = spec.solid === false ? [] : local.map((box) => worldBox(box, rot, spec.x, spec.z, ground))
    this.pieces.push({ name: spec.name, x: spec.x, z: spec.z, rot, ground, areas, boxes, build: spec.build, overhead: spec.overhead === true })
    return true
  }

  /** Searches the region on a grid for the free spot nearest `near` (or farthest from `far`) and places the piece there. */
  scan(spec: ScanSpec): boolean {
    const rot = spec.rot ?? 0
    const odd = rot % 2 === 1
    const hx = (odd ? spec.dl : spec.wl) / 2
    const hz = (odd ? spec.wl : spec.dl) / 2
    const region = spec.region ?? this.bounds
    const step = spec.step ?? 4
    const gap = spec.gap ?? PIECE_GAP
    let best: { x: number; z: number; score: number } | null = null
    for (let x = region.x0 + hx; x <= region.x1 - hx + 1e-6; x += step) {
      for (let z = region.z0 + hz; z <= region.z1 - hz + 1e-6; z += step) {
        const score = spec.near ? Math.hypot(x - spec.near[0], z - spec.near[1]) : spec.far ? -Math.hypot(x - spec.far[0], z - spec.far[1]) : 0
        if (best && score >= best.score) continue
        if (!this.fits([{ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz }], spec.overhead === true, gap)) continue
        best = { x, z, score }
      }
    }
    if (!best) {
      if (spec.quiet !== true) this.rejected.push(spec.name)
      return false
    }
    return this.place({ ...spec, x: best.x, z: best.z })
  }
}
