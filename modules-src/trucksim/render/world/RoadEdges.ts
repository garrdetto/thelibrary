/**
 * Curbs and guardrails along the county's roads. `planRoadEdges` (renderer-free, computed once per terrain) walks every road on
 * both sides in `STEP` metre stations and keeps:
 * - guardrail runs where a highway or road runs along a fill (the ground falls `RAIL_DROP` within `RAIL_LOOK` past the
 *   shoulder) and on the outside of sharp highway curves (radius under `CURVE_RADIUS`, the highway loop's corners), set just outside the shoulder, at
 *   least `MIN_RAIL` long;
 * - curb runs along Millbrook's streets at the asphalt's edge.
 * Both stop at junction mouths and where a road is cut back into a higher one. `RoadEdgeLayer` draws each chunk's share (W-beam
 * on posts in galvanized steel, concrete curbs) and `railBoxes` gives the rails as solid boxes for the physics world.
 */
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SITE_BY_ID } from '../../shared/WorldLayout'
import { SHOULDER } from '../../shared/Terrain'
import type { Terrain } from '../../shared/Terrain'
import type { StaticBox } from '../../sim/SimWorld'
import type { MaterialLibrary } from '../Materials'
import { SceneryBatch } from '../lots/Batch'
import { SceneryMaterials } from '../lots/Palette'
import { getRoadNetwork, pointAt } from './RoadsGeometry'
import type { RoadNetwork, RoadPath } from './RoadsGeometry'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

export const STEP = 2
export const RAIL_DROP = 0.9
export const RAIL_LOOK = 10
/** Highway curves tighter than this radius (m) get a rail on their outside. */
export const CURVE_RADIUS = 400
const CURVE_SPAN = 20
export const MIN_RAIL = 16
const RAIL_SETBACK = 0.6
const RAIL_HEIGHT = 0.72
const POST_EVERY = 2
const CURB_HEIGHT = 0.15
const CURB_WIDTH = 0.25
const TOWN = SITE_BY_ID.town

export interface EdgeRun {
  kind: 'rail' | 'curb'
  /** Station points (x, z pairs) along the run and the ground height under each. */
  pts: number[]
  ys: number[]
}

function blocked(path: RoadPath, side: number, s: number): boolean {
  for (const [a, b] of path.cuts) if (s >= a - 4 && s <= b + 4) return true
  for (const mouth of path.mouths) if ((mouth.side === side || mouth.side === 0) && s >= mouth.from - 3 && s <= mouth.to + 3) return true
  return false
}

const inTown = (x: number, z: number) => Math.abs(x - TOWN.x) <= TOWN.w / 2 && Math.abs(z - TOWN.z) <= TOWN.d / 2

/** Every curb and guardrail run on the network over `terrain`. */
export function planRoadEdges(terrain: Terrain, network: RoadNetwork = getRoadNetwork()): EdgeRun[] {
  const runs: EdgeRun[] = []
  const at = { x: 0, z: 0, dirX: 0, dirZ: 1, segment: 0 }
  const behind = { x: 0, z: 0, dirX: 0, dirZ: 1, segment: 0 }
  const ahead = { x: 0, z: 0, dirX: 0, dirZ: 1, segment: 0 }
  for (const path of network.paths) {
    const kind = path.road.kind
    const railRoad = kind === 'highway' || kind === 'road'
    const curbRoad = kind === 'street'
    if (!railRoad && !curbRoad) continue
    for (const side of [1, -1]) {
      let run: EdgeRun | null = null
      let runKind: 'rail' | 'curb' | null = null
      const close = () => {
        if (run && (run.kind === 'curb' || run.pts.length / 2 >= MIN_RAIL / STEP)) runs.push(run)
        run = null
        runKind = null
      }
      for (let s = 0; s <= path.length; s += STEP) {
        pointAt(path, s, at)
        const lx = at.dirZ * side
        const lz = -at.dirX * side
        let want: 'rail' | 'curb' | null = null
        if (!blocked(path, side, s)) {
          if (curbRoad && inTown(at.x, at.z)) want = 'curb'
          else if (railRoad) {
            if (kind === 'highway') {
              pointAt(path, s - CURVE_SPAN / 2, behind)
              pointAt(path, s + CURVE_SPAN / 2, ahead)
              const turn = Math.atan2(behind.dirX * ahead.dirZ - behind.dirZ * ahead.dirX, behind.dirX * ahead.dirX + behind.dirZ * ahead.dirZ)
              const outside = turn > 0 ? 1 : -1
              if (Math.abs(turn) > CURVE_SPAN / CURVE_RADIUS && side === outside) want = 'rail'
            }
            const edge = path.half + SHOULDER
            const road = terrain.heightAt(at.x + lx * edge, at.z + lz * edge)
            for (let d = 2; d <= RAIL_LOOK && want === null; d += 2) {
              if (road - terrain.heightAt(at.x + lx * (edge + d), at.z + lz * (edge + d)) >= RAIL_DROP) want = 'rail'
            }
          }
        }
        if (want !== runKind) close()
        if (!want) continue
        const offset = want === 'rail' ? path.half + SHOULDER + RAIL_SETBACK : path.half + CURB_WIDTH / 2
        const x = at.x + lx * offset
        const z = at.z + lz * offset
        if (!run) {
          run = { kind: want, pts: [], ys: [] }
          runKind = want
        }
        const current: EdgeRun = run
        current.pts.push(x, z)
        current.ys.push(terrain.heightAt(at.x + lx * (path.half + (want === 'rail' ? SHOULDER : 0)), at.z + lz * (path.half + (want === 'rail' ? SHOULDER : 0))))
      }
      close()
    }
  }
  return runs
}

