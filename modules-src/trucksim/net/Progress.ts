/**
 * The driver's saved career. Signed in, every action is posted to `/api/trucksim`, which runs the same `applyAction` rules and
 * saves to D1; actions are sent one at a time so they never race. Guests (or when the server can't be reached) run
 * `applyAction` in memory on a fresh profile that is gone when the page closes. A host such as Life Sim can pass its own
 * `world` id for the Worker's haul-world seam. Administrators can switch to a sandbox (`enterSandbox`): a rich copy of the
 * profile run in memory like a guest's, never saved, for the developer panel.
 */
import { applyAction, withStarterDriveway } from '../shared/Actions'
import type { ActResult, TruckAction } from '../shared/Actions'
import { defaultProfile, normalizeProfile } from '../shared/Economy'
import type { Profile } from '../shared/Economy'
import type { HaulWorld } from '../shared/HaulWorld'
import type { PublicLot } from '../shared/Lots'

export interface ProgressClient {
  readonly profile: Profile
  readonly signedIn: boolean
  readonly username: string | null
  readonly lots: readonly PublicLot[]
  readonly offline: boolean
  act(action: TruckAction): Promise<ActResult>
  onChange(listener: (profile: Profile) => void): () => void
  refreshLots(): Promise<readonly PublicLot[]>
}

interface ProfileResponse {
  signedIn?: boolean
  username?: string
  admin?: boolean
  profile?: unknown
  lots?: PublicLot[]
}

interface ActResponse {
  ok?: boolean
  message?: string
  delta?: number
  paid?: ActResult['paid'] | null
  profile?: unknown
  error?: string
}

export class Progress implements ProgressClient {
  private listeners = new Set<(profile: Profile) => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private sandbox = false
  /** True for administrators (the server says so); unlocks the developer panel. */
  admin = false

  private constructor(
    public profile: Profile,
    readonly signedIn: boolean,
    readonly username: string | null,
    public lots: PublicLot[],
    readonly offline: boolean,
    private readonly world: HaulWorld,
    private readonly endpoint: string,
  ) {}

  static async load(world: HaulWorld, endpoint = '/api/trucksim'): Promise<Progress> {
    const url = world.id === 'county' ? endpoint : `${endpoint}?world=${encodeURIComponent(world.id)}`
    try {
      const response = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as ProfileResponse
      const lots = Array.isArray(data.lots) ? data.lots : []
      if (data.signedIn && data.profile) {
        const progress = new Progress(normalizeProfile(data.profile), true, data.username ?? null, lots, false, world, url)
        progress.admin = data.admin === true
        return progress
      }
      return new Progress(guestProfile(world, lots), false, null, lots, false, world, url)
    } catch {
      return new Progress(guestProfile(world, []), false, null, [], true, world, url)
    }
  }

  onChange(listener: (profile: Profile) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(profile: Profile): void {
    this.profile = profile
    for (const listener of this.listeners) listener(profile)
  }

  act(action: TruckAction): Promise<ActResult> {
    const run = this.queue.then(() => (this.signedIn && !this.sandbox ? this.post(action) : this.local(action)))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** True while the career is a sandbox copy that is never saved. */
  get sandboxed(): boolean {
    return this.sandbox
  }

  /** Switches to an unsaved copy of the profile with `cash` (administrators only; a reload brings the real career back). */
  enterSandbox(cash = 5_000_000): boolean {
    if (!this.admin) return false
    this.sandbox = true
    this.set({ ...normalizeProfile(JSON.parse(JSON.stringify(this.profile))), cash })
    return true
  }

  /** Edits the sandbox profile directly (ignored outside the sandbox). */
  sandboxEdit(edit: (profile: Profile) => void): void {
    if (!this.sandbox) return
    const next = normalizeProfile(JSON.parse(JSON.stringify(this.profile)))
    edit(next)
    this.set(next)
  }

  private local(action: TruckAction): ActResult {
    const taken = new Set(this.lots.map((lot) => lot.index))
    const result = applyAction(this.profile, action, { now: Date.now(), world: this.world, lotFree: (index) => !taken.has(index) })
    if (result.ok) this.set(result.profile)
    return result
  }

  private async post(action: TruckAction): Promise<ActResult> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(action),
      })
      const data = (await response.json().catch(() => ({}))) as ActResponse
      if (!response.ok) return { ok: false, profile: this.profile, delta: 0, message: data.error ?? 'The yard office could not be reached. Try again.' }
      const profile = data.profile ? normalizeProfile(data.profile) : this.profile
      if (data.ok) this.set(profile)
      return { ok: Boolean(data.ok), profile, delta: data.delta ?? 0, message: data.message ?? '', ...(data.paid ? { paid: data.paid } : {}) }
    } catch {
      return { ok: false, profile: this.profile, delta: 0, message: 'The yard office could not be reached. Try again.' }
    }
  }

  async refreshLots(): Promise<readonly PublicLot[]> {
    if (this.offline) return this.lots
    try {
      const base = this.endpoint.includes('?') ? `${this.endpoint}&lots=1` : `${this.endpoint}?lots=1`
      const response = await fetch(base, { credentials: 'same-origin' })
      if (response.ok) {
        const data = (await response.json()) as { lots?: PublicLot[] }
        if (Array.isArray(data.lots)) this.lots = data.lots
      }
    } catch {
      return this.lots
    }
    return this.lots
  }
}

/** A guest borrows the first lot nobody owns, for this visit only. */
function guestProfile(world: HaulWorld, lots: readonly PublicLot[]): Profile {
  const taken = new Set(lots.map((lot) => lot.index))
  const free = world.lots.find((lot) => !taken.has(lot.index))
  return withStarterDriveway({ ...defaultProfile(), lot: free ? free.index : null }, world)
}
