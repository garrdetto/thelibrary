import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Constants } from '@babylonjs/core/Engines/constants'
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type * as THREE from 'three'
import { SPARKS, sparkColor } from './sparkField'
import type { SparkField } from './sparkField'

const SPARK_VERTS = 8
const SPARK_INDICES = [0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 4, 7, 5, 5, 7, 6]
const FLASH_SIDES = 10
const FLASH_VERTS = 1 + FLASH_SIDES * 2
/** Frames the mesh stays drawn after start-up, so its shader is built before the first contact. */
const WARM_FRAMES = 90
/** A spark's half width on screen, in pixels: never thinner than the first (it would flicker), never fatter than the second (a spark is a speck, however close). */
const MIN_PIXELS = 1
const MAX_PIXELS = 2.2
/** The dimmest a spark gets when it is widened to stay a pixel across. */
const FAR_DIM = 0.45
/** How bright the glow at the contact is next to a fresh spark. */
const FLASH_GLOW = 0.2
const FLASH_COLOR = [1, 0.6, 0.24]

/**
 * Draws a `SparkField` on Babylon as one additive HDR mesh. Each spark is a streak from where it was one exposure
 * ago (relative to the moving camera) to where it is now: a ribbon facing the camera whose centre line carries the
 * colour and whose edges and tips are black, so it has a soft outline and a hot core without a texture. Sparks
 * thinner than a pixel are widened to one and dimmed instead of flickering. Contact glows are small camera-facing
 * discs. Bloom (at night) and tone mapping do the rest.
 */
