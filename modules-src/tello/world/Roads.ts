/**
 * Every road, street, driveway, track, sidewalk and trail in Montello, as
 * ribbons draped on the graded ground: state and county highways in the lake
 * country's lined two-lane asphalt, streets and driveways in its plain
 * asphalt, tracks in gravel, sidewalks in concrete, trails in dirt. Junctions
 * get a round patch, parking lots a slab, and each bridge a concrete deck
 * with railings (solid for cars and walkers through `bridgeSolids`).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import { asphaltTexture } from '../../rackreel/world/Highway'
import { detailTexture } from '../../rackreel/world/World'
import type { BridgeData, RoadKind } from '../data/MapData'
import type { TelloLand } from '../region'
import { isMainLeg, PROFILE_STEP, townProfiles, type StreetProfile } from '../data/Streets'
import { junctionFills } from './JunctionShapes'
import { resample, triangulate } from './Poly'

export const CELL = 512
/** How far each kind of surface sits above the ground it is draped on. */
const LIFT: Record<RoadKind, number> = { 0: 0.06, 1: 0.05, 2: 0.04, 3: 0.035, 4: 0.15, 5: 0.03 }
/** Metres between stations along streets and highways, and along everything else. */
export const STREET_STEP = 3
export const OTHER_STEP = 4
/** A ribbon's corner is never pushed out further than this many times its half width. */
const MITER_LIMIT = 1.6
/** Roads of one class sit a hair apart so no two coincide. */
const LAYERS = 6
const LAYER_GAP = 0.0012
/** Roads are drawn out to this far inside the edge of what is seen past the playable area (the ground stops at the edge). */
const ROAD_SEEN = 16
/** The pavement at a junction sits this far over the highest road meeting there. */
const FILL_OVER = 0.006

export interface Batch { positions: number[]; uvs: number[]; indices: number[] }

export function batchOf(map: Map<string, Batch>, key: string): Batch {
  let b = map.get(key)
  if (!b) map.set(key, (b = { positions: [], uvs: [], indices: [] }))
  return b
}

function surface(scene: Scene, name: string, texture: Texture, tint?: Color3, zOffset = -2): StandardMaterial {
  const mat = new StandardMaterial(`tello-${name}`, scene)
  mat.diffuseTexture = texture
  if (tint) mat.diffuseColor = tint
  mat.specularColor = Color3.Black()
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  mat.zOffset = zOffset
  return mat
}

export function toMesh(scene: Scene, name: string, b: Batch, mat: StandardMaterial): Mesh {
  const normals: number[] = []
  VertexData.ComputeNormals(b.positions, b.indices, normals, { useRightHandedSystem: false })
  for (let i = 1; i < normals.length; i += 3) {
    if (normals[i] < 0) {
      normals[i - 1] = -normals[i - 1]
      normals[i] = -normals[i]
      normals[i + 1] = -normals[i + 1]
    }
  }
  const data = new VertexData()
  data.positions = b.positions
  data.indices = b.indices
  data.normals = normals
  data.uvs = b.uvs
  const mesh = new Mesh(name, scene)
  data.applyToMesh(mesh, false)
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.isPickable = false
  mesh.freezeWorldMatrix()
  mesh.doNotSyncBoundingInfo = true
  return mesh
}

/** Where drivable roads meet or end: the points two or more of them share, and each road's ends, with the widest road there. */
export function junctions(land: TelloLand): { x: number; z: number; r: number }[] {
  const seen = new Map<string, { x: number; z: number; r: number; n: number; end: boolean }>()
  for (const road of land.doc.roads) {
    if (road.k > 3) continue
    const p = road.p
    for (let k = 0; k < p.length; k += 2) {
      const key = `${Math.round(p[k] * 2)},${Math.round(p[k + 1] * 2)}`
      const end = k === 0 || k === p.length - 2
      const hit = seen.get(key)
      if (hit) {
        hit.n++
        hit.r = Math.max(hit.r, road.w / 2)
      } else seen.set(key, { x: p[k], z: p[k + 1], r: road.w / 2, n: 1, end })
    }
  }
  const out: { x: number; z: number; r: number }[] = []
  for (const j of seen.values()) if (j.n > 1 || j.end) out.push({ x: j.x, z: j.z, r: j.r })
  return out
}

