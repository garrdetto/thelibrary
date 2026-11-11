/**
 * Skinned models (`.rrs`, written by `tools/builders_skinned.py`): one mesh weighted to a skeleton, cut into a few
 * parts that can each wear their own texture, plus the clips to move it. Every joint is a TransformNode that sits
 * axis-aligned at the reference pose, so posing one works the same as on the rigid `.rrm` rigs; a Babylon bone is
 * linked to each node and its bind matrix carries the turn from the pose the mesh was modelled in.
 */
import { Bone } from '@babylonjs/core/Bones/bone'
import { Skeleton } from '@babylonjs/core/Bones/skeleton'
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo'
import type { Material } from '@babylonjs/core/Materials/material'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { ArmChain } from '../systems/ArmReach'
import type { HeadFrame } from '../systems/FaceShape'
import type { Clip } from '../systems/Locomotion'
import { modelFileUrl } from './ModelLibrary'

interface JointHeader {
  name: string
  parent: number
  rest: [number, number, number]
  bind: [number, number, number]
  ref: [number, number, number, number]
}

interface PartHeader {
  name: string
  material: string
  vertices: number
  indices: number
  wide: boolean
  offset: number
  bytes: number
  item?: string
}

interface ClipHeader {
  name: string
  seconds: number
  frames: number
  loop: boolean
  speed: number
  offset: number
  bytes: number
}

export interface SkinMeta {
  arms: Record<'L' | 'R', ArmChain>
  hip: number
  height: number
  head: HeadFrame
  wear: { upper: Record<string, string>; lower: Record<string, string> }
}

interface SkinPart {
  name: string
  mesh: Mesh
  material: string
  item?: string
}

export interface SkinnedTemplate {
  name: string
  joints: JointHeader[]
  bindLocal: Matrix[]
  parts: SkinPart[]
  clips: Map<string, Clip>
  meta: SkinMeta
  material: (tag: string) => Material
  /** The face part's vertex positions as modelled, for the face-shape sliders to start from. */
  faceBase: Float32Array
}

/** The skinned side of a rig: its skeleton, clips and what it can wear. */
export interface SkinRig {
  skeleton: Skeleton
  /** Joint nodes in the order the clips store them. */
  order: TransformNode[]
  clips: Map<string, Clip>
  meta: SkinMeta
  /** Dresses the rig: `items` are catalog ids (a jacket, a vest, pants, a cap, a pack). */
  wear(items: string[]): void
  /** The face part's positions as modelled. Never write to it. */
  faceBase: Float32Array
  /** Reshapes this rig's face (it gets a copy of the geometry the first time), or puts the modelled shape back with null. */
  shapeFace(positions: Float32Array | null): void
  /** The head's material: a painted head for this rig, or null for the model's own. */
  paintHead(material: Material | null): void
}

/** What `Avatar` poses: named joint nodes under a root, the meshes they carry, and the skinned side when there is one. */
export interface AvatarRig {
  root: TransformNode
  joints: Map<string, TransformNode>
  meshes: AbstractMesh[]
  partMeshes: Map<string, AbstractMesh>
  skin?: SkinRig
}

const BOUNDS_MIN = new Vector3(-1.3, -0.4, -1.3)
const BOUNDS_MAX = new Vector3(1.3, 2.4, 1.3)
let rigCount = 0

export async function loadSkinned(scene: Scene, name: string, material: (tag: string) => Material): Promise<SkinnedTemplate> {
  const response = await fetch(modelFileUrl(`${name}.rrs`))
  if (!response.ok) throw new Error(`Missing model ${name}`)
  const buffer = await response.arrayBuffer()
  const view = new DataView(buffer)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'RRS1') throw new Error(`Bad model ${name}`)
  const headerLength = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as { joints: JointHeader[]; parts: PartHeader[]; clips: ClipHeader[]; meta: SkinMeta }
  const dataStart = 8 + headerLength
  const parts: SkinPart[] = []
  let faceBase = new Float32Array(0)
  for (const part of header.parts) {
    const v = part.vertices
    let at = dataStart + part.offset
    const positions = new Float32Array(buffer.slice(at, at + v * 12))
    at += v * 12
    const rawNormals = new Int8Array(buffer, at, v * 3)
    at += Math.ceil((v * 3) / 4) * 4
    const uvs = new Float32Array(buffer.slice(at, at + v * 8))
    at += v * 8
    const skin = new Uint8Array(buffer, at, v * 8)
    at += v * 8
    const indices = part.wide ? new Uint32Array(buffer.slice(at, at + part.indices * 4)) : new Uint16Array(buffer.slice(at, at + part.indices * 2))
    const normals = new Float32Array(v * 3)
    for (let i = 0; i < normals.length; i++) normals[i] = rawNormals[i] / 127
    const matricesIndices = new Float32Array(v * 4)
    const matricesWeights = new Float32Array(v * 4)
    for (let i = 0; i < v; i++) {
      for (let k = 0; k < 4; k++) {
        matricesIndices[i * 4 + k] = skin[i * 8 + k]
        matricesWeights[i * 4 + k] = skin[i * 8 + 4 + k] / 255
      }
    }
    if (part.name === 'face') faceBase = positions.slice()
    const mesh = new Mesh(`${name}:${part.name}`, scene)
    const data = new VertexData()
    data.positions = positions
    data.normals = normals
    data.uvs = uvs
    data.matricesIndices = matricesIndices
    data.matricesWeights = matricesWeights
    data.indices = indices
    data.applyToMesh(mesh, false)
    mesh.isPickable = false
    mesh.setEnabled(false)
    parts.push({ name: part.name, mesh, material: part.material, item: part.item })
  }
  const clips = new Map<string, Clip>()
  const joints = header.joints.length
  for (const c of header.clips) {
    const at = dataStart + c.offset
    const hips = new Float32Array(buffer.slice(at, at + c.frames * 12))
    const rot = new Int16Array(buffer.slice(at + c.frames * 12, at + c.frames * 12 + c.frames * joints * 8))
    clips.set(c.name, { name: c.name, seconds: c.seconds, frames: c.frames, loop: c.loop, speed: c.speed, hips, rot })
  }
  const absolute: Matrix[] = []
  const bindLocal: Matrix[] = []
  const one = Vector3.One()
  for (const j of header.joints) {
    const turn = new Quaternion(-j.ref[0], -j.ref[1], -j.ref[2], j.ref[3])
    const abs = Matrix.Compose(one, turn, new Vector3(j.bind[0], j.bind[1], j.bind[2]))
    absolute.push(abs)
    bindLocal.push(j.parent < 0 ? abs.clone() : abs.multiply(Matrix.Invert(absolute[j.parent])))
  }
  return { name, joints: header.joints, bindLocal, parts, clips, meta: header.meta, material, faceBase }
}

