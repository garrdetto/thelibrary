import type { LakeSiteConfig, SitePoint, StandPlan } from '../../rackreel/world/LakeSite'
import { COVER } from '../../tello/data/MapData'
import type { TelloLand } from '../../tello/region'

/** Where Lake Montello's launch ramp is (map coordinates): the park's shore the dock is looked for beside. */
const LAUNCH = { x: -35, z: 458 }
const DOCK_LENGTH = 18
const SEARCH_Z = { from: 260, to: 760, step: 3 }
const WILD_CLEAR = 30
const WILD_EDGE = 90
const STAND_RING = { from: 160, to: 1500 }
const RAY_CAP = 700
const RAYS = 180

export interface LakeSite extends LakeSiteConfig {
  /** The launch ramp the dock is beside (scene coordinates). */
  launch: SitePoint
}

interface Footprint {
  x0: number
  z0: number
  x1: number
  z1: number
}

function footprints(land: TelloLand): Footprint[] {
  return land.doc.buildings.filter((b) => !b.x).map((b) => {
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    for (let k = 0; k < b.p.length; k += 2) {
      x0 = Math.min(x0, b.p[k])
      x1 = Math.max(x1, b.p[k])
      z0 = Math.min(z0, b.p[k + 1])
      z1 = Math.max(z1, b.p[k + 1])
    }
    return { x0, z0, x1, z1 }
  })
}

function nearBuilding(boxes: Footprint[], x: number, z: number, reach: number): boolean {
  for (const b of boxes) if (x > b.x0 - reach && x < b.x1 + reach && z > b.z0 - reach && z < b.z1 + reach) return true
  return false
}

/**
 * Where the lake gameplay stands on Lake Montello (land after `rebaseLand`, so the surface is at y = 0). The dock runs
 * out from the park shore west of downtown, level ground on the shore side and 16 m of water with the boat beside it;
 * Wild Man's loops go round a centre in the water a few hundred metres out; the stands are in the woods round the
 * lake; the wild land is woods well away from pavement and houses. Every point is in scene coordinates.
 */
export function findLakeSite(land: TelloLand): LakeSite {
  const boxes = footprints(land)
  const dirIn = { x: 1, z: 0 }
  const side = { x: dirIn.z, z: -dirIn.x }
  const deep = (x: number, z: number, d: number) => land.depthAt(x, z) >= d
  const solid = (x: number, z: number) =>
    land.clearAt(x, z) > 4 && land.depthAt(x, z) <= 0 && land.coverAt(x, z) !== COVER.woods && land.coverAt(x, z) !== COVER.marsh && land.canopyAt(x, z) < 0.3 && !nearBuilding(boxes, x, z, 12)
  let best: { z: number; shore: number; score: number } | null = null
  for (let z = SEARCH_Z.from; z <= SEARCH_Z.to; z += SEARCH_Z.step) {
    let shore: number | null = null
    for (let x = 140; x > -400; x -= 0.5) {
      if (land.depthAt(x, z) > 0.1) break
      if (land.heightAt(x, z) > 0.6) shore = x
    }
    if (shore === null) continue
    const along = (d: number, s = 0) => ({ x: shore! + dirIn.x * d + side.x * s, z: z + dirIn.z * d + side.z * s })
    const start = along(2)
    const end = along(-(DOCK_LENGTH - 2))
    const boat = { x: end.x + side.x * 2.6 + dirIn.x * 1.5, z: end.z + side.z * 2.6 + dirIn.z * 1.5 }
    const utv = { x: along(14).x - side.x * 6, z: along(14).z - side.z * 6 }
    const out = along(-(DOCK_LENGTH + 6))
    if (!solid(start.x, start.z) || !solid(along(7).x, along(7).z) || !solid(utv.x, utv.z) || !solid(along(14, 6).x, along(14, 6).z)) continue
    if (!deep(end.x, end.z, 1) || !deep(boat.x, boat.z, 1) || !deep(out.x, out.z, 1.2)) continue
    if (Math.abs(land.groundAt(start.x, start.z) - land.groundAt(utv.x, utv.z)) > 1.4) continue
    const score = Math.hypot(shore - LAUNCH.x, z - LAUNCH.z)
    if (!best || score < best.score) best = { z, shore, score }
  }
  if (!best) throw new Error('Lake Montello has no shore for the dock')
  const { shore, z } = best
  const at = (d: number, s = 0): SitePoint => ({ x: shore + dirIn.x * d + side.x * s, z: z + dirIn.z * d + side.z * s })
  const heading = Math.atan2(-dirIn.x, -dirIn.z)
  const scene = (p: SitePoint): SitePoint => ({ x: land.toSceneX(p.x), z: land.toSceneZ(p.z) })
  const dockStart = at(2)
  const dockEnd = at(-(DOCK_LENGTH - 2))
  const boat = { x: dockEnd.x + side.x * 2.9 + dirIn.x * 1.5, z: dockEnd.z + side.z * 2.9 + dirIn.z * 1.5 }
  const utv = { x: at(14).x - side.x * 6, z: at(14).z - side.z * 6 }

  const centre = lakeCentre(land, at(-120))
  const radii = lakeRadii(land, centre)
  const radius = (angle: number) => {
    const f = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
    const x = f * RAYS
    const i = Math.floor(x) % RAYS
    const t = x - Math.floor(x)
    return radii[i] + (radii[(i + 1) % RAYS] - radii[i]) * t
  }

  const wildMap = (x: number, z: number): boolean =>
    land.playable(x, z, WILD_EDGE) && land.coverAt(x, z) === COVER.woods && land.clearAt(x, z) >= WILD_CLEAR && land.depthAt(x, z) <= 0 && !nearBuilding(boxes, x, z, 70)
  const wild = (sx: number, sz: number): boolean => wildMap(land.toMapX(sx), land.toMapZ(sz))
  const stands: StandPlan[] = findStands(land, at(0), wildMap).map((p) => ({ ...p, ...scene(p) }))

  return {
    dock: { start: scene(dockStart), end: scene(dockEnd), heading },
    spawn: scene(at(7)),
    spawnHeading: heading,
    boat: scene(boat),
    boatHeading: heading + Math.PI / 2,
    utv: scene(utv),
    utvHeading: heading + Math.PI / 2,
    lake: { center: scene(centre), radius },
    stands,
    wild,
    launch: scene(LAUNCH),
  }
}

