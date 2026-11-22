/**
 * The single authority for money, jobs and lots. `applyAction` takes a profile and one action and returns a new profile, the
 * cash change (`delta`, so a host can route money to a shared wallet) and a plain message. It runs in the Worker for signed-in
 * drivers and in the page for guests. A refused action returns the profile unchanged, `delta` 0 and the reason.
 */
import { FUEL_PRICE_PER_L, REPAIR_COST_PER_POINT, RESALE_SHARE, TRAILER_BY_ID, TRUCK_BY_ID, defaultLook, haulFor, lookCost } from './Catalog'
import type { TruckLook } from './Catalog'
import { FUEL_STATION_MARKUP, MAX_TRAILERS, MAX_TRUCKS, REPAIR_LABOUR_MARKUP, SELL_DAMAGE_DISCOUNT, cleanCompany, newTruck, nextUid, normalizeLook } from './Economy'
import type { Profile } from './Economy'
import type { HaulWorld } from './HaulWorld'
import { findJob, jobPayout, jobSlot, minimumMs } from './Jobs'
import type { JobPayout } from './Jobs'
import { COLOR_PATTERN, MAX_ITEMS, hasService, itemCost, itemRefund, validateItem } from './Lots'
import type { BuildItem, LotSize } from './Lots'
import { LOTS, LOT_D, LOT_W } from './WorldLayout'

export type TruckAction =
  | { action: 'buy-truck'; model: string; look?: TruckLook }
  | { action: 'buy-trailer'; model: string; color?: string }
  | { action: 'sell-truck'; uid: string }
  | { action: 'sell-trailer'; uid: string }
  | { action: 'customize'; uid: string; look: TruckLook }
  | { action: 'select'; truck: string; trailer: string | null }
  | { action: 'accept-job'; job: string }
  | { action: 'complete-job'; job: string; damage: number }
  | { action: 'abandon-job' }
  | { action: 'refuel'; uid: string; litres: number }
  | { action: 'repair'; uid: string }
  | { action: 'build'; items: BuildItem[] }
  | { action: 'demolish'; ids: string[] }
  | { action: 'rename'; company: string }
  | { action: 'claim-lot'; index: number }
  | { action: 'odometer'; uid: string; km: number; fuelUsedL: number }

export interface ActionContext {
  now: number
  world: HaulWorld
  lotFree?: (index: number) => boolean
  lotSize?: LotSize
}

export interface ActResult {
  ok: boolean
  profile: Profile
  delta: number
  message: string
  paid?: JobPayout
}

export const MAX_ODOMETER_KM_PER_UPDATE = 200
export const MAX_FUEL_PER_KM = 1
export const XP_PER_PAY = 1 / 20
export const JOB_DAMAGE_POINTS = 25

const money = (amount: number) => `$${Math.round(amount).toLocaleString('en-US')}`

function refuse(profile: Profile, message: string): ActResult {
  return { ok: false, profile, delta: 0, message }
}

function accept(profile: Profile, rawDelta: number, message: string, paid?: JobPayout): ActResult {
  const delta = rawDelta === 0 ? 0 : rawDelta
  profile.cash += delta
  return paid ? { ok: true, profile, delta, message, paid } : { ok: true, profile, delta, message }
}

function lotSizeFor(profile: Profile, ctx: ActionContext): LotSize {
  if (ctx.lotSize) return ctx.lotSize
  const spec = profile.lot === null ? undefined : LOTS[profile.lot]
  return spec ? { w: spec.w, d: spec.d } : { w: LOT_W, d: LOT_D }
}

function jobUses(profile: Profile, uid: string): boolean {
  return profile.job !== null && (profile.job.truck === uid || profile.job.trailer === uid)
}

/** What a truck sells for: the resale share of its price, less up to half for damage. */
export function truckResale(price: number, damage: number): number {
  return Math.floor(price * RESALE_SHARE * (1 - (Math.max(0, Math.min(100, damage)) / 100) * SELL_DAMAGE_DISCOUNT))
}

function buyTruck(profile: Profile, action: Extract<TruckAction, { action: 'buy-truck' }>): ActResult {
  const model = TRUCK_BY_ID[action.model]
  if (!model) return refuse(profile, 'That truck is not for sale.')
  if (profile.trucks.length >= MAX_TRUCKS) return refuse(profile, 'Your yard has no room for another truck.')
  const stock = defaultLook(model)
  const look = action.look ? normalizeLook(action.look, model) : stock
  const price = model.price + lookCost(stock, look)
  if (price > profile.cash) return refuse(profile, `You need ${money(price - profile.cash)} more.`)
  profile.trucks.push(newTruck(nextUid('t', profile.trucks.map((truck) => truck.uid)), model, look))
  return accept(profile, -price, `Bought the ${model.brand} ${model.name} for ${money(price)}.`)
}