export interface Station { x: number; z: number; sx: number; sz: number; along: number; miter: number }

/** The points a road's ribbon is built on, with each one's left normal (scaled to hold the width round a bend) and distance along. */
export function stationsOf(road: { k: number; p: number[] }, profile?: StreetProfile, town = false): Station[] {
  const pts = profile ? profile.pts : resample(road.p, town ? PROFILE_STEP : road.k <= 1 ? STREET_STEP : OTHER_STEP)
  const n = pts.length / 2
  const out: Station[] = []
  let along = 0
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1]
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    let nx = 0, nz = 0, miter = 1
    const px = x - pts[a * 2], pz = z - pts[a * 2 + 1], qx = pts[c * 2] - x, qz = pts[c * 2 + 1] - z
    const pl = Math.hypot(px, pz), ql = Math.hypot(qx, qz)
    if (pl > 1e-6 && ql > 1e-6) {
      const n1x = -pz / pl, n1z = px / pl, n2x = -qz / ql, n2z = qx / ql
      const bx = n1x + n2x, bz = n1z + n2z
      const bl = Math.hypot(bx, bz) || 1
      nx = bx / bl
      nz = bz / bl
      miter = Math.min(MITER_LIMIT, 1 / Math.max(0.1, nx * n1x + nz * n1z))
    } else {
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      nx = -dz / len
      nz = dx / len
    }
    if (i > 0) along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1])
    out.push({ x, z, sx: nx, sz: nz, along, miter })
  }
  return out
}

