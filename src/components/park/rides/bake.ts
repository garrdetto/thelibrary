import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import type { BufferGeometry, Material, Mesh, Texture } from 'three'
import { CUSTOM_RIDE_LIMITS } from '../../../../server/park/index.mjs'
import type { CustomRideMotion } from '../../../../server/park/index.mjs'
import type { RideMesh } from '@/lib/park/rideMesh'
import { splitPieces } from '@/lib/park/ridePieces'

/** Park tiles are 4 m squares. */
export const TILE_METRES = 4
const FILL = 0.96

type Sampler = { width: number; height: number; data: Uint8ClampedArray; wrapS: number; wrapT: number }

/** Every mesh in the file merged into one indexed list, in park axes (Z up), at the file's scale. */
export type SourceModel = {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** sRGB base colour factor × vertex colour, per vertex. */
  tint: Float32Array
  /** Texture index per vertex, -1 for none. */
  texture: Int16Array
  indices: Uint32Array
  textures: Sampler[]
  triangles: number
}

/** A reduced model ready to fit: one colour per triangle corner. */
export type ReducedModel = { triangles: number; positions: Float32Array; normals: Float32Array; colors: Float32Array; bounds: { min: [number, number, number]; max: [number, number, number] } }

export type FitSettings = { size: [number, number]; scale: number; yaw: number; motion: CustomRideMotion }

const toSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

function sampler(texture: Texture | null | undefined, cache: Map<Texture, number>, list: Sampler[]) {
  if (!texture?.image) return -1
  const known = cache.get(texture)
  if (known !== undefined) return known
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return -1
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const index = list.push({ width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, wrapS: texture.wrapS, wrapT: texture.wrapT }) - 1
  cache.set(texture, index)
  return index
}

const wrap = (value: number, mode: number) => {
  if (mode === 1001) return Math.min(1, Math.max(0, value))
  if (mode === 1002) { const m = ((value % 2) + 2) % 2; return m > 1 ? 2 - m : m }
  return value - Math.floor(value)
}

function sample(s: Sampler, u: number, v: number, out: number[]) {
  const x = Math.min(s.width - 1, Math.floor(wrap(u, s.wrapS) * s.width)), y = Math.min(s.height - 1, Math.floor(wrap(v, s.wrapT) * s.height))
  const o = (y * s.width + x) * 4
  out[0] = s.data[o] / 255; out[1] = s.data[o + 1] / 255; out[2] = s.data[o + 2] / 255
}

/** Reads a .glb/.gltf and merges its meshes. Textures are read back to pixels so colours can be baked per corner. */
export async function loadSource(file: File): Promise<SourceModel> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.parseAsync(await file.arrayBuffer(), '')
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  scene.traverse(node => { if ((node as Mesh).isMesh && (node as Mesh).geometry?.attributes.position) meshes.push(node as Mesh) })
  if (!meshes.length) throw new Error('That model has no meshes.')

  const textures: Sampler[] = [], cache = new Map<Texture, number>()
  const P: number[] = [], N: number[] = [], UV: number[] = [], TINT: number[] = [], TEX: number[] = [], IDX: number[] = []
  for (const mesh of meshes) {
    const geometry = mesh.geometry as BufferGeometry
    const pos = geometry.attributes.position, nor = geometry.attributes.normal, uv = geometry.attributes.uv, col = geometry.attributes.color
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { color?: { r: number; g: number; b: number }; map?: Texture | null })[]
    const matrix = mesh.matrixWorld, normalMatrix = matrix.clone().invert().transpose().elements
    const e = matrix.elements
    const base = P.length / 3
    const vertexMaterial = new Int32Array(pos.count).fill(0)
    const index = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i)
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index.length, materialIndex: 0 }]
    for (const group of groups) for (let i = group.start; i < Math.min(index.length, group.start + group.count); i++) vertexMaterial[index[i]] = group.materialIndex ?? 0
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v)
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      P.push(wx, -wz, wy)
      if (nor) {
        const a = nor.getX(v), b = nor.getY(v), c = nor.getZ(v)
        const nx = normalMatrix[0] * a + normalMatrix[4] * b + normalMatrix[8] * c, ny = normalMatrix[1] * a + normalMatrix[5] * b + normalMatrix[9] * c, nz = normalMatrix[2] * a + normalMatrix[6] * b + normalMatrix[10] * c
        const l = Math.hypot(nx, ny, nz) || 1
        N.push(nx / l, -nz / l, ny / l)
      } else N.push(0, 0, 0)
      UV.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0)
      const material = materials[vertexMaterial[v]] ?? materials[0]
      const factor = material?.color ?? { r: 1, g: 1, b: 1 }
      const vc = col ? [col.getX(v), col.getY(v), col.getZ(v)] : [1, 1, 1]
      TINT.push(toSrgb(factor.r * vc[0]), toSrgb(factor.g * vc[1]), toSrgb(factor.b * vc[2]))
      TEX.push(uv ? sampler(material?.map, cache, textures) : -1)
    }
    for (const i of index) IDX.push(base + i)
  }
  if (IDX.length / 3 > 600_000) throw new Error('That model is too detailed to bake here. Remesh it below 200,000 polygons first.')
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), tint: new Float32Array(TINT), texture: new Int16Array(TEX), indices: new Uint32Array(IDX), textures, triangles: IDX.length / 3 }
}

