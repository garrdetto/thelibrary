/**
 * The work machines drawn in original yellow and dark grey liveries: the 20 t tracked excavator, the articulated wheel loader and
 * the counterbalance forklift. Each builder hangs everything under the `parent` node given, returns `update` with the matching
 * pose type from `sim/types` and disposes every mesh it made. Joint conventions are described on each machine's file.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { MaterialLibrary } from '../Materials'
import { buildExcavatorModel } from './machine/Excavator'
import type { ExcavatorVisual } from './machine/Excavator'
import { buildForkliftModel } from './machine/Forklift'
import type { ForkliftVisual } from './machine/Forklift'
import { buildWheelLoaderModel } from './machine/Loader'
import type { LoaderVisual } from './machine/Loader'

export type { ExcavatorVisual, ForkliftVisual, LoaderVisual }

/** Builds the excavator; `update(pose: ExcavatorPose)` places tracks, house, boom, stick and bucket. */
export function buildExcavator(scene: Scene, parent: TransformNode, mats: MaterialLibrary): ExcavatorVisual {
  return buildExcavatorModel(scene, parent, mats)
}

/** Builds the wheel loader; `update(pose: LoaderPose)` places the frame, wheels, arm and bucket. */
export function buildWheelLoader(scene: Scene, parent: TransformNode, mats: MaterialLibrary): LoaderVisual {
  return buildWheelLoaderModel(scene, parent, mats)
}

/** Builds the forklift; `update(pose, mast, forks)` takes mast tilt (rad, + forward) and fork height (m). */
export function buildForklift(scene: Scene, parent: TransformNode, mats: MaterialLibrary): ForkliftVisual {
  return buildForkliftModel(scene, parent, mats)
}