export function buildRoads(scene: Scene, land: TelloLand): Mesh[] {
  const detail = detailTexture(scene)
  const asphalt = asphaltTexture(scene, 10)
  const mats: Record<RoadKind | 6, StandardMaterial> = {
    0: surface(scene, 'highway', asphalt, undefined, -7),
    1: surface(scene, 'street', asphalt, undefined, -6),
    2: surface(scene, 'lane', asphaltTexture(scene, 8), new Color3(0.92, 0.92, 0.92), -5),
    3: surface(scene, 'gravel', detail, new Color3(0.56, 0.52, 0.45), -4),
    4: surface(scene, 'walk', detail, new Color3(0.7, 0.69, 0.66), -3),
    5: surface(scene, 'trail', detail, new Color3(0.5, 0.41, 0.29), -3),
    6: surface(scene, 'junction', asphalt, undefined, -9),
  }
  const batches = new Map<string, Batch>()
  const h = (x: number, z: number) => land.heightAt(x, z)
  const profiles = townProfiles(land.doc)
  land.doc.roads.forEach((road, roadIndex) => {
    const prof = profiles.get(road)
    const town = !!prof || isMainLeg(road)
    const stations = stationsOf(road, prof, town)
    const n = stations.length
    const halfAt = (i: number) => (prof ? prof.half[i] : road.w / 2)
    const kind: RoadKind = town ? 1 : road.k
    const lift = LIFT[road.k] + (roadIndex % LAYERS) * LAYER_GAP
    for (let s0 = 0; s0 < n - 1; s0 += 16) {
      const s1 = Math.min(n - 1, s0 + 16)
      if (!land.seen(stations[s0].x, stations[s0].z, ROAD_SEEN) && !land.seen(stations[s1].x, stations[s1].z, ROAD_SEEN)) continue
      const batch = batchOf(batches, `${kind}|${Math.floor(stations[s0].x / CELL)},${Math.floor(stations[s0].z / CELL)}`)
      for (let i = s0; i <= s1; i++) {
        const st = stations[i]
        const half = halfAt(i) * st.miter
        for (const side of [-1, 0, 1]) {
          const px = st.x + st.sx * side * half
          const pz = st.z + st.sz * side * half
          batch.positions.push(land.toSceneX(px), h(px, pz) + lift, land.toSceneZ(pz))
          batch.uvs.push(px, pz)
        }
        if (i === s0) continue
        const v = batch.positions.length / 3 - 3
        batch.indices.push(v - 3, v, v - 2, v - 2, v, v + 1, v - 2, v + 1, v - 1, v - 1, v + 1, v + 2)
      }
      if (road.k === 4) {
        const curb = batchOf(batches, `4|${Math.floor(stations[s0].x / CELL)},${Math.floor(stations[s0].z / CELL)}`)
        for (let i = s0; i < s1; i++) {
          for (const side of [-1, 1]) {
            const a = stations[i], b = stations[i + 1]
            const ha = halfAt(i), hb = halfAt(i + 1)
            const ax = a.x + a.sx * side * ha, az = a.z + a.sz * side * ha
            const bx = b.x + b.sx * side * hb, bz = b.z + b.sz * side * hb
            const v = curb.positions.length / 3
            for (const [x, z, y] of [[ax, az, h(ax, az) + lift], [bx, bz, h(bx, bz) + lift], [bx, bz, h(bx, bz) - 0.05], [ax, az, h(ax, az) - 0.05]]) {
              curb.positions.push(land.toSceneX(x), y, land.toSceneZ(z))
              curb.uvs.push(x, z + y)
            }
            curb.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
          }
        }
      }
    }
  })
  for (const fill of junctionFills(land.doc)) {
    const t = fill.tris
    if (!land.seen(t[0], t[1], ROAD_SEEN)) continue
    const b = batchOf(batches, `6|${Math.floor(t[0] / CELL)},${Math.floor(t[1] / CELL)}`)
    const over = LIFT[fill.kind as RoadKind] + (LAYERS - 1) * LAYER_GAP + FILL_OVER
    const first = b.positions.length / 3
    for (let k = 0; k < t.length; k += 2) {
      b.positions.push(land.toSceneX(t[k]), h(t[k], t[k + 1]) + over, land.toSceneZ(t[k + 1]))
      b.uvs.push(t[k], t[k + 1])
    }
    for (let k = 0; k < t.length / 6; k++) b.indices.push(first + k * 3, first + k * 3 + 1, first + k * 3 + 2)
  }
  for (const lot of land.doc.lots) {
    const b = batchOf(batches, `2|${Math.floor(lot.p[0] / CELL)},${Math.floor(lot.p[1] / CELL)}`)
    const c = b.positions.length / 3
    for (let k = 0; k < lot.p.length; k += 2) {
      b.positions.push(land.toSceneX(lot.p[k]), Math.max(lot.f, h(lot.p[k], lot.p[k + 1])) + 0.04, land.toSceneZ(lot.p[k + 1]))
      b.uvs.push(lot.p[k], lot.p[k + 1])
    }
    for (const i of triangulate(lot.p)) b.indices.push(c + i)
  }
  const out: Mesh[] = []
  for (const [key, b] of batches) {
    if (!b.indices.length) continue
    const kind = Number(key.split('|')[0]) as RoadKind | 6
    out.push(toMesh(scene, `tello-road:${key}`, b, mats[kind]))
  }
  return out
}

// ---------------------------------------------------------------- bridges

/** A box of a bridge in map coordinates: centre, half sizes (across, up, along) and the heading of its length (atan2(dx, dz north)). */
export interface BridgeBox { x: number; y: number; z: number; across: number; up: number; along: number; heading: number; part: 'deck' | 'rail'; stone?: boolean }

/** A town bridge's parapet: a stone wall with an iron railing on it (half thickness, and height to the rail's top). */
export const PARAPET_T = 0.2
export const PARAPET_H = 1.15

