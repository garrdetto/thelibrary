import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Vector3 } from 'three'
import type { Camera, Material, Object3D } from 'three'

/** A point in canvas pixels, measured from the stage's top-left corner. */
export type Px = { x: number; y: number }

export type SmoothSettings = {
  /** 0–1: how far each selected vertex moves toward its smoothed position. */
  strength: number
  /** Laplacian passes; more passes flatten wider dents. */
  passes: number
  /** Neighbours across an edge sharper than this (degrees) are left out, which keeps panel lines, window frames and trim. */
  creaseDeg: number
  /** Pixels inside the polygon edge over which the effect fades in, so there is no visible seam. */
  featherPx: number
}

export const DEFAULT_SMOOTH: SmoothSettings = { strength: 0.7, passes: 25, creaseDeg: 40, featherPx: 24 }
export const SMOOTH_LIMITS = { passesMax: 120, creaseMin: 10, creaseMax: 90, featherMax: 80 } as const
const RELAX = 1.6

/**
 * Welded view of one geometry: vertices at the same position (UV and normal
 * seams) share a cluster, so smoothing never tears the surface open.
 */
type Topology = {
  clusterOf: Int32Array
  clusters: number[][]
  neighbours: number[][]
  /** Triangles as cluster indices. */
  faces: Int32Array
}

const topologies = new WeakMap<BufferGeometry, Topology>()

function topology(geometry: BufferGeometry): Topology {
  const hit = topologies.get(geometry)
  if (hit) return hit
  const pos = geometry.getAttribute('position') as BufferAttribute
  const count = pos.count
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const span = Math.max(1e-6, box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  const q = 1e5 / span
  const byKey = new Map<string, number>()
  const clusterOf = new Int32Array(count)
  const clusters: number[][] = []
  for (let i = 0; i < count; i++) {
    const key = `${Math.round((pos.getX(i) - box.min.x) * q)},${Math.round((pos.getY(i) - box.min.y) * q)},${Math.round((pos.getZ(i) - box.min.z) * q)}`
    let id = byKey.get(key)
    if (id === undefined) { id = clusters.length; byKey.set(key, id); clusters.push([]) }
    clusters[id].push(i)
    clusterOf[i] = id
  }
  const index = geometry.getIndex()
  const triangles = index ? index.count : count
  const faces = new Int32Array(triangles - (triangles % 3))
  for (let i = 0; i < faces.length; i++) faces[i] = clusterOf[index ? index.getX(i) : i]
  const sets = clusters.map(() => new Set<number>())
  for (let t = 0; t + 2 < faces.length; t += 3) {
    const a = faces[t], b = faces[t + 1], c = faces[t + 2]
    if (a !== b) { sets[a].add(b); sets[b].add(a) }
    if (b !== c) { sets[b].add(c); sets[c].add(b) }
    if (a !== c) { sets[a].add(c); sets[c].add(a) }
  }
  const out: Topology = { clusterOf, clusters, neighbours: sets.map(s => [...s]), faces }
  topologies.set(geometry, out)
  return out
}

/** Area-weighted normal per cluster from the given local positions. */
function clusterNormals(topo: Topology, p: Float32Array) {
  const n = new Float32Array(topo.clusters.length * 3)
  const f = topo.faces
  for (let t = 0; t + 2 < f.length; t += 3) {
    const a = f[t] * 3, b = f[t + 1] * 3, c = f[t + 2] * 3
    const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2]
    const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2]
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l
  }
  return n
}

type Target = {
  mesh: Mesh
  topo: Topology
  /** Committed cluster positions (local space, 3 per cluster). */
  base: Float32Array
  /** Selection weight per cluster, 0 when unselected. */
  weight: Float32Array
  selectedCount: number
}

function clusterPositions(topo: Topology, pos: BufferAttribute) {
  const out = new Float32Array(topo.clusters.length * 3)
  topo.clusters.forEach((verts, c) => { const i = verts[0]; out[c * 3] = pos.getX(i); out[c * 3 + 1] = pos.getY(i); out[c * 3 + 2] = pos.getZ(i) })
  return out
}

