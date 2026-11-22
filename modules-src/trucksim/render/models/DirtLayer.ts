/**
 * Road grime on a truck. Thin decal quads hang just outside the cab sides, the lower hood, the wheel arches and the mudflaps (in
 * the vehicle frame under the truck's root, so they move with it), all sampling one `DynamicTexture`: two side strips and a rear
 * strip of mud cells. Each cell holds how much mud is left (0 to 1); cells only exist where there is bodywork under them, and
 * there is more mud low down. `setDirt` fades the whole layer with the truck's dirt level (0 to 100), and `scrub` sprays it: the
 * ray from the wand is intersected with the decal quads, the cells around the hit lose mud, and the texture is repainted.
 * `remaining` is the share of the starting mud still on, which the wash turns into the `cleaned` share it reports. Where no
 * canvas exists (node tests) the cells still work and nothing is painted. `dispose` frees the mesh, material and texture.
 */

import type { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TruckLayout } from './truck/Layout'

/** The wand's spray radius on the body, in metres. */
export const SPRAY_RADIUS = 0.32
/** Mud removed per second at the centre of the spray (cell value units). */
export const SPRAY_RATE = 2.6

const TEX = 256
const CELL_PX = 4
const SIDE_COLS = 64
const SIDE_ROWS = 16
const REAR_COLS = 32
const REAR_ROWS = 8
const EDGE_FADE = 0.35

type Strip = 'left' | 'right' | 'rear'

interface StripSpace {
  strip: Strip
  cols: number
  rows: number
  pxTop: number
  a0: number
  a1: number
  y0: number
  y1: number
}

interface Region {
  strip: Strip
  plane: number
  a0: number
  a1: number
  y0: number
  y1: number
}

export interface DirtHit {
  point: Vector3
  removed: number
}

export interface DirtLayer {
  readonly mesh: Mesh | null
  readonly remaining: number
  readonly level: number
  setDirt(level: number): void
  resetMud(): void
  scrub(origin: Vector3, direction: Vector3, dt: number): DirtHit | null
  dispose(): void
}

function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The bodywork the grime can sit on, per strip, in the vehicle frame. */
export function dirtRegions(layout: TruckLayout): Region[] {
  const out: Region[] = []
  const cab = { a0: layout.sleeperBackZ, a1: layout.cabFrontZ, y0: Math.max(0.45, layout.cabFloorY - 0.35), y1: layout.cabFloorY + 0.75 }
  const arches: { a0: number; a1: number; y0: number; y1: number }[] = []
  const reach = layout.wheelR + 0.32
  for (const z of [0, ...layout.rearAxles.map((axle) => axle.z)]) arches.push({ a0: z - reach, a1: z + reach, y0: 0.18, y1: layout.wheelR * 2 + 0.22 })
  for (const strip of ['left', 'right'] as const) {
    const sign = strip === 'left' ? 1 : -1
    out.push({ strip, plane: sign * (layout.hw + 0.03), ...cab })
    if (layout.style !== 'cabover' && layout.noseZ > layout.cabFrontZ + 0.2) {
      out.push({ strip, plane: sign * (layout.hoodHalfWidth + 0.03), a0: layout.cabFrontZ, a1: layout.noseZ, y0: Math.max(0.45, layout.hoodBottom - 0.1), y1: layout.hoodBottom + 0.45 })
    }
    for (const arch of arches) out.push({ strip, plane: sign * (layout.model.width / 2 + 0.04), ...arch })
  }
  out.push({ strip: 'rear', plane: layout.frameRearZ - 0.04, a0: -layout.model.width / 2, a1: layout.model.width / 2, y0: 0.3, y1: 1.15 })
  return out
}

function spaces(layout: TruckLayout, regions: readonly Region[]): Record<Strip, StripSpace> {
  const side = regions.filter((region) => region.strip !== 'rear')
  const a0 = Math.min(...side.map((region) => region.a0))
  const a1 = Math.max(...side.map((region) => region.a1))
  const y1 = Math.max(...side.map((region) => region.y1))
  const width = layout.model.width / 2 + 0.1
  return {
    left: { strip: 'left', cols: SIDE_COLS, rows: SIDE_ROWS, pxTop: 0, a0, a1, y0: 0, y1 },
    right: { strip: 'right', cols: SIDE_COLS, rows: SIDE_ROWS, pxTop: SIDE_ROWS * CELL_PX, a0, a1, y0: 0, y1 },
    rear: { strip: 'rear', cols: REAR_COLS, rows: REAR_ROWS, pxTop: SIDE_ROWS * CELL_PX * 2, a0: -width, a1: width, y0: 0.2, y1: 1.25 },
  }
}