function buyTrailer(profile: Profile, action: Extract<TruckAction, { action: 'buy-trailer' }>): ActResult {
  const model = TRAILER_BY_ID[action.model]
  if (!model) return refuse(profile, 'That trailer is not for sale.')
  if (profile.trailers.length >= MAX_TRAILERS) return refuse(profile, 'Your yard has no room for another trailer.')
  if (model.price > profile.cash) return refuse(profile, `You need ${money(model.price - profile.cash)} more.`)
  const color = action.color !== undefined && COLOR_PATTERN.test(action.color) ? action.color : model.defaultColor
  profile.trailers.push({ uid: nextUid('r', profile.trailers.map((trailer) => trailer.uid)), model: model.id, color, damage: 0 })
  return accept(profile, -model.price, `Bought the ${model.name} for ${money(model.price)}.`)
}

function sellTruck(profile: Profile, uid: string): ActResult {
  const truck = profile.trucks.find((entry) => entry.uid === uid)
  if (!truck) return refuse(profile, 'You do not own that truck.')
  if (profile.trucks.length <= 1) return refuse(profile, 'You cannot sell your only truck.')
  if (truck.uid === profile.activeTruck) return refuse(profile, 'Switch to another truck before selling this one.')
  if (jobUses(profile, uid)) return refuse(profile, 'That truck is on a job.')
  const value = truckResale(TRUCK_BY_ID[truck.model].price, truck.damage)
  profile.trucks = profile.trucks.filter((entry) => entry.uid !== uid)
  return accept(profile, value, `Sold the truck for ${money(value)}.`)
}

function sellTrailer(profile: Profile, uid: string): ActResult {
  const trailer = profile.trailers.find((entry) => entry.uid === uid)
  if (!trailer) return refuse(profile, 'You do not own that trailer.')
  if (trailer.uid === profile.activeTrailer) return refuse(profile, 'Unhitch this trailer before selling it.')
  if (jobUses(profile, uid)) return refuse(profile, 'That trailer is on a job.')
  const value = truckResale(TRAILER_BY_ID[trailer.model].price, trailer.damage)
  profile.trailers = profile.trailers.filter((entry) => entry.uid !== uid)
  return accept(profile, value, `Sold the trailer for ${money(value)}.`)
}

function customize(profile: Profile, uid: string, rawLook: TruckLook): ActResult {
  const truck = profile.trucks.find((entry) => entry.uid === uid)
  if (!truck) return refuse(profile, 'You do not own that truck.')
  const look = normalizeLook(rawLook, TRUCK_BY_ID[truck.model])
  const cost = lookCost(truck.look, look)
  if (cost > profile.cash) return refuse(profile, `You need ${money(cost - profile.cash)} more.`)
  truck.look = look
  return accept(profile, -cost, cost > 0 ? `Customised for ${money(cost)}.` : 'Nothing to change.')
}

function select(profile: Profile, truck: string, trailer: string | null): ActResult {
  if (!profile.trucks.some((entry) => entry.uid === truck)) return refuse(profile, 'You do not own that truck.')
  if (trailer !== null && !profile.trailers.some((entry) => entry.uid === trailer)) return refuse(profile, 'You do not own that trailer.')
  if (profile.job) {
    const dump = TRUCK_BY_ID[profile.trucks.find((entry) => entry.uid === truck)?.model ?? '']?.dump !== undefined
    if (profile.job.truck !== truck || (!dump && profile.job.trailer !== trailer)) return refuse(profile, 'Finish or abandon your job before changing rigs.')
  }
  profile.activeTruck = truck
  profile.activeTrailer = trailer
  return accept(profile, 0, 'Rig selected.')
}

