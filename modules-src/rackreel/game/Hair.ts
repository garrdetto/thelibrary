/**
 * Hairstyles grown over the scan's own scalp. The scalp is where the heads' hair mask (red channel of
 * `hunter-head-masks.webp`) covers the face part; each style is a thickness over it (a crop, a quiff, spikes, curls, a
 * round afro, a mohawk strip, a long fall down the back) plus a bun or a ponytail where the style has one. The shell
 * tapers to nothing at the hairline, follows the face sliders (it is rebuilt from the shaped face), is skinned with the
 * face's own weights so it moves with the head, and wears a strand texture tinted to the picked hair colour. Hats
 * hide it (the head's painted hair is tucked under the hat as before).
 */
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Skeleton } from '@babylonjs/core/Bones/skeleton'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { modelFileUrl } from '../core/ModelLibrary'
import type { HeadFrame } from '../systems/FaceShape'
import { noise } from './Garments'

/** Hair colour per `HAIR` id (the painted heads' own hair colours). */
export const HAIR_COLOUR: Record<string, [number, number, number]> = {
  base: [0.2, 0.13, 0.09],
  young: [0.06, 0.05, 0.05],
  sandy: [0.46, 0.36, 0.24],
  blond: [0.64, 0.52, 0.32],
  ginger: [0.38, 0.17, 0.08],
  silver: [0.62, 0.62, 0.62],
  elder: [0.86, 0.85, 0.82],
}

/** What a hairstyle is grown from: the face part as modelled and how much hair each of its vertices carries. */
export interface ScalpSource {
  normals: Float32Array
  indices: ArrayLike<number>
  matricesIndices: Float32Array
  matricesWeights: Float32Array
  /** Hair mask under each vertex, 0..1. */
  hair: Float32Array
  head: HeadFrame
  headJoint: number
}

const sources = new WeakMap<Mesh, Promise<ScalpSource | null>>()
let maskPixels: Promise<{ data: Uint8ClampedArray; size: number } | null> | null = null

function loadMask(): Promise<{ data: Uint8ClampedArray; size: number } | null> {
  maskPixels ??= new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(image, 0, 0, size, size)
      resolve({ data: ctx.getImageData(0, 0, size, size).data, size })
    }
    image.onerror = () => resolve(null)
    image.src = modelFileUrl('hunter-head-masks.webp')
  })
  return maskPixels
}