function writePositions(target: Target, p: Float32Array) {
  const pos = target.mesh.geometry.getAttribute('position') as BufferAttribute
  const normal = target.mesh.geometry.getAttribute('normal') as BufferAttribute | undefined
  const n = normal ? clusterNormals(target.topo, p) : null
  target.topo.clusters.forEach((verts, c) => {
    for (const i of verts) {
      pos.setXYZ(i, p[c * 3], p[c * 3 + 1], p[c * 3 + 2])
      if (normal && n) normal.setXYZ(i, n[c * 3], n[c * 3 + 1], n[c * 3 + 2])
    }
  })
  pos.needsUpdate = true
  if (normal) normal.needsUpdate = true
  target.mesh.geometry.computeBoundingSphere()
  target.mesh.geometry.computeBoundingBox()
}

function pointInPolygon(x: number, y: number, poly: Px[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distanceToEdges(x: number, y: number, poly: Px[]) {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)))
  }
  return best
}

export type SelectionReport = { vertices: number; meshes: number }

/** Smooths the dents of a loaded body, one screen-space polygon at a time. */
export class BodySmoother {
  private targets: Target[] = []
  private undoStack: { mesh: Mesh; base: Float32Array }[][] = []
  private selection: Target[] = []
  private markers: Object3D[] = []
  private lastSettings: SmoothSettings = DEFAULT_SMOOTH
  edits = 0

