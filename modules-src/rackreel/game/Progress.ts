import { applyEvent, applyPlaytime, defaultProfile, equip, gearEffects, normalizeProfile, purchase } from '../shared/Economy'
import type { GameEvent, GearEffects, Profile, Slot } from '../shared/Economy'
import { SPECIES_BY_ID } from '../systems/LootTableManager'
import type { SpeciesId } from '../systems/LootTableManager'

const API = new URL('/api/rackreel', location.href).href

export interface EarnReport {
  paid: number
  completed: { id: string; text: string; reward: number }[]
}

export type CatchReport =
  | { action: 'fish'; species: SpeciesId; value: number; legendary: boolean; boat: boolean }
  | { action: 'game'; species: SpeciesId; value: number; legendary: boolean; doe: boolean; stand: boolean }

export class Progress {
  profile: Profile = defaultProfile()
  signedIn = false
  username = ''
  onChange: (() => void) | null = null
  private playClock = 0

  get effects(): GearEffects {
    return gearEffects(this.profile.loadout)
  }

  async load(): Promise<void> {
    try {
      const res = await fetch(API, { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json() as { signedIn: boolean; username?: string; profile?: unknown }
      if (data.signedIn && data.profile) {
        this.signedIn = true
        this.username = data.username ?? ''
        this.profile = normalizeProfile(data.profile)
        this.onChange?.()
      }
    } catch {
      this.signedIn = false
    }
  }

  private async post(body: Record<string, unknown>): Promise<{ profile?: unknown; paid?: number; completed?: EarnReport['completed']; error?: string }> {
    const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({})) as { profile?: unknown; paid?: number; completed?: EarnReport['completed']; error?: string }
    if (!res.ok) return { error: data.error ?? 'The trading post could not be reached.' }
    return data
  }

  private adopt(raw: unknown): void {
    if (raw) this.profile = normalizeProfile(raw)
    this.onChange?.()
  }

  async report(c: CatchReport): Promise<EarnReport> {
    if (this.signedIn) {
      const data = await this.post(c)
      if (data.error) return { paid: 0, completed: [] }
      this.adopt(data.profile)
      return { paid: data.paid ?? 0, completed: data.completed ?? [] }
    }
    const t = SPECIES_BY_ID[c.species]
    const doe = c.action === 'game' && c.doe
    const trophy = !doe && (c.legendary || c.value >= t.trophyAt)
    const event: GameEvent = c.action === 'fish'
      ? { type: 'fish', species: c.species, trophy, boat: c.boat, legendary: c.legendary }
      : { type: 'game', species: c.species, doe, stand: c.stand, trophy, legendary: !doe && c.legendary }
    const share = doe ? 0 : (c.value - t.min) / Math.max(1e-6, t.max - t.min)
    const result = applyEvent(this.profile, event, share, Date.now())
    this.onChange?.()
    return result
  }

  async update(dt: number, active: boolean): Promise<number> {
    if (!active) return 0
    this.playClock += dt
    if (this.playClock < 60) return 0
    this.playClock = 0
    if (this.signedIn) {
      const data = await this.post({ action: 'tick' })
      if (!data.error) this.adopt(data.profile)
      return data.paid ?? 0
    }
    const paid = applyPlaytime(this.profile, 1)
    this.onChange?.()
    return paid
  }

  async buy(item: string): Promise<string | null> {
    if (this.signedIn) {
      const data = await this.post({ action: 'buy', item })
      if (data.error) return data.error
      this.adopt(data.profile)
      return null
    }
    const error = purchase(this.profile, item)
    this.onChange?.()
    return error
  }

  async equip(slot: Slot, item: string): Promise<string | null> {
    const local = equip(this.profile, slot, item)
    if (local) return local
    this.onChange?.()
    if (this.signedIn) {
      const data = await this.post({ action: 'equip', slot, item })
      if (data.error) return data.error
      this.adopt(data.profile)
    }
    return null
  }
}
