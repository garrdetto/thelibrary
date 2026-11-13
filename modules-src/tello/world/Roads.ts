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
import { asphaltTexture, countyRoadTexture } from '../../rackreel/world/Highway'
import { detailTexture } from '../../rackreel/world/World'
import type { BridgeData, RoadKind } from '../data/MapData'
import type { TelloLand } from '../region'
import { resample, triangulate } from './Poly'

const CELL = 512
/** How far each kind of surface sits above the ground it is draped on. */
const LIFT: Record<RoadKind, number> = { 0: 0.06, 1: 0.05, 2: 0.04, 3: 0.035, 4: 0.045, 5: 0.03 }
const JUNCTION_LIFT = 0.07

interface Batch { positions: number[]; uvs: number[]; indices: number[] }

function batchOf(map: Map<string, Batch>, key: string): Batch {
  let b = map.get(key)
  if (!b) map.set(key, (b = { positions: [], uvs: [], indices: [] }))
  return b
}

function surface(scene: Scene, name: string, texture: Texture, tint?: Color3): StandardMaterial {
  const mat = new StandardMaterial(`tello-${name}`, scene)
  mat.diffuseTexture = texture
  if (tint) mat.diffuseColor = tint
  mat.specularColor = new Color3(0.04, 0.04, 0.04)
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  mat.zOffset = -2
  return mat
}

function toMesh(scene: Scene, name: string, b: Batch, mat: StandardMaterial): Mesh {
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

export function buildRoads(scene: Scene, land: TelloLand): Mesh[] {
  const lined = countyRoadTexture(scene)
  lined.wrapV = Texture.WRAP_ADDRESSMODE
  const detail = detailTexture(scene)
  const mats: Record<RoadKind | 6, StandardMaterial> = {
    0: surface(scene, 'highway', lined),
    1: surface(scene, 'street', asphaltTexture(scene, 10)),
    2: surface(scene, 'lane', asphaltTexture(scene, 8), new Color3(0.92, 0.92, 0.92)),
    3: surface(scene, 'gravel', detail, new Color3(0.56, 0.52, 0.45)),
    4: surface(scene, 'walk', detail, new Color3(0.7, 0.69, 0.66)),
    5: surface(scene, 'trail', detail, new Color3(0.5, 0.41, 0.29)),
    6: surface(scene, 'junction', asphaltTexture(scene, 10)),
  }
  const batches = new Map<string, Batch>()
  const h = (x: number, z: number) => land.heightAt(x, z)
  for (const road of land.doc.roads) {
    const pts = resample(road.p, 4)
    const n = pts.length / 2
    const half = road.w / 2
    const lift = LIFT[road.k]
    const worldUv = road.k !== 0
    const stations: { x: number; z: number; sx: number; sz: number; along: number }[] = []
    let along = 0
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2]
      const z = pts[i * 2 + 1]
      const a = Math.max(0, i - 1)
      const c = Math.min(n - 1, i + 1)
      const dx = pts[c * 2] - pts[a * 2]
      const dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      if (i > 0) along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1])
      stations.push({ x, z, sx: -dz / len, sz: dx / len, along })
    }
    // Pieces of up to 64 m, each in the batch of the cell it starts in, so far stretches of a long road are culled.
    for (let s0 = 0; s0 < n - 1; s0 += 16) {
      const s1 = Math.min(n - 1, s0 + 16)
      const batch = batchOf(batches, `${road.k}|${Math.floor(stations[s0].x / CELL)},${Math.floor(stations[s0].z / CELL)}`)
      for (let i = s0; i <= s1; i++) {
        const st = stations[i]
        for (const side of [-1, 0, 1]) {
          const px = st.x + st.sx * side * half
          const pz = st.z + st.sz * side * half
          batch.positions.push(land.toSceneX(px), h(px, pz) + lift, land.toSceneZ(pz))
          if (worldUv) batch.uvs.push(px, pz)
          else batch.uvs.push((side + 1) / 2, st.along / 12)
        }
        if (i === s0) continue
        const v = batch.positions.length / 3 - 3
        batch.indices.push(v - 3, v, v - 2, v - 2, v, v + 1, v - 2, v + 1, v - 1, v - 1, v + 1, v + 2)
      }
    }
  }
  // Junction patches: a disc as wide as the widest road meeting there.
  for (const j of junctions(land)) {
    const b = batchOf(batches, `6|${Math.floor(j.x / CELL)},${Math.floor(j.z / CELL)}`)
    const c = b.positions.length / 3
    const r = j.r + 0.15
    b.positions.push(land.toSceneX(j.x), h(j.x, j.z) + JUNCTION_LIFT, land.toSceneZ(j.z))
    b.uvs.push(j.x, j.z)
    const seg = 14
    for (let k = 0; k <= seg; k++) {
      const ang = (k / seg) * Math.PI * 2
      const x = j.x + Math.cos(ang) * r
      const z = j.z + Math.sin(ang) * r
      b.positions.push(land.toSceneX(x), h(x, z) + JUNCTION_LIFT, land.toSceneZ(z))
      b.uvs.push(x, z)
      if (k > 0) b.indices.push(c, c + k + 1, c + k)
    }
  }
  // Parking lots: a slab on the levelled pad.
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
export interface BridgeBox { x: number; y: number; z: number; across: number; up: number; along: number; heading: number; part: 'deck' | 'rail' }

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
    const railH = drivable ? 0.45 : 0.55
    for (const r of runs(b)) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az)
      if (len < 0.5) continue
      const heading = Math.atan2(r.bx - r.ax, r.bz - r.az)
      const cx = (r.ax + r.bx) / 2
      const cz = (r.az + r.bz) / 2
      out.push({ x: cx, y: b.y - 0.3, z: cz, across: half, up: 0.3, along: len / 2 + 0.3, heading, part: 'deck' })
      const sx = Math.cos(heading)
      const sz = -Math.sin(heading)
      for (const side of [-1, 1]) out.push({ x: cx + sx * side * (half - 0.12), y: b.y + railH, z: cz + sz * side * (half - 0.12), across: 0.12, up: railH, along: len / 2 + 0.3, heading, part: 'rail' })
    }
  }
  return out
}

export function buildBridges(scene: Scene, land: TelloLand, cast: (mesh: Mesh) => void): Mesh[] {
  const boxes = bridgeSolids(land)
  if (!boxes.length) return []
  const b: Batch = { positions: [], uvs: [], indices: [] }
  for (const box of boxes) {
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
  mat.specularColor = new Color3(0.03, 0.03, 0.03)
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
