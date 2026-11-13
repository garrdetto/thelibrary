import { Box3, BufferAttribute, Matrix3, Vector3 } from 'three'
import type { BufferGeometry, Camera, Material, Mesh, Object3D } from 'three'
import { clusterNormals, topology, writeVertexNormals } from './meshTopology'
import type { Topology } from './meshTopology'
import { BUMP_LEVELS, bumpDepths, SMOOTH_METHODS, smoothCapped, smoothPositions, spread } from './smoothAlgorithms'
import type { BumpLevel, SmoothMethod } from './smoothAlgorithms'
import { withFullIndices } from './displayIndex'
import { bodyMaterials, flattenTextureBumps, softenPaint } from './textureSmooth'
import type { TextureReport } from './textureSmooth'

export { BUMP_LEVELS, SMOOTH_METHODS }
export type { BumpLevel, SmoothMethod, TextureReport }

/** A point in canvas pixels, measured from the stage's top-left corner. */
export type Px = { x: number; y: number }

export type SmoothSettings = {
  method: SmoothMethod
  /** 0–1: how far each selected vertex moves toward its smoothed position. */
  strength: number
  /** Iterations; more passes reach wider dents. */
  passes: number
  /** Neighbours across an edge sharper than this (degrees) are left out, which keeps panel lines, window frames and trim. */
  creaseDeg: number
  /** Pixels inside the polygon edge over which the effect fades in, so there is no visible seam. */
  featherPx: number
}

export const DEFAULT_SMOOTH: SmoothSettings = { method: 'clean', strength: 0.9, passes: 12, creaseDeg: 40, featherPx: 24 }
export const SMOOTH_LIMITS = { creaseMin: 10, creaseMax: 90, featherMax: 80, bumpMin: 0.3, bumpMax: 12 } as const
/** Depths are reported as millimetres on a full-size car: the model's diagonal is taken as 5.6 m. */
const REFERENCE_MM = 5600
const AUTO_FROM_MM = 0.5
const AUTO_FULL_MM = 2

type Target = {
  mesh: Mesh
  topo: Topology
  /** Committed cluster positions (local space, 3 per cluster). */
  base: Float32Array
  /** Committed vertex normals, or null when the mesh has none. */
  baseNormals: Float32Array | null
  /** Selection weight per cluster, 0 when unselected. */
  weight: Float32Array
  selectedCount: number
  /** Bump depth per cluster in reference millimetres, once analysed. */
  depth: Float32Array | null
  /** The last previewed positions and the settings that made them, so keeping them doesn't smooth twice. */
  previewed: { key: string; p: Float32Array } | null
}

export type SelectionReport = { vertices: number; meshes: number }
export type DetectReport = { roughShare: number; spots: number; worstMm: number; typicalMm: number }
export type AutoPlan = { settings: SmoothSettings; selection: SelectionReport; share: number; typicalMm: number }
export type BumpReport = { moved: number; largestMm: number; capMm: number }
export type MarkerKind = 'selection' | 'heat'

function clusterPositions(topo: Topology, pos: BufferAttribute) {
  const out = new Float32Array(topo.clusters.length * 3)
  topo.clusters.forEach((verts, c) => { const i = verts[0]; out[c * 3] = pos.getX(i); out[c * 3 + 1] = pos.getY(i); out[c * 3 + 2] = pos.getZ(i) })
  return out
}

function writePositions(target: Target, p: Float32Array, normals: Float32Array | null) {
  const geometry = target.mesh.geometry
  const pos = geometry.getAttribute('position') as BufferAttribute
  target.topo.clusters.forEach((verts, c) => { for (const i of verts) pos.setXYZ(i, p[c * 3], p[c * 3 + 1], p[c * 3 + 2]) })
  pos.needsUpdate = true
  const normal = geometry.getAttribute('normal') as BufferAttribute | undefined
  if (normal && normals) { (normal.array as Float32Array).set(normals); normal.needsUpdate = true }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
}

/** Normals for smoothed positions: only the selection and the ring around it are re-shaded, so the rest keeps the model's own shading. */
function normalsFor(target: Target, p: Float32Array, creaseDeg: number, touched: Float32Array | null) {
  if (!target.baseNormals) return null
  const out = Float32Array.from(target.baseNormals)
  let only: Uint8Array | null = null
  if (touched) {
    only = new Uint8Array(touched.length)
    for (let c = 0; c < touched.length; c++) if (touched[c] > 0) { only[c] = 1; for (const n of target.topo.neighbours[c]) only[n] = 1 }
  }
  writeVertexNormals(target.topo, p, creaseDeg, out, only)
  return out
}

