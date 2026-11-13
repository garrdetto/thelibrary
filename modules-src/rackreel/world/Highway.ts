/** The interstate across the north-east corner: a four-lane divided highway on an embankment, crossing the back-bay channel on a concrete girder bridge high enough to run a boat under. */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { HALF, HIGHWAY, Terrain, highwayGrade } from './Terrain'

const STEP = 4
const DASH = 12

interface Builder {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

function builder(): Builder {
  return { positions: [], normals: [], uvs: [], indices: [] }
}

export function highwayPoint(across: number, t: number): { x: number; z: number } {
  return { x: HIGHWAY.x + HIGHWAY.dx * t + HIGHWAY.dz * across, z: HIGHWAY.z + HIGHWAY.dz * t - HIGHWAY.dx * across }
}

function inside(t: number): boolean {
  const a = highwayPoint(-HIGHWAY.halfWidth, t)
  const b = highwayPoint(HIGHWAY.halfWidth, t)
  const lim = HALF - 6
  return Math.max(Math.abs(a.x), Math.abs(a.z), Math.abs(b.x), Math.abs(b.z)) < lim
}

function onSpan(t: number): boolean {
  return Math.abs(t) <= HIGHWAY.span / 2
}

function surfaceAt(terrain: Terrain, across: number, t: number): number {
  const g = highwayGrade(t, terrain.shape)
  if (onSpan(t)) return g
  const p = highwayPoint(across, t)
  return Math.max(g, terrain.heightAt(p.x, p.z)) + 0.05
}

function quad(b: Builder, p: number[][], uv: number[][]): void {
  const base = b.positions.length / 3
  const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2]
  const bx = p[3][0] - p[0][0], by = p[3][1] - p[0][1], bz = p[3][2] - p[0][2]
  let nx = ay * bz - az * by
  let ny = az * bx - ax * bz
  let nz = ax * by - ay * bx
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len
  ny /= len
  nz /= len
  for (let i = 0; i < 4; i++) {
    b.positions.push(p[i][0], p[i][1], p[i][2])
    b.normals.push(nx, ny, nz)
    b.uvs.push(uv[i][0], uv[i][1])
  }
  b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** A 2D profile (across, up) swept along the road between t0 and t1, following the road surface. */
function sweep(b: Builder, terrain: Terrain, profile: [number, number][], t0: number, t1: number, center: number, follow = true): void {
  for (let t = t0; t < t1 - 1e-6; t += STEP) {
    const ta = t
    const tb = Math.min(t1, t + STEP)
    if (!inside(ta) || !inside(tb)) continue
    const ya = follow ? surfaceAt(terrain, center, ta) : 0
    const yb = follow ? surfaceAt(terrain, center, tb) : 0
    for (let i = 0; i < profile.length - 1; i++) {
      const [a0, h0] = profile[i]
      const [a1, h1] = profile[i + 1]
      const p0 = highwayPoint(center + a0, ta)
      const p1 = highwayPoint(center + a1, ta)
      const q0 = highwayPoint(center + a0, tb)
      const q1 = highwayPoint(center + a1, tb)
      quad(b, [[p0.x, ya + h0, p0.z], [q0.x, yb + h0, q0.z], [q1.x, yb + h1, q1.z], [p1.x, ya + h1, p1.z]], [[0, 0], [0, 1], [1, 1], [1, 0]])
    }
  }
}

function box(b: Builder, across0: number, across1: number, t0: number, t1: number, y0: number, y1: number): void {
  const c = (a: number, t: number, y: number) => {
    const p = highwayPoint(a, t)
    return [p.x, y, p.z]
  }
  quad(b, [c(across0, t0, y1), c(across0, t1, y1), c(across1, t1, y1), c(across1, t0, y1)], [[0, 0], [0, 1], [1, 1], [1, 0]])
  quad(b, [c(across0, t0, y0), c(across1, t0, y0), c(across1, t1, y0), c(across0, t1, y0)], [[0, 0], [0, 1], [1, 1], [1, 0]])
  quad(b, [c(across0, t0, y0), c(across0, t0, y1), c(across1, t0, y1), c(across1, t0, y0)], [[0, 0], [0, 1], [1, 1], [1, 0]])
  quad(b, [c(across1, t1, y0), c(across1, t1, y1), c(across0, t1, y1), c(across0, t1, y0)], [[0, 0], [0, 1], [1, 1], [1, 0]])
  quad(b, [c(across0, t1, y0), c(across0, t1, y1), c(across0, t0, y1), c(across0, t0, y0)], [[0, 0], [0, 1], [1, 1], [1, 0]])
  quad(b, [c(across1, t0, y0), c(across1, t0, y1), c(across1, t1, y1), c(across1, t1, y0)], [[0, 0], [0, 1], [1, 1], [1, 0]])
}

function column(b: Builder, across: number, t: number, y0: number, y1: number, r: number): void {
  const seg = 12
  const c = highwayPoint(across, t)
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = c.x + Math.cos(a0) * r, z0 = c.z + Math.sin(a0) * r
    const x1 = c.x + Math.cos(a1) * r, z1 = c.z + Math.sin(a1) * r
    quad(b, [[x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[0, 0], [0, 1], [1, 1], [1, 0]])
  }
}

function toMesh(name: string, b: Builder, scene: Scene): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = b.positions
  data.normals = b.normals
  data.uvs = b.uvs
  data.indices = b.indices
  data.applyToMesh(mesh, false)
  mesh.isPickable = false
  mesh.receiveShadows = true
  mesh.freezeWorldMatrix()
  return mesh
}

