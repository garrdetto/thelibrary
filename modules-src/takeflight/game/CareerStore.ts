/**
 * Where the career lives: on the account through `/api/takeflight` when the pilot is signed in (the Worker applies each flight
 * with the shared rules and returns the result), otherwise in this browser for guests. `record` applies a flight and resolves
 * to what changed; a failed save keeps the local result and says so.
 */
import { applyFlight, defaultCareer, joinAirline, leaveAirline, normalizeCareer, pilotClassOf } from '../shared/Career'
import type { AirlineId } from '../shared/Airlines'
import type { CareerProfile, FlightResult, FlightSummary } from '../shared/Career'
import { HANGAR_CLASSES, hangarEntry } from '../shared/Hangar'

const GUEST_KEY = 'takeflight.career.v1'
const API = '/api/takeflight'

export type CareerMode = 'account' | 'guest'

export interface RecordOutcome {
  result: FlightResult
  saved: boolean
  message: string | null
}

function readGuest(): CareerProfile {
  try {
    const raw = localStorage.getItem(GUEST_KEY)
    return raw ? normalizeCareer(JSON.parse(raw)) : defaultCareer()
  } catch {
    return defaultCareer()
  }
}

function writeGuest(profile: CareerProfile): boolean {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(profile))
    return true
  } catch {
    return false
  }
}

export class CareerStore {
  profile: CareerProfile = defaultCareer()
  mode: CareerMode = 'guest'
  username: string | null = null
  private readonly listeners: (() => void)[] = []

  onChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    this.profile = readGuest()
    this.mode = 'guest'
    try {
      const response = await fetch(API, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (response.ok) {
        const body = (await response.json()) as { signedIn: boolean; username?: string; profile?: unknown }
        if (body.signedIn && body.profile) {
          this.profile = normalizeCareer(body.profile)
          this.mode = 'account'
          this.username = body.username ?? null
        }
      }
    } catch {
      this.mode = 'guest'
    }
    this.changed()
  }

  /** Joins (or moves to) an airline; resolves to an error message, or null when it worked. */
  async joinAirline(id: AirlineId): Promise<string | null> {
    const local = joinAirline(this.profile, id, Date.now())
    if (local.error) return local.error
    return this.change(local.profile, { action: 'join', airline: id })
  }

  async leaveAirline(): Promise<string | null> {
    return this.change(leaveAirline(this.profile), { action: 'leave' })
  }

  private async change(profile: CareerProfile, body: Record<string, unknown>): Promise<string | null> {
    if (this.mode === 'guest') {
      this.profile = profile
      const saved = writeGuest(profile)
      this.changed()
      return saved ? null : 'This browser would not keep the career.'
    }
    try {
      const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const reply = (await response.json().catch(() => ({}))) as { ok?: boolean; profile?: unknown; error?: string }
      if (response.ok && reply.ok && reply.profile) {
        this.profile = normalizeCareer(reply.profile)
        this.changed()
        return null
      }
      return reply.error ?? 'The career could not be saved.'
    } catch {
      return 'The career could not be saved: no connection.'
    }
  }

  /**
   * Adds a flight. Guests apply the page's summary; signed-in pilots send the flight record, which the Worker re-flies and
   * scores itself (the summary only fills the debrief if the save fails).
   */
  async record(summary: FlightSummary, record: Promise<Uint8Array | null>): Promise<RecordOutcome> {
    const entry = hangarEntry(summary.aircraft)
    const context = { now: Date.now(), pilotClass: pilotClassOf(entry?.category ?? 'trainer'), family: entry?.family ?? 'wren', classes: HANGAR_CLASSES, payload: entry?.payload }
    const local = applyFlight(this.profile, summary, context)
    if (this.mode === 'guest') {
      this.profile = local.profile
      const saved = writeGuest(local.profile)
      this.changed()
      return { result: local, saved, message: saved ? null : 'This browser would not keep the career.' }
    }
    const bytes = await record
    if (!bytes) return { result: local, saved: false, message: 'The flight record could not be made, so the flight was not saved.' }
    try {
      const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]) })
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: FlightResult; error?: string }
      if (response.ok && body.ok && body.result) {
        this.profile = normalizeCareer(body.result.profile)
        this.changed()
        return { result: { ...body.result, profile: this.profile }, saved: true, message: null }
      }
      return { result: local, saved: false, message: body.error ?? 'The career could not be saved.' }
    } catch {
      return { result: local, saved: false, message: 'The career could not be saved: no connection.' }
    }
  }
}
