import type { WeaponSpec } from '../../shared/weapons.mjs'

const MAX_ROUNDS_PER_FRAME = 4
const BLOOM_PER_ROUND = 0.0035
const BLOOM_LIMIT = 0.03
const BLOOM_DECAY = 0.06

export class WeaponState {
  ammo: number
  reloadLeft = 0
  private next = 0
  private burstLeft = 0
  private triggerWasDown = false
  bloom = 0

  constructor(readonly spec: WeaponSpec) {
    this.ammo = spec.magazine
  }

  get reloading(): boolean {
    return this.reloadLeft > 0
  }

  get busy(): boolean {
    return this.burstLeft > 0
  }

  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadLeft / this.spec.reload : 1
  }

  reload(): boolean {
    if (this.reloading || this.ammo >= this.spec.magazine || this.burstLeft > 0) return false
    this.reloadLeft = this.spec.reload
    return true
  }

  cancel(): void {
    this.reloadLeft = 0
    this.burstLeft = 0
    this.triggerWasDown = true
  }

  holster(): void {
    this.cancel()
  }

  update(dt: number, triggerDown: boolean): number {
    const pressed = triggerDown && !this.triggerWasDown
    this.triggerWasDown = triggerDown
    this.bloom = Math.max(0, this.bloom - BLOOM_DECAY * dt)
    this.next -= dt

    if (this.reloading) {
      this.reloadLeft = Math.max(0, this.reloadLeft - dt)
      if (!this.reloading) this.ammo = this.spec.magazine
      if (this.next < 0) this.next = 0
      return 0
    }

    if (this.ammo <= 0 && this.burstLeft === 0) {
      if (this.next < 0) this.next = 0
      if (pressed) this.reload()
      return 0
    }

    if (this.spec.mode === 'auto') {
      if (!triggerDown) {
        if (this.next < 0) this.next = 0
        return 0
      }
    } else if (this.burstLeft === 0) {
      if (this.next < 0) this.next = 0
      if (!pressed || this.next > 0) return 0
      this.burstLeft = Math.min(this.spec.burst, this.ammo)
    }

    let rounds = 0
    while (this.next <= 0 && this.ammo > 0 && rounds < MAX_ROUNDS_PER_FRAME) {
      if (this.spec.mode === 'burst') {
        if (this.burstLeft === 0) break
        this.burstLeft--
      }
      this.ammo--
      this.bloom = Math.min(BLOOM_LIMIT, this.bloom + (this.spec.mode === 'auto' ? BLOOM_PER_ROUND : 0))
      rounds++
      const lastOfBurst = this.spec.mode === 'burst' && this.burstLeft === 0
      this.next += lastOfBurst ? Math.max(this.spec.roundInterval, this.spec.burstDelay) : this.spec.roundInterval
    }
    if (this.ammo <= 0) this.burstLeft = 0
    if (this.next < 0) this.next = 0
    return rounds
  }
}
