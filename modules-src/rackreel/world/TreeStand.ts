import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { PLAY_LIMIT, forestDensity, trailOffset } from './Terrain'
import type { Terrain } from './Terrain'

export type StandKind = 'ladder' | 'blind'

export interface StandLayout {
  model: 'treestand' | 'boxblind'
  offset: number
  base: Vector3
  top: Vector3
  seat: Vector3
  climbSplit: number
  firstPerson: boolean
  name: string
}

export const STAND_LAYOUTS: Record<StandKind, StandLayout> = {
  ladder: { model: 'treestand', offset: 0.25, base: new Vector3(0, 0, 2.15), top: new Vector3(0, 4.22, 0.7), seat: new Vector3(0, 4.72, 0.3), climbSplit: 0.86, firstPerson: false, name: 'ladder stand' },
  blind: { model: 'boxblind', offset: 0, base: new Vector3(0, 0, -2.45), top: new Vector3(0, 3.02, -1.2), seat: new Vector3(0, 3.52, 0.05), climbSplit: 0.8, firstPerson: true, name: 'box blind' },
}

export const STAND_LADDER_BASE = STAND_LAYOUTS.ladder.base
export const STAND_LADDER_TOP = STAND_LAYOUTS.ladder.top
export const STAND_SEAT = STAND_LAYOUTS.ladder.seat
export const STAND_CLIMB_SECONDS = 3.6

export interface StandSite {
  kind: StandKind
  tree: Vector3
  root: Vector3
  heading: number
}

interface Candidate { score: number; x: number; z: number; heading: number }

function candidates(terrain: Terrain, near: Vector3, density: [number, number], minR: number, maxR: number): Candidate[] {
  const out: Candidate[] = []
  for (let r = minR; r <= maxR; r += 8) {
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2
      const x = near.x + Math.cos(ang) * r
      const z = near.z + Math.sin(ang) * r
      if (Math.abs(x) > PLAY_LIMIT - 40 || Math.abs(z) > PLAY_LIMIT - 40) continue
      const h = terrain.heightAt(x, z)
      if (h < 1.6 || terrain.slopeAt(x, z) > 0.2 || trailOffset(x, z) < 7) continue
      const d = forestDensity(x, z)
      if (d < density[0] || d > density[1]) continue
      const e = 6
      const gx = forestDensity(x + e, z) - forestDensity(x - e, z)
      const gz = forestDensity(x, z + e) - forestDensity(x, z - e)
      const g = Math.hypot(gx, gz)
      if (g < 0.015) continue
      const heading = Math.atan2(-gx, -gz)
      const ahead = (dd: number) => forestDensity(x + Math.sin(heading) * dd, z + Math.cos(heading) * dd)
      const open = 1 - (ahead(25) + ahead(45)) / 2
      const front = terrain.heightAt(x + Math.sin(heading) * 2.4, z + Math.cos(heading) * 2.4)
      const back = terrain.heightAt(x - Math.sin(heading) * 2.6, z - Math.cos(heading) * 2.6)
      if (Math.abs(front - h) > 0.45 || Math.abs(back - h) > 0.45) continue
      out.push({ score: open * 2 + g * 4 - Math.abs(r - (minR + maxR) / 2) / 200, x, z, heading })
    }
  }
  return out.sort((p, q) => q.score - p.score)
}

function toSite(terrain: Terrain, kind: StandKind, c: Candidate): StandSite {
  const tree = new Vector3(c.x, terrain.heightAt(c.x, c.z), c.z)
  const root = tree.add(new Vector3(Math.sin(c.heading), 0, Math.cos(c.heading)).scale(STAND_LAYOUTS[kind].offset))
  root.y = kind === 'blind' ? Math.min(tree.y, terrain.heightAt(root.x, root.z)) : tree.y
  return { kind, tree, root, heading: c.heading }
}

export function findStandSites(terrain: Terrain, near: Vector3, avoid: Vector3[]): StandSite[] {
  const sites: StandSite[] = []
  const taken = (x: number, z: number, spacing: number) => sites.some((s) => Math.hypot(s.tree.x - x, s.tree.z - z) < spacing) || avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 30)
  for (const c of candidates(terrain, near, [0.34, 0.75], 40, 300)) {
    if (taken(c.x, c.z, 85)) continue
    sites.push(toSite(terrain, 'ladder', c))
    if (sites.length >= 3) break
  }
  for (const c of candidates(terrain, near, [0.08, 0.36], 60, 220)) {
    if (taken(c.x, c.z, 90)) continue
    sites.push(toSite(terrain, 'blind', c))
    break
  }
  if (!sites.length) sites.push(toSite(terrain, 'ladder', { x: near.x + 50, z: near.z + 50, heading: 0, score: 0 }))
  return sites
}

export function findStandSite(terrain: Terrain, near: Vector3): StandSite {
  return findStandSites(terrain, near, [])[0]
}

export function standToWorld(site: StandSite, local: Vector3): Vector3 {
  const c = Math.cos(site.heading)
  const s = Math.sin(site.heading)
  return new Vector3(site.root.x + local.x * c + local.z * s, site.root.y + local.y, site.root.z - local.x * s + local.z * c)
}
