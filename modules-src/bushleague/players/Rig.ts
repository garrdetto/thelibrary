/** The shared ballplayer skeleton: one bone layout for every body type (and for Meshy rigs retargeted in Blender), its rest pose at 1.85 m facing +z, and the body-type proportions. */
import * as THREE from 'three/webgpu'
import type { BodyType } from '../sim'

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder.L', 'arm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'arm.R', 'forearm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'toe.L',
  'thigh.R', 'shin.R', 'foot.R', 'toe.R',
] as const

export type BoneName = (typeof BONES)[number]

/** Parent and offset from the parent (metres, 1.85 m reference). Character faces +z; its left is +x. */
const LAYOUT: Readonly<Record<BoneName, { parent: BoneName | null; offset: readonly [number, number, number] }>> = {
  hips: { parent: null, offset: [0, 0.98, 0] },
  spine: { parent: 'hips', offset: [0, 0.12, 0] },
  chest: { parent: 'spine', offset: [0, 0.2, 0] },
  neck: { parent: 'chest', offset: [0, 0.2, 0] },
  head: { parent: 'neck', offset: [0, 0.1, 0.01] },
  'shoulder.L': { parent: 'chest', offset: [0.06, 0.15, 0] },
  'arm.L': { parent: 'shoulder.L', offset: [0.13, 0, 0] },
  'forearm.L': { parent: 'arm.L', offset: [0.29, 0, 0] },
  'hand.L': { parent: 'forearm.L', offset: [0.26, 0, 0] },
  'shoulder.R': { parent: 'chest', offset: [-0.06, 0.15, 0] },
  'arm.R': { parent: 'shoulder.R', offset: [-0.13, 0, 0] },
  'forearm.R': { parent: 'arm.R', offset: [-0.29, 0, 0] },
  'hand.R': { parent: 'forearm.R', offset: [-0.26, 0, 0] },
  'thigh.L': { parent: 'hips', offset: [0.1, -0.05, 0] },
  'shin.L': { parent: 'thigh.L', offset: [0, -0.44, 0] },
  'foot.L': { parent: 'shin.L', offset: [0, -0.43, 0] },
  'toe.L': { parent: 'foot.L', offset: [0, -0.05, 0.15] },
  'thigh.R': { parent: 'hips', offset: [-0.1, -0.05, 0] },
  'shin.R': { parent: 'thigh.R', offset: [0, -0.44, 0] },
  'foot.R': { parent: 'shin.R', offset: [0, -0.43, 0] },
  'toe.R': { parent: 'foot.R', offset: [0, -0.05, 0.15] },
}

export interface Proportions {
  /** Uniform scale from the 1.85 m reference. */
  scale: number
  /** Limb and torso thickness multiplier. */
  girth: number
  /** Extra forward depth of the belly in metres. */
  belly: number
  shoulders: number
}

export const BODY_PROPORTIONS: Readonly<Record<BodyType, Omit<Proportions, 'scale'>>> = {
  lean: { girth: 0.9, belly: 0, shoulders: 1 },
  stocky: { girth: 1.18, belly: 0.03, shoulders: 1.12 },
  belly: { girth: 1.08, belly: 0.13, shoulders: 1.02 },
  tall: { girth: 0.95, belly: 0.01, shoulders: 1.02 },
  short: { girth: 1.02, belly: 0.02, shoulders: 0.98 },
}

export function proportionsFor(body: BodyType, height: number): Proportions {
  return { scale: height / 1.85, ...BODY_PROPORTIONS[body] }
}

export interface Rig {
  skeleton: THREE.Skeleton
  root: THREE.Bone
  bones: Record<BoneName, THREE.Bone>
  rest: Record<BoneName, THREE.Quaternion>
}

export function restOffset(name: BoneName, proportions: Proportions): THREE.Vector3 {
  const [x, y, z] = LAYOUT[name].offset
  const widen = name.startsWith('shoulder') ? proportions.shoulders : 1
  return new THREE.Vector3(x * widen, y, z).multiplyScalar(proportions.scale)
}

export function boneParent(name: BoneName): BoneName | null {
  return LAYOUT[name].parent
}

export function createRig(proportions: Proportions): Rig {
  const bones = {} as Record<BoneName, THREE.Bone>
  const rest = {} as Record<BoneName, THREE.Quaternion>
  for (const name of BONES) {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.copy(restOffset(name, proportions))
    bones[name] = bone
    rest[name] = bone.quaternion.clone()
  }
  for (const name of BONES) {
    const parent = LAYOUT[name].parent
    if (parent) bones[parent].add(bones[name])
  }
  const list = BONES.map((name) => bones[name])
  return { skeleton: new THREE.Skeleton(list), root: bones.hips, bones, rest }
}