/** The geometry's normals as plain floats (quantized or interleaved normals are unpacked once so they can be rewritten). */
function floatNormals(geometry: BufferGeometry): Float32Array | null {
  const normal = geometry.getAttribute('normal')
  const count = geometry.getAttribute('position').count
  if (!normal || normal.count !== count) return null
  const plain = normal instanceof BufferAttribute && normal.itemSize === 3 && normal.array instanceof Float32Array && !normal.normalized
  if (!plain) {
    const values = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) { values[i * 3] = normal.getX(i); values[i * 3 + 1] = normal.getY(i); values[i * 3 + 2] = normal.getZ(i) }
    geometry.setAttribute('normal', new BufferAttribute(values, 3))
  }
  return Float32Array.from((geometry.getAttribute('normal') as BufferAttribute).array as Float32Array)
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

function percentile(values: number[], q: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** Smooths a loaded body: by lasso, by detected rough spots, or all over, with undo. */
export class BodySmoother {
  private targets: Target[] = []
  private undoStack: (() => void)[] = []
  private selection: Target[] = []
  private markers: Object3D[] = []
  private heatMarkers: Object3D[] = []
  private lastSettings: SmoothSettings = DEFAULT_SMOOTH
  private analysedCrease: number | null = null
  private heatThreshold: number | null = null
  edits = 0

  constructor(private readonly root: Object3D, private readonly makeMarker: (mesh: Mesh, positions: Float32Array, colors: Float32Array | null) => Object3D) {
    root.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh || node.userData.msHelper || !mesh.geometry?.getAttribute('position')) return
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute
      if (mesh.geometry.index && mesh.geometry.index.count % 3 !== 0) return
      const topo = topology(mesh.geometry)
      const baseNormals = floatNormals(mesh.geometry)
      this.targets.push({ mesh, topo, base: clusterPositions(topo, pos), baseNormals, weight: new Float32Array(topo.clusters.length), selectedCount: 0, depth: null, previewed: null })
    })
  }

  get hasSelection() { return this.selection.length > 0 }
  get undoDepth() { return this.undoStack.length }

  private beginSelection() {
    this.cancel()
    for (const target of this.targets) { target.weight.fill(0); target.selectedCount = 0; target.previewed = null }
  }

  private finishSelection(): SelectionReport {
    this.selection = []
    let vertices = 0
    for (const target of this.targets) {
      let count = 0
      for (let c = 0; c < target.weight.length; c++) if (target.weight[c] > 0) { count++; vertices += target.topo.clusters[c].length }
      target.selectedCount = count
      if (count) this.selection.push(target)
    }
    this.showMarkers()
    return { vertices, meshes: this.selection.length }
  }

  /** Picks the camera-facing vertices inside a polygon drawn over the canvas. */
  select(polygon: Px[], camera: Camera, size: { width: number; height: number }, featherPx: number): SelectionReport {
    this.beginSelection()
    const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
    const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y))
    const world = new Vector3(), eye = new Vector3(), toEye = new Vector3(), normalMatrix = new Matrix3(), normal = new Vector3()
    camera.getWorldPosition(eye)
    const cameraDir = camera.getWorldDirection(new Vector3())
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true
    this.root.updateMatrixWorld(true)
    for (const target of this.targets) {
      const { topo, base, weight, mesh } = target
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
        if (w > 0) weight[c] = w
      }
    }
    return this.finishSelection()
  }

  /** Selects every surface of the model, front and back. */
  selectAll(): SelectionReport {
    this.beginSelection()
    for (const target of this.targets) target.weight.fill(1)
    return this.finishSelection()
  }

  /** Selects the spots marked by the last analysis whose bumps are deeper than `thresholdMm`, blended out over two rings. */
  selectMarked(thresholdMm: number): SelectionReport {
    this.beginSelection()
    for (const target of this.targets) {
      if (!target.depth) continue
      for (let c = 0; c < target.weight.length; c++) target.weight[c] = target.depth[c] >= thresholdMm ? 1 : 0
      target.weight.set(spread(target.topo, spread(target.topo, target.weight, 'grow', 0.66), 'grow', 0.5))
    }
    return this.finishSelection()
  }

  /** Grows or shrinks the current selection by one ring of vertices. */
  resize(mode: 'grow' | 'shrink'): SelectionReport {
    if (!this.selection.length) return { vertices: 0, meshes: 0 }
    const current = this.selection
    this.restore(current)
    for (const target of current) { target.weight.set(spread(target.topo, target.weight, mode)); target.previewed = null }
    const report = this.finishSelection()
    this.preview(this.lastSettings)
    return report
  }

  private worldScale(target: Target) {
    return target.mesh.matrixWorld.getMaxScaleOnAxis() || 1
  }

  /** The body's diagonal in world units; depths are scaled as if it were a full-size car's. */
  private diagonal() {
    this.root.updateMatrixWorld(true)
    const box = new Box3()
    for (const target of this.targets) {
      target.mesh.geometry.computeBoundingBox()
      box.union(target.mesh.geometry.boundingBox!.clone().applyMatrix4(target.mesh.matrixWorld))
    }
    return box.isEmpty() ? 1 : box.getSize(new Vector3()).length() || 1
  }

  /**
   * Flattens random lumps over the whole body in one step and re-shades it.
   * Creases stay, and no point moves more than the level's cap.
   */
  smoothBumps(level: BumpLevel, creaseDeg: number): BumpReport {
    this.cancel()
    const { capMm, passes } = BUMP_LEVELS[level]
    const diag = this.diagonal()
    this.remember(this.targets)
    let moved = 0, largestMm = 0
    for (const target of this.targets) {
      const toMm = (this.worldScale(target) / diag) * REFERENCE_MM
      const result = smoothCapped(target.topo, target.base, passes, creaseDeg, capMm / toMm)
      target.base = result.positions
      target.baseNormals = normalsFor(target, target.base, creaseDeg, null)
      writePositions(target, target.base, target.baseNormals)
      moved += result.moved
      largestMm = Math.max(largestMm, result.largest * toMm)
    }
    this.changed(1)
    return { moved, largestMm, capMm }
  }

  /** Measures how rough every part of the body is. Depths are millimetres on a full-size car. */
  analyse(creaseDeg: number): DetectReport {
    this.cancel()
    const diag = this.diagonal()
    const sample: number[] = []
    let rough = 0, total = 0, worst = 0
    for (const target of this.targets) {
      const toMm = (this.worldScale(target) / diag) * REFERENCE_MM
      const depth = bumpDepths(target.topo, target.base, creaseDeg)
      for (let c = 0; c < depth.length; c++) {
        depth[c] *= toMm
        if (depth[c] >= AUTO_FULL_MM) rough++
        worst = Math.max(worst, depth[c])
        if (sample.length < 200000 && (c % 3 === 0)) sample.push(depth[c])
      }
      total += depth.length
      target.depth = depth
    }
    this.analysedCrease = creaseDeg
    const spots = this.targets.reduce((n, t) => n + (t.depth ? this.countSpots(t, AUTO_FULL_MM) : 0), 0)
    return { roughShare: total ? rough / total : 0, spots, worstMm: worst, typicalMm: percentile(sample, 0.5) }
  }

  get analysed() { return this.analysedCrease !== null }

  /** Separate patches of points at or above the threshold. */
  private countSpots(target: Target, thresholdMm: number) {
    const depth = target.depth!
    const seen = new Uint8Array(depth.length)
    let spots = 0
    for (let c = 0; c < depth.length; c++) {
      if (seen[c] || depth[c] < thresholdMm) continue
      spots++
      const stack = [c]
      seen[c] = 1
      while (stack.length) {
        const k = stack.pop()!
        for (const n of target.topo.neighbours[k]) if (!seen[n] && depth[n] >= thresholdMm) { seen[n] = 1; stack.push(n) }
      }
    }
    return spots
  }

  /** Paints the rough spots on the model: yellow just over the threshold, red at three times it. Pass null to hide. */
  showHeat(thresholdMm: number | null): { spots: number; share: number } {
    this.hideHeat()
    this.heatThreshold = thresholdMm
    if (thresholdMm === null) return { spots: 0, share: 0 }
    let spots = 0, marked = 0, total = 0
    for (const target of this.targets) {
      const depth = target.depth
      if (!depth) continue
      total += depth.length
      const points: number[] = [], colors: number[] = []
      for (let c = 0; c < depth.length; c++) {
        const t = depth[c] / thresholdMm
        if (t < 0.6) continue
        if (t >= 1) marked++
        points.push(target.base[c * 3], target.base[c * 3 + 1], target.base[c * 3 + 2])
        if (t < 1) colors.push(0.55, 0.5, 0.2)
        else { const k = Math.min(1, (t - 1) / 2); colors.push(1, 0.78 * (1 - k) + 0.12 * k, 0.15 * (1 - k)) }
      }
      spots += this.countSpots(target, thresholdMm)
      if (!points.length) continue
      const marker = this.makeMarker(target.mesh, Float32Array.from(points), Float32Array.from(colors))
      marker.userData.msHelper = true
      target.mesh.add(marker)
      this.heatMarkers.push(marker)
    }
    return { spots, share: total ? marked / total : 0 }
  }

  private hideHeat() {
    for (const marker of this.heatMarkers) this.dropMarker(marker)
    this.heatMarkers = []
  }

  /**
   * One-click smoothing: measures the body, selects every rough area with a
   * weight that follows how rough it is (clean panels stay untouched), and
   * picks edge-keeping settings to suit the roughness found.
   */
  autoPlan(base: SmoothSettings): AutoPlan | null {
    const report = this.analyse(base.creaseDeg)
    this.beginSelection()
    const marked: number[] = []
    for (const target of this.targets) {
      const depth = target.depth!
      for (let c = 0; c < depth.length; c++) {
        const t = (depth[c] - AUTO_FROM_MM) / (AUTO_FULL_MM - AUTO_FROM_MM)
        target.weight[c] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
        if (target.weight[c] >= 0.5 && marked.length < 200000) marked.push(depth[c])
      }
      target.weight.set(spread(target.topo, spread(target.topo, target.weight, 'grow', 0.7), 'grow', 0.5))
    }
    const selection = this.finishSelection()
    if (!selection.vertices) return null
    const rough = percentile(marked, 0.9)
    const settings: SmoothSettings = { ...base, method: 'clean', strength: 1, passes: Math.round(Math.min(20, Math.max(8, 8 + rough * 2))) }
    this.preview(settings)
    if (this.heatThreshold !== null) this.showHeat(this.heatThreshold)
    return { settings, selection, share: report.roughShare, typicalMm: report.typicalMm }
  }

  private dropMarker(marker: Object3D) {
    marker.removeFromParent()
    const m = marker as unknown as { geometry?: BufferGeometry; material?: Material }
    m.geometry?.dispose(); m.material?.dispose()
  }

  private showMarkers() {
    this.hideMarkers()
    for (const target of this.selection) {
      const points = new Float32Array(target.selectedCount * 3)
      let k = 0
      for (let c = 0; c < target.weight.length; c++) if (target.weight[c] > 0) { points[k++] = target.base[c * 3]; points[k++] = target.base[c * 3 + 1]; points[k++] = target.base[c * 3 + 2] }
      const marker = this.makeMarker(target.mesh, points, null)
      marker.userData.msHelper = true
      target.mesh.add(marker)
      this.markers.push(marker)
    }
  }

  private hideMarkers() {
    for (const marker of this.markers) this.dropMarker(marker)
    this.markers = []
  }

  private smoothed(target: Target, settings: SmoothSettings): Float32Array {
    const key = `${settings.method}|${settings.strength}|${settings.passes}|${settings.creaseDeg}`
    if (target.previewed?.key === key) return target.previewed.p
    const { topo, base, weight } = target
    const p = smoothPositions(topo, base, weight, settings.method, settings.passes, settings.creaseDeg)
    const out = Float32Array.from(base)
    for (let c = 0; c < weight.length; c++) {
      const k = weight[c] * settings.strength
      if (k <= 0) continue
      out[c * 3] += (p[c * 3] - base[c * 3]) * k
      out[c * 3 + 1] += (p[c * 3 + 1] - base[c * 3 + 1]) * k
      out[c * 3 + 2] += (p[c * 3 + 2] - base[c * 3 + 2]) * k
    }
    target.previewed = { key, p: out }
    return out
  }

  /** Previews the selection smoothed with these settings (not yet committed). */
  preview(settings: SmoothSettings) {
    this.lastSettings = settings
    for (const target of this.selection) {
      const p = this.smoothed(target, settings)
      writePositions(target, p, normalsFor(target, p, settings.creaseDeg, target.weight))
    }
  }

  /** Shows the body as it was before the previewed smoothing while `original` is true. */
  compare(original: boolean) {
    if (original) this.restore(this.selection)
    else this.preview(this.lastSettings)
  }

  private restore(targets: Target[]) {
    for (const target of targets) writePositions(target, target.base, target.baseNormals)
  }

  private forget() {
    for (const target of this.targets) target.previewed = null
  }

  private remember(targets: Target[]) {
    const saved = targets.map(t => ({ target: t, base: Float32Array.from(t.base), normals: t.baseNormals ? Float32Array.from(t.baseNormals) : null }))
    this.pushUndo(() => {
      for (const { target, base, normals } of saved) {
        target.base = base
        target.baseNormals = normals
        writePositions(target, base, normals)
      }
    })
  }

  private pushUndo(step: () => void) {
    this.undoStack.push(step)
    if (this.undoStack.length > 12) this.undoStack.shift()
  }

  /** Takes the bump (normal) maps off the body's materials, so painted-in bumpiness no longer catches the light. */
  flattenTextures(): TextureReport {
    this.cancel()
    const result = flattenTextureBumps(bodyMaterials(this.root))
    if (result.changed) { this.pushUndo(result.undo); this.changed(1) }
    return result
  }

  /** Evens out blotchy, grainy paint in the body's colour textures while keeping sharp lines (trim, windows, decals). */
  softenTextures(strength: number): TextureReport {
    this.cancel()
    const result = softenPaint(bodyMaterials(this.root), strength)
    if (result.changed) { this.pushUndo(result.undo); this.changed(1) }
    return result
  }

  private changed(step: 1 | -1) {
    this.edits = Math.max(0, this.edits + step)
    this.forget()
    for (const target of this.targets) target.depth = null
    const crease = this.analysedCrease, heat = this.heatThreshold
    this.analysedCrease = null
    this.hideHeat()
    if (crease !== null && heat !== null) { this.analyse(crease); this.showHeat(heat) }
  }

  /** Keeps the previewed smoothing and clears the selection. */
  apply() {
    if (!this.selection.length) return
    this.remember(this.selection)
    for (const target of this.selection) {
      target.base = this.smoothed(target, this.lastSettings)
      target.baseNormals = normalsFor(target, target.base, this.lastSettings.creaseDeg, target.weight)
      writePositions(target, target.base, target.baseNormals)
      target.weight.fill(0); target.selectedCount = 0
    }
    this.selection = []
    this.hideMarkers()
    this.changed(1)
  }

  /**
   * Re-shades the whole body like an auto-smooth angle: faceted, blotchy
   * shading becomes smooth while edges sharper than the crease angle stay crisp.
   */
  shadeSmooth(creaseDeg: number) {
    this.cancel()
    const shaded = this.targets.filter(t => t.baseNormals)
    if (!shaded.length) return
    this.remember(shaded)
    for (const target of shaded) {
      target.baseNormals = normalsFor(target, target.base, creaseDeg, null)
      writePositions(target, target.base, target.baseNormals)
    }
    this.changed(1)
  }

  /** Drops the selection and puts the previewed vertices back. */
  cancel() {
    this.restore(this.selection)
    this.forget()
    for (const target of this.selection) { target.weight.fill(0); target.selectedCount = 0 }
    this.selection = []
    this.hideMarkers()
  }

  undo() {
    this.cancel()
    const last = this.undoStack.pop()
    if (!last) return
    last()
    this.changed(-1)
  }

  dispose() { this.cancel(); this.hideHeat() }
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
  const notes: { node: Object3D; userData: Record<string, unknown> }[] = []
  root.traverse(node => { notes.push({ node, userData: node.userData }); node.userData = {} })
  try {
    const result = await withFullIndices(root, () => new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false }))
    if (!(result instanceof ArrayBuffer)) throw new Error('The model could not be exported.')
    return new Uint8Array(result)
  } finally {
    for (const { node, userData } of notes) node.userData = userData
    for (const { mesh, preview } of swapped) mesh.material = preview
    for (const h of helpers) h.parent.add(h.object)
  }
}
