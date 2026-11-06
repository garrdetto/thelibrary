/** Computer managers, pitchers and hitters. They only ever produce intents, drawing on the contest's AI stream, so recorded intents replay without them. */
import { PITCH_SPECS } from './pitches'
import { pitchMovement } from './flight'
import { strikeZone, PLATE_HALF_WIDTH } from './field'
import type { Rng } from './random'
import { TUNING } from './tuning'
import type { SwingIntent } from './contact'
import type { Player, PitchType, SwingType } from './types'

export interface PitchIntent {
  type: PitchType
  /** Target at the front of the plate in millimetres. */
  targetX: number
  targetY: number
  /** 0–100; 75 is a normal delivery. */
  effort: number
  /** −100…100 accuracy-meter miss; 0 is a perfect release. */
  accuracy: number
}

export interface PrePitchIntent {
  steal: number[]
  pickoff: number
  change: string | null
  warm: string | null
  pinchHit: string | null
}

export interface PitchView {
  pitcher: Player
  batter: Player
  balls: number
  strikes: number
  outs: number
  runnersOn: number
  fatigue: number
  lastType: PitchType | null
}

export interface SwingView {
  batter: Player
  pitcher: Player
  balls: number
  strikes: number
  outs: number
  bases: (Player | null)[]
  plateX: number
  plateY: number
  speed: number
  type: PitchType
  grade: number
  sacrifice: boolean
  /** −1…1 difficulty for this AI club; 0 is the calibrated league. */
  skill?: number
}

export function chooseAiPitch(view: PitchView, rng: Rng): PitchIntent {
  const pitching = view.pitcher.pitching
  const repertoire = pitching?.repertoire ?? [{ type: 'FF' as PitchType, grade: 40 }]
  const ahead = view.strikes > view.balls
  const behind = view.balls >= 2 && view.balls > view.strikes
  const pick = rng.weighted(repertoire, (item) => {
    const fastball = item.type === 'FF' || item.type === 'SI' || item.type === 'FC'
    let weight = 0.4 + item.grade / 50
    if (fastball) weight *= behind ? 2.2 : ahead ? 0.8 : 1.4
    else weight *= ahead ? 1.5 : behind ? 0.6 : 1
    if (item.type === view.lastType) weight *= 0.75
    return weight
  })
  const zone = strikeZone(view.batter.height)
  const hand = view.batter.bats === 'S' ? (view.pitcher.throws === 'R' ? 'L' : 'R') : view.batter.bats
  const away = hand === 'R' ? 1 : -1
  const tune = TUNING.aiPitch
  let x: number
  let y: number
  const roll = rng.next()
  if (view.strikes === 2 && roll < 0.42) {
    const low = PITCH_SPECS[pick.type].tilt < -90 || pick.type === 'CH' || pick.type === 'FS'
    x = away * (PLATE_HALF_WIDTH + tune.chase * rng.range(0.2, 1.2))
    y = low ? zone.bottom - tune.chase * rng.range(0.4, 1.3) : rng.range(zone.bottom, zone.top)
    if (rng.chance(0.4)) x = -x * 0.6
  } else if (behind && roll < 0.65) {
    x = rng.range(-tune.middle, tune.middle)
    y = (zone.bottom + zone.top) / 2 + rng.range(-tune.middle, tune.middle)
  } else {
    const side = rng.chance(0.62) ? away : -away
    x = side * (PLATE_HALF_WIDTH - tune.edge * rng.range(0.2, 1.4))
    y = rng.chance(0.6) ? zone.bottom + tune.edge * rng.range(0.1, 1.4) : zone.top - tune.edge * rng.range(0.2, 1.4)
  }
  const effort = view.strikes === 2 && pick.type === 'FF' && rng.chance(0.3) ? 92 : 75
  return { type: pick.type, targetX: Math.round(x * 1000), targetY: Math.round(y * 1000), effort, accuracy: 0 }
}

export function chooseAiSwing(view: SwingView, rng: Rng): SwingIntent {
  const tune = TUNING.aiBat
  const r = view.batter.ratings
  const movement = pitchMovement(view.type) * (0.6 + view.grade / 125)
  const sharp = 1 - 0.45 * (view.skill ?? 0)
  const read = (tune.readBase + tune.readEye * (1 - r.eye / 100) + tune.readMovement * movement) * sharp
  const seenX = view.plateX + rng.normal(0, read)
  const seenY = view.plateY + rng.normal(0, read)
  const zone = strikeZone(view.batter.height)
  const outsideBy = Math.max(Math.abs(seenX) - PLATE_HALF_WIDTH - 0.037, zone.bottom - 0.037 - seenY, seenY - zone.top - 0.037, 0)
  const looksStrike = outsideBy === 0

  if (view.sacrifice && view.strikes < 2) {
    return { action: 'swing', type: 'bunt', timing: Math.round(rng.normal(0, 40)), aimX: Math.round(seenX * 1000), aimY: Math.round(seenY * 1000) }
  }

  let swingChance: number
  if (looksStrike) {
    swingChance = view.strikes === 2 ? tune.swingStrikeTwo : view.balls === 3 && view.strikes === 0 ? tune.swingStrikeThreeOh : tune.swingStrike
  } else {
    swingChance = (view.strikes === 2 ? tune.chaseTwo : tune.chase) * Math.exp(-outsideBy * tune.chaseFalloff * 10) * (1.25 - r.eye / 200)
    if (view.balls === 3) swingChance *= 0.6
  }
  if (!rng.chance(swingChance)) return { action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 }

  let type: SwingType = 'contact'
  if (view.strikes < 2 && r.power > 55 && view.balls >= view.strikes && rng.chance(0.25 + (r.power - 55) / 120)) type = 'power'
  else if (view.strikes < 2 && rng.chance(0.35)) type = 'power'

  const expected = (view.pitcher.pitching?.velocity ?? 40) - 1.5
  const bias = (expected - view.speed) * tune.speedBias * (1 - r.eye / 260)
  const timingSd = (tune.timingBase + tune.timingContact * (1 - r.contact / 100)) * sharp
  const aimSd = (tune.aimBase + tune.aimContact * (1 - r.contact / 100) + tune.aimMovement * movement) * sharp
  return {
    action: 'swing',
    type,
    timing: Math.round(rng.normal(-bias, timingSd)),
    aimX: Math.round((seenX + rng.normal(0, aimSd)) * 1000),
    aimY: Math.round((seenY + rng.normal(0, aimSd)) * 1000),
  }
}
