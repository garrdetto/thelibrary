import type { Material } from '@babylonjs/core/Materials/material'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import '@babylonjs/core/Meshes/instancedMesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

export const MODEL_NAMES = [
  'pine', 'pine-lo', 'hardwood', 'hardwood-lo', 'birch', 'birch-lo', 'grass', 'fern', 'cattail', 'rock', 'log',
  'deer', 'antlers', 'bear', 'hunter', 'utv', 'boat', 'rod', 'rifle', 'bobber', 'treestand', 'cabin', 'quad', 'boxblind',
  'fish-muskie', 'fish-pike', 'fish-walleye', 'fish-smallmouth', 'fish-perch',
] as const
export type ModelName = typeof MODEL_NAMES[number]

export interface ModelPart {
  name: string
  pivot: Vector3
  mesh: Mesh
  parent?: string
}

export interface ModelTemplate {
  name: ModelName
  parts: Map<string, ModelPart>
}

export interface ModelRig {
  root: TransformNode
  joints: Map<string, TransformNode>
  meshes: InstancedMesh[]
  partMeshes: Map<string, InstancedMesh>
}

interface PartHeader {
  name: string
  pivot: [number, number, number]
  vertices: number
  indices: number
  wide: boolean
  offset: number
  bytes: number
  uv?: boolean
  material?: string
  parent?: string
}

const BASE = new URL('./rackreel/models/', location.href.replace(/[^/]*$/, '')).href

export async function loadModel(scene: Scene, name: ModelName, material: (model: ModelName, part: string, tag: string) => Material): Promise<ModelTemplate> {
  const response = await fetch(`${BASE}${name}.rrm`)
  if (!response.ok) throw new Error(`Missing model ${name}`)
  const buffer = await response.arrayBuffer()
  const view = new DataView(buffer)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'RRM1') throw new Error(`Bad model ${name}`)
  const headerLength = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as { parts: PartHeader[] }
  const dataStart = 8 + headerLength
  const parts = new Map<string, ModelPart>()
  for (const part of header.parts) {
    let at = dataStart + part.offset
    const positions = new Float32Array(buffer.slice(at, at + part.vertices * 12))
    at += part.vertices * 12
    const rawNormals = new Int8Array(buffer, at, part.vertices * 3)
    at += part.vertices * 3
    at = dataStart + part.offset + Math.ceil((part.vertices * 15) / 4) * 4
    const rawColors = new Uint8Array(buffer, at, part.vertices * 4)
    at += part.vertices * 4
    let uvs: Float32Array | null = null
    if (part.uv) {
      uvs = new Float32Array(buffer.slice(at, at + part.vertices * 8))
      at += part.vertices * 8
    }
    const indices = part.wide ? new Uint32Array(buffer.slice(at, at + part.indices * 4)) : new Uint16Array(buffer.slice(at, at + part.indices * 2))
    const normals = new Float32Array(part.vertices * 3)
    for (let i = 0; i < normals.length; i++) normals[i] = rawNormals[i] / 127
    const colors = new Float32Array(part.vertices * 4)
    for (let i = 0; i < colors.length; i++) {
      const c = rawColors[i] / 255
      colors[i] = i % 4 === 3 ? 1 : c
    }
    const pivot = new Vector3(part.pivot[0], part.pivot[1], part.pivot[2])
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= pivot.x
      positions[i + 1] -= pivot.y
      positions[i + 2] -= pivot.z
    }
    const mesh = new Mesh(`${name}:${part.name}`, scene)
    const data = new VertexData()
    data.positions = positions
    data.normals = normals
    data.colors = colors
    data.indices = indices
    if (uvs) data.uvs = uvs
    data.applyToMesh(mesh, false)
    mesh.material = material(name, part.name, part.material ?? '')
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.setEnabled(false)
    mesh.doNotSyncBoundingInfo = false
    parts.set(part.name, { name: part.name, pivot, mesh, parent: part.parent })
  }
  return { name, parts }
}

export function instantiate(template: ModelTemplate, parent: TransformNode | null, scene: Scene, register?: (mesh: InstancedMesh) => void): ModelRig {
  const root = new TransformNode(`${template.name}-rig`, scene)
  if (parent) root.parent = parent
  const joints = new Map<string, TransformNode>()
  const meshes: InstancedMesh[] = []
  const partMeshes = new Map<string, InstancedMesh>()
  for (const part of template.parts.values()) {
    const joint = new TransformNode(`${template.name}-${part.name}`, scene)
    joint.parent = root
    joint.position.copyFrom(part.pivot)
    if (!part.mesh.isEnabled()) part.mesh.setEnabled(true)
    part.mesh.isVisible = false
    const inst = part.mesh.createInstance(`${template.name}-${part.name}-i`)
    inst.parent = joint
    inst.isPickable = false
    meshes.push(inst)
    partMeshes.set(part.name, inst)
    register?.(inst)
    joints.set(part.name, joint)
  }
  for (const part of template.parts.values()) {
    const parentPart = part.parent ? template.parts.get(part.parent) : undefined
    const parentJoint = part.parent ? joints.get(part.parent) : undefined
    if (!parentPart || !parentJoint) continue
    const joint = joints.get(part.name)!
    joint.parent = parentJoint
    joint.position.copyFrom(part.pivot.subtract(parentPart.pivot))
  }
  return { root, joints, meshes, partMeshes }
}

export function disposeRig(rig: ModelRig, unregister?: (mesh: InstancedMesh) => void): void {
  for (const m of rig.meshes) {
    unregister?.(m)
    m.dispose()
  }
  rig.root.dispose()
}

export function partMesh(template: ModelTemplate, part: string): Mesh {
  const found = template.parts.get(part)
  if (!found) throw new Error(`Missing part ${template.name}:${part}`)
  return found.mesh
}
