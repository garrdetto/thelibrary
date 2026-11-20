/** The camera lock at the oche: the eye `distanceBehindOche` behind the oche line at `eyeHeight`, looking just under the bull, with the field of view fitted every frame so `boardHalfExtent` either side of that point fills the shorter side of the view at any aspect (`minFov`/`maxFov` clamp it). */
import { config } from '../config'
import { BULL_HEIGHT, OCHE_DISTANCE } from '../shared/Board'

export const CAMERA_EYE: readonly [number, number, number] = [0, config.camera.eyeHeight, OCHE_DISTANCE + config.camera.distanceBehindOche]
export const CAMERA_LOOK_AT: readonly [number, number, number] = [0, BULL_HEIGHT - 0.03, 0]

/** The vertical field of view in degrees for a view of this aspect (width over height). */
export function fitFov(aspect: number): number {
  const distance = Math.hypot(CAMERA_EYE[0] - CAMERA_LOOK_AT[0], CAMERA_EYE[1] - CAMERA_LOOK_AT[1], CAMERA_EYE[2] - CAMERA_LOOK_AT[2])
  const half = config.camera.boardHalfExtent
  const safe = Math.max(0.3, aspect)
  const vertical = safe >= 1 ? half : half / safe
  const fov = (2 * Math.atan(vertical / distance) * 180) / Math.PI
  return Math.min(config.camera.maxFov, Math.max(config.camera.minFov, fov))
}
