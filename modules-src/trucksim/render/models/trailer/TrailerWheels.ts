/**
 * Trailer wheels: a dual-tyre assembly (tyres with shoulder grooves, disc rims, hub and lug ring) built once as two source
 * meshes (rubber and steel); every wheel position is a node that owns two instances of them, so a three-axle lowboy still costs
 * two instanced draw calls for all its wheels. `update` writes position, spin and steer in place and allocates nothing.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { TrailerModel } from '../../../shared/Catalog'
import type { WheelPose } from '../../../sim/types'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { at, boxAt, cylinder, latheX } from '../truck/Geometry'
import type { P2 } from '../truck/Geometry'
import { MergeBatch } from './Merge'
import type { Palette } from './Merge'

const TIRE_HALF = 0.14
const DUAL_OFFSET = 0.165
const RIM_RADIUS = 0.286

function tyreProfile(radius: number): P2[] {
  const rr = RIM_RADIUS
  const out: P2[] = [
    [rr, -TIRE_HALF * 0.7], [rr + 0.05, -TIRE_HALF * 0.97], [radius - 0.1, -TIRE_HALF], [radius - 0.04, -TIRE_HALF * 0.92], [radius - 0.008, -TIRE_HALF * 0.78],
  ]
  for (const g of [-0.07, -0.025, 0.025, 0.07]) out.push([radius, g - 0.012], [radius - 0.014, g - 0.006], [radius - 0.014, g + 0.006], [radius, g + 0.012])
  out.push([radius - 0.008, TIRE_HALF * 0.78], [radius - 0.04, TIRE_HALF * 0.92], [radius - 0.1, TIRE_HALF], [rr + 0.05, TIRE_HALF * 0.97], [rr, TIRE_HALF * 0.7])
  return out
}

function rubberParts(radius: number): VertexData[] {
  const tyre = latheX(tyreProfile(radius), 32, { closed: true })
  const other = latheX(tyreProfile(radius), 32, { closed: true })
  at(tyre, DUAL_OFFSET, 0, 0)
  at(other, -DUAL_OFFSET, 0, 0)
  return [tyre, other]
}

function steelParts(): VertexData[] {
  const parts: VertexData[] = []
  for (const side of [-1, 1]) {
    const disc = latheX([[0.05, 0], [RIM_RADIUS, 0], [RIM_RADIUS + 0.004, side * 0.1], [RIM_RADIUS - 0.03, side * 0.125]], 24, { capStart: true })
    at(disc, side * DUAL_OFFSET, 0, 0)
    parts.push(disc)
  }
  const hub = cylinder(0.2, 0.2, 0.5, 14, 'x')
  parts.push(hub)
  const cap = cylinder(0.12, 0.12, 0.62, 12, 'x')
  parts.push(cap)
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * 2 * k) / 8
    const nut = boxAt(-0.31, 0.31, -0.012, 0.012, -0.012, 0.012)
    at(nut, 0, Math.cos(a) * 0.13, Math.sin(a) * 0.13)
    parts.push(nut)
  }
  return parts
}

/** The wheels of one trailer. */
export interface TrailerWheelSet {
  nodes: TransformNodeType[]
  update(wheels: readonly WheelPose[]): void
}

/** Builds one node per wheel position of the model (two per axle), instancing a shared tyre and rim mesh. */
export function buildTrailerWheels(scene: Scene, parent: TransformNodeType, model: TrailerModel, palette: Palette, meshes: AbstractMesh[], nodes: TransformNodeType[]): TrailerWheelSet {
  const radius = model.wheelRadius
  const rubberBatch = new MergeBatch().addAll('rubber', rubberParts(radius))
  const steelBatch = new MergeBatch().addAll('aluminum', steelParts())
  const sourceHolder = new TransformNode('trailer-wheel-source', scene)
  sourceHolder.parent = parent
  nodes.push(sourceHolder)
  const tyres = rubberBatch.build(scene, 'trailer-tyre', sourceHolder, palette, meshes)[0]
  const rims = steelBatch.build(scene, 'trailer-rim', sourceHolder, palette, meshes)[0]
  tyres.isVisible = false
  rims.isVisible = false
  const wheelNodes: TransformNodeType[] = []
  const halfTrack = model.width / 2 - 0.35
  let index = 0
  for (const z of model.axles) {
    for (const side of [1, -1]) {
      const node = new TransformNode(`trailer-wheel-${index}`, scene)
      node.parent = parent
      node.position.set(side * halfTrack, radius, z)
      const tyre = tyres.createInstance(`trailer-tyre-${index}`)
      tyre.parent = node
      tyre.isPickable = false
      const rim = rims.createInstance(`trailer-rim-${index}`)
      rim.parent = node
      rim.isPickable = false
      meshes.push(tyre, rim)
      nodes.push(node)
      wheelNodes.push(node)
      index++
    }
  }
  return {
    nodes: wheelNodes,
    update(wheels) {
      const count = Math.min(wheels.length, wheelNodes.length)
      for (let i = 0; i < count; i++) {
        const wheel = wheels[i]
        const node = wheelNodes[i]
        node.position.x = wheel.x
        node.position.y = wheel.y
        node.position.z = wheel.z
        node.rotation.x = wheel.spin
        node.rotation.y = wheel.steer
        const scale = wheel.radius / radius
        node.scaling.x = scale
        node.scaling.y = scale
        node.scaling.z = scale
      }
    },
  }
}