/** A point in the water the rays go out from: out from the dock, where the lake opens up the most (map coordinates). */
function lakeCentre(land: TelloLand, from: SitePoint): SitePoint {
  let best = from
  let bestOpen = -1
  for (let dx = -420; dx <= -40; dx += 20) {
    for (let dz = -240; dz <= 240; dz += 20) {
      const p = { x: from.x + dx, z: from.z + dz }
      if (land.depthAt(p.x, p.z) < 1) continue
      let open = 0
      for (let a = 0; a < 16; a++) {
        const c = Math.cos((a / 16) * Math.PI * 2)
        const s = Math.sin((a / 16) * Math.PI * 2)
        let r = 0
        while (r < RAY_CAP && land.depthAt(p.x + c * r, p.z + s * r) > 0.1) r += 8
        open += r
      }
      if (open > bestOpen) {
        bestOpen = open
        best = p
      }
    }
  }
  return best
}

/** How far the shore is from `c` in `RAYS` directions; open water out to the cap counts as the cap (the loops then close over open water). */
function lakeRadii(land: TelloLand, c: SitePoint): number[] {
  const out: number[] = []
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    let r = 0
    while (r < RAY_CAP && land.depthAt(c.x + cx * r, c.z + cz * r) > 0.1) r += 1
    out.push(Math.max(40, r))
  }
  return out.map((_, i) => (out[(i + RAYS - 1) % RAYS] + out[i] * 2 + out[(i + 1) % RAYS]) / 4)
}

/** Three ladder stands and a box blind in the woods round the dock, 160 m to 1.5 km out and well apart, each facing the openest ground nearby (map coordinates). */
function findStands(land: TelloLand, near: SitePoint, wild: (x: number, z: number) => boolean): { kind: 'ladder' | 'blind'; x: number; z: number; heading: number }[] {
  const out: { kind: 'ladder' | 'blind'; x: number; z: number; heading: number }[] = []
  const taken = (x: number, z: number, gap: number) => out.some((s) => Math.hypot(s.x - x, s.z - z) < gap)
  const want: ('ladder' | 'blind')[] = ['ladder', 'ladder', 'ladder', 'blind']
  for (const kind of want) {
    let best: { x: number; z: number; heading: number; score: number } | null = null
    for (let r = STAND_RING.from; r <= STAND_RING.to; r += 40) {
      for (let a = 0; a < 36; a++) {
        const ang = (a / 36) * Math.PI * 2 + (kind === 'blind' ? 0.1 : 0)
        const x = near.x + Math.cos(ang) * r
        const z = near.z + Math.sin(ang) * r
        if (!wild(x, z) || taken(x, z, 220) || land.slopeAt(x, z) > 0.18) continue
        let open = 0
        let heading = 0
        for (let k = 0; k < 8; k++) {
          const h = (k / 8) * Math.PI * 2
          const ahead = land.canopyAt(x + Math.sin(h) * 30, z + Math.cos(h) * 30)
          if (1 - ahead > open) {
            open = 1 - ahead
            heading = h
          }
        }
        const score = open * 2 - Math.abs(r - 600) / 1200 - (1 - land.canopyAt(x, z)) * 0.5
        if (!best || score > best.score) best = { x, z, heading, score }
      }
    }
    if (best) out.push({ kind, x: best.x, z: best.z, heading: best.heading })
  }
  return out
}