/** The scalp of a rig's face part (shared by every rig of the same template, keyed by its source geometry's first mesh). */
export function scalpSource(face: Mesh, head: HeadFrame, headJoint: number): Promise<ScalpSource | null> {
  const key = (face.geometry?.meshes[0] as Mesh | undefined) ?? face
  let found = sources.get(key)
  if (!found) {
    found = loadMask().then((mask) => {
      const uv = face.getVerticesData(VertexBuffer.UVKind)
      const normals = face.getVerticesData(VertexBuffer.NormalKind)
      const indices = face.getIndices()
      const mi = face.getVerticesData(VertexBuffer.MatricesIndicesKind)
      const mw = face.getVerticesData(VertexBuffer.MatricesWeightsKind)
      if (!mask || !uv || !normals || !indices || !mi || !mw) return null
      const n = normals.length / 3
      const hair = new Float32Array(n)
      const s = mask.size
      for (let i = 0; i < n; i++) {
        const x = Math.min(s - 1, Math.max(0, Math.floor(uv[i * 2] * s)))
        const y = Math.min(s - 1, Math.max(0, Math.floor((1 - uv[i * 2 + 1]) * s)))
        hair[i] = mask.data[(y * s + x) * 4] / 255
      }
      return { normals: new Float32Array(normals), indices: Array.from(indices), matricesIndices: new Float32Array(mi), matricesWeights: new Float32Array(mw), hair, head, headJoint }
    })
    sources.set(key, found)
  }
  return found
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How far a scalp point grows out (metres) for a style. `d` is the direction from the skull's middle (x, y, z), `p`
 * the point itself.
 */
function thickness(style: string, dx: number, dy: number, dz: number, px: number, py: number, pz: number, reach: number): number {
  const up = Math.max(0, dy)
  const front = Math.max(0, dz)
  const back = Math.max(0, -dz)
  switch (style) {
    case 'crop': return 0.002 + up * 0.004
    case 'quiff': return 0.003 + up * 0.006 + up * front * 0.045 * smooth(-0.2, 0.5, dz)
    case 'spiky': {
      const spikes = Math.max(0, Math.sin(px * 160) * Math.sin(pz * 160 + py * 40)) ** 2
      return 0.003 + up * 0.006 + up * spikes * 0.03
    }
    case 'curly': return 0.008 + up * 0.009 + (noise(px * 90, py * 90, pz * 90) - 0.5) * 0.012
    case 'afro': return Math.max(0.008, 0.15 - reach) + (noise(px * 70, py * 70, pz * 70) - 0.5) * 0.01
    case 'mohawk': {
      const strip = Math.exp(-((dx / 0.16) ** 2))
      return 0.001 + strip * (0.01 + up * 0.045 + back * 0.015)
    }
    case 'bun':
    case 'ponytail': return 0.002 + up * 0.002
    case 'long': return 0.006 + up * 0.004 + back * 0.012
    default: return 0
  }
}

export interface HairBuild {
  data: VertexData
  /** True when only the ponytail is kept (under a hat). */
  tailOnly: boolean
}

/**
 * The hair geometry for a style over the face's current positions, or null for the scan's own painted hair or under a
 * hat.
 */
export function buildHair(style: string, src: ScalpSource, positions: Float32Array, hatted: boolean): VertexData | null {
  if (style === 'painted' || !style) return null
  if (hatted) return null
  const { head } = src
  const cx = head.centre[0]
  const cz = head.centre[1]
  const cy = (head.top + head.chin) / 2 + 0.02
  const n = positions.length / 3
  const out: number[] = []
  const uv: number[] = []
  const mi: number[] = []
  const mw: number[] = []
  const tri: number[] = []
  const map = new Int32Array(n).fill(-1)
  const scalp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const vx = positions[i * 3] - cx
    const vy = positions[i * 3 + 1] - cy
    const vz = positions[i * 3 + 2] - cz
    const reach = Math.hypot(vx, vy, vz) || 1
    const lim = -0.02 - 0.42 * smooth(-0.1, -0.75, vz / reach)
    scalp[i] = src.hair[i] * smooth(lim, lim + 0.4, vy / reach)
  }
  const use = (i: number) => scalp[i] > 0.03
  for (let t = 0; t < src.indices.length; t += 3) {
    const a = src.indices[t]
    const b = src.indices[t + 1]
    const c = src.indices[t + 2]
    if (!use(a) || !use(b) || !use(c)) continue
    for (const i of [a, b, c]) {
      if (map[i] >= 0) continue
      const px = positions[i * 3]
      const py = positions[i * 3 + 1]
      const pz = positions[i * 3 + 2]
      const vx = px - cx
      const vy = py - cy
      const vz = pz - cz
      const reach = Math.hypot(vx, vy, vz) || 1
      const taper = smooth(0.03, 0.8, scalp[i])
      let grow = thickness(style, vx / reach, vy / reach, vz / reach, px, py, pz, reach) * taper + 0.001
      if (style === 'long') grow += smooth(0.0, -0.6, vy / reach) * smooth(0, -0.5, vz / reach) * 0.03 * taper
      const nx = src.normals[i * 3]
      const ny = src.normals[i * 3 + 1]
      const nz = src.normals[i * 3 + 2]
      const radial = style === 'afro' ? 0.7 : 0.25
      const gx = nx * (1 - radial) + (vx / reach) * radial
      const gy = ny * (1 - radial) + (vy / reach) * radial
      const gz = nz * (1 - radial) + (vz / reach) * radial
      const gl = Math.hypot(gx, gy, gz) || 1
      map[i] = out.length / 3
      out.push(px + (gx / gl) * grow, py + (gy / gl) * grow, pz + (gz / gl) * grow)
      uv.push((px + pz * 0.7) * 30, (py - pz * 0.35) * 6)
      for (let k = 0; k < 4; k++) {
        mi.push(src.matricesIndices[i * 4 + k])
        mw.push(src.matricesWeights[i * 4 + k])
      }
    }
    tri.push(map[a], map[b], map[c])
  }
  if (style === 'long') addFall(out, uv, mi, mw, tri, src, positions, map, scalp, cx, cy, cz)
  if (style === 'bun') addBlob(out, uv, mi, mw, tri, src.headJoint, cx, head.top - 0.035, cz - 0.1, 0.038, 0.034)
  if (style === 'ponytail') addTail(out, uv, mi, mw, tri, src.headJoint, cx, head.top - 0.07, cz - 0.1)
  if (!tri.length) return null
  const data = new VertexData()
  data.positions = out
  data.indices = tri
  data.uvs = uv
  data.matricesIndices = mi
  data.matricesWeights = mw
  const normals: number[] = []
  VertexData.ComputeNormals(out, tri, normals)
  data.normals = normals
  return data
}

