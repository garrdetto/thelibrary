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
import { isMainLeg, townProfiles } from '../data/Streets'
import { insideBuilding, onLot, pavementOf } from './Clearance'
import { junctionFills } from './JunctionShapes'
import { triangulate } from './Poly'
import { stationsOf } from './Stations'
export { stationsOf, type Station } from './Stations'

export const CELL = 512
/** How far each kind of surface sits above the ground it is draped on. */
const LIFT: Record<RoadKind, number> = { 0: 0.06, 1: 0.05, 2: 0.04, 3: 0.035, 4: 0.15, 5: 0.03 }
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

/**
 * A still, unpickable mesh from a batch. Nothing reads a road's vertices back once they are on the GPU, so the copies
 * Babylon would keep are dropped (`clearCachedData`): the roads, street paint and decals held about 130 MB of plain
 * number arrays for the whole session before.
 */
export function toMesh(scene: Scene, name: string, b: Batch, mat: StandardMaterial): Mesh {
  const positions = Float32Array.from(b.positions)
  const normals = new Float32Array(positions.length)
  VertexData.ComputeNormals(positions, b.indices, normals, { useRightHandedSystem: false })
  for (let i = 1; i < normals.length; i += 3) {
    if (normals[i] < 0) {
      normals[i - 1] = -normals[i - 1]
      normals[i] = -normals[i]
      normals[i + 1] = -normals[i + 1]
    }
  }
  const data = new VertexData()
  data.positions = positions
  data.indices = positions.length / 3 > 65535 ? Uint32Array.from(b.indices) : Uint16Array.from(b.indices)
  data.normals = normals
  data.uvs = Float32Array.from(b.uvs)
  const mesh = new Mesh(name, scene)
  data.applyToMesh(mesh, false)
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.isPickable = false
  mesh.freezeWorldMatrix()
  mesh.doNotSyncBoundingInfo = true
  releaseVertices(mesh)
  return mesh
}

/**
 * Drops the copy of a mesh's vertices and indices Babylon keeps after uploading them. Only once: clearing a second time
 * would record zero indices, and Babylon would then stop treating the mesh's one submesh as the whole mesh (a
 * see-through one then has no bounds to sort by).
 */
