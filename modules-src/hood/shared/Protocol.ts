import type { BuildOp } from './Build'
import type { Pose } from './Catalog'
import type { Look } from './Look'
import type { Edge, PlacedObject } from './Lot'
import type { Feature, HouseStyle } from './Style'
import type { Needs } from './Needs'
import type { JobId, ServiceKind } from './Jobs'
import type { TownRequest } from './TownSim'

export type Speed = 0 | 1 | 2 | 3

export type Command =
  | { t: 'go'; sim: string; x: number; z: number }
  | { t: 'use'; sim: string; obj: number; act: string }
  | { t: 'chat'; sim: string; target: string }
  | { t: 'cancel'; sim: string }
  | { t: 'knock'; sim: string }
  | { t: 'answer'; id: string; allow: boolean; always?: boolean }
  | { t: 'askLeave'; id: string }
  | { t: 'sendHome'; id: string; block?: boolean }
  | { t: 'forget'; list: 'alwaysLetIn' | 'blocked'; index: number }
  | { t: 'speed'; speed: Speed }
  | { t: 'build'; op: BuildOp }
  | { t: 'settings'; yardOpen?: boolean; guestsUseFridgeBeds?: boolean }
  | { t: 'job'; sim: string; job: JobId | null }
  | { t: 'work'; sim: string }
  | { t: 'task'; sim: string; task: string }
  | { t: 'clockOut'; sim: string }
  | { t: 'order'; kind: ServiceKind; sim?: string }

export interface CareerView {
  job: JobId
  level: number
  title: string
  xp: number
  next: number
  shifts: number
  last: { pay: number; perf: number; at: number } | null
}

/** A household Sim on a shift in town, for the owner's work panel. */
export interface WorkView {
  id: string
  name: string
  look: Look
  career: CareerView
  start: number
  until: number
  perf: number
  earned: number
  task: { id: string; label: string; starts: number; ends: number } | null
  counts: Record<string, number>
  calls: { id: string; label: string }[]
}

export interface AwayView {
  id: string
  name: string
  until: number
  where: string
}

export interface OrderView {
  kind: ServiceKind
  eta: number
  sim: string | null
}

export interface SimView {
  id: string
  name: string
  look: Look
  x: number
  z: number
  facing: number
  pose: Pose
  /** Object being used, so the page can seat the Sim on it. */
  obj?: number
  seat?: number
  act?: string
  hh: boolean
  owner: string
  mine: boolean
  needs?: Needs
  queue?: string[]
  friends?: { name: string; value: number }[]
  bubble?: string
  career?: CareerView | null
}

export interface LotView {
  street: number
  lot: number
  address: string
  ownerName: string
  householdName: string
  walls: Edge[]
  doors: Edge[]
  windows: Edge[]
  floors: [number, number][]
  style: HouseStyle
  features: Feature[]
  objects: PlacedObject[]
  /** True when this viewer may see inside (household or a guest). */
  entitled: boolean
}

export interface SettingsView {
  yardOpen: boolean
  guestsUseFridgeBeds: boolean
  alwaysLetIn: string[]
  blocked: string[]
}

export interface MemberView {
  id: string
  name: string
  role: 'owner' | 'visitor'
  guest: boolean
  me: boolean
}

export type ServerMessage =
  | { t: 'welcome'; id: string; role: 'owner' | 'visitor'; lot: LotView; settings?: SettingsView }
  | { t: 'lot'; lot: LotView; settings?: SettingsView }
  | { t: 'state'; clock: number; speed: Speed; funds?: number; home: boolean; sims: SimView[]; now: number; work?: WorkView[]; away?: AwayView[]; orders?: OrderView[] }
  | { t: 'town'; requests: TownRequest[] }
  | { t: 'people'; people: MemberView[] }
  | { t: 'knock'; id: string; name: string }
  | { t: 'knockEnd'; id: string }
  | { t: 'guest'; guest: boolean }
  | { t: 'notice'; text: string }
  | { t: 'bye'; text: string }

export const STATE_HZ = 5
export const TICK_HZ = 10
export const LOT_CAPACITY = 8

/** Hours and minutes from the household clock (day 1 starts at 8:00). */
export function clockParts(minutes: number): { day: number; hour: number; minute: number } {
  const total = Math.floor(minutes) + 8 * 60
  return { day: Math.floor(total / 1440) + 1, hour: Math.floor(total / 60) % 24, minute: total % 60 }
}

export function clockLabel(minutes: number): string {
  const { day, hour, minute } = clockParts(minutes)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `Day ${day} · ${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
