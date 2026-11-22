/**
 * Parts every trailer shares: the build context, frame rails and cross members, the kingpin and coupler plate, axles with
 * springs and brake drums, fenders, mud flaps, the ICC rear bumper, DOT-style reflective tape (thin coloured strips), tail lamps
 * and the landing gear whose inner legs slide from stowed to the ground. Static pieces go into the context's `MergeBatch`.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { TrailerModel } from '../../../shared/Catalog'
import type { TrailerPose } from '../../../sim/types'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { at, boxAt, cylinder } from '../truck/Geometry'
import { LAMP_LEVEL } from '../../Materials'
import { MergeBatch, tapeX } from './Merge'
import type { Palette } from './Merge'

/** Everything a trailer kind builder needs. */
export interface TrailerContext {
  scene: Scene
  root: TransformNodeType
  model: TrailerModel
  palette: Palette
  batch: MergeBatch
  meshes: AbstractMesh[]
  nodes: TransformNodeType[]
  color: string
}

/** Where cargo sits: the deck (or box floor) range along Z, the usable width, the surface height and the clear height above it. */
export interface CargoLayout {
  zRear: number
  zFront: number
  width: number
  baseY: number
  clearHeight: number
  interior: boolean
}

/** What a kind builder hands back. */
export interface KindParts {
  update?(pose: TrailerPose): void
  layout: CargoLayout | null
  chains?: boolean
  fluid?(color: string | null, fill: number): void
  setFluidMaterial?(color: string | null): void
}

/** Options for the shared running gear. */
export interface GearOptions {
  railY0: number
  railY1: number
  railHalfGap: number
  zFront: number
  zRear: number
  fenders?: boolean
  skirts?: boolean
  tape?: boolean
  rearBumper?: boolean
}

export function lastAxle(model: TrailerModel): number {
  return model.axles[model.axles.length - 1]
}

/** Frame rails, cross members, the bumper, axles, fenders, flaps and tape. */
export function addRunningGear(ctx: TrailerContext, options: GearOptions): void {
  const { batch, model } = ctx
  const { railY0, railY1, railHalfGap, zFront, zRear } = options
  const radius = model.wheelRadius
  const halfTrack = model.width / 2 - 0.35
  for (const side of [-1, 1]) {
    batch.add('darkSteel', boxAt(side * railHalfGap - 0.07, side * railHalfGap + 0.07, railY0, railY1, zRear, zFront))
    batch.add('steel', boxAt(side * railHalfGap - 0.1, side * railHalfGap + 0.1, railY1 - 0.025, railY1, zRear + 0.05, zFront - 0.05))
  }
  for (let z = zFront - 0.7; z > zRear + 0.3; z -= 1.3) batch.add('darkSteel', boxAt(-railHalfGap, railHalfGap, railY0 + 0.02, railY0 + 0.1, z - 0.04, z + 0.04))
  const first = model.axles[0]
  const last = lastAxle(model)
  batch.add('steel', boxAt(-railHalfGap + 0.1, -railHalfGap + 0.2, railY0 - 0.1, railY0, last - 0.5, first + 0.5))
  batch.add('steel', boxAt(railHalfGap - 0.2, railHalfGap - 0.1, railY0 - 0.1, railY0, last - 0.5, first + 0.5))
  for (const z of model.axles) {
    batch.add('darkSteel', boxAt(-halfTrack, halfTrack, radius - 0.07, radius + 0.07, z - 0.07, z + 0.07))
    for (const side of [-1, 1]) {
      batch.add('steel', at(cylinder(0.5, 0.5, 0.2, 14, 'x'), side * (halfTrack - 0.05), radius, z))
      batch.add('darkSteel', boxAt(side * 0.6 - 0.04, side * 0.6 + 0.04, radius + 0.08, radius + 0.15, z - 0.55, z + 0.55))
      batch.add('darkSteel', boxAt(side * 0.6 - 0.05, side * 0.6 + 0.05, radius + 0.15, railY0, z - 0.05, z + 0.05))
      batch.add('rubber', boxAt(side * 0.35 - 0.1, side * 0.35 + 0.1, radius + 0.1, radius + 0.3, z - 0.1, z + 0.1))
    }
  }
  if (options.fenders !== false) {
    const top = radius * 2 + 0.06
    for (const side of [-1, 1]) {
      const x = side * halfTrack
      batch.add('aluminum', boxAt(x - 0.34, x + 0.34, top, top + 0.025, last - 0.62, first + 0.62))
      batch.add('aluminum', boxAt(x + side * 0.31, x + side * 0.34, top - 0.14, top + 0.02, last - 0.62, first + 0.62))
      batch.add('rubber', boxAt(x - 0.3, x + 0.3, 0.28, 0.82, last - 0.74, last - 0.72))
      batch.add('aluminum', boxAt(x - 0.04, x + 0.04, 0.5, 0.6, last - 0.742, last - 0.73))
    }
  }
  if (options.rearBumper !== false) {
    batch.add('darkSteel', boxAt(-1.12, 1.12, 0.42, 0.62, zRear - 0.02, zRear + 0.1))
    for (const side of [-1, 1]) batch.add('darkSteel', boxAt(side * 0.9 - 0.04, side * 0.9 + 0.04, 0.42, railY1 - 0.05, zRear, zRear + 0.1))
    for (let i = 0; i < 12; i++) {
      const x0 = -1.1 + i * 0.185
      batch.add(i % 2 === 0 ? 'tapeRed' : 'tapeWhite', boxAt(x0, x0 + 0.185, 0.46, 0.58, zRear - 0.026, zRear - 0.02))
    }
  }
  if (options.tape !== false) addSideTape(ctx, zFront - 0.3, zRear + 0.3, (railY0 + railY1) / 2 - 0.05, model.width / 2 + 0.002)
  addMarkerLamps(ctx, zFront, zRear, railY1)
}

