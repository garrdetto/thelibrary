/**
 * Steel W-beam guardrails where a road runs right beside deep water or a steep drop (`guardrailRuns`): galvanised
 * posts every twelve and a half feet, a corrugated beam on blocks between them, and a solid box along each span so
 * cars and walkers are held back. Main Street's west side by the river is the longest run.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { guardrailRuns, type RailRun } from '../data/RoadFixes'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

/** Post spacing, 12 ft 6 in. */
export const POST_SPACING = 3.81
const POST_HEIGHT = 0.95
const BEAM_CENTRE = 0.6
const BEAM_HALF_HEIGHT = 0.155
const BEAM_HALF_THICK = 0.025

/** Points along a run's line every `spacing` metres (flat x, z pairs), including both ends. */
export function postsAlong(pts: number[], spacing: number): number[] {
  const out = [pts[0], pts[1]]
  let carry = 0
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], dx = pts[k + 2] - ax, dz = pts[k + 3] - az
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    let at = spacing - carry
    while (at <= len) {
      out.push(ax + (dx / len) * at, az + (dz / len) * at)
      at += spacing
    }
    carry = len - (at - spacing)
  }
  const lx = pts[pts.length - 2], lz = pts[pts.length - 1]
  if (Math.hypot(out[out.length - 2] - lx, out[out.length - 1] - lz) > 0.3) out.push(lx, lz)
  return out
}

export function buildGuardrails(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand, runs: readonly RailRun[] = guardrailRuns(land.doc, land)): number {
  const chunks = new ChunkedBuilders(256)
  const beams = mats.plain('tello-guardrail-beam', { color: 0xaeb4b6, gloss: 0.4, metal: 0.55 })
  const posts = mats.plain('tello-guardrail-post', { color: 0x8d9293, gloss: 0.3, metal: 0.45 })
  let spans = 0
  for (const run of runs) {
    const pts = postsAlong(run.pts, POST_SPACING)
    const n = pts.length / 2
    const ground = (i: number) => land.heightAt(pts[i * 2], pts[i * 2 + 1])
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1]
      const prev = pts.slice(Math.max(0, i - 1) * 2, Math.max(0, i - 1) * 2 + 2)
      const next = pts.slice(Math.min(n - 1, i + 1) * 2, Math.min(n - 1, i + 1) * 2 + 2)
      const yaw = Math.atan2(next[1] - prev[1], next[0] - prev[0])
      chunks.get(x, -z, posts).orientedBox(x, ground(i) + POST_HEIGHT / 2 - 0.15, -z, 0.05, POST_HEIGHT / 2, 0.065, yaw)
    }
    for (let i = 0; i + 1 < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.2) continue
      const cx = (ax + bx) / 2, cz = (az + bz) / 2
      const yaw = Math.atan2(bz - az, bx - ax)
      const y = (ground(i) + ground(i + 1)) / 2
      const beam = chunks.get(cx, -cz, beams)
      const nx = -(bz - az) / len, nz = (bx - ax) / len
      const out = run.side
      const offset = BEAM_HALF_THICK + 0.02
      beam.orientedBox(cx, y + BEAM_CENTRE, -cz, len / 2 + 0.02, BEAM_HALF_HEIGHT, BEAM_HALF_THICK, yaw)
      for (const dy of [-0.075, 0.075]) beam.orientedBox(cx + nx * out * offset, y + BEAM_CENTRE + dy, -(cz + nz * out * offset), len / 2 + 0.02, 0.035, 0.012, yaw)
      sink.addStaticBox({ cx, cy: y + BEAM_CENTRE - 0.1, cz: -cz, hx: len / 2 + 0.05, hy: 0.45, hz: 0.12, rotY: yaw })
      spans++
    }
  }
  chunks.flush(root, 'tello-guardrails')
  return spans
}
