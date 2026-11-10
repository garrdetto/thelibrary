/** Weed beds in the shallows: short bushy coontail-style clumps on the bottom mixed with long streamers that reach the top and lie along the surface. Placed in patches wherever the water is 0.3–2.4 m deep (the flats, the island shelf, the channel banks and the back bay), thin-instanced per 40 m cell and shown only near the camera. */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../core/EngineSetup'
import { BAY, LAKE_CENTER, Terrain, fbm } from './Terrain'

const CELL = 40
const SPACING = 1.35
const SHOW = 150
const HIDE = 175

function hash(x: number, z: number, k: number): number {
  let h = Math.imul(Math.round(x * 13.7) | 0, 374761393) + Math.imul(Math.round(z * 17.3) | 0, 668265263) + Math.imul(k, 982451653)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface Strip {
  positions: number[]
  colors: number[]
  indices: number[]
}

/** One blade as a ribbon through `points` (x, y, z) with `width` at each point, coloured from dark at the root to lighter at the tip. */
function ribbon(out: Strip, points: number[][], widths: number[], side: number[], dark: number[], light: number[]): void {
  const base = out.positions.length / 3
  for (let i = 0; i < points.length; i++) {
    const k = i / (points.length - 1)
    const w = widths[i] / 2
    const [x, y, z] = points[i]
    out.positions.push(x - side[0] * w, y, z - side[1] * w, x + side[0] * w, y, z + side[1] * w)
    const c = [dark[0] + (light[0] - dark[0]) * k, dark[1] + (light[1] - dark[1]) * k, dark[2] + (light[2] - dark[2]) * k]
    out.colors.push(c[0], c[1], c[2], 1, c[0] * 0.92, c[1] * 0.92, c[2] * 0.92, 1)
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = base + i * 2
    out.indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
}

/** A short bushy clump, 1 unit tall (scaled to a share of the depth). */
function shortClump(): Strip {
  const out: Strip = { positions: [], colors: [], indices: [] }
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + b * 0.37
    const lean = 0.12 + (b % 3) * 0.08
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const h = 0.65 + ((b * 37) % 10) / 28
    const pts: number[][] = []
    for (let i = 0; i <= 4; i++) {
      const k = i / 4
      pts.push([dx * lean * k * k + dx * 0.04, h * k, dz * lean * k * k + dz * 0.04])
    }
    ribbon(out, pts, [0.06, 0.09, 0.1, 0.08, 0.03], [-dz, dx], [0.07, 0.11, 0.05], [0.2, 0.3, 0.1])
  }
  return out
}

/** Long streamers: up from the bottom to 1 unit, then 0.55–0.9 m lying along the surface. */
function longClump(): Strip {
  const out: Strip = { positions: [], colors: [], indices: [] }
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + 0.6
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const run = 0.55 + b * 0.12
    const pts: number[][] = []
    for (let i = 0; i <= 5; i++) {
      const k = i / 5
      pts.push([dx * 0.08 * k + Math.sin(k * 3 + b) * 0.03, 0.97 * k, dz * 0.08 * k])
    }
    for (let i = 1; i <= 3; i++) {
      const k = i / 3
      pts.push([dx * (0.08 + run * k), 0.97 + 0.02 * Math.sin(k * 2), dz * (0.08 + run * k)])
    }
    ribbon(out, pts, [0.03, 0.04, 0.045, 0.05, 0.05, 0.05, 0.06, 0.06, 0.03], [-dz, dx], [0.08, 0.12, 0.05], [0.28, 0.36, 0.13])
  }
  return out
}

function stripMesh(name: string, strip: Strip, scene: Scene, material: StandardMaterial): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = strip.positions
  data.colors = strip.colors
  data.indices = strip.indices
  const normals: number[] = []
  VertexData.ComputeNormals(strip.positions, strip.indices, normals)
  data.normals = normals
  data.applyToMesh(mesh, false)
  mesh.material = material
  mesh.isPickable = false
  mesh.receiveShadows = false
  return mesh
}

interface Cell {
  x: number
  z: number
  meshes: Mesh[]
  shown: boolean
}

