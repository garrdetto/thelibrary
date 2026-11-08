import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { PLAY_LIMIT, forestDensity, trailOffset } from './Terrain'
import type { Terrain } from './Terrain'

export const STAND_TREE_OFFSET = 0.25
export const STAND_LADDER_BASE = new Vector3(0, 0, 2.15)
export const STAND_LADDER_TOP = new Vector3(0, 4.22, 0.7)
export const STAND_SEAT = new Vector3(0, 4.72, 0.3)
export const STAND_CLIMB_SECONDS = 3.6

export interface StandSite {
  tree: Vector3
  root: Vector3
  heading: number
}

export function findStandSite(terrain: Terrain, near: Vector3): StandSite {
  let best: { score: number; x: number; z: number; heading: number } | null = null
  for (let r = 40; r <= 140; r += 6) {
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2
      const x = near.x + Math.cos(ang) * r
      const z = near.z + Math.sin(ang) * r
      if (Math.abs(x) > PLAY_LIMIT - 40 || Math.abs(z) > PLAY_LIMIT - 40) continue
      const h = terrain.heightAt(x, z)
      if (h < 1.6 || terrain.slopeAt(x, z) > 0.2 || trailOffset(x, z) < 7) continue
      const density = forestDensity(x, z)
      if (density < 0.38 || density > 0.7) continue
      const e = 6
      const gx = forestDensity(x + e, z) - forestDensity(x - e, z)
      const gz = forestDensity(x, z + e) - forestDensity(x, z - e)
      const g = Math.hypot(gx, gz)
      if (g < 0.02) continue
      const heading = Math.atan2(-gx, -gz)
      const ahead = (d: number) => forestDensity(x + Math.sin(heading) * d, z + Math.cos(heading) * d)
      const open = 1 - (ahead(25) + ahead(45)) / 2
      const front = terrain.heightAt(x + Math.sin(heading) * 2.4, z + Math.cos(heading) * 2.4)
      if (Math.abs(front - h) > 0.45) continue
      const score = open * 2 + g * 4 - Math.abs(r - 70) / 120
      if (!best || score > best.score) best = { score, x, z, heading }
    }
  }
  const pick = best ?? { x: near.x + 50, z: near.z + 50, heading: 0, score: 0 }
  const tree = new Vector3(pick.x, terrain.heightAt(pick.x, pick.z), pick.z)
  const root = tree.add(new Vector3(Math.sin(pick.heading), 0, Math.cos(pick.heading)).scale(STAND_TREE_OFFSET))
  root.y = tree.y
  return { tree, root, heading: pick.heading }
}

export function standToWorld(site: StandSite, local: Vector3): Vector3 {
  const c = Math.cos(site.heading)
  const s = Math.sin(site.heading)
  return new Vector3(site.root.x + local.x * c + local.z * s, site.root.y + local.y, site.root.z - local.x * s + local.z * c)
}
