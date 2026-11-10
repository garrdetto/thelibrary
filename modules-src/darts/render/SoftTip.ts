/** The soft-tip dart's point. The Meshy model's point came out brass, lopsided and about 6 mm off the dart's axis, and the front of its barrel sits up to 3.5 mm off the axis too. When the model loads, the model's own point (everything within `TIP_LENGTH` of the nose) is removed, the front of the body is re-centred on the axis along a straight fitted centre line (fading out towards the shaft), and a drawn matte black plastic point (`tipGeometry`) is added on the axis, so the dart sticks exactly where it scores. The nose sits at the origin and the dart runs along +z, as in `Dart.ts`. */
import * as THREE from 'three/webgpu'

/** Length of the model's own point, measured from the nose, in metres. */
export const TIP_LENGTH = 0.013
/** The drawn point reaches this far back, tucking into the barrel's front ring. */
export const TIP_REACH = 0.0145
const BIN = 0.002
const CENTRE_FROM = TIP_LENGTH
const FADE_FROM = 0.05
const FADE_TO = 0.07
const MIN_BIN_VERTICES = 20
/** A triangle reaching this close to the nose belongs to the model's own point. */
const POINT_REACH = 0.0115

export interface SoftTipPlan {
  /** The positions with the front of the body re-centred on the axis. */
  points: Float32Array
  /** 1 for each triangle of the model's own point, which is dropped. */
  tip: Uint8Array
}

/** The body's centre line from `CENTRE_FROM` to `FADE_FROM`, as a straight line `centre = a + b × along` per axis: a weighted fit through the middle of each 2 mm slice's x and y extent, using only slices that are whole rings (x and y extents within 25 % of each other), so a part-built slice can't put a kink in the barrel. */
function centreLine(points: Float32Array, noseZ: number): { x: [number, number]; y: [number, number] } {
  const slices = new Map<number, { n: number; x0: number; x1: number; y0: number; y1: number }>()
  for (let i = 0; i < points.length / 3; i++) {
    const along = points[i * 3 + 2] - noseZ
    if (along < CENTRE_FROM || along > FADE_FROM) continue
    const key = Math.floor(along / BIN)
    const slice = slices.get(key) ?? { n: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    slice.n++
    slice.x0 = Math.min(slice.x0, points[i * 3])
    slice.x1 = Math.max(slice.x1, points[i * 3])
    slice.y0 = Math.min(slice.y0, points[i * 3 + 1])
    slice.y1 = Math.max(slice.y1, points[i * 3 + 1])
    slices.set(key, slice)
  }
  let w = 0, sz = 0, szz = 0, sx = 0, szx = 0, sy = 0, szy = 0
  for (const [key, slice] of slices) {
    const width = slice.x1 - slice.x0
    const height = slice.y1 - slice.y0
    if (slice.n < MIN_BIN_VERTICES || Math.abs(width - height) > 0.25 * Math.max(width, height)) continue
    const z = (key + 0.5) * BIN
    const cx = (slice.x0 + slice.x1) / 2
    const cy = (slice.y0 + slice.y1) / 2
    w += slice.n; sz += slice.n * z; szz += slice.n * z * z; sx += slice.n * cx; szx += slice.n * z * cx; sy += slice.n * cy; szy += slice.n * z * cy
  }
  const det = w * szz - sz * sz
  if (w === 0 || Math.abs(det) < 1e-18) return { x: [0, 0], y: [0, 0] }
  const fit = (s: number, sz2: number): [number, number] => [(s * szz - sz * sz2) / det, (w * sz2 - sz * s) / det]
  return { x: fit(sx, szx), y: fit(sy, szy) }
}

/** Re-centres the front of a dart body mesh given in dart space (`points` xyz per vertex, `triangles` three indices each) and marks the triangles of its own point. */
export function softTipPlan(points: ArrayLike<number>, triangles: ArrayLike<number>): SoftTipPlan {
  const out = Float32Array.from(points)
  const count = out.length / 3
  let noseZ = Infinity
  for (let i = 0; i < count; i++) noseZ = Math.min(noseZ, out[i * 3 + 2])
  const line = centreLine(out, noseZ)
  for (let i = 0; i < count; i++) {
    const along = out[i * 3 + 2] - noseZ
    if (along >= FADE_TO) continue
    const fade = along <= FADE_FROM ? 1 : 1 - (along - FADE_FROM) / (FADE_TO - FADE_FROM)
    const at = Math.max(along, CENTRE_FROM)
    out[i * 3] -= (line.x[0] + line.x[1] * at) * fade
    out[i * 3 + 1] -= (line.y[0] + line.y[1] * at) * fade
  }
  const tip = new Uint8Array(triangles.length / 3)
  for (let t = 0; t < tip.length; t++) {
    const a = out[triangles[t * 3] * 3 + 2] - noseZ
    const b = out[triangles[t * 3 + 1] * 3 + 2] - noseZ
    const c = out[triangles[t * 3 + 2] * 3 + 2] - noseZ
    if ((a + b + c) / 3 < TIP_LENGTH || Math.min(a, b, c) < POINT_REACH) tip[t] = 1
  }
  return { points: out, tip }
}

/** A moulded soft tip: rounded nose, slight taper, a collar and a shank that tucks into the barrel, along +z from the origin. */
export function tipGeometry(): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0, 0], [0.0002, 0.0006], [0.0006, 0.0009], [0.0012, 0.0011], [0.008, 0.0014], [0.0095, 0.0015],
    [0.0098, 0.0021], [0.0112, 0.0022], [0.0115, 0.0019], [TIP_REACH, 0.0019],
  ]
  const geometry = new THREE.LatheGeometry(profile.map(([along, radius]) => new THREE.Vector2(radius, along)), 20)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

export function createSoftTipMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#151515'), metalness: 0, roughness: 0.62 })
  material.name = 'tip'
  return material
}

/** Applies `softTipPlan` to the loaded soft-tip model in place and adds the drawn point. */
export function applySoftTip(model: THREE.Object3D, material: THREE.Material): void {
  model.updateMatrixWorld(true)
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert()
  const bodies: THREE.Mesh[] = []
  model.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name !== 'flight') bodies.push(mesh)
  })
  for (const mesh of bodies) {
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const local = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld)
    const back = new THREE.Matrix4().copy(local).invert()
    const vertex = new THREE.Vector3()
    const points = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) vertex.fromBufferAttribute(position, i).applyMatrix4(local).toArray(points, i * 3)
    const index = geometry.getIndex()
    const triangles = index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : Array.from({ length: position.count }, (_, i) => i)
    const plan = softTipPlan(points, triangles)
    const moved = new Float32Array(points.length)
    for (let i = 0; i < position.count; i++) vertex.fromArray(plan.points, i * 3).applyMatrix4(back).toArray(moved, i * 3)
    geometry.setAttribute('position', new THREE.BufferAttribute(moved, 3))
    const kept: number[] = []
    for (let t = 0; t < plan.tip.length; t++) if (!plan.tip[t]) kept.push(triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2])
    geometry.setIndex(kept)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  }
  const point = new THREE.Mesh(tipGeometry(), material)
  point.name = 'soft-tip'
  point.castShadow = true
  point.receiveShadow = false
  model.add(point)
}
