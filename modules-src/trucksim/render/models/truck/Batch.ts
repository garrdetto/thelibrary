/**
 * Collects truck parts per material key and turns each group into one mesh, so a whole static body costs one draw call per
 * material. Parts arrive as `VertexData` already placed in the batch's frame (the truck root, the dump bed pivot, a wheel);
 * nothing is created in the scene until `build`, which parents every mesh under the node it is given.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { VertexData as VertexDataType } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'

/** A material slot of a truck: shared library names, the truck's three paints and its own lamp instances. */
export type PartKey =
  | 'primary' | 'secondary' | 'accent'
  | 'chrome' | 'steel' | 'darkSteel' | 'aluminum' | 'rubber' | 'glass' | 'glassTint' | 'plastic' | 'grille' | 'satinBlack'
  | 'deck' | 'lampAmber' | 'lampWhite' | 'lampRed' | 'hoseRed' | 'hoseBlue'
  | 'head' | 'tail' | 'reverse' | 'wheel' | 'hub' | 'cargo'

interface Group {
  positions: number[]
  normals: number[]
  indices: number[]
}

/** One built mesh and the slot it was built for. */
export interface BuiltMesh {
  key: PartKey
  mesh: Mesh
}

/** Accumulates placed parts per material key. */
export class PartBatch {
  private readonly groups = new Map<PartKey, Group>()

  /** Adds placed vertex data to a material group (the data is copied; it may be reused by the caller). */
  add(key: PartKey, data: VertexDataType): void {
    let group = this.groups.get(key)
    if (!group) {
      group = { positions: [], normals: [], indices: [] }
      this.groups.set(key, group)
    }
    const base = group.positions.length / 3
    const positions = data.positions as ArrayLike<number>
    const normals = data.normals as ArrayLike<number>
    const indices = data.indices as ArrayLike<number>
    for (let i = 0; i < positions.length; i++) group.positions.push(positions[i])
    for (let i = 0; i < normals.length; i++) group.normals.push(normals[i])
    for (let i = 0; i < indices.length; i++) group.indices.push(indices[i] + base)
  }

  /** Adds several parts to one group. */
  addAll(key: PartKey, parts: VertexDataType[]): void {
    for (const part of parts) this.add(key, part)
  }

  /** True when nothing was added. */
  get empty(): boolean {
    return this.groups.size === 0
  }

  /** Vertex count across every group (for budgets in tests). */
  get vertexCount(): number {
    let count = 0
    for (const group of this.groups.values()) count += group.positions.length / 3
    return count
  }

  /** Creates one mesh per group under `parent`, with materials from `material(key)`. */
  build(scene: Scene, name: string, parent: TransformNode, material: (key: PartKey) => Material): BuiltMesh[] {
    const out: BuiltMesh[] = []
    for (const [key, group] of this.groups) {
      if (group.indices.length === 0) continue
      const mesh = new Mesh(`${name}-${key}`, scene)
      mesh.parent = parent
      const data = new VertexData()
      data.positions = new Float32Array(group.positions)
      data.normals = new Float32Array(group.normals)
      data.indices = group.positions.length / 3 > 65535 ? new Uint32Array(group.indices) : group.indices
      data.applyToMesh(mesh, false)
      mesh.material = material(key)
      mesh.isPickable = false
      mesh.receiveShadows = true
      out.push({ key, mesh })
    }
    this.groups.clear()
    return out
  }
}
