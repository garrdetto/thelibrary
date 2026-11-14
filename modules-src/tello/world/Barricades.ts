/**
 * Where a road leaves Montello's city limits it is closed: an orange-and-white striped barricade on posts across the
 * lanes, just inside the invisible wall at the playable area's edge.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

const ORANGE = hexRGB(0xe0601e)
const WHITE = hexRGB(0xf2f0ea)
/** How far inside the edge the barricade stands. */
const SETBACK = 3
const STRIPE = 0.6

export function buildBarricades(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): number {
  const chunks = new ChunkedBuilders(256)
  const boards = mats.plain('tello-barricade', { vcolor: true, gloss: 0.3 })
  const posts = mats.plain('tello-barricade-post', { color: 0xd9d6cf, gloss: 0.2 })
  let count = 0
  for (const exit of land.doc.limits.exits) {
    const ox = Math.sin(exit.h)
    const oz = Math.cos(exit.h)
    const mx = exit.x - ox * SETBACK
    const mz = exit.z - oz * SETBACK
    if (land.depthAt(mx, mz) > 0.2) continue
    const half = exit.w / 2 + 0.8
    const ground = land.heightAt(mx, mz)
    // Across the road: the town frame's x along (cos h, sin h) in map terms, mirrored in z.
    const ax = Math.cos(exit.h)
    const az = -Math.sin(exit.h)
    const yaw = Math.atan2(az, ax)
    const tz = -mz
    const board = chunks.get(mx, tz, boards, { colors: true })
    const post = chunks.get(mx, tz, posts)
    for (const y of [0.85, 1.25]) {
      const n = Math.max(2, Math.round((half * 2) / STRIPE))
      for (let k = 0; k < n; k++) {
        const t = -half + (k + 0.5) * ((half * 2) / n)
        board.orientedBox(mx + ax * t, ground + y, tz - az * t, half / n, 0.11, 0.03, yaw, { color: k % 2 ? WHITE : ORANGE })
      }
    }
    for (const side of [-1, 1]) {
      const px = mx + ax * side * (half - 0.25)
      const pz = tz - az * side * (half - 0.25)
      post.orientedBox(px, ground + 0.7, pz, 0.05, 0.7, 0.05, yaw)
      post.orientedBox(px, ground + 0.04, pz, 0.08, 0.04, 0.35, yaw)
    }
    sink.addStaticBox({ cx: mx, cy: ground + 0.8, cz: tz, hx: half, hy: 0.8, hz: 0.2, rotY: yaw })
    count++
  }
  chunks.flush(root, 'tello-barricades')
  return count
}