function acceptJob(profile: Profile, jobId: string, ctx: ActionContext): ActResult {
  if (profile.job) return refuse(profile, 'Finish or abandon your current job first.')
  const job = findJob(ctx.world, jobId)
  if (!job) return refuse(profile, 'That job is not on offer.')
  const slot = jobSlot(ctx.now)
  const offered = Number(jobId.split('-').slice(-2, -1)[0])
  if (offered !== slot && offered !== slot - 1) return refuse(profile, 'That job has expired.')
  const owned = profile.trucks.find((entry) => entry.uid === profile.activeTruck)
  const truck = owned ? TRUCK_BY_ID[owned.model] : undefined
  if (!owned || !truck) return refuse(profile, 'Select a truck first.')
  const attached = profile.trailers.find((entry) => entry.uid === profile.activeTrailer)
  const trailer = attached ? TRAILER_BY_ID[attached.model] : null
  const haul = haulFor(truck, trailer)
  if (haul !== job.haul) return refuse(profile, job.haul === 'dump' ? 'This job needs a dump truck.' : `This job needs a ${job.haul === 'lowboy' ? 'lowboy' : job.haul} trailer behind a semi-truck.`)
  const capacity = truck.dump ? truck.dump.capacityKg : (trailer?.maxPayloadKg ?? 0)
  if (job.massKg > capacity) return refuse(profile, `This load weighs ${job.massKg.toLocaleString('en-US')} kg; your rig carries ${capacity.toLocaleString('en-US')} kg.`)
  profile.job = { job, acceptedAt: ctx.now, truck: owned.uid, trailer: truck.dump || !attached ? null : attached.uid }
  return accept(profile, 0, 'Job accepted.')
}

function completeJob(profile: Profile, jobId: string, rawDamage: number, ctx: ActionContext): ActResult {
  const active = profile.job
  if (!active || active.job.id !== jobId) return refuse(profile, 'That is not your current job.')
  const elapsedMs = ctx.now - active.acceptedAt
  if (elapsedMs < minimumMs(active.job)) return refuse(profile, 'You could not have arrived that quickly.')
  const damage = Number.isFinite(rawDamage) ? Math.max(0, Math.min(1, rawDamage)) : 0
  const paid = jobPayout(active.job, { damage, elapsedMs })
  const points = Math.round(damage * JOB_DAMAGE_POINTS)
  const truck = profile.trucks.find((entry) => entry.uid === active.truck)
  if (truck) truck.damage = Math.min(100, truck.damage + points)
  const trailer = profile.trailers.find((entry) => entry.uid === active.trailer)
  if (trailer) trailer.damage = Math.min(100, trailer.damage + points)
  profile.job = null
  profile.stats.jobs += 1
  profile.stats.earned += paid.pay
  profile.stats.km += active.job.distanceM / 1000
  profile.stats.tonnes += active.job.massKg / 1000
  profile.xp += Math.round(paid.pay * XP_PER_PAY)
  return accept(profile, paid.pay, `Delivered. ${money(paid.pay)} paid.`, paid)
}

function refuel(profile: Profile, uid: string, litres: number): ActResult {
  const truck = profile.trucks.find((entry) => entry.uid === uid)
  if (!truck) return refuse(profile, 'You do not own that truck.')
  if (!Number.isFinite(litres) || litres <= 0) return refuse(profile, 'Choose an amount of fuel.')
  const room = TRUCK_BY_ID[truck.model].fuelTankL - truck.fuelL
  if (room < 0.5) return refuse(profile, 'The tank is already full.')
  const added = Math.min(litres, room)
  const cost = Math.round(added * FUEL_PRICE_PER_L * (hasService(profile.build) ? 1 : FUEL_STATION_MARKUP))
  if (cost > profile.cash) return refuse(profile, `You need ${money(cost - profile.cash)} more.`)
  truck.fuelL = Math.min(TRUCK_BY_ID[truck.model].fuelTankL, truck.fuelL + added)
  return accept(profile, -cost, `Added ${Math.round(added)} L for ${money(cost)}.`)
}

function repair(profile: Profile, uid: string): ActResult {
  const unit = profile.trucks.find((entry) => entry.uid === uid) ?? profile.trailers.find((entry) => entry.uid === uid)
  if (!unit) return refuse(profile, 'You do not own that vehicle.')
  const points = Math.ceil(unit.damage)
  if (points <= 0) return refuse(profile, 'Nothing needs repairing.')
  const cost = Math.round(points * REPAIR_COST_PER_POINT * (hasService(profile.build) ? 1 : REPAIR_LABOUR_MARKUP))
  if (cost > profile.cash) return refuse(profile, `You need ${money(cost - profile.cash)} more.`)
  unit.damage = 0
  return accept(profile, -cost, `Repaired for ${money(cost)}.`)
}

