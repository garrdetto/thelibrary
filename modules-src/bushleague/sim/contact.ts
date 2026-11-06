/** Bat meets ball: the swing's timing and cursor against where the pitch crossed decide whether there is contact and, if so, exit speed, launch angle, spray and spin. */
import type { Launch } from './flight'
import type { Rng } from './random'
import { TUNING } from './tuning'
import type { Hand, Ratings, SwingType } from './types'

export interface SwingIntent {
  action: 'take' | 'swing'
  type: SwingType
  /** Milliseconds; negative is early, positive is late. */
  timing: number
  /** Cursor centre at the plate in millimetres. */
  aimX: number
  aimY: number
}

export type ContactResult =
  | { result: 'miss' }
  | { result: 'tip' }
  | { result: 'contact'; launch: Launch; quality: number }

export interface ContactInput {
  swing: SwingIntent
  plateX: number
  plateY: number
  pitchSpeed: number
  pitchGrade: number
  stuff: number
  batter: Ratings
  batterHand: Hand
}

export function pciRadius(type: SwingType): number {
  return TUNING.pci[type]
}

export function resolveContact(input: ContactInput, rng: Rng): ContactResult {
  const { swing, batter } = input
  const tune = TUNING
  const deception = 1 - Math.max(-0.1, (input.pitchGrade + input.stuff - 100) * tune.stuffRadius)
  const radius = pciRadius(swing.type) * deception
  const window = tune.window[swing.type]
  const dx = input.plateX - swing.aimX / 1000
  const dy = input.plateY - swing.aimY / 1000
  const offset = Math.hypot(dx, dy) / radius
  const timing = Math.abs(swing.timing) / window
  if (offset > 1 || timing > 1) return { result: 'miss' }

  const vertical = dy / radius
  if (swing.type !== 'bunt' && vertical > tune.tip && rng.chance(0.55)) return { result: 'tip' }

  const quality = Math.max(0, 1 - tune.quality.offset * offset * offset - tune.quality.timing * timing * timing)
  const pull = input.batterHand === 'R' ? -1 : 1

  if (swing.type !== 'bunt') {
    const foulChance = Math.min(0.9, tune.foul.base + tune.foul.offset * offset * offset + tune.foul.timing * timing * timing)
    if (rng.chance(foulChance)) {
      const back = swing.timing > 0 || vertical > 0.2 ? rng.chance(0.75) : rng.chance(0.25)
      const speed = 22 + rng.next() * 14
      if (back) return { result: 'contact', quality: 0, launch: { speed, launch: 15 + rng.next() * 45, spray: 180 + rng.normal(0, 30), backspin: 1500, sidespin: 0 } }
      const side = swing.timing <= 0 ? pull : -pull
      return { result: 'contact', quality: 0, launch: { speed: speed + 6, launch: rng.range(-5, 40), spray: side * rng.range(52, 80), backspin: 1200, sidespin: 0 } }
    }
  }

  if (swing.type === 'bunt') {
    const speed = 7 + quality * 6 + rng.normal(0, 1.2)
    const launch = -12 + vertical * 30 + rng.normal(0, 6)
    const spray = pull * (-swing.timing / window) * 22 + rng.normal(0, 14)
    return { result: 'contact', quality, launch: { speed: Math.max(3, speed), launch, spray, backspin: launch > 10 ? 1500 : -600, sidespin: 0 } }
  }

  const ev = tune.exitVelocity
  let maxSpeed = ev.base + ev.power * (batter.power / 100) + ev.pitchSpeed * (input.pitchSpeed - 40)
  if (swing.type === 'power') maxSpeed += ev.powerSwing
  if (swing.type === 'contact') maxSpeed += ev.contactSwing
  const speed = Math.min(ev.max, Math.max(8, ev.floor + (maxSpeed - ev.floor) * Math.pow(quality, ev.exponent) + rng.normal(0, ev.sd)))

  const la = tune.launch
  const launch = la.base + la.vertical * vertical + la.power * ((batter.power - 50) / 50) * (swing.type === 'power' ? 1.4 : 1) + rng.normal(0, la.sd)

  const sp = tune.spray
  const away = (input.plateX * -pull) / 0.25
  const pullAmount = (-swing.timing / window) * sp.timing - away * sp.offset + sp.pullBias + rng.normal(0, sp.sd)
  const spray = pull * pullAmount

  const backspin = launch > 0 ? Math.min(3600, 1100 + launch * 42 + (1 - quality) * 500) : Math.max(-1600, launch * 45)
  const sidespin = pull * Math.min(1200, Math.abs(pullAmount) * 14) * (pullAmount > 0 ? 1 : -0.6)
  return { result: 'contact', quality, launch: { speed, launch: Math.max(-70, Math.min(85, launch)), spray, backspin, sidespin } }
}