export function releaseVertices(mesh: Mesh): void {
  const geometry = mesh.geometry
  if (!geometry || !geometry.getIndices(false)?.length) return
  geometry.clearCachedData()
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
  const pavement = pavementOf(land)
  const profiles = townProfiles(land.doc)
  land.doc.roads.forEach((road, roadIndex) => {
    const prof = profiles.get(road)
    const town = !!prof || isMainLeg(road)
    const stations = stationsOf(road, prof, town)
    const n = stations.length
    const halfAt = (i: number) => (prof ? prof.half[i] : road.w / 2)
    const kind: RoadKind = town ? 1 : road.k
    const lift = LIFT[road.k] + (roadIndex % LAYERS) * LAYER_GAP
    const walk = road.k >= 4
    // A station is left out where the ribbon would run into a wall, or (a walk or trail) across a street.
    const drop = stations.map((st) => {
      if (road.k >= 2 && insideBuilding(land, st.x, st.z) > 0.3) return true
      return walk && (pavement.inside(st.x, st.z) > -0.15 || onLot(land, st.x, st.z))
    })
    let maxHalf = 0
    for (let i = 0; i < n; i++) maxHalf = Math.max(maxHalf, halfAt(i))
    const cols = Math.max(2, Math.ceil((2 * maxHalf) / ACROSS_STEP))
    for (let s0 = 0; s0 < n - 1; s0 += 16) {
      const s1 = Math.min(n - 1, s0 + 16)
      if (!land.seen(stations[s0].x, stations[s0].z, ROAD_SEEN) && !land.seen(stations[s1].x, stations[s1].z, ROAD_SEEN)) continue
      const cell = `${Math.floor(stations[s0].x / CELL)},${Math.floor(stations[s0].z / CELL)}`
      const batch = batchOf(batches, `${kind}|${cell}`)
      let prev = -1
      // The coarse surface (each station's two edges and centre): a point never sits below it, so where the ground
      // between drops away (the dug-out river under a bridge deck) the ribbon spans it as before.
      const coarse = (i: number): [number, number, number] => {
        const st = stations[i], half = halfAt(i) * st.miter
        return [h(st.x - st.sx * half, st.z - st.sz * half), h(st.x, st.z), h(st.x + st.sx * half, st.z + st.sz * half)]
      }
      const floorAt = (ca: [number, number, number], cb: [number, number, number], t: number, side: number) => {
        const at = (c: [number, number, number]) => (side < 0 ? c[1] + (c[0] - c[1]) * -side : c[1] + (c[2] - c[1]) * side)
        return at(ca) * (1 - t) + at(cb) * t
      }
      const row = (x: number, z: number, sx: number, sz: number, half: number, ca: [number, number, number], cb: [number, number, number], t: number) => {
        const base = batch.positions.length / 3
        for (let c = 0; c <= cols; c++) {
          const side = -1 + (2 * c) / cols
          const px = x + sx * side * half
          const pz = z + sz * side * half
          batch.positions.push(land.toSceneX(px), Math.max(h(px, pz), floorAt(ca, cb, t, side)) + lift, land.toSceneZ(pz))
          batch.uvs.push(px, pz)
        }
        if (prev >= 0) {
          for (let c = 0; c < cols; c++) batch.indices.push(prev + c, base + c, prev + c + 1, prev + c + 1, base + c, base + c + 1)
        }
        prev = base
      }
      for (let i = s0; i <= s1; i++) {
        if (drop[i]) {
          prev = -1
          continue
        }
        const a = stations[i]
        const ca = coarse(i)
        row(a.x, a.z, a.sx, a.sz, halfAt(i) * a.miter, ca, ca, 0)
        if (i === s1 || drop[i + 1]) continue
        const b = stations[i + 1]
        const cb = coarse(i + 1)
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / ALONG_STEP)
        for (let k = 1; k < steps; k++) {
          const t = k / steps
          const sx = a.sx + (b.sx - a.sx) * t, sz = a.sz + (b.sz - a.sz) * t
          const sl = Math.hypot(sx, sz) || 1
          const half = (halfAt(i) * a.miter) * (1 - t) + halfAt(i + 1) * b.miter * t
          row(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, sx / sl, sz / sl, half, ca, cb, t)
        }
      }
      if (walk) {
        const curb = batchOf(batches, `${road.k}|${cell}`)
        for (let i = s0; i < s1; i++) {
          if (drop[i] || drop[i + 1]) continue
          const a = stations[i], b = stations[i + 1]
          const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / ALONG_STEP)
          const edge = (t: number, side: number): [number, number] => {
            const sx = a.sx + (b.sx - a.sx) * t, sz = a.sz + (b.sz - a.sz) * t
            const sl = Math.hypot(sx, sz) || 1
            const half = halfAt(i) * a.miter * (1 - t) + halfAt(i + 1) * b.miter * t
            return [a.x + (b.x - a.x) * t + (sx / sl) * side * half, a.z + (b.z - a.z) * t + (sz / sl) * side * half]
          }
          for (const side of [-1, 1]) {
            for (let k = 0; k < steps; k++) {
              const [ax, az] = edge(k / steps, side)
              const [bx, bz] = edge((k + 1) / steps, side)
              skirt(curb, land, ax, az, h(ax, az) + lift, h(ax, az) - 0.05, bx, bz, h(bx, bz) + lift, h(bx, bz) - 0.05)
            }
          }
        }
      }
    }
    if (walk) {
      // Round every bend and every free end, so walks meet in curves instead of notches and square corners.
      for (let i = 0; i < n; i++) {
        if (drop[i]) continue
        const st = stations[i]
        const end = i === 0 || i === n - 1 || drop[i - 1] || drop[i + 1]
        if (!end && st.miter < 1.02) continue
        const r = halfAt(i)
        if (!land.seen(st.x, st.z, ROAD_SEEN)) continue
        if (pavement.inside(st.x, st.z) > -r - 0.1 || insideBuilding(land, st.x, st.z) > -r) continue
        const b = batchOf(batches, `${road.k}|${Math.floor(st.x / CELL)},${Math.floor(st.z / CELL)}`)
        roundCap(b, land, h, st.x, st.z, r, lift - 0.0005)
      }
    }
  })
  for (const fill of junctionFills(land.doc)) {
    const t = fill.tris
    if (!land.seen(t[0], t[1], ROAD_SEEN)) continue
    const b = batchOf(batches, `${fill.kind >= 2 ? fill.kind : 6}|${Math.floor(t[0] / CELL)},${Math.floor(t[1] / CELL)}`)
    const lift = LIFT[fill.kind as RoadKind] + (LAYERS - 1) * LAYER_GAP + FILL_OVER
    for (let k = 0; k < t.length; k += 6) fineTriangle(b, land, h, lift, -Infinity, t[k], t[k + 1], t[k + 2], t[k + 3], t[k + 4], t[k + 5])
  }
  for (const lot of land.doc.lots) {
    const b = batchOf(batches, `2|${Math.floor(lot.p[0] / CELL)},${Math.floor(lot.p[1] / CELL)}`)
    const tri = triangulate(lot.p)
    const p = lot.p
    for (let k = 0; k < tri.length; k += 3) {
      const i0 = tri[k] * 2, i1 = tri[k + 1] * 2, i2 = tri[k + 2] * 2
      fineTriangle(b, land, h, 0.04, lot.f, p[i0], p[i0 + 1], p[i1], p[i1 + 1], p[i2], p[i2 + 1])
    }
  }
  const out: Mesh[] = []
  for (const [key, b] of batches) {
    if (!b.indices.length) continue
    const kind = Number(key.split('|')[0]) as RoadKind | 6
    out.push(toMesh(scene, `tello-road:${key}`, b, mats[kind]))
  }
  return out
}