const STRIPS: readonly Strip[] = ['left', 'right', 'rear']

/** Builds the grime decals for a truck under its root node. */
export function createDirtLayer(scene: Scene, root: TransformNode, layout: TruckLayout): DirtLayer {
  const regions = dirtRegions(layout)
  const space = spaces(layout, regions)
  const cells: Record<Strip, Float32Array> = { left: new Float32Array(SIDE_COLS * SIDE_ROWS), right: new Float32Array(SIDE_COLS * SIDE_ROWS), rear: new Float32Array(REAR_COLS * REAR_ROWS) }
  const support: Record<Strip, Float32Array> = { left: new Float32Array(SIDE_COLS * SIDE_ROWS), right: new Float32Array(SIDE_COLS * SIDE_ROWS), rear: new Float32Array(REAR_COLS * REAR_ROWS) }
  let total = 0
  for (const strip of STRIPS) {
    const s = space[strip]
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const a = s.a0 + ((col + 0.5) / s.cols) * (s.a1 - s.a0)
        const y = s.y0 + ((row + 0.5) / s.rows) * (s.y1 - s.y0)
        let edge = 0
        for (const region of regions) {
          if (region.strip !== strip) continue
          edge = Math.max(edge, Math.min(a - region.a0, region.a1 - a, y - region.y0, region.y1 - y))
        }
        if (edge <= 0) continue
        const low = 1 - (y - s.y0) / (s.y1 - s.y0)
        const index = row * s.cols + col
        const ragged = Math.min(1, edge / EDGE_FADE + hash(index, strip.length * 131) * 0.9 - 0.35)
        if (ragged <= 0.05) continue
        support[strip][index] = Math.min(1, ragged * (0.5 + 0.5 * low) * (0.65 + 0.35 * hash(index, strip.length * 977)))
        total += support[strip][index]
      }
    }
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const uvOf = (strip: Strip, a: number, y: number): [number, number] => {
    const s = space[strip]
    const u = (a - s.a0) / (s.a1 - s.a0)
    const v = (y - s.y0) / (s.y1 - s.y0)
    const px = u * s.cols * CELL_PX
    const py = s.pxTop + (1 - v) * s.rows * CELL_PX
    return [px / TEX, 1 - py / TEX]
  }
  for (const region of regions) {
    const base = positions.length / 3
    const corners: [number, number][] = [[region.a0, region.y0], [region.a1, region.y0], [region.a1, region.y1], [region.a0, region.y1]]
    for (const [a, y] of corners) {
      if (region.strip === 'rear') {
        positions.push(a, y, region.plane)
        normals.push(0, 0, -1)
      } else {
        positions.push(region.plane, y, a)
        normals.push(Math.sign(region.plane), 0, 0)
      }
      uvs.push(...uvOf(region.strip, a, y))
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  let texture: DynamicTexture | null = null
  let context: CanvasRenderingContext2D | null = null
  try {
    texture = new DynamicTexture('trucksim-dirt', { width: TEX, height: TEX }, scene, true, Texture.TRILINEAR_SAMPLINGMODE)
    context = texture.getContext() as CanvasRenderingContext2D | null
    if (!context || typeof context.clearRect !== 'function') {
      texture.dispose()
      texture = null
      context = null
    }
  } catch {
    texture?.dispose()
    texture = null
    context = null
  }

  const material = new PBRMaterial('trucksim-dirt', scene)
  material.albedoColor = Color3.White()
  material.metallic = 0
  material.roughness = 1
  material.metallicF0Factor = 0
  material.environmentIntensity = 0.15
  material.zOffset = -2
  material.transparencyMode = Material.MATERIAL_ALPHABLEND
  material.backFaceCulling = false
  if (texture) {
    texture.hasAlpha = true
    material.albedoTexture = texture
    material.useAlphaFromAlbedoTexture = true
  }

  let mesh: Mesh | null = null
  if (texture) {
    mesh = new Mesh('trucksim-dirt', scene)
    mesh.parent = root
    const data = new VertexData()
    data.positions = positions
    data.normals = normals
    data.uvs = uvs
    data.indices = indices
    data.applyToMesh(mesh, false)
    mesh.material = material
    mesh.isPickable = false
    mesh.receiveShadows = true
  }

  const paintCell = (strip: Strip, col: number, row: number): void => {
    if (!context) return
    const s = space[strip]
    const index = row * s.cols + col
    const x = col * CELL_PX
    const y = s.pxTop + (s.rows - 1 - row) * CELL_PX
    context.clearRect(x, y, CELL_PX, CELL_PX)
    const value = cells[strip][index]
    if (value < 0.02) return
    const tone = hash(index, 31 + strip.length)
    const r = Math.round(92 + tone * 34)
    const g = Math.round(74 + tone * 26)
    const b = Math.round(52 + tone * 16)
    context.fillStyle = `rgba(${r},${g},${b},${Math.min(0.95, value * 1.1).toFixed(3)})`
    context.fillRect(x, y, CELL_PX, CELL_PX)
    if (hash(index, 7) > 0.6) {
      context.fillStyle = `rgba(${r - 28},${g - 24},${b - 18},${Math.min(0.9, value).toFixed(3)})`
      context.fillRect(x + 1, y + 1, 2, 2)
    }
  }

  const paintAll = (): void => {
    if (!context || !texture) return
    context.clearRect(0, 0, TEX, TEX)
    for (const strip of STRIPS) {
      const s = space[strip]
      for (let row = 0; row < s.rows; row++) for (let col = 0; col < s.cols; col++) paintCell(strip, col, row)
    }
    texture.update(true)
  }

  let level = 0
  let disposed = false
  const inverse = new Matrix()
  const localOrigin = new Vector3()
  const localDirection = new Vector3()

  const layer: DirtLayer = {
    get mesh() {
      return mesh
    },
    get level() {
      return level
    },
    get remaining() {
      if (total <= 0) return 0
      let left = 0
      for (const strip of STRIPS) for (let i = 0; i < cells[strip].length; i++) left += cells[strip][i]
      return left / total
    },
    setDirt(next: number) {
      level = Math.max(0, Math.min(100, Number.isFinite(next) ? next : 0))
      material.alpha = Math.min(1, level / 70)
      if (mesh) mesh.setEnabled(level > 0.5)
    },
    resetMud() {
      for (const strip of STRIPS) cells[strip].set(support[strip])
      paintAll()
    },
    scrub(origin: Vector3, direction: Vector3, dt: number): DirtHit | null {
      if (disposed) return null
      root.computeWorldMatrix(true)
      root.getWorldMatrix().invertToRef(inverse)
      Vector3.TransformCoordinatesToRef(origin, inverse, localOrigin)
      Vector3.TransformNormalToRef(direction, inverse, localDirection)
      let best: { t: number; region: Region; a: number; y: number } | null = null
      for (const region of regions) {
        const rear = region.strip === 'rear'
        const o = rear ? localOrigin.z : localOrigin.x
        const d = rear ? localDirection.z : localDirection.x
        if (Math.abs(d) < 1e-6) continue
        const t = (region.plane - o) / d
        if (t <= 0 || (best && t >= best.t)) continue
        const a = rear ? localOrigin.x + localDirection.x * t : localOrigin.z + localDirection.z * t
        const y = localOrigin.y + localDirection.y * t
        if (a < region.a0 || a > region.a1 || y < region.y0 || y > region.y1) continue
        best = { t, region, a, y }
      }
      if (!best) return null
      const s = space[best.region.strip]
      const cellA = (s.a1 - s.a0) / s.cols
      const cellY = (s.y1 - s.y0) / s.rows
      const values = cells[best.region.strip]
      let removed = 0
      const c0 = Math.max(0, Math.floor((best.a - SPRAY_RADIUS - s.a0) / cellA))
      const c1 = Math.min(s.cols - 1, Math.floor((best.a + SPRAY_RADIUS - s.a0) / cellA))
      const r0 = Math.max(0, Math.floor((best.y - SPRAY_RADIUS - s.y0) / cellY))
      const r1 = Math.min(s.rows - 1, Math.floor((best.y + SPRAY_RADIUS - s.y0) / cellY))
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const index = row * s.cols + col
          if (values[index] <= 0) continue
          const da = s.a0 + (col + 0.5) * cellA - best.a
          const dy = s.y0 + (row + 0.5) * cellY - best.y
          const distance = Math.hypot(da, dy)
          if (distance > SPRAY_RADIUS) continue
          const take = Math.min(values[index], SPRAY_RATE * dt * (1 - (distance / SPRAY_RADIUS) ** 2))
          values[index] -= take
          if (values[index] < 0.03) {
            removed += values[index]
            values[index] = 0
          }
          removed += take
          paintCell(best.region.strip, col, row)
        }
      }
      if (removed > 0) texture?.update(true)
      const point = Vector3.TransformCoordinates(localOrigin.add(localDirection.scale(best.t)), root.getWorldMatrix())
      return { point, removed }
    },
    dispose() {
      if (disposed) return
      disposed = true
      mesh?.dispose(false, false)
      mesh = null
      material.dispose(false, false)
      texture?.dispose()
      texture = null
    },
  }
  layer.resetMud()
  layer.setDirt(0)
  return layer
}