const plans = new WeakMap<Terrain, EdgeRun[]>()

/** The edge plan for `terrain` (computed once). */
export function roadEdges(terrain: Terrain): EdgeRun[] {
  let plan = plans.get(terrain)
  if (!plan) plans.set(terrain, (plan = planRoadEdges(terrain)))
  return plan
}

/** The guardrails as solid boxes, one per station pair. */
export function railBoxes(terrain: Terrain): StaticBox[] {
  const out: StaticBox[] = []
  for (const run of roadEdges(terrain)) {
    if (run.kind !== 'rail') continue
    for (let i = 0; i + 1 < run.ys.length; i++) {
      const ax = run.pts[i * 2], az = run.pts[i * 2 + 1], bx = run.pts[i * 2 + 2], bz = run.pts[i * 2 + 3]
      const length = Math.hypot(bx - ax, bz - az)
      if (length < 0.1) continue
      const y = (run.ys[i] + run.ys[i + 1]) / 2
      out.push({ x: (ax + bx) / 2, y: y + RAIL_HEIGHT / 2, z: (az + bz) / 2, hx: 0.12, hy: RAIL_HEIGHT / 2 + 0.1, hz: length / 2, rotY: Math.atan2(bx - ax, bz - az) })
    }
  }
  return out
}

class EdgeChunk implements ChunkPart {
  constructor(private readonly meshes: Mesh[]) {}

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose(false, false)
    this.meshes.length = 0
  }
}

/** Draws curbs and guardrails per chunk: a run's stations are drawn in the chunk their segment starts in. */
export class RoadEdgeLayer implements ChunkLayer {
  readonly name = 'road-edges'
  private readonly materials: SceneryMaterials

  constructor(private readonly scene: Scene, mats: MaterialLibrary, private readonly terrain: Terrain) {
    this.materials = new SceneryMaterials(scene, mats)
  }

  build(_cx: number, _cz: number, ctx: ChunkContext): ChunkPart | null {
    const { x0, z0, size } = ctx
    const batch = new SceneryBatch()
    batch.frame(-x0, 0, -z0, 0)
    let any = false
    for (const run of roadEdges(this.terrain)) {
      for (let i = 0; i + 1 < run.ys.length; i++) {
        const ax = run.pts[i * 2], az = run.pts[i * 2 + 1]
        if (ax < x0 || ax >= x0 + size || az < z0 || az >= z0 + size) continue
        const bx = run.pts[i * 2 + 2], bz = run.pts[i * 2 + 3]
        const ya = run.ys[i], yb = run.ys[i + 1]
        any = true
        if (run.kind === 'curb') {
          batch.beam('concrete', ax, ya + CURB_HEIGHT / 2, az, bx, yb + CURB_HEIGHT / 2, bz, CURB_WIDTH, CURB_HEIGHT + 0.06)
          continue
        }
        batch.beam('steel', ax, ya + RAIL_HEIGHT - 0.12, az, bx, yb + RAIL_HEIGHT - 0.12, bz, 0.06, 0.32)
        if (i % Math.round(POST_EVERY / STEP) === 0) batch.box('metalDark', ax, ya - 0.3, az, 0.15, RAIL_HEIGHT + 0.25, 0.15)
      }
    }
    if (!any) return null
    const meshes = batch.build(this.scene, `trucksim-edges-${ctx.cx}-${ctx.cz}`, ctx.root, (key) => this.materials.get(key))
    for (const mesh of meshes) ctx.addShadowCaster(mesh)
    return new EdgeChunk(meshes)
  }

  dispose(): void {
    this.materials.dispose()
  }
}
