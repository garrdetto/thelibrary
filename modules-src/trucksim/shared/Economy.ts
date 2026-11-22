/**
 * A driver's saved state: cash, owned trucks and trailers, the active rig, the lot and what is built on it, the accepted job
 * and lifetime stats. `normalizeProfile` rebuilds anything stored or sent by a client field by field and never throws, so
 * the Worker, the page and guests all start from the same safe shape. The rules that change a profile live in `Actions.ts`.
 */
import { CARGO_BY_ID, STARTER_TRUCK, STARTING_CASH, TRAILER_BY_ID, TRUCK_BY_ID, defaultLook } from './Catalog'
import type { BumperOption, Finish, FlapOption, HaulKind, HornOption, LightOption, StackOption, Stripe, TruckLook, TruckModel, WheelOption } from './Catalog'
import { MAX_ITEMS, COLOR_PATTERN, normalizeBuildItem } from './Lots'
import type { BuildItem } from './Lots'
import type { Job } from './Jobs'
import { LOTS } from './WorldLayout'

export interface OwnedTruck {
  uid: string
  model: string
  look: TruckLook
  odometerKm: number
  damage: number
  fuelL: number
}

export interface OwnedTrailer {
  uid: string
  model: string
  color: string
  damage: number
}

export interface ActiveJob {
  job: Job
  acceptedAt: number
  truck: string
  trailer: string | null
}

export interface ProfileStats {
  jobs: number
  earned: number
  km: number
  tonnes: number
}

export interface Profile {
  version: 1
  cash: number
  company: string
  trucks: OwnedTruck[]
  trailers: OwnedTrailer[]
  activeTruck: string
  activeTrailer: string | null
  lot: number | null
  build: BuildItem[]
  job: ActiveJob | null
  stats: ProfileStats
  xp: number
}

export const DEFAULT_COMPANY = 'Open Road Hauling'
export const MAX_COMPANY_LENGTH = 32
export const MAX_TRUCKS = 24
export const MAX_TRAILERS = 24
export const MAX_CASH = 1_000_000_000
export const MAX_XP = 1_000_000_000
export const FUEL_STATION_MARKUP = 1.35
export const REPAIR_LABOUR_MARKUP = 1.6
export const SELL_DAMAGE_DISCOUNT = 0.5

export const LOOK_OPTIONS = {
  finish: ['gloss', 'metallic', 'matte'] as const satisfies readonly Finish[],
  stripe: ['none', 'pinstripe', 'band', 'swoosh'] as const satisfies readonly Stripe[],
  stacks: ['none', 'single', 'dual', 'dualTall'] as const satisfies readonly StackOption[],
  bumper: ['stock', 'chrome', 'heavy'] as const satisfies readonly BumperOption[],
  lights: ['stock', 'cabBar', 'full'] as const satisfies readonly LightOption[],
  wheels: ['steel', 'polished', 'black'] as const satisfies readonly WheelOption[],
  mudflaps: ['plain', 'chrome'] as const satisfies readonly FlapOption[],
  horn: ['stock', 'air'] as const satisfies readonly HornOption[],
}

const HAULS: readonly HaulKind[] = ['dump', 'tanker', 'flatbed', 'grain', 'reefer', 'lowboy']
const UID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return finite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function choose<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback
}

/** Rebuilds a look from untrusted data, taking anything missing or invalid from the model's stock look. */
export function normalizeLook(raw: unknown, model: TruckModel): TruckLook {
  const stock = defaultLook(model)
  if (typeof raw !== 'object' || raw === null) return stock
  const source = raw as Record<string, unknown>
  const paint = typeof source.paint === 'object' && source.paint !== null ? (source.paint as Record<string, unknown>) : {}
  return {
    paint: {
      primary: colour(paint.primary, stock.paint.primary),
      secondary: colour(paint.secondary, stock.paint.secondary),
      accent: colour(paint.accent, stock.paint.accent),
      finish: choose(paint.finish, LOOK_OPTIONS.finish, stock.paint.finish),
      stripe: choose(paint.stripe, LOOK_OPTIONS.stripe, stock.paint.stripe),
    },
    stacks: choose(source.stacks, LOOK_OPTIONS.stacks, stock.stacks),
    visor: typeof source.visor === 'boolean' ? source.visor : stock.visor,
    bumper: choose(source.bumper, LOOK_OPTIONS.bumper, stock.bumper),
    lights: choose(source.lights, LOOK_OPTIONS.lights, stock.lights),
    wheels: choose(source.wheels, LOOK_OPTIONS.wheels, stock.wheels),
    mudflaps: choose(source.mudflaps, LOOK_OPTIONS.mudflaps, stock.mudflaps),
    horn: choose(source.horn, LOOK_OPTIONS.horn, stock.horn),
  }
}

/** A fresh uid with `prefix` that no entry in `used` has. */
export function nextUid(prefix: string, used: Iterable<string>): string {
  const taken = new Set(used)
  let n = taken.size + 1
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

/** A new truck of `model` with a full tank. */
export function newTruck(uid: string, model: TruckModel, look: TruckLook = defaultLook(model)): OwnedTruck {
  return { uid, model: model.id, look, odometerKm: 0, damage: 0, fuelL: model.fuelTankL }
}

/** A new profile: $3,000 and the paid-off starter dump truck with a full tank. */
export function defaultProfile(): Profile {
  const starter = TRUCK_BY_ID[STARTER_TRUCK]
  return {
    version: 1,
    cash: STARTING_CASH,
    company: DEFAULT_COMPANY,
    trucks: [newTruck('t1', starter)],
    trailers: [],
    activeTruck: 't1',
    activeTrailer: null,
    lot: null,
    build: [],
    job: null,
    stats: { jobs: 0, earned: 0, km: 0, tonnes: 0 },
    xp: 0,
  }
}

/** Trims a company name, drops control characters and limits its length; null when nothing is left. */
export function cleanCompany(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_COMPANY_LENGTH).trim()
  return cleaned.length > 0 ? cleaned : null
}

