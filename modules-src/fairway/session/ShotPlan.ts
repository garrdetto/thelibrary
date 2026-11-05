/** The local player's shot setup between swings: shot type, planned power toward a target distance, and the cached perfect-strike preview with its landing zone. */
import { SHOT_KINDS, tuning, type ShotKind } from '../tuning'
import type { ShotParams, ShotResult } from '../systems/BallFlight'
import type { Course } from '../systems/Course'
import { defaultShotKind, landingZone, measuresRest, perfectParams, powerForDistance, previewShot, type LandingZone } from '../systems/ShotPlanner'
import { horizontalDistance } from '../systems/Vector'

export interface ShotPreview {
  params: ShotParams
  result: ShotResult
  zone: LandingZone | null
  /** Carry for full shots, where it stops for putts and the short game. */
  distance: number
}

export class ShotPlan {
  shot: ShotKind = 'full'
  power = 1
  private targetDistance = 0
  private key = ''
  private cached: ShotPreview | null = null

  /** New turn: default shot type for the lie and distance, then the power whose perfect strike reaches the target. */
  reset(params: ShotParams, targetDistance: number, distanceToPin: number, course: Course): void {
    this.shot = defaultShotKind(distanceToPin, params.lie)
    const putting = params.lie === 'green' || params.club === 'putter'
    this.targetDistance = putting ? targetDistance + tuning.shortGame.puttPast : targetDistance
    this.replan({ ...params, shot: this.shot }, course)
  }

  /** Club or shot type changed: keep the same target distance and plan the power again. */
  replan(params: ShotParams, course: Course): void {
    this.power = powerForDistance({ ...params, shot: this.shot }, this.targetDistance, course)
  }

  select(kind: ShotKind): boolean {
    if (kind === this.shot) return false
    this.shot = kind
    return true
  }

  next(): ShotKind {
    this.shot = SHOT_KINDS[(SHOT_KINDS.indexOf(this.shot) + 1) % SHOT_KINDS.length]
    return this.shot
  }

  nudge(delta: number): void {
    this.power = Math.max(tuning.shortGame.minPower, Math.min(1, Math.round((this.power + delta) * 1000) / 1000))
  }

  /** The perfect strike for these parameters at this power, recomputed only when an input that changes it moves. */
  preview(params: ShotParams, power: number, course: Course): ShotPreview {
    const perfect = perfectParams(params, power)
    const key = [perfect.hole, ...perfect.origin.map((value) => value.toFixed(3)), perfect.yaw.toFixed(4), perfect.club, perfect.power.toFixed(3), perfect.spin, perfect.shot, perfect.lie, perfect.teeShot, ...perfect.wind].join('|')
    if (key !== this.key || !this.cached) {
      const result = previewShot(perfect, course)
      const spot = measuresRest(perfect) ? result.rest : (result.landing ?? result.rest)
      this.cached = { params: perfect, result, zone: landingZone(perfect, result), distance: horizontalDistance(spot, perfect.origin) }
      this.key = key
    }
    return this.cached
  }
}
