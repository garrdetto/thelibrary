import { BufferAttribute, BufferGeometry, DoubleSide, Matrix3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three'
import type { Camera, Material, Object3D, Texture } from 'three'
import { detectVehicleWindows, glassMask } from '../../../../modules-src/maplestreet/shared/WindowDetect'
import type { GlassMask, WindowMesh } from '../../../../modules-src/maplestreet/shared/WindowDetect'
import { pointInPolygon } from '../../../../modules-src/maplestreet/shared/VehicleGlass'
import type { Px } from './bodySmooth'
import { fullIndex, setFullIndex } from './displayIndex'

export type WindowMode = 'glass' | 'open'
export type WindowReport = { triangles: number; area: number }

/** The games turn any material with one of these names into clear glass. */
export const GLASS_NAME = /glass|window|windshield/i
const MASK_SIDE = 2048

type Part = { mesh: Mesh; flags: Uint8Array; overlay: Mesh | null }
type UndoStep = { geometry: BufferGeometry; index: BufferAttribute | null; glass: Mesh | null }[]

function materialsOf(mesh: Mesh): Material[] {
  const own = (mesh.userData.msOriginalMaterial as Material | Material[] | undefined) ?? mesh.material
  return Array.isArray(own) ? own : [own]
}

const isGlass = (mesh: Mesh) => materialsOf(mesh).some(material => GLASS_NAME.test(material?.name ?? ''))

function floats(attribute: { count: number; itemSize: number; getX(i: number): number; getY(i: number): number; getZ?(i: number): number }, size: 2 | 3) {
  const out = new Float32Array(attribute.count * size)
  for (let i = 0; i < attribute.count; i++) {
    out[i * size] = attribute.getX(i)
    out[i * size + 1] = attribute.getY(i)
    if (size === 3) out[i * 3 + 2] = attribute.getZ!(i)
  }
  return out
}

function indexArray(geometry: BufferGeometry): Uint32Array {
  const index = fullIndex(geometry)
  if (!index) return Uint32Array.from({ length: geometry.getAttribute('position').count - (geometry.getAttribute('position').count % 3) }, (_, i) => i)
  const out = new Uint32Array(index.count - (index.count % 3))
  for (let i = 0; i < out.length; i++) out[i] = index.getX(i)
  return out
}

const masks = new WeakMap<object, GlassMask>()

/** The glass mask of a colour texture, read once per image and at most MASK_SIDE texels a side. */
function maskOf(texture: Texture | null | undefined): GlassMask | null {
  const image = texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!texture || !image?.width || !image.height) return null
  const hit = masks.get(image)
  if (hit) return hit
  const scale = Math.min(1, MASK_SIDE / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const mask = glassMask(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {}, texture.flipY)
  masks.set(image, mask)
  return mask
}

/**
 * Finds a body's painted-on windows and turns them into real glass (their own
 * mesh with a material named `glass`) or removes them. Works on the loaded
 * model itself, so the preview and the saved file show the same thing.
 */
export class WindowTool {
  private parts: Part[] = []
  private undoStack: UndoStep[] = []
  edits = 0

  /** `toBody` takes the model's own space (the root's parent) into the body frame: x forward, y up, z right, metres. */
  constructor(private readonly root: Object3D, private readonly toBody: () => Matrix4) {}

  get undoDepth() { return this.undoStack.length }
  get selected() { return this.parts.reduce((n, part) => n + part.flags.reduce((a, f) => a + f, 0), 0) }
  /** True when the model already has glass of its own (made here earlier, or modelled that way). */
  get hasGlass() { let found = false; this.root.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh && !node.userData.msHelper && isGlass(mesh)) found = true }); return found }

  private bodies(): Mesh[] {
    const out: Mesh[] = []
    this.root.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh || node.userData.msHelper || !mesh.geometry?.getAttribute('position') || isGlass(mesh)) return
      if (mesh.geometry.groups.length > 1) return
      out.push(mesh)
    })
    return out
  }

  private frame(mesh: Mesh) {
    this.root.updateMatrixWorld(true)
    const toModel = this.root.parent ? new Matrix4().copy(this.root.parent.matrixWorld).invert() : new Matrix4()
    return new Matrix4().multiplyMatrices(this.toBody(), new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld))
  }

  private ensureParts() {
    const meshes = this.bodies()
    const same = meshes.length === this.parts.length && meshes.every((mesh, i) => this.parts[i].mesh === mesh && this.parts[i].flags.length === indexArray(mesh.geometry).length / 3)
    if (same) return
    this.clear()
    this.parts = meshes.map(mesh => ({ mesh, flags: new Uint8Array(indexArray(mesh.geometry).length / 3), overlay: null }))
  }

  /** Finds the window panes by themselves and highlights them. */
  find(): WindowReport {
    this.clear()
    const meshes = this.bodies()
    const inputs: WindowMesh[] = meshes.map(mesh => {
      const geometry = mesh.geometry
      const m = this.frame(mesh)
      const normalMatrix = new Matrix3().getNormalMatrix(m)
      const positions = floats(geometry.getAttribute('position'), 3)
      const v = new Vector3()
      for (let i = 0; i < positions.length; i += 3) { v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m); positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z }
      const normal = geometry.getAttribute('normal')
      let normals: Float32Array | null = null
      if (normal && normal.count === geometry.getAttribute('position').count) {
        normals = floats(normal, 3)
        for (let i = 0; i < normals.length; i += 3) { v.set(normals[i], normals[i + 1], normals[i + 2]).applyMatrix3(normalMatrix).normalize(); normals[i] = v.x; normals[i + 1] = v.y; normals[i + 2] = v.z }
      }
      const map = (materialsOf(mesh)[0] as MeshStandardMaterial | undefined)?.map ?? null
      const uv = geometry.getAttribute(map && map.channel > 0 ? `uv${map.channel}` : 'uv')
      return { positions, normals, uvs: uv ? floats(uv, 2) : null, indices: indexArray(geometry), mask: maskOf(map) }
    })
    const found = detectVehicleWindows(inputs)
    this.parts = meshes.map((mesh, i) => ({ mesh, flags: found.flags[i], overlay: null }))
    this.show()
    return { triangles: found.triangles, area: found.area }
  }

  /** Adds the camera-facing triangles inside a loop drawn over the canvas to the selection, or takes them out. */
  lasso(polygon: Px[], camera: Camera, size: { width: number; height: number }, mode: 'add' | 'remove'): WindowReport {
    this.ensureParts()
    const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
    const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y))
    const inside = (x: number, y: number) => pointInPolygon(x, y, polygon)
    const eye = camera.getWorldPosition(new Vector3())
    const forward = camera.getWorldDirection(new Vector3())
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), centre = new Vector3(), normal = new Vector3(), toEye = new Vector3()
    this.root.updateMatrixWorld(true)
    for (const part of this.parts) {
      const position = part.mesh.geometry.getAttribute('position')
      const index = indexArray(part.mesh.geometry)
      for (let t = 0; t < part.flags.length; t++) {
        if ((mode === 'add') === (part.flags[t] === 1)) continue
        a.fromBufferAttribute(position, index[t * 3]).applyMatrix4(part.mesh.matrixWorld)
        b.fromBufferAttribute(position, index[t * 3 + 1]).applyMatrix4(part.mesh.matrixWorld)
        c.fromBufferAttribute(position, index[t * 3 + 2]).applyMatrix4(part.mesh.matrixWorld)
        centre.copy(a).add(b).add(c).multiplyScalar(1 / 3)
        normal.copy(b).sub(a).cross(toEye.copy(c).sub(a))
        if (perspective) toEye.subVectors(centre, eye); else toEye.copy(forward)
        if (normal.dot(toEye) >= 0) continue
        const ndc = centre.project(camera)
        if (ndc.z < -1 || ndc.z > 1) continue
        const x = ((ndc.x + 1) / 2) * size.width, y = ((1 - ndc.y) / 2) * size.height
        if (x < minX || x > maxX || y < minY || y > maxY || !inside(x, y)) continue
        part.flags[t] = mode === 'add' ? 1 : 0
      }
    }
    this.show()
    return this.report()
  }

  private report(): WindowReport {
    let triangles = 0, area = 0
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    for (const part of this.parts) {
      const position = part.mesh.geometry.getAttribute('position')
      const index = indexArray(part.mesh.geometry)
      const m = this.frame(part.mesh)
      for (let t = 0; t < part.flags.length; t++) {
        if (!part.flags[t]) continue
        triangles++
        a.fromBufferAttribute(position, index[t * 3]).applyMatrix4(m)
        b.fromBufferAttribute(position, index[t * 3 + 1]).applyMatrix4(m)
        c.fromBufferAttribute(position, index[t * 3 + 2]).applyMatrix4(m)
        area += b.sub(a).cross(c.sub(a)).length() / 2
      }
    }
    return { triangles, area }
  }

  private split(part: Part) {
    const index = indexArray(part.mesh.geometry)
    const picked: number[] = [], rest: number[] = []
    for (let t = 0; t < part.flags.length; t++) (part.flags[t] ? picked : rest).push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2])
    return { picked, rest }
  }

  private sharing(geometry: BufferGeometry, index: number[]) {
    const out = new BufferGeometry()
    for (const name of Object.keys(geometry.attributes)) out.setAttribute(name, geometry.attributes[name])
    out.setIndex(new BufferAttribute(geometry.getAttribute('position').count > 65535 ? Uint32Array.from(index) : Uint16Array.from(index), 1))
    out.boundingBox = geometry.boundingBox?.clone() ?? null
    out.boundingSphere = geometry.boundingSphere?.clone() ?? null
    return out
  }

  private show() {
    this.hide()
    for (const part of this.parts) {
      const { picked } = this.split(part)
      if (!picked.length) continue
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', part.mesh.geometry.getAttribute('position'))
      geometry.setIndex(new BufferAttribute(Uint32Array.from(picked), 1))
      const overlay = new Mesh(geometry, new MeshBasicMaterial({ color: '#35d0ff', transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
      overlay.userData.msHelper = true
      overlay.renderOrder = 6
      overlay.raycast = () => {}
      part.mesh.add(overlay)
      part.overlay = overlay
    }
  }

  private hide() {
    for (const part of this.parts) {
      if (!part.overlay) continue
      part.overlay.removeFromParent()
      part.overlay.geometry.dispose();
      (part.overlay.material as Material).dispose()
      part.overlay = null
    }
  }

  /** Turns the selected triangles into glass, or removes them. */
  apply(mode: WindowMode): WindowReport {
    const report = this.report()
    if (!report.triangles) return report
    const step: UndoStep = []
    for (const part of this.parts) {
      const { picked, rest } = this.split(part)
      if (!picked.length) continue
      const geometry = part.mesh.geometry
      let glass: Mesh | null = null
      if (mode === 'glass') {
        const material = new MeshStandardMaterial({ name: 'glass', color: '#e8f1f5', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, side: DoubleSide, depthWrite: false })
        glass = new Mesh(this.sharing(geometry, picked), material)
        glass.name = 'glass'
        glass.renderOrder = 3
        glass.raycast = () => {}
        part.mesh.add(glass)
      }
      step.push({ geometry, index: fullIndex(geometry), glass })
      setFullIndex(geometry, new BufferAttribute(geometry.getAttribute('position').count > 65535 ? Uint32Array.from(rest) : Uint16Array.from(rest), 1))
    }
    this.clear()
    this.undoStack.push(step)
    if (this.undoStack.length > 12) this.undoStack.shift()
    this.edits++
    return report
  }

  /** Drops the selection without changing the model. */
  clear() {
    this.hide()
    this.parts = []
  }

  undo() {
    const step = this.undoStack.pop()
    if (!step) return
    this.clear()
    for (const { geometry, index, glass } of step) {
      setFullIndex(geometry, index)
      if (glass) { glass.removeFromParent(); glass.geometry.dispose(); (glass.material as Material).dispose() }
    }
    this.edits = Math.max(0, this.edits - 1)
  }

  dispose() { this.clear() }
}
