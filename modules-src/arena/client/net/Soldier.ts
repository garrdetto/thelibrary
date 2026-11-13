import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Material } from '@babylonjs/core/Materials/material'
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { ArenaMaterials } from '../scene/Materials'

export interface Soldier {
  root: TransformNode
  parts: Mesh[]
  upper: TransformNode
  leftLeg: TransformNode
  rightLeg: TransformNode
  leftArm: TransformNode
  rightArm: TransformNode
}

export function createSoldier(scene: Scene, id: string, team: 0 | 1, materials: ArenaMaterials, shadows: ShadowGenerator): Soldier {
  const armor = team === 0 ? materials.armorBlue : materials.armorRed
  const under = materials.gunmetal
  const parts: Mesh[] = []
  const root = new TransformNode(`soldier-${id}`, scene)

  const part = (mesh: Mesh, parent: TransformNode, material: Material, x: number, y: number, z: number): Mesh => {
    mesh.parent = parent
    mesh.position.set(x, y, z)
    mesh.material = material
    mesh.isPickable = false
    shadows.addShadowCaster(mesh)
    parts.push(mesh)
    return mesh
  }
  const joint = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
    const node = new TransformNode(`${root.name}-${name}`, scene)
    node.parent = parent
    node.position.set(x, y, z)
    return node
  }

  const pelvis = joint('pelvis', root, 0, 0.98, 0)
  part(MeshBuilder.CreateBox(`${root.name}-hips`, { width: 0.46, height: 0.22, depth: 0.28 }, scene), pelvis, under, 0, 0, 0)

  const legs = [-1, 1].map(side => {
    const hip = joint(side < 0 ? 'left-hip' : 'right-hip', pelvis, side * 0.13, -0.06, 0)
    part(MeshBuilder.CreateCapsule(`${root.name}-thigh-${side}`, { radius: 0.1, height: 0.5 }, scene), hip, under, 0, -0.22, 0)
    part(MeshBuilder.CreateBox(`${root.name}-thighplate-${side}`, { width: 0.2, height: 0.3, depth: 0.08 }, scene), hip, armor, 0, -0.2, 0.09)
    part(MeshBuilder.CreateCapsule(`${root.name}-shin-${side}`, { radius: 0.095, height: 0.5 }, scene), hip, armor, 0, -0.66, 0)
    part(MeshBuilder.CreateBox(`${root.name}-boot-${side}`, { width: 0.17, height: 0.12, depth: 0.32 }, scene), hip, under, 0, -0.9, 0.05)
    return hip
  })

  const upper = joint('upper', pelvis, 0, 0.1, 0)
  part(MeshBuilder.CreateBox(`${root.name}-abdomen`, { width: 0.38, height: 0.26, depth: 0.24 }, scene), upper, under, 0, 0.12, 0)
  part(MeshBuilder.CreateBox(`${root.name}-chest`, { width: 0.56, height: 0.36, depth: 0.34 }, scene), upper, armor, 0, 0.42, 0.02)
  part(MeshBuilder.CreateBox(`${root.name}-chestplate`, { width: 0.42, height: 0.2, depth: 0.08 }, scene), upper, armor, 0, 0.46, 0.2).rotation.x = -0.25
  part(MeshBuilder.CreateBox(`${root.name}-pack`, { width: 0.4, height: 0.4, depth: 0.14 }, scene), upper, under, 0, 0.4, -0.22)

  const arms = [-1, 1].map(side => {
    part(MeshBuilder.CreateSphere(`${root.name}-pauldron-${side}`, { diameter: 0.3, segments: 16 }, scene), upper, armor, side * 0.35, 0.56, 0).scaling.set(1.1, 0.8, 1)
    const shoulder = joint(side < 0 ? 'left-shoulder' : 'right-shoulder', upper, side * 0.35, 0.5, 0)
    part(MeshBuilder.CreateCapsule(`${root.name}-arm-${side}`, { radius: 0.08, height: 0.42 }, scene), shoulder, under, 0, -0.18, 0)
    part(MeshBuilder.CreateCapsule(`${root.name}-forearm-${side}`, { radius: 0.085, height: 0.36 }, scene), shoulder, armor, 0, -0.5, 0.11).rotation.x = 2.47
    return shoulder
  })

  const head = joint('head', upper, 0, 0.78, 0.02)
  part(MeshBuilder.CreateSphere(`${root.name}-helmet`, { diameter: 0.32, segments: 20 }, scene), head, armor, 0, 0, 0).scaling.set(0.95, 1, 1.08)
  part(MeshBuilder.CreateSphere(`${root.name}-visor`, { diameter: 0.24, segments: 20 }, scene), head, materials.visor, 0, 0.0, 0.08).scaling.set(1.05, 0.55, 0.75)
  part(MeshBuilder.CreateBox(`${root.name}-gun`, { width: 0.09, height: 0.14, depth: 0.78 }, scene), upper, materials.gunmetal, 0.12, 0.3, 0.42)
  part(MeshBuilder.CreateBox(`${root.name}-gunlight`, { width: 0.1, height: 0.03, depth: 0.2 }, scene), upper, team === 0 ? materials.energyBlue : materials.energyRed, 0.12, 0.385, 0.32)

  return { root, parts, upper, leftLeg: legs[0], rightLeg: legs[1], leftArm: arms[0], rightArm: arms[1] }
}

export function disposeSoldier(soldier: Soldier, shadows: ShadowGenerator): void {
  for (const mesh of soldier.parts) shadows.removeShadowCaster(mesh)
  soldier.root.dispose()
}
