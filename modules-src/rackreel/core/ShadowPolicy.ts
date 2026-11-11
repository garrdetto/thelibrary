/** When the shadow map needs redrawing, renderer-free: how far a caster may drift before its shadow is stale, and how far the hunter may walk before the shadow frame is moved to follow. */

/** A caster's shadow is redrawn once it has moved this far (metres) since it was last drawn. About a fifth of a shadow texel. */
export const POSITION_SLACK = 0.02
/** ...or turned or stretched this much (a matrix term, so roughly radians). */
export const TURN_SLACK = 0.01
/** The shadow frame follows the hunter in steps this long (metres) rather than every stride. */
export const SHADOW_RECENTRE = 12
/** Up to this far from the eye a caster gets the slack as written; beyond it the slack grows with distance, up to `SLACK_FAR` times. */
export const SLACK_NEAR = 8
export const SLACK_FAR = 12

/** How much to multiply the slack by for a caster `distance` metres from the eye: a deer across the clearing can drift further before anyone could tell. */
export function slackAt(distance: number): number {
  return Math.min(SLACK_FAR, Math.max(1, distance / SLACK_NEAR))
}

/**
 * True when any of the 4×4 matrices in `now` (16 numbers each, translation in terms 12 to 14) differs from the same
 * terms of `was`, read from `offset`, by more than the slack times `scale`.
 */
export function drifted(was: ArrayLike<number>, now: ArrayLike<number>, offset = 0, scale = 1): boolean {
  const position = POSITION_SLACK * scale
  const turn = TURN_SLACK * scale
  for (let i = 0; i < now.length; i++) {
    const term = i & 15
    if (Math.abs(was[offset + i] - now[i]) > (term >= 12 && term < 15 ? position : turn)) return true
  }
  return false
}

/** True when `target` is more than `reach` from `applied` along any axis: time to move the shadow frame. */
export function needsRecentre(applied: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, reach = SHADOW_RECENTRE): boolean {
  return !(Math.abs(target.x - applied.x) <= reach && Math.abs(target.y - applied.y) <= reach && Math.abs(target.z - applied.z) <= reach)
}
