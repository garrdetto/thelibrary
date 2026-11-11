import { Geometry } from '@babylonjs/core/Meshes/geometry'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { IndicesArray } from '@babylonjs/core/types'

/**
 * Gives `target` its own Geometry that points at `source`'s vertex buffers instead of copying them. Thin-instance buffers are stored on
 * the Geometry, so every thin-instanced mesh needs one of its own; the vertex data itself (positions, normals, colours, UVs) is uploaded
 * once and shared. `indices` replaces the source's index list (the same array is shared between meshes that pass the same one).
 */
export function linkGeometry(source: Mesh, target: Mesh, indices?: IndicesArray): void {
  const from = source.geometry
  if (!from) throw new Error(`No geometry on ${source.name}`)
  const total = from.getTotalVertices()
  const geometry = new Geometry(`${target.name}-geo`, source.getScene())
  for (const kind of from.getVerticesDataKinds()) {
    const buffer = from.getVertexBuffer(kind)
    if (buffer && !buffer.getIsInstanced()) geometry.setVerticesBuffer(buffer, total, false)
  }
  geometry.setIndices(indices ?? from.getIndices() ?? [], total)
  geometry.applyToMesh(target)
}
