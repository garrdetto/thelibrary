export type SkillState = 'IDLE' | 'FISH_REELING' | 'HUNT_AIMING'

export const TENSION_MIN = 0
export const TENSION_MAX = 100
export const SLACK_LIMIT = 10
export const STRAIN_LIMIT = 90

export interface ReelTuning {
  crankTension: number
  crankProgress: number
  holdTensionPerSecond: number
  holdProgressPerSecond: number
  relaxPerSecond: number
  /** Where the line settles when you stop reeling: the drag holds the fish, no line is gained. */
  restTension: number
  /** Seconds without reeling before a fish works the hook loose. */
  idleLimit: number
  slackFrictionPerPoint: number
  strainFrictionPerPoint: number
  surgeStrength: number
}

export const REEL_TUNING: ReelTuning = {
  crankTension: 9,
  crankProgress: 2.4,
  holdTensionPerSecond: 22,
  holdProgressPerSecond: 7.5,
  relaxPerSecond: 24,
  restTension: 24,
  idleLimit: 20,
  slackFrictionPerPoint: 0.9,
  strainFrictionPerPoint: 1.6,
  surgeStrength: 30,
}

export interface ReelSnapshot {
  tension: number
  progress: number
  lineHealth: number
  slack: boolean
  strain: boolean
  /** Strength of the fish's current run (0 when it isn't surging); drives jumps and drag in the animation. */
  surge: number
  outcome: 'fighting' | 'landed' | 'snapped' | 'thrown'
}

export interface SwayTuning {
  hipAmplitude: number
  adsAmplitude: number
  breathAmplitude: number
  moveMultiplier: number
  breathHoldSeconds: number
  breathRecoverSeconds: number
}

export const SWAY_TUNING: SwayTuning = {
  hipAmplitude: 0.032,
  adsAmplitude: 0.0042,
  breathAmplitude: 0.0012,
  moveMultiplier: 3.2,
  breathHoldSeconds: 4,
  breathRecoverSeconds: 5,
}

export class SkillCheckManager {
  state: SkillState = 'IDLE'
  tension = 35
  progress = 0
  lineHealth = 100
  outcome: ReelSnapshot['outcome'] = 'fighting'
  private fightPower = 0.5
  private fightClock = 0
  private surgePhase = 0
  private surgeTimer = 0
  private surge = 0
  private holding = false
  private slackTime = 0
  private idleTime = 0

  aiming = false
  swayX = 0
  swayY = 0
  breath = 1
  holdingBreath = false
  private swayClock = 0
  swayAmplitude = 0

  constructor(private readonly rng: () => number = Math.random, readonly reel: ReelTuning = REEL_TUNING, readonly sway: SwayTuning = SWAY_TUNING) {}

  beginReel(fightPower: number): void {
    this.state = 'FISH_REELING'
    this.tension = 40
    this.progress = 8
    this.lineHealth = 100
    this.outcome = 'fighting'
    this.fightPower = Math.max(0.1, Math.min(1.4, fightPower))
    this.fightClock = 0
    this.surgePhase = this.rng() * Math.PI * 2
    this.surgeTimer = 1 + this.rng() * 2
    this.surge = 0
    this.slackTime = 0
    this.idleTime = 0
  }

  beginAiming(): void {
    this.state = 'HUNT_AIMING'
    this.breath = 1
    this.holdingBreath = false
  }

  reset(): void {
    this.state = 'IDLE'
    this.holding = false
    this.aiming = false
  }

  /** A single tap of the handle: a quarter turn of line, never a whole retrieve. */
  crank(): void {
    if (this.state !== 'FISH_REELING' || this.outcome !== 'fighting') return
    this.tension = Math.min(TENSION_MAX, this.tension + this.reel.crankTension * (0.7 + this.fightPower * 0.6))
    if (this.tension >= SLACK_LIMIT && this.tension <= STRAIN_LIMIT) this.progress += this.reel.crankProgress / (0.6 + this.fightPower)
  }

  setHolding(holding: boolean): void {
    this.holding = holding
  }