  constructor(private readonly root: Object3D, private readonly makeMarker: (mesh: Mesh, positions: Float32Array) => Object3D) {
    root.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute
      if (mesh.geometry.index && mesh.geometry.index.count % 3 !== 0) return
      const topo = topology(mesh.geometry)
      this.targets.push({ mesh, topo, base: clusterPositions(topo, pos), weight: new Float32Array(topo.clusters.length), selectedCount: 0 })
    })
  }

  get hasSelection() { return this.selection.length > 0 }
  get undoDepth() { return this.undoStack.length }

  /** Picks the camera-facing vertices inside a polygon drawn over the canvas. */
  select(polygon: Px[], camera: Camera, size: { width: number; height: number }, featherPx: number): SelectionReport {
    this.cancel()
    const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
    const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y))
    const world = new Vector3(), eye = new Vector3(), toEye = new Vector3(), normalMatrix = new Matrix3(), normal = new Vector3()
    camera.getWorldPosition(eye)
    const cameraDir = camera.getWorldDirection(new Vector3())
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true
    let vertices = 0
    this.root.updateMatrixWorld(true)
    for (const target of this.targets) {
      const { topo, base, weight, mesh } = target
      weight.fill(0)
      target.selectedCount = 0
      normalMatrix.getNormalMatrix(mesh.matrixWorld)
      const normals = clusterNormals(topo, base)
      for (let c = 0; c < topo.clusters.length; c++) {
        world.set(base[c * 3], base[c * 3 + 1], base[c * 3 + 2]).applyMatrix4(mesh.matrixWorld)
        normal.set(normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2]).applyMatrix3(normalMatrix)
        if (perspective) toEye.subVectors(world, eye); else toEye.copy(cameraDir)
        if (normal.dot(toEye) >= 0) continue
        const ndc = world.project(camera)
        if (ndc.z < -1 || ndc.z > 1) continue
        const x = ((ndc.x + 1) / 2) * size.width, y = ((1 - ndc.y) / 2) * size.height
        if (x < minX || x > maxX || y < minY || y > maxY || !pointInPolygon(x, y, polygon)) continue
        const w = featherPx > 0 ? Math.min(1, distanceToEdges(x, y, polygon) / featherPx) : 1
        if (w <= 0) continue
        weight[c] = w
        target.selectedCount++
        vertices += topo.clusters[c].length
      }
      if (target.selectedCount) this.selection.push(target)
    }
    this.showMarkers()
    return { vertices, meshes: this.selection.length }
  }

  private showMarkers() {
    this.hideMarkers()
    for (const target of this.selection) {
      const points = new Float32Array(target.selectedCount * 3)
      let k = 0
      for (let c = 0; c < target.weight.length; c++) if (target.weight[c] > 0) { points[k++] = target.base[c * 3]; points[k++] = target.base[c * 3 + 1]; points[k++] = target.base[c * 3 + 2] }
      const marker = this.makeMarker(target.mesh, points)
      marker.userData.msHelper = true
      target.mesh.add(marker)
      this.markers.push(marker)
    }
  }

  private hideMarkers() {
    for (const marker of this.markers) {
      marker.removeFromParent()
      const m = marker as unknown as { geometry?: BufferGeometry; material?: Material }
      m.geometry?.dispose(); m.material?.dispose()
    }
    this.markers = []
  }

  /** Previews the selection smoothed with these settings (not yet committed). */
  preview(settings: SmoothSettings) {
    this.lastSettings = settings
    for (const target of this.selection) writePositions(target, this.smoothed(target, settings))
  }

  private smoothed(target: Target, settings: SmoothSettings): Float32Array {
    const { topo, base, weight } = target
    const count = topo.clusters.length
    const normals = clusterNormals(topo, base)
    const cosLimit = Math.cos((settings.creaseDeg * Math.PI) / 180)
    const links: number[][] = new Array(count)
    for (let c = 0; c < count; c++) {
      if (weight[c] <= 0) continue
      links[c] = topo.neighbours[c].filter(n => normals[c * 3] * normals[n * 3] + normals[c * 3 + 1] * normals[n * 3 + 1] + normals[c * 3 + 2] * normals[n * 3 + 2] >= cosLimit)
    }
    const p = Float32Array.from(base)
    const order: number[] = []
    for (let c = 0; c < count; c++) if (links[c]?.length) order.push(c)
    /** In-place over-relaxation of the selected vertices toward their neighbours; the unselected rim stays fixed, so the patch settles into the surface around it. */
    for (let i = 0; i < settings.passes; i++) {
      for (const c of order) {
        const near = links[c]
        let x = 0, y = 0, z = 0
        for (const n of near) { x += p[n * 3]; y += p[n * 3 + 1]; z += p[n * 3 + 2] }
        p[c * 3] += RELAX * (x / near.length - p[c * 3])
        p[c * 3 + 1] += RELAX * (y / near.length - p[c * 3 + 1])
        p[c * 3 + 2] += RELAX * (z / near.length - p[c * 3 + 2])
      }
    }
    const out = Float32Array.from(base)
    for (let c = 0; c < count; c++) {
      const k = weight[c] * settings.strength
      if (k <= 0) continue
      out[c * 3] += (p[c * 3] - base[c * 3]) * k
      out[c * 3 + 1] += (p[c * 3 + 1] - base[c * 3 + 1]) * k
      out[c * 3 + 2] += (p[c * 3 + 2] - base[c * 3 + 2]) * k
    }
    return out
  }

  /** Keeps the previewed smoothing and clears the selection. */
  apply() {
    if (!this.selection.length) return
    this.undoStack.push(this.selection.map(t => ({ mesh: t.mesh, base: Float32Array.from(t.base) })))
    if (this.undoStack.length > 12) this.undoStack.shift()
    for (const target of this.selection) {
      target.base = this.smoothed(target, this.lastSettings)
      writePositions(target, target.base)
      target.weight.fill(0); target.selectedCount = 0
    }
    this.selection = []
    this.hideMarkers()
    this.edits++
  }

  /** Drops the selection and puts the previewed vertices back. */
  cancel() {
    for (const target of this.selection) { writePositions(target, target.base); target.weight.fill(0); target.selectedCount = 0 }
    this.selection = []
    this.hideMarkers()
  }

  undo() {
    this.cancel()
    const last = this.undoStack.pop()
    if (!last) return
    for (const { mesh, base } of last) {
      const target = this.targets.find(t => t.mesh === mesh)
      if (!target) continue
      target.base = base
      writePositions(target, base)
    }
    this.edits = Math.max(0, this.edits - 1)
  }

  dispose() { this.cancel() }
}

/**
 * Writes the model as it is now (with the smoothing baked in) to .glb bytes,
 * using the model's own materials rather than the editor's paint preview.
 */
export async function exportScene(root: Object3D): Promise<Uint8Array> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const swapped: { mesh: Mesh; preview: Material | Material[] }[] = []
  const helpers: { object: Object3D; parent: Object3D }[] = []
  root.traverse(node => {
    const mesh = node as Mesh
    if (node.userData.msHelper && node.parent) helpers.push({ object: node, parent: node.parent })
    if (mesh.isMesh && mesh.userData.msOriginalMaterial) { swapped.push({ mesh, preview: mesh.material }); mesh.material = mesh.userData.msOriginalMaterial as Material | Material[] }
  })
  for (const h of helpers) h.object.removeFromParent()
  try {
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })
    if (!(result instanceof ArrayBuffer)) throw new Error('The model could not be exported.')
    return new Uint8Array(result)
  } finally {
    for (const { mesh, preview } of swapped) mesh.material = preview
    for (const h of helpers) h.parent.add(h.object)
  }
}
