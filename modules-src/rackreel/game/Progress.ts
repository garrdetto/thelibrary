import { FISH_COOLDOWN_MS, GAME_COOLDOWN_MS, applyEvent, applyPlaytime, defaultProfile, equip, gearEffects, normalizeProfile, purchase } from '../shared/Economy'
import { categoryValues, placeOn } from '../shared/Records'
import type { RecordBoard } from '../shared/Records'
import type { GameEvent, GearEffects, Profile, Slot } from '../shared/Economy'
import { SPECIES_BY_ID } from '../systems/LootTableManager'
import type { SpeciesId } from '../systems/LootTableManager'

const API = new URL('/api/rackreel', location.href).href

export interface EarnReport {
  paid: number
  completed: { id: string; text: string; reward: number }[]
  /** High-score category id → place (1–3) this catch took. */
  placed: Record<string, number>
}

export const GUEST_NAME = 'You (guest)'

type PostReply = { profile?: unknown; paid?: number; completed?: EarnReport['completed']; records?: RecordBoard; placed?: Record<string, number>; error?: string }

export type CatchReport =
  | { action: 'fish'; species: SpeciesId; value: number; legendary: boolean; boat: boolean }
  | { action: 'game'; species: SpeciesId; value: number; legendary: boolean; doe: boolean; stand: boolean }

export class Progress {
  profile: Profile = defaultProfile()
  signedIn = false
  username = ''
  onChange: (() => void) | null = null
  /** The shared top three for every high-score category (guests keep theirs in this tab only). */
  board: RecordBoard = {}
  private playClock = 0

  /** The name high-score entries are filed under for this player. */
  get scoreName(): string {
    return this.signedIn ? this.username : GUEST_NAME
  }

  async loadRecords(): Promise<RecordBoard> {
    try {
      const res = await fetch(`${API}?records=1`, { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json() as { records?: RecordBoard }
        const server = data.records ?? {}
        if (!this.signedIn) {
          // Keep this tab's guest entries in view next to the saved board.
          for (const [id, list] of Object.entries(this.board)) for (const e of list) if (e.username === GUEST_NAME) placeOn(server, id, e)
        }
        this.board = server
      }
    } catch {
      // Offline: keep what we have.
    }
    return this.board
  }

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

  private async post(body: Record<string, unknown>): Promise<PostReply> {
    const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({})) as PostReply
    if (!res.ok) return { error: data.error ?? 'The trading post could not be reached.' }
    return data
  }

  private adopt(raw: unknown): void {
    if (raw) this.profile = normalizeProfile(raw)
    this.onChange?.()
  }

  async report(c: CatchReport): Promise<EarnReport> {
    if (this.signedIn) {
      const data = await this.post(c).catch(() => ({ error: 'offline' }) as PostReply)
      if (data.error) return { paid: 0, completed: [], placed: {} }
      if (data.records) this.board = data.records
      this.adopt(data.profile)
      return { paid: data.paid ?? 0, completed: data.completed ?? [], placed: data.placed ?? {} }
    }
    const t = SPECIES_BY_ID[c.species]
    const doe = c.action === 'game' && c.doe
    const now = Date.now()
    const last = c.action === 'fish' ? this.profile.lastFishAt : this.profile.lastGameAt
    const accepted = now - last >= (c.action === 'fish' ? FISH_COOLDOWN_MS : GAME_COOLDOWN_MS)
    const placed: Record<string, number> = {}
    if (accepted && !doe) {
      for (const [id, value] of Object.entries(categoryValues(c.species, c.value))) {
        const rank = placeOn(this.board, id, { username: GUEST_NAME, value, at: now })
        if (rank) placed[id] = rank
      }
    }
    const trophy = !doe && (c.legendary || c.value >= t.trophyAt)
    const event: GameEvent = c.action === 'fish'
      ? { type: 'fish', species: c.species, trophy, boat: c.boat, legendary: c.legendary }
      : { type: 'game', species: c.species, doe, stand: c.stand, trophy, legendary: !doe && c.legendary }
    const share = doe ? 0 : (c.value - t.min) / Math.max(1e-6, t.max - t.min)
    const result = applyEvent(this.profile, event, share, now)
    this.onChange?.()
    return { ...result, placed }
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
