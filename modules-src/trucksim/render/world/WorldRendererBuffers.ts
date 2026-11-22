/**
 * GPU buffer sharing for streamed chunks. `SharedIndexBuffer` uploads one index list once and lets any number of geometries draw
 * with it (each geometry holds a reference that its own dispose releases), so every terrain chunk of a resolution and every
 * thin-instance host of a prop model use the same index buffer. `linkVertexBuffers` gives a new geometry non-owning views of a
 * template geometry's vertex buffers: the per-chunk host gets its own Geometry (thin-instance buffers live there) while the vertex
 * data is uploaded once, and disposing the host never releases the template's buffers. Triangle helpers emit faces in Babylon's
 * front-face convention for the scene they will render in.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { DataBuffer } from '@babylonjs/core/Buffers/dataBuffer'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { Geometry } from '@babylonjs/core/Meshes/geometry'

/** One uploaded index list shared by many geometries. */
export class SharedIndexBuffer {
  readonly indices: Uint16Array | Uint32Array
  readonly is32Bits: boolean
  private buffer: DataBuffer | null
  private readonly engine: AbstractEngine

  constructor(engine: AbstractEngine, indices: Uint16Array | Uint32Array) {
    this.engine = engine
    this.indices = indices
    this.is32Bits = indices instanceof Uint32Array
    this.buffer = engine.createIndexBuffer(indices, false, 'trucksim-shared-indices')
  }

  get count(): number {
    return this.indices.length
  }

  /** Makes `geometry` draw with these indices; the geometry's dispose releases its reference. */
  attach(geometry: Geometry, totalVertices: number): void {
    if (!this.buffer) throw new Error('SharedIndexBuffer used after dispose')
    this.buffer.references++
    geometry.setIndexBuffer(this.buffer, totalVertices, this.indices.length, this.is32Bits)
  }

  /** Releases the owner's reference (the GPU buffer goes once every geometry using it is gone). */
  dispose(): void {
    if (!this.buffer) return
    this.engine._releaseBuffer(this.buffer)
    this.buffer = null
  }
}

/** Points `target` at `source`'s vertex buffers without taking ownership of them. */
export function linkVertexBuffers(engine: AbstractEngine, source: Geometry, target: Geometry): void {
  const total = source.getTotalVertices()
  for (const kind of source.getVerticesDataKinds()) {
    const original = source.getVertexBuffer(kind)
    if (!original || original.getIsInstanced()) continue
    const view = new VertexBuffer(engine, original.getWrapperBuffer(), kind, {
      updatable: false,
      stride: original.byteStride / 4,
      size: original.getSize(),
      offset: original.byteOffset / 4,
      type: original.type,
      normalized: original.normalized,
      takeBufferOwnership: false,
    })
    target.setVerticesBuffer(view, total, false)
  }
}

/** Front faces in Babylon's convention have (b − a) × (c − a) pointing away from the side they face. */
export function frontFacing(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): boolean {
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const crossX = uy * vz - uz * vy
  const crossY = uz * vx - ux * vz
  const crossZ = ux * vy - uy * vx
  return crossX * nx + crossY * ny + crossZ * nz < 0
}

/** Appends triangle (a, b, c) to `indices`, swapping b and c if needed so it faces along (nx, ny, nz). */
export function pushFacing(indices: number[], positions: ArrayLike<number>, a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
  if (frontFacing(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2], positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2], positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2], nx, ny, nz)) indices.push(a, b, c)
  else indices.push(a, c, b)
}