export class Weeds {
  private readonly cells: Cell[] = []
  readonly count: { short: number; long: number } = { short: 0, long: 0 }

  constructor(ctx: EngineContext, terrain: Terrain) {
    const { scene } = ctx
    const material = new StandardMaterial('weeds-mat', scene)
    material.diffuseColor = Color3.White()
    material.specularColor = new Color3(0.03, 0.04, 0.02)
    material.ambientColor = new Color3(0.35, 0.35, 0.35)
    material.backFaceCulling = false
    material.twoSidedLighting = true
    const shortSrc = stripMesh('weed-short', shortClump(), scene, material)
    const longSrc = stripMesh('weed-long', longClump(), scene, material)
    shortSrc.setEnabled(false)
    longSrc.setEnabled(false)
    const x0 = Math.min(LAKE_CENTER.x - 250, BAY.x - 90)
    const x1 = Math.max(LAKE_CENTER.x + 250, BAY.x + 90)
    const z0 = Math.min(LAKE_CENTER.z - 250, BAY.z - 90)
    const z1 = Math.max(LAKE_CENTER.z + 250, BAY.z + 90)
    const q = new Quaternion()
    const s = new Vector3()
    const p = new Vector3()
    const m = new Matrix()
    for (let cz = z0; cz < z1; cz += CELL) {
      for (let cx = x0; cx < x1; cx += CELL) {
        const shortM: number[] = []
        const longM: number[] = []
        for (let gz = cz; gz < cz + CELL; gz += SPACING) {
          for (let gx = cx; gx < cx + CELL; gx += SPACING) {
            const x = gx + hash(gx, gz, 1) * SPACING
            const z = gz + hash(gx, gz, 2) * SPACING
            const depth = terrain.depthAt(x, z)
            if (depth < 0.3 || depth > 2.4) continue
            const patch = fbm(x * 0.045 + 5, z * 0.045 - 9, 3, 41) + (depth < 1.8 ? 0.2 : -0.05)
            if (patch < -0.04 || hash(gx, gz, 3) > Math.min(0.92, (patch + 0.04) * 2.4)) continue
            const long = hash(gx, gz, 4) < 0.38 && depth < 2.1
            Quaternion.FromEulerAnglesToRef(0, hash(gx, gz, 5) * Math.PI * 2, 0, q)
            const ground = -depth
            if (long) {
              s.set(1, depth + 0.005, 1)
            } else {
              const hgt = Math.min(depth - 0.08, depth * (0.3 + hash(gx, gz, 6) * 0.35) + 0.12)
              const wide = 0.8 + hash(gx, gz, 7) * 0.7
              s.set(wide, Math.max(0.12, hgt), wide)
            }
            p.set(x, ground - 0.02, z)
            Matrix.ComposeToRef(s, q, p, m)
            const target = long ? longM : shortM
            for (let k = 0; k < 16; k++) target.push(m.m[k])
          }
        }
        if (!shortM.length && !longM.length) continue
        const meshes: Mesh[] = []
        for (const [src, mats] of [[shortSrc, shortM], [longSrc, longM]] as const) {
          if (!mats.length) continue
          const mesh = src.clone(`${src.name}-${cx}-${cz}`)
          mesh.makeGeometryUnique()
          mesh.setEnabled(false)
          mesh.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true)
          mesh.thinInstanceRefreshBoundingInfo(false)
          mesh.freezeWorldMatrix()
          mesh.alwaysSelectAsActiveMesh = false
          meshes.push(mesh)
          if (src === shortSrc) this.count.short += mats.length / 16
          else this.count.long += mats.length / 16
        }
        this.cells.push({ x: cx + CELL / 2, z: cz + CELL / 2, meshes, shown: false })
      }
    }
  }

  update(camera: Vector3): void {
    for (const c of this.cells) {
      const d = Math.hypot(c.x - camera.x, c.z - camera.z)
      const show = c.shown ? d < HIDE : d < SHOW
      if (show === c.shown) continue
      c.shown = show
      for (const m of c.meshes) m.setEnabled(show)
    }
  }
}