/** Points across a ribbon are at most this far apart, so the ground between them can't rise through the surface. */
const ACROSS_STEP = 1.6
/** Rows along a ribbon are at most this far apart (stations are 3 to 4 m apart; the ground grid is 4 m). */
const ALONG_STEP = 1.6

/** A vertical face from a ribbon's edge down to the ground (a curb). */
function skirt(b: Batch, land: TelloLand, ax: number, az: number, at: number, ab: number, bx: number, bz: number, bt: number, bb: number): void {
  const v = b.positions.length / 3
  for (const [x, z, y] of [[ax, az, at], [bx, bz, bt], [bx, bz, bb], [ax, az, ab]]) {
    b.positions.push(land.toSceneX(x), y, land.toSceneZ(z))
    b.uvs.push(x, z + y)
  }
  b.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
}

const CAP_SEGMENTS = 14

/** A round pad of walk (with its curb) centred on a bend or the end of a walk. */
function roundCap(b: Batch, land: TelloLand, h: (x: number, z: number) => number, x: number, z: number, r: number, lift: number): void {
  const top = (px: number, pz: number) => h(px, pz) + lift
  const centre = b.positions.length / 3
  b.positions.push(land.toSceneX(x), top(x, z), land.toSceneZ(z))
  b.uvs.push(x, z)
  const rim: [number, number, number][] = []
  for (let k = 0; k < CAP_SEGMENTS; k++) {
    const a = (k / CAP_SEGMENTS) * Math.PI * 2
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
    const y = top(px, pz)
    rim.push([px, pz, y])
    b.positions.push(land.toSceneX(px), y, land.toSceneZ(pz))
    b.uvs.push(px, pz)
  }
  for (let k = 0; k < CAP_SEGMENTS; k++) b.indices.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % CAP_SEGMENTS))
  for (let k = 0; k < CAP_SEGMENTS; k++) {
    const [ax, az, at] = rim[k]
    const [bx, bz, bt] = rim[(k + 1) % CAP_SEGMENTS]
    skirt(b, land, ax, az, at, h(ax, az) - 0.05, bx, bz, bt, h(bx, bz) - 0.05)
  }
}

/** Pavement edges are split until no side is longer than this, so slabs follow the ground instead of cutting into it. */
const FINE_EDGE = 2.4

/**
 * Lays a triangle (map x, z) split into pieces no wider than `FINE_EDGE`, each point `lift` over the ground, never below
 * the plane through the corners (so it spans a dip such as the river under a bridge) nor below `floor`.
 */
function fineTriangle(b: Batch, land: TelloLand, h: (x: number, z: number) => number, lift: number, floor: number, x0: number, z0: number, x1: number, z1: number, x2: number, z2: number): void {
  const y0 = h(x0, z0), y1 = h(x1, z1), y2 = h(x2, z2)
  const longest = Math.max(Math.hypot(x1 - x0, z1 - z0), Math.hypot(x2 - x1, z2 - z1), Math.hypot(x0 - x2, z0 - z2))
  const n = Math.max(1, Math.min(24, Math.ceil(longest / FINE_EDGE)))
  const base = b.positions.length / 3
  const index = (i: number, j: number) => base + (i * (i + 1)) / 2 + j
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= i; j++) {
      const u = (n - i) / n, v = (i - j) / n, w = j / n
      const x = x0 * u + x1 * v + x2 * w
      const z = z0 * u + z1 * v + z2 * w
      b.positions.push(land.toSceneX(x), Math.max(floor, h(x, z), y0 * u + y1 * v + y2 * w) + lift, land.toSceneZ(z))
      b.uvs.push(x, z)
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      b.indices.push(index(i, j), index(i + 1, j), index(i + 1, j + 1))
      if (j < i) b.indices.push(index(i, j), index(i + 1, j + 1), index(i, j + 1))
    }
  }
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