  updateReel(dt: number): ReelSnapshot {
    if (this.state === 'FISH_REELING' && this.outcome === 'fighting') {
      this.fightClock += dt
      this.surgeTimer -= dt
      if (this.surgeTimer <= 0) {
        this.surge = this.reel.surgeStrength * this.fightPower * (0.5 + this.rng())
        this.surgeTimer = 1.2 + this.rng() * 2.8 / (0.5 + this.fightPower)
      }
      this.surge = Math.max(0, this.surge - dt * 45)
      const pull = Math.sin(this.fightClock * 1.7 + this.surgePhase) * 6 * this.fightPower + this.surge
      this.tension += pull * dt * 2.2
      if (this.holding) {
        this.idleTime = 0
        this.tension += this.reel.holdTensionPerSecond * (0.6 + this.fightPower * 0.7) * dt
        if (this.tension >= SLACK_LIMIT && this.tension <= STRAIN_LIMIT) this.progress += this.reel.holdProgressPerSecond / (0.6 + this.fightPower) * dt
      } else {
        // Letting go stops the reel where it is: the drag eases the line back to a resting pull.
        this.idleTime += dt
        const rest = this.reel.restTension
        if (this.tension > rest) this.tension = Math.max(rest, this.tension - this.reel.relaxPerSecond * dt)
        else this.tension = Math.min(rest, this.tension + this.reel.relaxPerSecond * 0.5 * dt)
        if (this.idleTime > this.reel.idleLimit) this.outcome = 'thrown'
      }
      this.progress -= this.surge * 0.04 * dt
      this.tension = Math.max(TENSION_MIN, Math.min(TENSION_MAX, this.tension))
      if (this.tension < SLACK_LIMIT) {
        const deficit = SLACK_LIMIT - this.tension
        this.progress -= this.reel.slackFrictionPerPoint * deficit * dt
        this.slackTime += dt
        if (this.slackTime > 3.5) this.outcome = 'thrown'
      } else {
        this.slackTime = 0
      }
      if (this.tension > STRAIN_LIMIT) {
        const excess = this.tension - STRAIN_LIMIT
        this.lineHealth -= this.reel.strainFrictionPerPoint * excess * dt * (0.7 + this.fightPower * 0.5)
        if (this.tension >= TENSION_MAX - 0.01) this.lineHealth -= 12 * dt
      }
      this.progress = Math.max(0, Math.min(100, this.progress))
      if (this.lineHealth <= 0) {
        this.lineHealth = 0
        this.outcome = 'snapped'
      } else if (this.progress >= 100) {
        this.outcome = 'landed'
      } else if (this.progress <= 0 && this.fightClock > 2) {
        this.outcome = 'thrown'
      }
    }
    return { tension: this.tension, progress: this.progress, lineHealth: this.lineHealth, slack: this.tension < SLACK_LIMIT, strain: this.tension > STRAIN_LIMIT, surge: this.surge, outcome: this.outcome }
  }

  updateSway(dt: number, moving: number, aiming: boolean, holdBreath: boolean): { x: number; y: number; amplitude: number } {
    this.aiming = aiming
    this.swayClock += dt
    const wantsHold = holdBreath && aiming && this.breath > 0.02
    this.holdingBreath = wantsHold
    if (wantsHold) this.breath = Math.max(0, this.breath - dt / this.sway.breathHoldSeconds)
    else this.breath = Math.min(1, this.breath + dt / this.sway.breathRecoverSeconds)
    const exhausted = this.breath < 0.05 ? 2.2 : 1
    let amplitude = aiming ? this.sway.adsAmplitude : this.sway.hipAmplitude
    amplitude *= 1 + Math.min(1, moving) * this.sway.moveMultiplier
    if (this.holdingBreath) amplitude *= 0.22
    amplitude *= exhausted
    this.swayAmplitude = amplitude
    const t = this.swayClock
    const breathing = this.holdingBreath ? 0 : Math.sin(t * 1.3) * this.sway.breathAmplitude * (aiming ? 1 : 3)
    const tx = (Math.sin(t * 0.83) * 0.7 + Math.sin(t * 2.17 + 1.3) * 0.3) * amplitude
    const ty = (Math.cos(t * 0.61) * 0.6 + Math.sin(t * 1.73 + 0.4) * 0.4) * amplitude * 0.8 + breathing
    const k = 1 - Math.exp(-dt * 10)
    this.swayX += (tx - this.swayX) * k
    this.swayY += (ty - this.swayY) * k
    return { x: this.swayX, y: this.swayY, amplitude }
  }
}
