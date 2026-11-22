/**
 * Small helpers the site layouts share: lettered pieces, perimeter fences, light poles, fuel and wash canopies and the common dock
 * warehouse.
 */

import { BUILDING_BY_ID } from '../../../shared/Catalog'
import type { SceneryBatch, UvRect } from '../../lots/Batch'
import { drawFence, lightPole } from '../../lots/Items'
import type { LocalBox } from '../../lots/Items'
import type { PieceBuild, Rect, SitePlanner } from './Plan'
import { canopy, canopyColumns, pumps } from './Parts'
import { ZONE_MARGIN } from './Plan'

/** A piece whose drawing needs the sign cell for `text`. */
export function lettered(text: string, draw: (b: SceneryBatch, uv: UvRect | null) => LocalBox[]): PieceBuild {
  return (b, env) => draw(b, env.sign(text))
}

export function around(x: number, z: number, r: number): Rect {
  return { x0: x - r, z0: z - r, x1: x + r, z1: z + r }
}

/** A chain-link fence along the site's edge in 20 m runs; runs that would cross a road or a lane are left out. */
export function perimeterFence(p: SitePlanner, inset = 1.5, segment = 20): void {
  const r = p.bounds
  const def = BUILDING_BY_ID['fence-chain']
  const runs: { horizontal: boolean; fixed: number; from: number; to: number }[] = [
    { horizontal: true, fixed: r.z0 + inset, from: r.x0 + inset, to: r.x1 - inset },
    { horizontal: true, fixed: r.z1 - inset, from: r.x0 + inset, to: r.x1 - inset },
    { horizontal: false, fixed: r.x0 + inset, from: r.z0 + inset, to: r.z1 - inset },
    { horizontal: false, fixed: r.x1 - inset, from: r.z0 + inset, to: r.z1 - inset },
  ]
  for (const run of runs) {
    for (let t = run.from; t < run.to - 0.5; t += segment) {
      const length = Math.min(segment, run.to - t)
      const mid = t + length / 2
      p.place({
        name: 'fence',
        x: run.horizontal ? mid : run.fixed,
        z: run.horizontal ? run.fixed : mid,
        rot: run.horizontal ? 1 : 0,
        wl: 0.3,
        dl: length,
        gap: 0,
        build: (b) => drawFence(b, def, length, 0.15, 'concrete', -length / 2),
      })
    }
  }
}

/** Light poles at the nearest free spot to each point. */
export function lightPoles(p: SitePlanner, points: readonly (readonly [number, number])[]): void {
  for (const [x, z] of points) {
    p.scan({ name: 'light pole', wl: 1.2, dl: 1.2, region: around(x, z, 14), near: [x, z], step: 2, gap: 4, build: (b) => lightPole(b) })
  }
}

/**
 * A canopy over a wash lane with two spray arches and side brushes inside it, kept just outside the lane so a truck drives
 * straight through; only the canopy columns are solid.
 */
export function washCanopy(p: SitePlanner, zoneId: string, label: string, color: string): void {
  const zone = p.site.zones.find((z) => z.id === zoneId)
  if (!zone) return
  const wl = zone.w + 2 * (ZONE_MARGIN + 2)
  const dl = zone.d + 2 * (ZONE_MARGIN + 2)
  const along = zone.w >= zone.d
  const length = along ? zone.w : zone.d
  const width = along ? zone.d : zone.w
  const columns = canopyColumns(wl, dl).filter(([lx, lz]) => p.fits([{ x0: zone.x + lx - 0.4, z0: zone.z + lz - 0.4, x1: zone.x + lx + 0.4, z1: zone.z + lz + 0.4 }], true, 0))
  const areas = columns.map(([lx, lz]) => ({ x0: zone.x + lx - 0.4, z0: zone.z + lz - 0.4, x1: zone.x + lx + 0.4, z1: zone.z + lz + 0.4 }))
  p.place({
    name: `canopy ${zone.id}`, x: zone.x, z: zone.z, wl, dl, overhead: true, areas,
    build: (b, env) => {
      const boxes = canopy(b, wl, dl, color, env.sign(label), columns)
      const box = (key: string, u: number, y: number, v: number, su: number, sy: number, sv: number): void => {
        if (along) b.box(key, u, y, v, su, sy, sv)
        else b.box(key, v, y, u, sv, sy, su)
      }
      const post = width / 2 + 0.6
      for (const u of [-length / 4, length / 4]) {
        for (const v of [-post, post]) box('steel', u, 0, v, 0.3, 4.6, 0.3)
        box('steel', u, 4.5, 0, 0.3, 0.3, post * 2 + 0.3)
        for (let v = -width / 2 + 0.8; v < width / 2 - 0.5; v += 1.1) box('metalBlue', u, 4.2, v, 0.2, 0.3, 0.2)
      }
      for (const v of [-post + 0.45, post - 0.45]) {
        box('metalBlue', 0, 0.3, v, 0.6, 3.4, 0.6)
        box('darkSteel', 0, 3.7, v, 0.2, 0.6, 0.2)
      }
      box('concreteDark', 0, 0.02, 0, length, 0.02, width)
      for (let u = -length / 2 + 2; u < length / 2; u += 4) box('darkSteel', u, 0.045, 0, 0.3, 0.01, width - 1.6)
      return boxes
    },
  })
}

/** A canopy over a fuel zone with pump islands on both outer sides; columns and islands that would block a lane are left out. */
export function fuelCanopy(p: SitePlanner, zoneId: string, label: string, color: string, spanX: number, depthExtra: number): void {
  const zone = p.site.zones.find((z) => z.id === zoneId)
  if (!zone) return
  const wl = zone.w + 2 * (ZONE_MARGIN + spanX)
  const dl = zone.d + 2 * (ZONE_MARGIN + depthExtra)
  const columns = canopyColumns(wl, dl).filter(([lx, lz]) => p.fits([{ x0: zone.x + lx - 0.4, z0: zone.z + lz - 0.4, x1: zone.x + lx + 0.4, z1: zone.z + lz + 0.4 }], true, 0))
  const areas = columns.map(([lx, lz]) => ({ x0: zone.x + lx - 0.4, z0: zone.z + lz - 0.4, x1: zone.x + lx + 0.4, z1: zone.z + lz + 0.4 }))
  p.place({ name: `canopy ${zone.id}`, x: zone.x, z: zone.z, wl, dl, overhead: true, areas, build: (b, env) => canopy(b, wl, dl, color, env.sign(label), columns) })
  for (const side of [-1, 1]) {
    let done = false
    for (const length of [wl - 6, 28, 20, 14]) {
      for (const shift of [0, -wl / 4, wl / 4, -wl / 3, wl / 3]) {
        if (done) break
        done = p.place({
          name: `pumps ${zone.id}`,
          x: zone.x + shift,
          z: zone.z + side * (zone.d / 2 + ZONE_MARGIN + 2.2),
          rot: 1,
          wl: 1.4,
          dl: length,
          quiet: true,
          build: (b) => pumps(b, length, color),
        })
      }
    }
  }
}
