/**
 * Haul jobs. Every 30-minute slot offers the same jobs to everyone, generated from a seeded hash of the world id and the slot,
 * so the Worker can check a job it never stored by regenerating it from its id (`<world>-<slot>-<n>`). Pay grows with mass and
 * distance, loses up to 40 % for cargo damage and gains 15 % for arriving on time.
 */
import { CARGOS } from './Catalog'
import type { CargoSpec, HaulKind } from './Catalog'
import type { HaulWorld } from './HaulWorld'
import type { Zone, ZoneKind } from './WorldLayout'

export interface Job {
  id: string
  world: string
  cargo: string
  haul: HaulKind
  massKg: number
  from: string
  to: string
  distanceM: number
  pay: number
  minutes: number
}

export interface JobResult {
  damage: number
  elapsedMs: number
}

export interface JobPayout {
  pay: number
  bonus: number
  penalty: number
  clean?: number
}

export const JOB_SLOT_MS = 30 * 60 * 1000
export const DEFAULT_JOB_COUNT = 16
export const MAX_JOB_INDEX = 64
export const ON_TIME_BONUS = 0.15
export const MAX_DAMAGE_PENALTY = 0.4
const AVERAGE_KPH = 45
const MINIMUM_KPH = 90

export const HAUL_ORDER: HaulKind[] = ['dump', 'tanker', 'flatbed', 'grain', 'reefer', 'lowboy']

const LOADING_MINUTES: Record<HaulKind, number> = { dump: 4, tanker: 8, flatbed: 12, grain: 8, reefer: 10, lowboy: 20 }

const PICKUP_KINDS: Record<HaulKind, ZoneKind[]> = {
  dump: ['dumpLoad'],
  tanker: ['tankLoad'],
  flatbed: ['flatLoad'],
  grain: ['grainLoad'],
  reefer: ['reeferDock'],
  lowboy: ['equipPickup'],
}

const DROP_KINDS: Record<HaulKind, ZoneKind[]> = {
  dump: ['dumpUnload'],
  tanker: ['tankUnload'],
  flatbed: ['flatUnload'],
  grain: ['grainUnload'],
  reefer: ['reeferDock'],
  lowboy: ['equipDrop'],
}

function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

/** Index of the 30-minute slot containing `now` (milliseconds). */
export function jobSlot(now: number): number {
  return Math.floor(now / JOB_SLOT_MS)
}

function zonesFor(world: HaulWorld, kinds: ZoneKind[]): Zone[] {
  return kinds.flatMap((kind) => world.zonesOfKind(kind))
}

function generateJob(world: HaulWorld, slot: number, index: number): Job | null {
  const random = seeded(hashString(`${world.id}|${slot}|${index}`))
  const rotation = index < HAUL_ORDER.length ? (index + Math.abs(slot)) % HAUL_ORDER.length : Math.floor(random() * HAUL_ORDER.length)
  for (let attempt = 0; attempt < HAUL_ORDER.length; attempt++) {
    const haul = HAUL_ORDER[(rotation + attempt) % HAUL_ORDER.length]
    const pickups = zonesFor(world, PICKUP_KINDS[haul])
    const drops = zonesFor(world, DROP_KINDS[haul])
    const cargos = CARGOS.filter((cargo) => cargo.haul === haul)
    if (pickups.length === 0 || drops.length === 0 || cargos.length === 0) continue
    const reverse = haul === 'lowboy' && random() < 0.5
    const first = pick(reverse ? drops : pickups, random)
    const candidates = (reverse ? pickups : drops).filter((zone) => zone.id !== first.id && (haul !== 'reefer' || zone.site !== first.site))
    if (candidates.length === 0) continue
    const second = pick(candidates, random)
    const cargo: CargoSpec = pick(cargos, random)
    const share = random()
    const massKg = Math.round((cargo.minKg + (cargo.maxKg - cargo.minKg) * share * share) / 100) * 100
    const distanceM = Math.round(world.routeDistance(first, second))
    if (!Number.isFinite(distanceM) || distanceM <= 0) continue
    const tonnes = massKg / 1000
    const kilometres = distanceM / 1000
    const pay = Math.round((cargo.baseFee + cargo.ratePerTonKm * tonnes * kilometres) / 10) * 10
    const minutes = Math.max(5, Math.round((kilometres / AVERAGE_KPH) * 60 + LOADING_MINUTES[haul]))
    return { id: `${world.id}-${slot}-${index}`, world: world.id, cargo: cargo.id, haul, massKg, from: first.id, to: second.id, distanceM, pay, minutes }
  }
  return null
}

/** The jobs on offer in `slot`, deterministic for a world id and slot. The first six cover every haul kind. */
export function generateJobs(world: HaulWorld, slot: number, count = DEFAULT_JOB_COUNT): Job[] {
  const jobs: Job[] = []
  for (let index = 0; index < count; index++) {
    const job = generateJob(world, slot, index)
    if (job) jobs.push(job)
  }
  return jobs
}

/** Regenerates one job from its id, or null when the id is not one this world would have offered. */
export function findJob(world: HaulWorld, id: string): Job | null {
  const match = /^(.+)-(\d+)-(\d+)$/.exec(id)
  if (!match || match[1] !== world.id) return null
  const slot = Number(match[2])
  const index = Number(match[3])
  if (!Number.isSafeInteger(slot) || index >= MAX_JOB_INDEX) return null
  const job = generateJob(world, slot, index)
  return job && job.id === id ? job : null
}

/** The fastest a job can honestly be driven: its road distance at 90 km/h. */
export function minimumMs(job: Job): number {
  return (job.distanceM / ((MINIMUM_KPH * 1000) / 3600)) * 1000
}

/** What a finished job pays: the fee, less damage scaled by how fragile the cargo is, plus the on-time bonus. */
export function jobPayout(job: Job, result: JobResult): JobPayout {
  const cargo = CARGOS.find((entry) => entry.id === job.cargo)
  const damage = Number.isFinite(result.damage) ? Math.max(0, Math.min(1, result.damage)) : 0
  const sensitivity = 0.3 + 0.7 * (cargo?.fragile ?? 0)
  const penalty = Math.round(job.pay * MAX_DAMAGE_PENALTY * damage * sensitivity)
  const onTime = result.elapsedMs <= job.minutes * 60_000
  const bonus = onTime ? Math.round(job.pay * ON_TIME_BONUS) : 0
  return { pay: job.pay - penalty + bonus, bonus, penalty }
}