/** Simplifies to about `target` triangles with meshoptimizer and bakes one colour per triangle corner. */
export async function reduceSource(source: SourceModel, target: number): Promise<ReducedModel> {
  await MeshoptSimplifier.ready
  const goal = Math.max(CUSTOM_RIDE_LIMITS.trianglesMin, Math.min(CUSTOM_RIDE_LIMITS.trianglesMax, Math.round(target)))
  let indices = source.indices
  if (source.triangles > goal) {
    const attributes = source.uvs
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(source.indices, source.positions, 3, attributes, 2, [0.5, 0.5], null, goal * 3, 0.03, ['Permissive'])
    indices = simplified
    if (indices.length / 3 > goal * 1.25) [indices] = MeshoptSimplifier.simplifySloppy(source.indices, source.positions, 3, null, goal * 3, 0.06)
  }
  const triangles = Math.min(indices.length / 3, CUSTOM_RIDE_LIMITS.trianglesMax)
  const positions = new Float32Array(triangles * 9), normals = new Float32Array(triangles * 9), colors = new Float32Array(triangles * 9)
  const texel = [1, 1, 1]
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const P = source.positions, N = source.normals, UV = source.uvs
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2]
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl
    const cu = (UV[a * 2] + UV[b * 2] + UV[c * 2]) / 3, cv = (UV[a * 2 + 1] + UV[b * 2 + 1] + UV[c * 2 + 1]) / 3
    ;[a, b, c].forEach((v, k) => {
      const o = (t * 3 + k) * 3
      for (let j = 0; j < 3; j++) { positions[o + j] = P[v * 3 + j]; min[j] = Math.min(min[j], P[v * 3 + j]); max[j] = Math.max(max[j], P[v * 3 + j]) }
      const nl = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2])
      if (nl > 0.5 && N[v * 3] * fx + N[v * 3 + 1] * fy + N[v * 3 + 2] * fz > -0.2) { normals[o] = N[v * 3]; normals[o + 1] = N[v * 3 + 1]; normals[o + 2] = N[v * 3 + 2] }
      else { normals[o] = fx; normals[o + 1] = fy; normals[o + 2] = fz }
      const tex = source.texture[v]
      if (tex >= 0 && source.textures[tex]) sample(source.textures[tex], UV[v * 2] * 0.75 + cu * 0.25, UV[v * 2 + 1] * 0.75 + cv * 0.25, texel)
      else { texel[0] = 1; texel[1] = 1; texel[2] = 1 }
      for (let j = 0; j < 3; j++) colors[o + j] = Math.min(1, source.tint[v * 3 + j] * texel[j])
    })
  }
  return { triangles, positions, normals, colors, bounds: { min, max } }
}

/** Size of the reduced model in park metres before fitting, after the quarter turn. */
export function rawExtent(model: ReducedModel, yaw: number) {
  const sx = model.bounds.max[0] - model.bounds.min[0], sy = model.bounds.max[1] - model.bounds.min[1], sz = model.bounds.max[2] - model.bounds.min[2]
  return yaw % 2 ? { x: sy, y: sx, z: sz } : { x: sx, y: sy, z: sz }
}

/** Uniform scale that makes the model fill the footprint at `scale` = 1. */
export function fitScale(model: ReducedModel, settings: Pick<FitSettings, 'size' | 'scale' | 'yaw'>) {
  const extent = rawExtent(model, settings.yaw)
  const fit = Math.min(settings.size[0] * TILE_METRES * FILL / Math.max(0.001, extent.x), settings.size[1] * TILE_METRES * FILL / Math.max(0.001, extent.y))
  return fit * settings.scale
}

/** Places the reduced model on the footprint and splits base from moving part. Cheap: runs on every settings change. */
export function fitModel(model: ReducedModel, settings: FitSettings): RideMesh {
  const k = fitScale(model, settings)
  const cx = (model.bounds.min[0] + model.bounds.max[0]) / 2, cy = (model.bounds.min[1] + model.bounds.max[1]) / 2, z0 = model.bounds.min[2]
  const turn = settings.yaw * Math.PI / 2, cos = Math.round(Math.cos(turn)), sin = Math.round(Math.sin(turn))
  const corners = model.triangles * 3
  const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3)
  let height = 0
  for (let c = 0; c < corners; c++) {
    const x = (model.positions[c * 3] - cx) * k, y = (model.positions[c * 3 + 1] - cy) * k, z = (model.positions[c * 3 + 2] - z0) * k
    positions[c * 3] = x * cos - y * sin; positions[c * 3 + 1] = x * sin + y * cos; positions[c * 3 + 2] = z
    const nx = model.normals[c * 3], ny = model.normals[c * 3 + 1]
    normals[c * 3] = nx * cos - ny * sin; normals[c * 3 + 1] = nx * sin + ny * cos; normals[c * 3 + 2] = model.normals[c * 3 + 2]
    height = Math.max(height, z)
  }
  const { parts, instances } = splitPieces(positions, model.triangles, settings.motion)
  return { triangles: model.triangles, positions, normals, colors: model.colors, parts, height, instances }
}