/** The interstate's asphalt: dark grey grit with the odd lighter stone, the same for every road surface built from it. */
function paintAsphalt(g: CanvasRenderingContext2D, w: number, h: number): void {
  const img = g.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const n = Math.random() * 26 + (Math.random() < 0.02 ? 30 : 0)
    img.data[i * 4] = 52 + n
    img.data[i * 4 + 1] = 53 + n
    img.data[i * 4 + 2] = 56 + n
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
}

export function roadTexture(scene: Scene): DynamicTexture {
  const w = 256
  const h = 512
  const tex = new DynamicTexture('highway-road', { width: w, height: h }, scene, true)
  const g = tex.getContext() as CanvasRenderingContext2D
  paintAsphalt(g, w, h)
  const x = (u: number) => u * w
  g.fillStyle = 'rgba(150,148,140,0.35)'
  g.fillRect(0, 0, x(0.07), h)
  g.fillRect(x(0.93), 0, x(0.07), h)
  g.fillStyle = 'rgba(120,118,112,0.35)'
  g.fillRect(x(0.455), 0, x(0.09), h)
  g.fillStyle = '#e9e7df'
  g.fillRect(x(0.075), 0, 3, h)
  g.fillRect(x(0.92), 0, 3, h)
  g.fillStyle = '#e2b53c'
  g.fillRect(x(0.448), 0, 3, h)
  g.fillRect(x(0.548), 0, 3, h)
  g.fillStyle = '#e9e7df'
  for (const u of [0.262, 0.735]) g.fillRect(x(u), 0, 3, h * 0.25)
  tex.update(true)
  tex.wrapU = Texture.CLAMP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.anisotropicFilteringLevel = 8
  return tex
}

/** The same asphalt for a two-lane road (u across it): worn shoulders, white edge lines and a double yellow centre line. */
export function countyRoadTexture(scene: Scene): DynamicTexture {
  const w = 256
  const h = 512
  const tex = new DynamicTexture('county-road', { width: w, height: h }, scene, true)
  const g = tex.getContext() as CanvasRenderingContext2D
  paintAsphalt(g, w, h)
  const x = (u: number) => u * w
  g.fillStyle = 'rgba(150,148,140,0.3)'
  g.fillRect(0, 0, x(0.05), h)
  g.fillRect(x(0.95), 0, x(0.05), h)
  g.fillStyle = 'rgba(30,30,32,0.25)'
  for (const u of [0.2, 0.32, 0.68, 0.8]) g.fillRect(x(u), 0, x(0.05), h)
  g.fillStyle = '#e9e7df'
  g.fillRect(x(0.06), 0, 4, h)
  g.fillRect(x(0.94) - 4, 0, 4, h)
  g.fillStyle = '#e2b53c'
  g.fillRect(x(0.5) - 6, 0, 4, h)
  g.fillRect(x(0.5) + 2, 0, 4, h)
  tex.update(true)
  tex.wrapU = Texture.CLAMP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.anisotropicFilteringLevel = 8
  return tex
}