function rigid(mi: number[], mw: number[], joint: number): void {
  mi.push(joint, 0, 0, 0)
  mw.push(1, 0, 0, 0)
}

/** A slightly squashed ball (a bun). */
function addBlob(out: number[], uv: number[], mi: number[], mw: number[], tri: number[], joint: number, x: number, y: number, z: number, r: number, ry: number): void {
  const base = out.length / 3
  const rings = 8
  const segs = 12
  for (let i = 0; i <= rings; i++) {
    const v = (i / rings) * Math.PI
    for (let j = 0; j <= segs; j++) {
      const u = (j / segs) * Math.PI * 2
      out.push(x + Math.sin(v) * Math.cos(u) * r, y + Math.cos(v) * ry, z + Math.sin(v) * Math.sin(u) * r)
      uv.push(j / segs * 4, i / rings * 2)
      rigid(mi, mw, joint)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * (segs + 1) + j
      const b = a + segs + 1
      tri.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
}

/** A tapered tail from a tie at the back of the head, hanging down and a little out. */
function addTail(out: number[], uv: number[], mi: number[], mw: number[], tri: number[], joint: number, x: number, y: number, z: number): void {
  const base = out.length / 3
  const rings = 10
  const segs = 10
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const cy = y - t * 0.24
    const cz = z - 0.025 - Math.sin(t * Math.PI * 0.6) * 0.035
    const r = 0.026 * (1 - t * 0.75) + (t < 0.12 ? 0.006 : 0)
    for (let j = 0; j <= segs; j++) {
      const u = (j / segs) * Math.PI * 2
      out.push(x + Math.cos(u) * r, cy, cz + Math.sin(u) * r * 0.8)
      uv.push(j / segs * 3, t * 3)
      rigid(mi, mw, joint)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * (segs + 1) + j
      const b = a + segs + 1
      tri.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
}

/**
 * Shoulder-length hair: a sheet falling from the scalp's lower back edge to the shoulders. Edge vertices are the scalp
 * shell's vertices whose scalp weight is thin (the hairline) on the back half of the head.
 */
function addFall(out: number[], uv: number[], mi: number[], mw: number[], tri: number[], src: ScalpSource, positions: Float32Array, map: Int32Array, weight: Float32Array, cx: number, cy: number, cz: number): void {
  const edge: { i: number; angle: number }[] = []
  for (let i = 0; i < map.length; i++) {
    if (map[i] < 0) continue
    const dz = positions[i * 3 + 2] - cz
    const dy = positions[i * 3 + 1] - cy
    if (dz > 0.035 || dy > 0.02) continue
    if (weight[i] > 0.45) continue
    edge.push({ i, angle: Math.atan2(positions[i * 3] - cx, -dz) })
  }
  if (edge.length < 6) return
  edge.sort((a, b) => a.angle - b.angle)
  const steps = 18
  const lo = edge[0].angle
  const hi = edge[edge.length - 1].angle
  const picks: number[] = []
  for (let s = 0; s <= steps; s++) {
    const want = lo + ((hi - lo) * s) / steps
    let best = edge[0]
    for (const e of edge) if (Math.abs(e.angle - want) < Math.abs(best.angle - want)) best = e
    picks.push(best.i)
  }
  const drop = 0.16
  const rows = 4
  const base = out.length / 3
  for (const i of picks) {
    const top = map[i]
    const tx = out[top * 3]
    const ty = out[top * 3 + 1]
    const tz = out[top * 3 + 2]
    const ox = tx - cx
    const oz = tz - cz
    const ol = Math.hypot(ox, oz) || 1
    for (let r = 0; r <= rows; r++) {
      const t = r / rows
      const flare = 1 + t * 0.12
      out.push(cx + ox * flare + (ox / ol) * 0.006 * t, ty - drop * t, cz + oz * flare + (oz / ol) * 0.01 * t)
      uv.push((tx + tz * 0.7) * 30, (ty - drop * t - tz * 0.35) * 6)
      for (let k = 0; k < 4; k++) {
        mi.push(src.matricesIndices[i * 4 + k])
        mw.push(src.matricesWeights[i * 4 + k])
      }
    }
  }
  for (let c = 0; c < picks.length - 1; c++) {
    for (let r = 0; r < rows; r++) {
      const a = base + c * (rows + 1) + r
      const b = base + (c + 1) * (rows + 1) + r
      tri.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
}

const strandTextures = new WeakMap<Scene, RawTexture>()
const hairMaterials = new WeakMap<Scene, Map<string, Material>>()

/** A strand texture: fine streaks of varied brightness running along v, white so the material's colour tints it. */
function strands(scene: Scene): RawTexture {
  let found = strandTextures.get(scene)
  if (found) return found
  const w = 128
  const h = 128
  const data = new Uint8Array(w * h * 4)
  for (let x = 0; x < w; x++) {
    const base = 0.78 + noise(x * 0.9, 0.5, 3.1) * 0.32
    for (let y = 0; y < h; y++) {
      const wave = noise(x * 0.9, y * 0.06, 7.7)
      const v = Math.max(0, Math.min(1, base * (0.84 + wave * 0.24)))
      const o = (y * w + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v * 255
      data[o + 3] = 255
    }
  }
  found = new RawTexture(data, w, h, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE)
  found.name = 'rr-hunter-hair-strands'
  found.wrapU = Texture.WRAP_ADDRESSMODE
  found.wrapV = Texture.WRAP_ADDRESSMODE
  found.anisotropicFilteringLevel = 8
  strandTextures.set(scene, found)
  return found
}

/** One matte material per hair colour, shared by every head of that colour. */
export function hairMaterial(scene: Scene, colour: string): Material {
  let perScene = hairMaterials.get(scene)
  if (!perScene) hairMaterials.set(scene, (perScene = new Map()))
  const hit = perScene.get(colour)
  if (hit) return hit
  const c = HAIR_COLOUR[colour] ?? HAIR_COLOUR.base
  const mat = new StandardMaterial(`rr-hair-${colour}`, scene)
  mat.diffuseTexture = strands(scene)
  mat.diffuseColor = new Color3(c[0] * 1.25, c[1] * 1.25, c[2] * 1.25)
  mat.specularColor = new Color3(0.04, 0.04, 0.04)
  mat.specularPower = 24
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
  perScene.set(colour, mat)
  return mat
}

/** Puts hair geometry on a rig's hair mesh (made on first use and kept for the rig's life), or hides it for none. */
export function placeHair(current: Mesh | null, data: VertexData | null, rig: { root: TransformNode; skeleton: Skeleton; scene: Scene }, material: Material, register?: (mesh: Mesh) => void): Mesh | null {
  if (!data) {
    current?.setEnabled(false)
    return current
  }
  let mesh = current
  if (!mesh) {
    mesh = new Mesh('rr-hunter-hair', rig.scene)
    mesh.parent = rig.root
    mesh.isPickable = false
    mesh.receiveShadows = false
    register?.(mesh)
  }
  data.applyToMesh(mesh, false)
  mesh.skeleton = rig.skeleton
  mesh.numBoneInfluencers = 4
  mesh.setBoundingInfo(new BoundingInfo(new Vector3(-1.3, -0.4, -1.3), new Vector3(1.3, 2.4, 1.3)))
  mesh.material = material
  mesh.setEnabled(true)
  return mesh
}
