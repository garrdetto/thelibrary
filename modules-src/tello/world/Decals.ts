/**
 * Flat paint laid on Montello's ground in the town frame (x east, z south): parking stripes, curbs, infield dirt,
 * foul lines, warning tracks. Surfaces follow the lidar ground a few centimetres above it and sit under the town root
 * as frozen meshes, so the culler handles them like the buildings. Positions in, map coordinates (x east, z north).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { detailTexture } from '../../rackreel/world/World'
import type { TelloLand } from '../region'
import { batchOf, toMesh, type Batch } from './Roads'

export type PaintKind = 'white' | 'yellow' | 'dirt' | 'clay' | 'track' | 'curb' | 'bright' | 'dark' | 'mow' | 'pad' | 'chalk' | 'court'

const CELL = 256

const LOOKS: Record<PaintKind, { color: [number, number, number]; texture?: boolean; alpha?: number; zOffset: number }> = {
  white: { color: [0.86, 0.86, 0.84], zOffset: -4 },
  yellow: { color: [0.86, 0.66, 0.16], zOffset: -4 },
  dirt: { color: [0.62, 0.5, 0.36], texture: true, zOffset: -5 },
  clay: { color: [0.66, 0.4, 0.28], texture: true, zOffset: -5 },
  track: { color: [0.5, 0.4, 0.3], texture: true, zOffset: -5 },
  curb: { color: [0.8, 0.79, 0.76], texture: true, zOffset: -6 },
  bright: { color: [0.58, 0.8, 0.34], alpha: 0.16, zOffset: -3 },
  dark: { color: [0.18, 0.34, 0.12], alpha: 0.14, zOffset: -3 },
  mow: { color: [0.42, 0.62, 0.22], alpha: 0.2, zOffset: -3 },
  pad: { color: [0.55, 0.55, 0.53], texture: true, zOffset: -5 },
  chalk: { color: [0.95, 0.95, 0.92], zOffset: -6 },
  court: { color: [0.2, 0.42, 0.36], texture: true, zOffset: -5 },
}

export class Decals {
  private readonly batches = new Map<string, Batch>()
  constructor(private readonly land: TelloLand) {}

  private batch(kind: PaintKind, x: number, z: number): Batch {
    return batchOf(this.batches, `${kind}|${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
  }

  /** One ground-following quad; corners in map (x, z), `lift` metres above the ground. */
  quad(kind: PaintKind, c: [number, number][], lift = 0.09): void {
    const b = this.batch(kind, c[0][0], c[0][1])
    const v = b.positions.length / 3
    for (const [x, z] of c) {
      b.positions.push(x, this.land.heightAt(x, z) + lift, -z)
      b.uvs.push(x, z)
    }
    b.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
  }

  /** A strip from (x0, z0) to (x1, z1) `width` metres wide, cut every few metres so it follows the ground. */
  line(kind: PaintKind, x0: number, z0: number, x1: number, z1: number, width: number, lift = 0.09, step = 3): void {
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.05) return
    const n = Math.max(1, Math.ceil(len / step))
    const nx = (-(z1 - z0) / len) * (width / 2)
    const nz = ((x1 - x0) / len) * (width / 2)
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n
      const az = z0 + ((z1 - z0) * i) / n
      const bx = x0 + ((x1 - x0) * (i + 1)) / n
      const bz = z0 + ((z1 - z0) * (i + 1)) / n
      this.quad(kind, [[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]], lift)
    }
  }

  /** A polyline strip (a fence line, an arc). */
  path(kind: PaintKind, pts: [number, number][], width: number, lift = 0.09, closed = false): void {
    const n = pts.length
    for (let i = 0; i < n - (closed ? 0 : 1); i++) this.line(kind, pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1], width, lift, 2)
  }

  /** Paints every cell of a grid (`step` metres) over `bounds` whose centre `inside` accepts. */
  fill(kind: PaintKind, bounds: { x0: number; z0: number; x1: number; z1: number }, step: number, inside: (x: number, z: number) => boolean, lift = 0.09): void {
    for (let z = bounds.z0; z < bounds.z1; z += step) {
      for (let x = bounds.x0; x < bounds.x1; x += step) {
        if (!inside(x + step / 2, z + step / 2)) continue
        this.quad(kind, [[x, z], [x + step, z], [x + step, z + step], [x, z + step]], lift)
      }
    }
  }

  /** A raised curb: a top and an outer face along a polyline, `h` metres high, `w` wide, level with the ground at its ends. */
  curb(pts: [number, number][], w = 0.26, h = 0.15): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[i + 1]
      const len = Math.hypot(x1 - x0, z1 - z0)
      if (len < 0.05) continue
      const nx = (-(z1 - z0) / len) * (w / 2)
      const nz = ((x1 - x0) / len) * (w / 2)
      this.quad('curb', [[x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz], [x0 + nx, z0 + nz]], h)
      const side = (s: number) => {
        const b = this.batch('curb', x0, z0)
        const v = b.positions.length / 3
        const pts4: [number, number, number][] = [[x0 + s * nx, z0 + s * nz, 0.02], [x1 + s * nx, z1 + s * nz, 0.02], [x1 + s * nx, z1 + s * nz, h], [x0 + s * nx, z0 + s * nz, h]]
        for (const [x, z, up] of pts4) {
          b.positions.push(x, this.land.heightAt(x, z) + up, -z)
          b.uvs.push(x, up)
        }
        b.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
      }
      side(-1)
      side(1)
    }
  }

  /** Turns everything painted into frozen meshes under `root`. */
  flush(scene: Scene, root: TransformNode, name: string): Mesh[] {
    const concrete = detailTexture(scene)
    const mats = new Map<PaintKind, StandardMaterial>()
    const out: Mesh[] = []
    for (const [key, b] of this.batches) {
      if (!b.indices.length) continue
      const kind = key.split('|')[0] as PaintKind
      let mat = mats.get(kind)
      if (!mat) mats.set(kind, (mat = decalMaterial(scene, kind, concrete)))
      const mesh = toMesh(scene, `${name}:${key}`, b, mat)
      mesh.parent = root
      // `toMesh` froze the bounds before the mesh hung under the (moved, mirrored) town root; they must follow it, or
      // Babylon tests the decal for view at the wrong place and it blinks in and out as the camera turns.
      mesh.doNotSyncBoundingInfo = false
      mesh.freezeWorldMatrix()
      mesh.doNotSyncBoundingInfo = true
      out.push(mesh)
    }
    this.batches.clear()
    return out
  }
}

function decalMaterial(scene: Scene, kind: PaintKind, concrete: Texture): StandardMaterial {
  const look = LOOKS[kind]
  const mat = new StandardMaterial(`tello-decal-${kind}`, scene)
  mat.diffuseColor = new Color3(...look.color)
  if (look.texture) mat.diffuseTexture = concrete
  if (look.alpha) {
    mat.alpha = look.alpha
    mat.useAlphaFromDiffuseTexture = false
  }
  mat.specularColor = Color3.Black()
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  mat.zOffset = look.zOffset
  return mat
}