/** The straight runs of a bridge's centreline. */
function runs(b: BridgeData): { ax: number; az: number; bx: number; bz: number }[] {
  const p = b.p
  const out: { ax: number; az: number; bx: number; bz: number }[] = []
  let start = 0
  for (let k = 2; k < p.length; k += 2) {
    const last = k === p.length - 2
    let bend = false
    if (!last) {
      const a0 = Math.atan2(p[k] - p[start], p[k + 1] - p[start + 1])
      const a1 = Math.atan2(p[k + 2] - p[k], p[k + 3] - p[k + 1])
      bend = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) > 0.07
    }
    if (last || bend) {
      out.push({ ax: p[start], az: p[start + 1], bx: p[k], bz: p[k + 1] })
      start = k
    }
  }
  return out
}

/** Deck slabs and railings for every bridge. */
export function bridgeSolids(land: TelloLand): BridgeBox[] {
  const out: BridgeBox[] = []
  for (const b of land.doc.bridges) {
    const drivable = b.k <= 3
    const half = b.w / 2 + (drivable ? 0.9 : 0.35)
    const railH = b.s ? PARAPET_H / 2 : drivable ? 0.45 : 0.55
    for (const r of runs(b)) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az)
      if (len < 0.5) continue
      const heading = Math.atan2(r.bx - r.ax, r.bz - r.az)
      const cx = (r.ax + r.bx) / 2
      const cz = (r.az + r.bz) / 2
      out.push({ x: cx, y: b.y - 0.3, z: cz, across: half, up: 0.3, along: len / 2 + 0.3, heading, part: 'deck' })
      const sx = Math.cos(heading)
      const sz = -Math.sin(heading)
      const t = b.s ? PARAPET_T : 0.12
      for (const side of [-1, 1]) out.push({ x: cx + sx * side * (half - t), y: b.y + railH, z: cz + sz * side * (half - t), across: t, up: railH, along: len / 2 + 0.3, heading, part: 'rail', stone: !!b.s })
    }
  }
  return out
}

export function buildBridges(scene: Scene, land: TelloLand, cast: (mesh: Mesh) => void): Mesh[] {
  const boxes = bridgeSolids(land)
  if (!boxes.length) return []
  const b: Batch = { positions: [], uvs: [], indices: [] }
  for (const box of boxes) {
    if (box.stone) continue
    const c = Math.cos(box.heading)
    const s = Math.sin(box.heading)
    const base = b.positions.length / 3
    // Under a deck: extend the slab's sides down as a fascia so it reads as a beam, not a sheet.
    const down = box.part === 'deck' ? 0.5 : 0
    for (const dy of [-box.up - down, box.up]) {
      for (const [ax, al] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = ax * box.across
        const lz = al * box.along
        const mx = box.x + lx * c + lz * s
        const mz = box.z - lx * s + lz * c
        b.positions.push(land.toSceneX(mx), box.y + dy, land.toSceneZ(mz))
        b.uvs.push(mx / 3, mz / 3 + dy)
      }
    }
    const q = (i0: number, i1: number, i2: number, i3: number) => b.indices.push(base + i0, base + i1, base + i2, base + i0, base + i2, base + i3)
    q(4, 5, 6, 7); q(0, 3, 2, 1); q(0, 1, 5, 4); q(1, 2, 6, 5); q(2, 3, 7, 6); q(3, 0, 4, 7)
  }
  const mat = new StandardMaterial('tello-bridge', scene)
  mat.diffuseTexture = detailTexture(scene)
  mat.diffuseColor = new Color3(0.66, 0.65, 0.62)
  mat.specularColor = Color3.Black()
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  const data = new VertexData()
  data.positions = b.positions
  data.indices = b.indices
  const normals: number[] = []
  VertexData.ComputeNormals(b.positions, b.indices, normals, { useRightHandedSystem: false })
  data.normals = normals
  data.uvs = b.uvs
  const mesh = new Mesh('tello-bridges', scene)
  data.applyToMesh(mesh, false)
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.isPickable = false
  mesh.freezeWorldMatrix()
  cast(mesh)
  return [mesh]
}