/** Alternating red and white tape strips along both sides. */
export function addSideTape(ctx: TrailerContext, zFront: number, zRear: number, y: number, x: number): void {
  const segment = 0.3
  let index = 0
  for (let z = zFront; z - segment > zRear; z -= segment) {
    const slot = index % 2 === 0 ? 'tapeRed' : 'tapeWhite'
    ctx.batch.add(slot, tapeX(x, y, y + 0.1, z - segment, z, 1))
    ctx.batch.add(slot, tapeX(-x, y, y + 0.1, z - segment, z, -1))
    index++
  }
}

function addMarkerLamps(ctx: TrailerContext, zFront: number, zRear: number, y: number): void {
  const half = ctx.model.width / 2
  for (const side of [-1, 1]) {
    ctx.batch.add('lampAmber', boxAt(side * half - 0.02, side * half + 0.02, y + 0.02, y + 0.1, zFront - 0.3, zFront - 0.2))
    ctx.batch.add('lampAmber', boxAt(side * half - 0.02, side * half + 0.02, y + 0.02, y + 0.1, (zFront + zRear) / 2, (zFront + zRear) / 2 + 0.1))
    ctx.batch.add('lampRed', boxAt(side * half - 0.02, side * half + 0.02, y + 0.02, y + 0.1, zRear + 0.2, zRear + 0.3))
  }
}

/** The kingpin and coupler plate, plus a bolster up to `topY` when the deck stands above the plate. */
export function addNose(ctx: TrailerContext, topY: number, halfWidth = 0.85): void {
  const { batch, model } = ctx
  const kh = model.kingpinHeight
  batch.add('steel', boxAt(-halfWidth, halfWidth, kh - 0.04, kh + 0.02, -0.85, 0.85))
  batch.add('steel', at(cylinder(0.06, 0.06, 0.12, 10), 0, kh - 0.1, 0))
  if (topY > kh + 0.04) batch.add('darkSteel', boxAt(-halfWidth, halfWidth, kh + 0.02, topY - 0.02, -0.85, model.frontZ - 0.05))
}

/** Tail lamps (own material, brighter while braking). Returns an updater for the pose's brake flag. */
export function addTailLamps(ctx: TrailerContext, y: number, zRear: number): (pose: TrailerPose) => void {
  const lamp: PBRMaterial = ctx.palette.lamp('red', 'trailer-tail')
  lamp.emissiveIntensity = LAMP_LEVEL.running
  const batch = new MergeBatch()
  for (const side of [-1, 1]) {
    for (const k of [0, 1]) batch.add('lampRed', boxAt(side * (1.0 - k * 0.2) - 0.07, side * (1.0 - k * 0.2) + 0.07, y, y + 0.14, zRear - 0.03, zRear + 0.02))
  }
  const built = batch.build(ctx.scene, 'trailer-tail', ctx.root, ctx.palette, ctx.meshes) as Mesh[]
  for (const mesh of built) mesh.material = lamp
  let braking = false
  return (pose) => {
    if (pose.brakeLights === braking) return
    braking = pose.brakeLights
    lamp.emissiveIntensity = braking ? LAMP_LEVEL.on : LAMP_LEVEL.running
  }
}

/** Landing gear: static housings and cross brace in the batch, sliding inner legs as nodes. Returns an updater. */
export function addLandingGear(ctx: TrailerContext, railY0: number): (pose: TrailerPose) => void {
  const { model, batch } = ctx
  const z = model.landingGearZ
  const legs: TransformNodeType[] = []
  const legBatch = new MergeBatch()
  legBatch.add('steel', boxAt(-0.055, 0.055, 0, 0.8, -0.055, 0.055))
  legBatch.add('darkSteel', boxAt(-0.2, 0.2, 0, 0.04, -0.17, 0.17))
  legBatch.add('steel', boxAt(0.05, 0.12, 0.45, 0.5, -0.02, 0.02))
  for (const side of [-1, 1]) {
    batch.add('darkSteel', boxAt(side * 0.95 - 0.09, side * 0.95 + 0.09, 0.45, railY0 + 0.04, z - 0.09, z + 0.09))
    batch.add('steel', boxAt(side * 0.95 - 0.02, side * 0.95 + 0.02, 0.8, 0.84, z - 0.12, z + 0.12))
    const node = new TransformNode(`trailer-leg-${side}`, ctx.scene)
    node.parent = ctx.root
    node.position.set(side * 0.95, 0.45, z)
    ctx.nodes.push(node)
    legs.push(node)
  }
  batch.add('darkSteel', boxAt(-0.95, 0.95, 0.9, 0.97, z - 0.04, z + 0.04))
  const first = legBatch.build(ctx.scene, 'trailer-leg', legs[0], ctx.palette, ctx.meshes)
  for (const mesh of first) {
    const twin = mesh.createInstance(`${mesh.name}-twin`)
    twin.parent = legs[1]
    twin.isPickable = false
    ctx.meshes.push(twin)
    mesh.isVisible = true
  }
  return (pose) => {
    const y = 0.45 * (1 - pose.landingGear)
    legs[0].position.y = y
    legs[1].position.y = y
  }
}