function build(profile: Profile, items: BuildItem[], ctx: ActionContext): ActResult {
  if (profile.lot === null && !ctx.lotSize) return refuse(profile, 'Claim a lot before building.')
  if (!Array.isArray(items) || items.length === 0) return refuse(profile, 'Nothing to build.')
  if (profile.build.length + items.length > MAX_ITEMS) return refuse(profile, `Your lot is full (${MAX_ITEMS} pieces).`)
  const size = lotSizeFor(profile, ctx)
  const placed: BuildItem[] = []
  let cost = 0
  for (const item of items) {
    const problem = validateItem(item, [...profile.build, ...placed], size)
    if (problem) return refuse(profile, problem)
    placed.push({ ...item })
    cost += itemCost(item)
  }
  if (cost > profile.cash) return refuse(profile, `You need ${money(cost - profile.cash)} more.`)
  profile.build.push(...placed)
  return accept(profile, -cost, `Built for ${money(cost)}.`)
}

function demolish(profile: Profile, ids: string[]): ActResult {
  const wanted = new Set(Array.isArray(ids) ? ids : [])
  const removed = profile.build.filter((item) => wanted.has(item.id))
  if (removed.length === 0) return refuse(profile, 'Nothing to demolish.')
  const refund = removed.reduce((sum, item) => sum + itemRefund(item), 0)
  profile.build = profile.build.filter((item) => !wanted.has(item.id))
  return accept(profile, refund, `Demolished for a ${money(refund)} refund.`)
}

function claimLot(profile: Profile, index: number, ctx: ActionContext): ActResult {
  if (!Number.isInteger(index) || index < 0 || index >= LOTS.length) return refuse(profile, 'There is no such lot.')
  if (profile.lot === index) return accept(profile, 0, 'That lot is already yours.')
  if (profile.lot !== null && profile.build.length > 0) return refuse(profile, 'Demolish what you built before moving to another lot.')
  if (ctx.lotFree && !ctx.lotFree(index)) return refuse(profile, 'Someone already has that lot.')
  profile.lot = index
  return accept(profile, 0, `Lot ${index + 1} is yours.`)
}

function odometer(profile: Profile, uid: string, km: number, fuelUsedL: number): ActResult {
  const truck = profile.trucks.find((entry) => entry.uid === uid)
  if (!truck) return refuse(profile, 'You do not own that truck.')
  const driven = Number.isFinite(km) ? Math.max(0, Math.min(MAX_ODOMETER_KM_PER_UPDATE, km)) : 0
  const burned = Number.isFinite(fuelUsedL) ? Math.max(0, Math.min(driven * MAX_FUEL_PER_KM, fuelUsedL)) : 0
  truck.odometerKm += driven
  truck.fuelL = Math.max(0, truck.fuelL - burned)
  return accept(profile, 0, 'Trip recorded.')
}

/** Applies one action to a copy of `profile`; the input is never changed. */
export function applyAction(profile: Profile, action: TruckAction, ctx: ActionContext): ActResult {
  const next = structuredClone(profile)
  const result = run(next, action, ctx)
  return result.ok ? result : { ...result, profile }
}

function run(profile: Profile, action: TruckAction, ctx: ActionContext): ActResult {
  switch (action.action) {
    case 'buy-truck': return buyTruck(profile, action)
    case 'buy-trailer': return buyTrailer(profile, action)
    case 'sell-truck': return sellTruck(profile, action.uid)
    case 'sell-trailer': return sellTrailer(profile, action.uid)
    case 'customize': return customize(profile, action.uid, action.look)
    case 'select': return select(profile, action.truck, action.trailer)
    case 'accept-job': return acceptJob(profile, action.job, ctx)
    case 'complete-job': return completeJob(profile, action.job, action.damage, ctx)
    case 'abandon-job':
      if (!profile.job) return refuse(profile, 'You have no job to abandon.')
      profile.job = null
      return accept(profile, 0, 'Job abandoned.')
    case 'refuel': return refuel(profile, action.uid, action.litres)
    case 'repair': return repair(profile, action.uid)
    case 'build': return build(profile, action.items, ctx)
    case 'demolish': return demolish(profile, action.ids)
    case 'rename': {
      const company = cleanCompany(action.company)
      if (!company) return refuse(profile, 'Enter a company name.')
      profile.company = company
      return accept(profile, 0, 'Company renamed.')
    }
    case 'claim-lot': return claimLot(profile, action.index, ctx)
    case 'odometer': return odometer(profile, action.uid, action.km, action.fuelUsedL)
    default: return refuse(profile, 'Unknown action.')
  }
}
