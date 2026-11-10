export const ENCOUNTER_MIN_SECONDS = 60
export const ENCOUNTER_MAX_SECONDS = 180
/** Fish find a working bait a third quicker than they used to (was 3). */
export const FISH_SPEEDUP = 1.33
export const LINE_IN_WATER_RATE = 3 * FISH_SPEEDUP
export const IDLE_RATE = 0

export type EncounterChannel = 'fish' | 'game'

export class EncounterDirector {
  readonly progress: Record<EncounterChannel, number> = { fish: 0, game: 0 }
  readonly target: Record<EncounterChannel, number> = { fish: 0, game: 0 }

  constructor(private readonly rng: () => number = Math.random) {
    this.rearm('fish')
    this.rearm('game')
  }

  rearm(channel: EncounterChannel): void {
    this.progress[channel] = 0
    this.target[channel] = ENCOUNTER_MIN_SECONDS + this.rng() * (ENCOUNTER_MAX_SECONDS - ENCOUNTER_MIN_SECONDS)
  }

  update(dt: number, activity: { exploring: boolean; lineInWater: boolean; onLand: boolean; fishRate?: number }): EncounterChannel | null {
    if (activity.lineInWater) this.progress.fish += dt * LINE_IN_WATER_RATE * (activity.fishRate ?? 1)
    else if (activity.exploring) this.progress.fish += dt * 0.25
    if (activity.exploring && activity.onLand) this.progress.game += dt
    else if (activity.onLand) this.progress.game += dt * 0.35
    if (activity.lineInWater && this.progress.fish >= this.target.fish) return 'fish'
    if (activity.onLand && this.progress.game >= this.target.game) return 'game'
    return null
  }

  remaining(channel: EncounterChannel, rate = 1): number {
    return Math.max(0, (this.target[channel] - this.progress[channel]) / rate)
  }
}
