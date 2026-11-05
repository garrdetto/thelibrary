/** Who decides the bites: the Worker for signed-in anglers (server clock, server rolls, saved records) or the page for guests (same rules, nothing saved). */
import { activity, biteDelay, conditionsAt, creditsFor, rollCatch } from '../shared/Catch'
import type { CatchResult } from '../shared/Catch'
import { REELS } from '../shared/Gear'
import type { Rig } from '../shared/Gear'
import { LAKES } from '../shared/Lakes'
import type { LakeId } from '../shared/Lakes'
import { defaultProfile, lbToOz10 } from '../shared/Profile'
import type { AnglerProfile } from '../shared/Profile'
import { evaluateAchievements } from '../shared/Achievements'
import type { Unlock } from '../shared/Achievements'
import { now } from '../shared/Clock'

export interface BiteResult extends CatchResult {
  weightOz10: number
  lengthQ: number
  spot: string
  credits: number
  personalBest: boolean
  siteRecord: boolean
  daily: number
  id?: string
}

export interface Progress {
  seconds: number
  miles: number
  social?: number
}

export interface TickResult {
  result: BiteResult | null
  nextBiteAt: number | null
  profile?: AnglerProfile
  unlocked?: Unlock[]
}

export interface Authority {
  readonly saved: boolean
  start(lake: LakeId, x: number, z: number, rig: Rig, crowd: number, progress: Progress): Promise<number>
  tick(crowd: number, progress: Progress): Promise<TickResult>
  stop(progress: Progress): Promise<AnglerProfile | null>
}

export class ApiError extends Error {}

export async function api<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/angler', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new ApiError(data.error ?? 'The lake server is unavailable right now.')
  return data
}

export class ServerAuthority implements Authority {
  readonly saved = true
  private offset = 0
  /** The shared-lake instance this page is in, so catches reach the other anglers there. */
  room: number | undefined

  private local(serverTime: number | null, serverNow: number): number | null {
    this.offset = Date.now() - serverNow
    return serverTime ? serverTime + this.offset : null
  }

  async start(lake: LakeId, x: number, z: number, rig: Rig, crowd: number, progress: Progress): Promise<number> {
    const r = await api<{ nextBiteAt: number; serverNow: number }>({ action: 'start', lake, x, z, rig, crowd, progress, room: this.room })
    return this.local(r.nextBiteAt, r.serverNow) ?? Date.now() + 60_000
  }

  async tick(crowd: number, progress: Progress): Promise<TickResult> {
    const r = await api<{ result: BiteResult | null; nextBiteAt: number | null; serverNow: number; profile: AnglerProfile; unlocked?: Unlock[] }>({ action: 'tick', crowd, progress, room: this.room })
    return { result: r.result, nextBiteAt: this.local(r.nextBiteAt, r.serverNow), profile: r.profile, unlocked: r.unlocked }
  }

  async stop(progress: Progress): Promise<AnglerProfile | null> {
    const r = await api<{ profile: AnglerProfile }>({ action: 'stop', progress, room: this.room })
    return r.profile
  }
}

/** Guest play: the shared catch rules run in the page; credits and records are shown but not kept. */
export class LocalAuthority implements Authority {
  readonly saved = false
  profile: AnglerProfile = defaultProfile()
  private session: { lake: LakeId; x: number; z: number; rig: Rig; next: number; last: number } | null = null
  /** Preview aid (`?preview=fast`, guests only): bites every few seconds. Nothing is saved either way. */
  private readonly fast = new URLSearchParams(location.search).get('preview') === 'fast'

  async start(lake: LakeId, x: number, z: number, rig: Rig, crowd: number): Promise<number> {
    const t = Date.now()
    this.session = { lake, x, z, rig, next: 0, last: this.session?.last ?? 0 }
    this.schedule(t, crowd, 8000)
    return this.session.next
  }

  private schedule(t: number, crowd: number, extra = 0): void {
    const s = this.session!
    const ctx = { lake: LAKES[s.lake], x: s.x, z: s.z, date: now(), rig: s.rig, settled: 60, crowd }
    s.next = this.fast ? t + extra * 0.3 + 3000 : Math.max(t + extra + biteDelay(activity(ctx, conditionsAt(ctx)), Math.random) * 1000, s.last + 45_000)
  }

  async tick(crowd: number): Promise<TickResult> {
    const s = this.session
    if (!s) return { result: null, nextBiteAt: null }
    const t = Date.now()
    if (t < s.next) return { result: null, nextBiteAt: s.next }
    const ctx = { lake: LAKES[s.lake], x: s.x, z: s.z, date: now(), rig: s.rig, settled: 60, crowd }
    const roll = rollCatch(ctx, Math.random, REELS[this.profile.reel].bonus)
    s.last = t
    this.schedule(t, crowd, roll.fight * 1000 + 6000)
    const p = this.profile
    const weight = lbToOz10(roll.weight)
    const prev = p.stats.bySpecies[roll.species]
    const personalBest = roll.kind === 'landed' && (!prev || weight > prev.best)
    let credits = 0
    if (roll.kind === 'landed') {
      credits = creditsFor(roll.weight, roll.tier) * (personalBest && prev ? 2 : 1)
      p.tc += credits
      p.stats.landed++
      p.stats.bySpecies[roll.species] = { n: (prev?.n ?? 0) + 1, best: Math.max(prev?.best ?? 0, weight) }
      p.stats.tiers[roll.tier] = (p.stats.tiers[roll.tier] ?? 0) + 1
    } else if (roll.kind === 'lost') p.stats.lost++
    else p.stats.missed++
    const unlocked = evaluateAchievements(p)
    const result: BiteResult = { ...roll, weightOz10: weight, lengthQ: Math.round(roll.length * 4), spot: '', credits, personalBest, siteRecord: false, daily: 0 }
    return { result, nextBiteAt: s.next, profile: p, unlocked }
  }

  async stop(): Promise<AnglerProfile | null> {
    if (this.session) this.session.next = 0
    return this.profile
  }
}
