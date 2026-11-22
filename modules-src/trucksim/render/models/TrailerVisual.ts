/**
 * The five trailers as drawn meshes: `buildTrailerVisual` assembles the kind's static body into one mesh per material, adds
 * instanced dual wheels, landing gear, doors, tarp or gooseneck as moving parts, and exposes `update(pose)`, `setCargo` (deck
 * cargo, tanker level gauges, grain) and `setStraps` (straps on the flatbed, chains on the lowboy, one per tie point).
 * The frame is the trailer's: origin on the ground under the kingpin, +Z forward, +X the driver's left; everything hangs under
 * the `parent` node given. The lowboy's gooseneck is parented to `parent`, not the trailer root, and follows `pose.gooseneck`.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { CargoVisual, TrailerModel } from '../../shared/Catalog'
import type { TrailerPose } from '../../sim/types'
import type { MaterialLibrary } from '../Materials'
import type { KindParts, TrailerContext } from './trailer/Chassis'
import type { CargoModel } from './CargoVisual'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { boxAt } from './truck/Geometry'
import { buildCargoModel } from './CargoVisual'
import { MergeBatch, Palette, disposeAll } from './trailer/Merge'
import { buildFlatbed } from './trailer/Flatbed'
import { buildGrain } from './trailer/Grain'
import { buildLowboy } from './trailer/Lowboy'
import { buildReefer } from './trailer/Reefer'
import { buildTanker } from './trailer/Tanker'
import { buildTrailerWheels } from './trailer/TrailerWheels'

/** What a trailer carries, as the session knows it. */
export interface TrailerCargoState {
  visual: CargoVisual
  fill: number
  color: string
}

/** One trailer in the scene. */
export interface TrailerVisual {
  root: TransformNodeType
  readonly meshes: readonly AbstractMesh[]
  update(pose: TrailerPose): void
  setCargo(cargo: TrailerCargoState | null): void
  setStraps(done: number, total: number): void
  dispose(): void
}

const MAX_STRAPS = 12
const FLUID_VISUALS: ReadonlySet<CargoVisual> = new Set<CargoVisual>(['fuel', 'corn', 'soybeans', 'wheat'])

function kindBuilder(model: TrailerModel): (ctx: TrailerContext) => KindParts {
  switch (model.kind) {
    case 'tanker': return buildTanker
    case 'flatbed': return buildFlatbed
    case 'grain': return buildGrain
    case 'reefer': return buildReefer
    case 'lowboy': return buildLowboy
  }
}

/** Builds a trailer visual for a model and paint colour under `parent`. */
export function buildTrailerVisual(scene: Scene, parent: TransformNodeType, model: TrailerModel, color: string, mats: MaterialLibrary): TrailerVisual {
  const palette = new Palette(mats)
  const root = new TransformNode(`trailer-${model.id}`, scene)
  root.parent = parent
  root.rotationQuaternion = new Quaternion()
  const meshes: AbstractMesh[] = []
  const nodes: TransformNodeType[] = [root]
  const ctx: TrailerContext = { scene, root, model, palette, batch: new MergeBatch(), meshes, nodes, color }
  const parts = kindBuilder(model)(ctx)
  ctx.batch.build(scene, `trailer-${model.kind}`, root, palette, meshes)
  const wheels = buildTrailerWheels(scene, root, model, palette, meshes, nodes)

  const straps: InstancedMesh[] = []
  let strapSource: Mesh | null = null
  const layout = parts.layout
  if (layout) {
    const batch = new MergeBatch()
    const thin = parts.chains ? 0.012 : 0.03
    batch.add(parts.chains ? 'darkSteel' : 'safety', boxAt(-0.5, 0.5, 0.97, 1.0, -thin, thin))
    batch.add(parts.chains ? 'darkSteel' : 'safety', boxAt(-0.5, -0.497, 0, 1, -thin, thin))
    batch.add(parts.chains ? 'darkSteel' : 'safety', boxAt(0.497, 0.5, 0, 1, -thin, thin))
    strapSource = batch.build(scene, 'trailer-strap', root, palette, meshes)[0]
    strapSource.isVisible = false
    for (let i = 0; i < MAX_STRAPS; i++) {
      const strap = strapSource.createInstance(`trailer-strap-${i}`)
      strap.parent = root
      strap.isPickable = false
      strap.setEnabled(false)
      straps.push(strap)
      meshes.push(strap)
    }
  }

  let cargoModel: CargoModel | null = null
  let cargoKey = ''
  let strapsDone = 0
  let strapsTotal = 0
  let cargoHeight = 0.6

  const placeStraps = () => {
    if (!layout) return
    const total = Math.min(MAX_STRAPS, Math.max(0, strapsTotal))
    const span = layout.zFront - layout.zRear - 1.2
    for (let i = 0; i < MAX_STRAPS; i++) {
      const strap = straps[i]
      const visible = i < total && i < strapsDone
      strap.setEnabled(visible)
      if (!visible) continue
      strap.position.x = 0
      strap.position.y = layout.baseY
      strap.position.z = layout.zRear + 0.6 + (span * (i + 0.5)) / total
      strap.scaling.x = layout.width - 0.1
      strap.scaling.y = cargoHeight
    }
  }

  const clearCargo = () => {
    if (cargoModel) {
      for (const mesh of cargoModel.meshes) {
        const index = meshes.indexOf(mesh)
        if (index >= 0) meshes.splice(index, 1)
      }
      cargoModel.dispose()
      cargoModel = null
    }
    cargoKey = ''
  }

  return {
    root,
    meshes,
    update(pose) {
      const p = pose.position
      root.position.x = p.x
      root.position.y = p.y
      root.position.z = p.z
      const q = root.rotationQuaternion as Quaternion
      q.x = pose.rotation.x
      q.y = pose.rotation.y
      q.z = pose.rotation.z
      q.w = pose.rotation.w
      wheels.update(pose.wheels)
      parts.update?.(pose)
    },
    setCargo(cargo) {
      if (!cargo) {
        clearCargo()
        parts.fluid?.(null, 0)
        cargoHeight = 0.6
        placeStraps()
        return
      }
      if (FLUID_VISUALS.has(cargo.visual)) {
        clearCargo()
        parts.fluid?.(cargo.color, cargo.fill)
        return
      }
      parts.fluid?.(null, 0)
      if (!layout) return
      const key = `${cargo.visual}|${cargo.color.toLowerCase()}`
      if (key !== cargoKey) {
        clearCargo()
        const built = buildCargoModel(scene, root, mats, cargo.visual, cargo.color, layout)
        if (built) {
          cargoModel = built
          cargoKey = key
          for (const mesh of built.meshes) meshes.push(mesh)
          cargoHeight = built.height
          placeStraps()
        }
      }
      cargoModel?.setFill(cargo.fill)
    },
    setStraps(done, total) {
      strapsDone = Math.max(0, Math.floor(done))
      strapsTotal = Math.max(0, Math.floor(total))
      placeStraps()
    },
    dispose() {
      clearCargo()
      disposeAll(meshes)
      meshes.length = 0
      disposeAll(nodes)
      palette.dispose()
    },
  }
}