function normalizeTrucks(raw: unknown): OwnedTruck[] {
  const trucks: OwnedTruck[] = []
  const used = new Set<string>()
  for (const entry of Array.isArray(raw) ? raw.slice(0, MAX_TRUCKS * 2) : []) {
    if (trucks.length >= MAX_TRUCKS || typeof entry !== 'object' || entry === null) continue
    const source = entry as Record<string, unknown>
    const model = typeof source.model === 'string' ? TRUCK_BY_ID[source.model] : undefined
    if (!model) continue
    const uid = typeof source.uid === 'string' && UID_PATTERN.test(source.uid) && !used.has(source.uid) ? source.uid : nextUid('t', used)
    used.add(uid)
    trucks.push({
      uid,
      model: model.id,
      look: normalizeLook(source.look, model),
      odometerKm: clamp(source.odometerKm, 0, 10_000_000, 0),
      damage: clamp(source.damage, 0, 100, 0),
      fuelL: clamp(source.fuelL, 0, model.fuelTankL, model.fuelTankL),
    })
  }
  return trucks
}

function normalizeTrailers(raw: unknown): OwnedTrailer[] {
  const trailers: OwnedTrailer[] = []
  const used = new Set<string>()
  for (const entry of Array.isArray(raw) ? raw.slice(0, MAX_TRAILERS * 2) : []) {
    if (trailers.length >= MAX_TRAILERS || typeof entry !== 'object' || entry === null) continue
    const source = entry as Record<string, unknown>
    const model = typeof source.model === 'string' ? TRAILER_BY_ID[source.model] : undefined
    if (!model) continue
    const uid = typeof source.uid === 'string' && UID_PATTERN.test(source.uid) && !used.has(source.uid) ? source.uid : nextUid('r', used)
    used.add(uid)
    trailers.push({ uid, model: model.id, color: colour(source.color, model.defaultColor), damage: clamp(source.damage, 0, 100, 0) })
  }
  return trailers
}

function normalizeJob(raw: unknown, trucks: OwnedTruck[], trailers: OwnedTrailer[]): ActiveJob | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const job = typeof source.job === 'object' && source.job !== null ? (source.job as Record<string, unknown>) : null
  if (!job) return null
  const cargo = typeof job.cargo === 'string' ? CARGO_BY_ID[job.cargo] : undefined
  const haul = HAULS.find((kind) => kind === job.haul)
  const numbers = [job.massKg, job.distanceM, job.pay, job.minutes, source.acceptedAt]
  if (!cargo || !haul || !numbers.every(finite)) return null
  if (typeof job.id !== 'string' || typeof job.world !== 'string' || typeof job.from !== 'string' || typeof job.to !== 'string') return null
  if (typeof source.truck !== 'string' || !trucks.some((truck) => truck.uid === source.truck)) return null
  const trailer = typeof source.trailer === 'string' && trailers.some((entry) => entry.uid === source.trailer) ? source.trailer : null
  return {
    job: { id: job.id, world: job.world, cargo: cargo.id, haul, massKg: job.massKg as number, from: job.from, to: job.to, distanceM: job.distanceM as number, pay: job.pay as number, minutes: job.minutes as number },
    acceptedAt: source.acceptedAt as number,
    truck: source.truck,
    trailer,
  }
}

/** Rebuilds a profile from anything: drops unknown models, clamps numbers, repairs references. Never throws. */
export function normalizeProfile(raw: unknown): Profile {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const fallback = defaultProfile()
  const trucks = normalizeTrucks(source.trucks)
  if (trucks.length === 0) trucks.push(...fallback.trucks)
  const trailers = normalizeTrailers(source.trailers)
  const stats = typeof source.stats === 'object' && source.stats !== null ? (source.stats as Record<string, unknown>) : {}
  const build: BuildItem[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(source.build) ? source.build.slice(0, MAX_ITEMS * 2) : []) {
    const item = normalizeBuildItem(entry)
    if (!item || seen.has(item.id) || build.length >= MAX_ITEMS) continue
    seen.add(item.id)
    build.push(item)
  }
  const activeTruck = typeof source.activeTruck === 'string' && trucks.some((truck) => truck.uid === source.activeTruck) ? source.activeTruck : trucks[0].uid
  const activeTrailer = typeof source.activeTrailer === 'string' && trailers.some((trailer) => trailer.uid === source.activeTrailer) ? source.activeTrailer : null
  const lot = finite(source.lot) && Number.isInteger(source.lot) && source.lot >= 0 && source.lot < LOTS.length ? source.lot : null
  return {
    version: 1,
    cash: Math.round(clamp(source.cash, 0, MAX_CASH, fallback.cash)),
    company: cleanCompany(source.company) ?? DEFAULT_COMPANY,
    trucks,
    trailers,
    activeTruck,
    activeTrailer,
    lot,
    build,
    job: normalizeJob(source.job, trucks, trailers),
    stats: {
      jobs: Math.floor(clamp(stats.jobs, 0, 1e9, 0)),
      earned: Math.round(clamp(stats.earned, 0, 1e12, 0)),
      km: clamp(stats.km, 0, 1e9, 0),
      tonnes: clamp(stats.tonnes, 0, 1e9, 0),
    },
    xp: Math.floor(clamp(source.xp, 0, MAX_XP, 0)),
  }
}

/** Driver level for an xp total: 1 at the start, 4 at 1,000 xp, 11 at 10,000. */
export function level(xp: number): number {
  return finite(xp) ? 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100)) : 1
}
