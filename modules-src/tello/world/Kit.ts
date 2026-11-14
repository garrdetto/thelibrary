/**
 * Blender-built detail parts (`tools/build-montello.py`, optimised into `public/models/tello/`) laid into Tello's
 * merged builders. A kit file is loaded once; each root node becomes a part, its primitives keep their material name
 * as a slot (trim, stone, door, shingle, metal, granite, water, ...), and `put` appends a part's triangles to whichever
 * builder the caller picks for each slot, transformed and coloured, so the details cost no extra draw calls.
 *
 * Parts are in glTF space (x right, y up, z toward the viewer), the same axes as a storefront's own frame.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import { Assets } from '../../foxlake/fp/core/Assets'
import type { MeshBuilder, RGB } from '../../foxlake/fp/core/Geo'

export interface KitPiece { slot: string; pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array | null; idx: Uint32Array }

/** Where the kit files are served from, relative to the module page. */
export const KIT_URL = { downtown: '../models/tello/downtown-kit.glb', quarry: '../models/tello/quarry.glb' }

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const _p = new Vector3()
const _n = new Vector3()

export class ModelKit {
  constructor(readonly parts: Map<string, KitPiece[]>) {}

  /** Loads a kit file; null when it can't be loaded (the callers fall back to their simpler shapes). */
  static async load(scene: Scene, url: string): Promise<ModelKit | null> {
    const href = new URL(url, typeof location === 'undefined' ? 'http://localhost/modules/' : location.href).href
    const container = await new Assets(scene).container(href)
    if (!container) return null
    const root = container.meshes.find((m) => m.name === '__root__') ?? container.meshes[0]
    root.computeWorldMatrix(true)
    const toGltf = root.getWorldMatrix().clone().invert()
    const parts = new Map<string, KitPiece[]>()
    for (const mesh of container.meshes) {
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
      const ind = mesh.getIndices()
      if (!pos || !ind || !ind.length) continue
      mesh.computeWorldMatrix(true)
      const m = mesh.getWorldMatrix().multiply(toGltf)
      const nm = m.clone().invert().transpose()
      const nrm = mesh.getVerticesData(VertexBuffer.NormalKind)
      const uv = mesh.getVerticesData(VertexBuffer.UVKind)
      const col = mesh.getVerticesData(VertexBuffer.ColorKind)
      const count = pos.length / 3
      const piece: KitPiece = { slot: mesh.material?.name ?? 'trim', pos: new Float32Array(count * 3), nrm: new Float32Array(count * 3), uv: new Float32Array(count * 2), col: col ? new Float32Array(count * 3) : null, idx: Uint32Array.from(ind) }
      const stride = col ? col.length / count : 4
      for (let i = 0; i < count; i++) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], m, _p)
        piece.pos.set([_p.x, _p.y, _p.z], i * 3)
        if (nrm) {
          Vector3.TransformNormalFromFloatsToRef(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], nm, _n)
          _n.normalize()
          piece.nrm.set([_n.x, _n.y, _n.z], i * 3)
        }
        if (uv) piece.uv.set([uv[i * 2], uv[i * 2 + 1]], i * 2)
        if (col && piece.col) piece.col.set([toSrgb(col[i * stride]), toSrgb(col[i * stride + 1]), toSrgb(col[i * stride + 2])], i * 3)
      }
      const name = (mesh.parent && /_primitive\d+$/.test(mesh.name) ? mesh.parent.name : mesh.name).replace(/_primitive\d+$/, '')
      let list = parts.get(name)
      if (!list) parts.set(name, (list = []))
      list.push(piece)
    }
    container.dispose()
    return parts.size ? new ModelKit(parts) : null
  }

  has(name: string): boolean {
    return this.parts.has(name)
  }

  /**
   * Appends part `name`, moved by `m` (part space to the builder's own space; the builder's current transform still
   * applies on top), into the builder `pick` gives for each slot. `color` gives each vertex its colour from the slot
   * and the part's own vertex colour (sRGB), when it has one.
   */
  put(name: string, m: Matrix, pick: (slot: string) => MeshBuilder | null, color: (slot: string, own: RGB | null) => RGB): void {
    const pieces = this.parts.get(name)
    if (!pieces) return
    const nm = m.clone().invert().transpose()
    const flip = m.determinant() < 0
    for (const piece of pieces) {
      const b = pick(piece.slot)
      if (!b) continue
      const base = b.vertexCount
      const n = piece.pos.length / 3
      const plain = piece.col ? null : color(piece.slot, null)
      for (let i = 0; i < n; i++) {
        Vector3.TransformCoordinatesFromFloatsToRef(piece.pos[i * 3], piece.pos[i * 3 + 1], piece.pos[i * 3 + 2], m, _p)
        Vector3.TransformNormalFromFloatsToRef(piece.nrm[i * 3], piece.nrm[i * 3 + 1], piece.nrm[i * 3 + 2], nm, _n)
        _n.normalize()
        const c = plain ?? color(piece.slot, [piece.col![i * 3], piece.col![i * 3 + 1], piece.col![i * 3 + 2]])
        b.vertex(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, piece.uv[i * 2], piece.uv[i * 2 + 1], c)
      }
      const idx = piece.idx
      for (let k = 0; k + 2 < idx.length; k += 3) {
        if (flip) b.idx.push(base + idx[k], base + idx[k + 2], base + idx[k + 1])
        else b.idx.push(base + idx[k], base + idx[k + 1], base + idx[k + 2])
      }
    }
  }
}

/** A part placement: translate, then scale along the part's own axes. */
export function place(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, yaw = 0): Matrix {
  return Matrix.Scaling(sx, sy, sz).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(x, y, z))
}