export class SparkStreaks {
  private readonly mesh: Mesh
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly sparkBase: number
  private readonly tail = new Float32Array(3)
  private readonly color = new Float32Array(3)
  private readonly eye = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, at: 0 }
  private drawn = 0
  private frames = 0

  constructor(scene: Scene, imageProcessing: ImageProcessingConfiguration, layerMask: number) {
    const flashes = SPARKS.flashes, capacity = SPARKS.capacity
    this.sparkBase = flashes * FLASH_VERTS
    const verts = this.sparkBase + capacity * SPARK_VERTS
    this.positions = new Float32Array(verts * 3)
    this.colors = new Float32Array(verts * 4)
    for (let v = 0; v < verts; v++) this.colors[v * 4 + 3] = 1
    const normals = new Float32Array(verts * 3)
    for (let v = 0; v < verts; v++) normals[v * 3 + 1] = 1
    const indices: number[] = []
    for (let f = 0; f < flashes; f++) {
      const c = f * FLASH_VERTS
      for (let s = 0; s < FLASH_SIDES; s++) {
        const a = c + 1 + s, b = c + 1 + ((s + 1) % FLASH_SIDES), ra = a + FLASH_SIDES, rb = b + FLASH_SIDES
        indices.push(c, a, b, a, ra, rb, a, rb, b)
      }
    }
    for (let i = 0; i < capacity; i++) for (const k of SPARK_INDICES) indices.push(this.sparkBase + i * SPARK_VERTS + k)

    const mesh = new Mesh('sparks', scene)
    const data = new VertexData()
    data.positions = this.positions
    data.normals = normals
    data.colors = this.colors
    data.indices = indices
    data.applyToMesh(mesh, true)
    const mat = new PBRMaterial('sparks', scene)
    mat.unlit = true
    mat.albedoColor = new Color3(1, 1, 1)
    mat.imageProcessingConfiguration = imageProcessing
    mat.alphaMode = Constants.ALPHA_ADD
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
    mat.backFaceCulling = false
    mat.disableDepthWrite = true
    mat.fogEnabled = false
    mesh.material = mat
    mesh.layerMask = layerMask
    mesh.renderingGroupId = 1
    mesh.alwaysSelectAsActiveMesh = true
    mesh.doNotSyncBoundingInfo = true
    mesh.isPickable = false
    mesh.receiveShadows = false
    this.mesh = mesh
  }

  /** How fast the viewer moves, from one frame to the next; a jump (a camera cut) counts as standing still. */
  private track(x: number, y: number, z: number): void {
    const e = this.eye, now = performance.now() / 1000, dt = now - e.at
    if (dt > 0.001 && dt < 0.25) {
      const vx = (x - e.x) / dt, vy = (y - e.y) / dt, vz = (z - e.z) / dt
      if (vx * vx + vy * vy + vz * vz < 150 * 150) {
        e.vx += (vx - e.vx) * 0.5
        e.vy += (vy - e.vy) * 0.5
        e.vz += (vz - e.vz) * 0.5
      } else e.vx = e.vy = e.vz = 0
    } else if (dt >= 0.25) e.vx = e.vy = e.vz = 0
    e.x = x
    e.y = y
    e.z = z
    e.at = now
  }

  private put(vertex: number, x: number, y: number, z: number, r: number, g: number, b: number): void {
    const p = vertex * 3, c = vertex * 4
    this.positions[p] = x
    this.positions[p + 1] = y
    this.positions[p + 2] = z
    this.colors[c] = r
    this.colors[c + 1] = g
    this.colors[c + 2] = b
  }

  /** Rebuilds the mesh for this frame, seen from `camera` on a view `viewHeight` render pixels tall. */
  draw(field: SparkField, camera: THREE.PerspectiveCamera, viewHeight: number): void {
    const m = camera.matrixWorld.elements, ex = m[12], ey = m[13], ez = m[14]
    this.track(ex, ey, ez)
    this.frames++
    const flashing = field.flashes.some((f) => f.life > 0)
    if (field.live === 0 && !flashing && this.drawn === 0) {
      this.mesh.isVisible = this.frames < WARM_FRAMES
      return
    }
    const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewHeight)
    const e = this.eye, tail = this.tail, color = this.color
    let n = 0
    for (let i = 0; i < field.capacity; i++) {
      if (field.life[i] <= 0) continue
      const p = i * 3, hx = field.pos[p], hy = field.pos[p + 1], hz = field.pos[p + 2]
      const tx0 = ex - hx, ty0 = ey - hy, tz0 = ez - hz, distance = Math.hypot(tx0, ty0, tz0)
      let half = field.size[i], dim = 1
      const least = MIN_PIXELS * pixel * distance, most = MAX_PIXELS * pixel * distance
      if (half < least) {
        dim = Math.max(FAR_DIM, Math.sqrt(half / least))
        half = least
      } else if (half > most) half = most
      field.tail(i, e.vx, e.vy, e.vz, tail, 0)
      let dx = hx - tail[0], dy = hy - tail[1], dz = hz - tail[2], length = Math.hypot(dx, dy, dz)
      if (length < 1e-5) {
        dx = m[4]
        dy = m[5]
        dz = m[6]
        length = 1
      }
      dx /= length
      dy /= length
      dz /= length
      const reach = Math.max(length, half * 2)
      const ax = hx - dx * reach, ay = hy - dy * reach, az = hz - dz * reach
      let sx = dy * tz0 - dz * ty0, sy = dz * tx0 - dx * tz0, sz = dx * ty0 - dy * tx0, sl = Math.hypot(sx, sy, sz)
      if (sl < 1e-6 * distance) {
        sx = m[0]
        sy = m[1]
        sz = m[2]
        sl = 1
      }
      sx *= half / sl
      sy *= half / sl
      sz *= half / sl
      sparkColor(field.life[i] / field.span[i], field.glow[i] * dim, color, 0)
      const r = color[0], g = color[1], b = color[2], fade = 0.3
      const v = this.sparkBase + n * SPARK_VERTS
      this.put(v, ax - dx * half, ay - dy * half, az - dz * half, 0, 0, 0)
      this.put(v + 1, ax - sx, ay - sy, az - sz, 0, 0, 0)
      this.put(v + 2, ax, ay, az, r * fade, g * fade * 0.8, b * fade * 0.5)
      this.put(v + 3, ax + sx, ay + sy, az + sz, 0, 0, 0)
      this.put(v + 4, hx - sx, hy - sy, hz - sz, 0, 0, 0)
      this.put(v + 5, hx, hy, hz, r, g, b)
      this.put(v + 6, hx + sx, hy + sy, hz + sz, 0, 0, 0)
      this.put(v + 7, hx + dx * half * 1.5, hy + dy * half * 1.5, hz + dz * half * 1.5, 0, 0, 0)
      n++
    }
    const used = this.sparkBase + n * SPARK_VERTS, last = this.sparkBase + this.drawn * SPARK_VERTS
    if (last > used) {
      this.positions.fill(0, used * 3, last * 3)
      for (let v = used; v < last; v++) this.colors[v * 4] = this.colors[v * 4 + 1] = this.colors[v * 4 + 2] = 0
    }
    this.drawn = n
    field.flashes.forEach((f, index) => {
      const c = index * FLASH_VERTS
      if (f.life <= 0) {
        this.positions.fill(0, c * 3, (c + FLASH_VERTS) * 3)
        return
      }
      const k = f.life / f.span, glow = SPARKS.peak * FLASH_GLOW * f.glow * k * k
      const r = FLASH_COLOR[0] * glow, g = FLASH_COLOR[1] * glow, b = FLASH_COLOR[2] * glow
      this.put(c, f.x, f.y, f.z, r, g, b)
      for (let s = 0; s < FLASH_SIDES; s++) {
        const a = (s / FLASH_SIDES) * Math.PI * 2, ca = Math.cos(a) * f.radius, sa = Math.sin(a) * f.radius
        const ox = m[0] * ca + m[4] * sa, oy = m[1] * ca + m[5] * sa, oz = m[2] * ca + m[6] * sa
        this.put(c + 1 + s, f.x + ox * 0.4, f.y + oy * 0.4, f.z + oz * 0.4, r * 0.3, g * 0.3, b * 0.3)
        this.put(c + 1 + FLASH_SIDES + s, f.x + ox, f.y + oy, f.z + oz, 0, 0, 0)
      }
    })
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false)
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false)
    this.mesh.isVisible = n > 0 || flashing || this.frames < WARM_FRAMES
  }

  get count(): number {
    return this.drawn
  }

  dispose(): void {
    this.mesh.material?.dispose()
    this.mesh.dispose()
  }
}