export function instantiateSkinned(template: SkinnedTemplate, scene: Scene, register?: (mesh: AbstractMesh) => void): AvatarRig {
  const id = rigCount++
  const root = new TransformNode(`${template.name}-rig`, scene)
  const joints = new Map<string, TransformNode>()
  const order: TransformNode[] = []
  const bones: Bone[] = []
  const skeleton = new Skeleton(`${template.name}-skeleton`, `${template.name}-skeleton-${id}`, scene)
  template.joints.forEach((j, i) => {
    const node = new TransformNode(`${template.name}-${j.name}`, scene)
    node.parent = j.parent < 0 ? root : order[j.parent]
    node.position.set(j.rest[0], j.rest[1], j.rest[2])
    node.rotationQuaternion = Quaternion.Identity()
    const bone = new Bone(j.name, skeleton, j.parent < 0 ? null : bones[j.parent], template.bindLocal[i])
    bone._updateAbsoluteBindMatrices(undefined, false)
    bone.linkTransformNode(node)
    order.push(node)
    bones.push(bone)
    joints.set(j.name, node)
  })
  const meshes: AbstractMesh[] = []
  const partMeshes = new Map<string, AbstractMesh>()
  for (const part of template.parts) {
    const mesh = part.mesh.clone(`${template.name}-${part.name}-${id}`, root)
    mesh.skeleton = skeleton
    mesh.numBoneInfluencers = 4
    mesh.material = template.material(part.material)
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.setBoundingInfo(new BoundingInfo(BOUNDS_MIN, BOUNDS_MAX))
    mesh.setEnabled(!part.item)
    meshes.push(mesh)
    partMeshes.set(part.name, mesh)
    register?.(mesh)
  }
  const { upper, lower } = template.meta.wear
  const pick = (table: Record<string, string>, items: string[]) => {
    for (const key in table) if (key.split('+').every((item) => items.includes(item))) return table[key]
    return null
  }
  const wear = (items: string[]) => {
    for (const part of template.parts) if (part.item) partMeshes.get(part.name)!.setEnabled(items.includes(part.item))
    const top = pick(upper, items)
    const bottom = pick(lower, items)
    if (top) partMeshes.get('upper')!.material = template.material(top)
    if (bottom) partMeshes.get('lower')!.material = template.material(bottom)
  }
  const face = partMeshes.get('face') as Mesh
  const faceTag = template.parts.find((part) => part.name === 'face')!.material
  let reshaped = false
  const shapeFace = (positions: Float32Array | null) => {
    if (!positions && !reshaped) return
    if (!reshaped) {
      face.makeGeometryUnique()
      face.setVerticesData(VertexBuffer.PositionKind, positions ?? template.faceBase, true)
      reshaped = true
      return
    }
    face.updateVerticesData(VertexBuffer.PositionKind, positions ?? template.faceBase)
  }
  const paintHead = (material: Material | null) => {
    face.material = material ?? template.material(faceTag)
  }
  return { root, joints, meshes, partMeshes, skin: { skeleton, order, clips: template.clips, meta: template.meta, wear, faceBase: template.faceBase, shapeFace, paintHead } }
}

/** Frees a rig made by `instantiateSkinned`: its meshes, joints and skeleton. Unparent anything it carries first. */
export function disposeSkinned(rig: AvatarRig, unregister?: (mesh: AbstractMesh) => void): void {
  for (const m of rig.meshes) unregister?.(m)
  rig.skin?.skeleton.dispose()
  rig.root.dispose()
}