/** The plain asphalt (no markings), tiling both ways, for streets and lots laid in world units: one tile per `tile` metres. */
export function asphaltTexture(scene: Scene, tile = 10): DynamicTexture {
  const size = 256
  const tex = new DynamicTexture('asphalt', { width: size, height: size }, scene, true)
  paintAsphalt(tex.getContext() as CanvasRenderingContext2D, size, size)
  tex.update(true)
  tex.wrapU = Texture.WRAP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.uScale = 1 / tile
  tex.vScale = 1 / tile
  tex.anisotropicFilteringLevel = 8
  return tex
}

export interface HighwayMeshes {
  road: Mesh
  concrete: Mesh
}

export function buildHighway(ctx: EngineContext, terrain: Terrain): HighwayMeshes {
  const { scene } = ctx
  const hw = HIGHWAY.halfWidth
  const road = builder()
  const across = [-hw, -hw * 0.5, 0, hw * 0.5, hw]
  for (let t = -HIGHWAY.reach; t < HIGHWAY.reach - 1e-6; t += STEP) {
    const tb = t + STEP
    if (!inside(t) || !inside(tb)) continue
    for (let i = 0; i < across.length - 1; i++) {
      const a0 = across[i]
      const a1 = across[i + 1]
      const p0 = highwayPoint(a0, t)
      const p1 = highwayPoint(a1, t)
      const q0 = highwayPoint(a0, tb)
      const q1 = highwayPoint(a1, tb)
      const u0 = (a0 + hw) / (2 * hw)
      const u1 = (a1 + hw) / (2 * hw)
      quad(road, [[p0.x, surfaceAt(terrain, a0, t), p0.z], [q0.x, surfaceAt(terrain, a0, tb), q0.z], [q1.x, surfaceAt(terrain, a1, tb), q1.z], [p1.x, surfaceAt(terrain, a1, t), p1.z]], [[u0, t / DASH], [u0, tb / DASH], [u1, tb / DASH], [u1, t / DASH]])
    }
  }
  const concrete = builder()
  const gaps = terrain.shape.highwayGaps ?? []
  /** `sweep` with the host world's openings in this barrier left out. */
  const run = (b: Builder, profile: [number, number][], t0: number, t1: number, side: -1 | 0 | 1, center: number) => {
    let spans: [number, number][] = [[t0, t1]]
    for (const g of gaps) {
      if (g.side !== side) continue
      spans = spans.flatMap(([a, c]) => (g.t1 <= a || g.t0 >= c ? [[a, c] as [number, number]] : ([[a, g.t0], [g.t1, c]] as [number, number][]).filter(([u, v]) => v - u > 1)))
    }
    for (const [a, c] of spans) sweep(b, terrain, profile, a, c, center)
  }
  const jersey: [number, number][] = [[-0.32, 0], [-0.26, 0.08], [-0.12, 0.3], [-0.1, 0.82], [0.1, 0.82], [0.12, 0.3], [0.26, 0.08], [0.32, 0]]
  run(concrete, jersey, -HIGHWAY.reach, HIGHWAY.reach, 0, 0)
  for (const side of [-1, 1]) sweep(concrete, terrain, jersey, -HIGHWAY.span / 2 - 4, HIGHWAY.span / 2 + 4, side * (hw - 0.35))
  const rail: [number, number][] = [[-0.04, 0.55], [0.04, 0.55], [0.04, 0.78], [-0.04, 0.78], [-0.04, 0.55]]
  const post: [number, number][] = [[-0.07, 0], [0.07, 0], [0.07, 0.62], [-0.07, 0.62], [-0.07, 0]]
  for (const side of [-1, 1] as const) {
    run(concrete, rail, -HIGHWAY.reach, -HIGHWAY.span / 2 - 4, side, side * (hw + 0.4))
    run(concrete, rail, HIGHWAY.span / 2 + 4, HIGHWAY.reach, side, side * (hw + 0.4))
    if (gaps.length) {
      for (let t = -HIGHWAY.reach; t < HIGHWAY.reach; t += 4) {
        if (Math.abs(t) < HIGHWAY.span / 2 + 4 || gaps.some((g) => g.side === side && t > g.t0 - 0.5 && t < g.t1 + 0.5)) continue
        run(concrete, post, t, t + 0.16, side, side * (hw + 0.46))
      }
    }
  }
  const deck = HIGHWAY.deck
  const s = HIGHWAY.span / 2
  box(concrete, -hw - 0.5, hw + 0.5, -s - 2, s + 2, deck - 0.75, deck - 0.02)
  for (const a of [-hw + 1.6, -hw * 0.35, hw * 0.35, hw - 1.6]) box(concrete, a - 0.3, a + 0.3, -s - 2, s + 2, deck - 1.85, deck - 0.75)
  for (const t of [-s + 12, s - 12]) {
    box(concrete, -hw - 0.2, hw + 0.2, t - 0.6, t + 0.6, deck - 2.75, deck - 1.85)
    for (const a of [-hw + 2.5, 0, hw - 2.5]) {
      const p = highwayPoint(a, t)
      column(concrete, a, t, terrain.heightAt(p.x, p.z) - 0.5, deck - 2.7, 0.6)
    }
  }
  for (const t of [-s, s]) {
    const p = highwayPoint(0, t)
    const ground = Math.min(terrain.heightAt(p.x, p.z), terrain.heightAt(highwayPoint(-hw, t).x, highwayPoint(-hw, t).z), terrain.heightAt(highwayPoint(hw, t).x, highwayPoint(hw, t).z))
    const dir = Math.sign(t)
    box(concrete, -hw - 0.8, hw + 0.8, t - (dir < 0 ? 1.4 : 0), t + (dir > 0 ? 1.4 : 0), ground - 1, deck - 0.75)
    for (const side of [-1, 1]) box(concrete, side * (hw + 0.8) - 0.5, side * (hw + 0.8) + 0.5, t + dir * 0.0, t + dir * 9, ground - 1, deck - 0.4)
  }
  const roadMesh = toMesh('highway-road', road, scene)
  const roadMat = new StandardMaterial('highway-road-mat', scene)
  roadMat.diffuseTexture = roadTexture(scene)
  roadMat.specularColor = new Color3(0.04, 0.04, 0.04)
  roadMat.ambientColor = new Color3(0.35, 0.35, 0.35)
  roadMat.backFaceCulling = false
  roadMesh.material = roadMat
  const concreteMesh = toMesh('highway-concrete', concrete, scene)
  const concreteMat = new StandardMaterial('highway-concrete-mat', scene)
  concreteMat.diffuseColor = new Color3(0.62, 0.6, 0.56)
  concreteMat.specularColor = new Color3(0.03, 0.03, 0.03)
  concreteMat.ambientColor = new Color3(0.35, 0.35, 0.35)
  concreteMat.backFaceCulling = false
  concreteMesh.material = concreteMat
  ctx.shadows.addShadowCaster(concreteMesh)
  return { road: roadMesh, concrete: concreteMesh }
}

/** True when (x, z) is on the highway surface (for keeping grass and rocks off it). */
export function onHighway(across: number, t: number): boolean {
  return across < HIGHWAY.halfWidth + 1.5 && Math.abs(t) < HIGHWAY.reach
}
