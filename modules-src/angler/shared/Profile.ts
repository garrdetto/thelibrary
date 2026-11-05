/** The angler's saved profile: Tackle Credits, what they own and wear, boat paint, lifetime stats and achievements. Normalised the same way in the page and the Worker. */
import { BOATS, DEFAULT_PAINT, boatKinds, normalizePaint } from './Boats'
import type { BoatKind, BoatPaint } from './Boats'
import { RODS } from './Gear'
import type { Rig, RodId } from './Gear'
import { LAKES, isLakeId } from './Lakes'
import type { LakeId } from './Lakes'
import { SPECIES, isSpeciesId } from './Species'
import type { Presentation, SpeciesId } from './Species'
import { DEFAULT_LOOK, normalizeLook } from './Wardrobe'
import type { Look } from './Wardrobe'

export interface SpeciesStats {
  n: number
  /** Best landed weight, tenths of an ounce. */
  best: number
}

export interface Stats {
  landed: number
  lost: number
  missed: number
  tcEarned: number
  seconds: number
  nightSeconds: number
  miles: number
  bySpecies: Partial<Record<SpeciesId, SpeciesStats>>
  lakes: LakeId[]
  tiers: Record<string, number>
  months: number[]
  lastDaily: string
  social: number
  records: number
}

export interface AnglerProfile {
  tc: number
  rods: RodId[]
  boats: BoatKind[]
  /** Wardrobe and boat cosmetic item ids owned. */
  items: string[]
  reel: number
  motor: number
  sonar: number
  rig: Rig
  boat: BoatKind
  look: Look
  paint: Record<BoatKind, BoatPaint>
  stats: Stats
  /** Achievement id → highest tier earned (1-4). */
  achievements: Record<string, number>
}

export const STARTER_RODS: RodId[] = ['panfish', 'walleye']

export function emptyStats(): Stats {
  return { landed: 0, lost: 0, missed: 0, tcEarned: 0, seconds: 0, nightSeconds: 0, miles: 0, bySpecies: {}, lakes: [], tiers: {}, months: [], lastDaily: '', social: 0, records: 0 }
}

export function defaultProfile(): AnglerProfile {
  return {
    tc: 0, rods: [...STARTER_RODS], boats: ['bass'], items: [], reel: 0, motor: 0, sonar: 0,
    rig: { rod: 'walleye', presentation: 'jig' }, boat: 'bass', look: { ...DEFAULT_LOOK },
    paint: { bass: { ...DEFAULT_PAINT }, jon: { ...DEFAULT_PAINT, primary: 'olive', seats: 'tan', motor: 'charcoal' }, pontoon: { ...DEFAULT_PAINT, primary: 'navy', seats: 'cream', carpet: 'sand', motor: 'white' } },
    stats: emptyStats(), achievements: {},
  }
}

const num = (v: unknown, min = 0, max = 1e12) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min)

export function normalizeProfile(input: unknown): AnglerProfile {
  const base = defaultProfile()
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const rods = Array.isArray(s.rods) ? s.rods.filter((r): r is RodId => typeof r === 'string' && r in RODS) : []
  const boats = Array.isArray(s.boats) ? s.boats.filter((b): b is BoatKind => typeof b === 'string' && (boatKinds as readonly string[]).includes(b)) : []
  const ownedRods = [...new Set([...STARTER_RODS, ...rods])]
  const ownedBoats = [...new Set<BoatKind>(['bass', ...boats])]
  const rigIn = (s.rig && typeof s.rig === 'object' ? s.rig : {}) as Record<string, unknown>
  const rod = typeof rigIn.rod === 'string' && ownedRods.includes(rigIn.rod as RodId) ? (rigIn.rod as RodId) : base.rig.rod
  const presentation = typeof rigIn.presentation === 'string' && RODS[rod].presentations.includes(rigIn.presentation as Presentation) ? (rigIn.presentation as Presentation) : RODS[rod].presentations[0]
  const paintIn = (s.paint && typeof s.paint === 'object' ? s.paint : {}) as Record<string, unknown>
  const paint = Object.fromEntries(boatKinds.map(k => [k, paintIn[k] ? normalizePaint(paintIn[k]) : base.paint[k]])) as Record<BoatKind, BoatPaint>
  const st = (s.stats && typeof s.stats === 'object' ? s.stats : {}) as Record<string, unknown>
  const bySpeciesIn = (st.bySpecies && typeof st.bySpecies === 'object' ? st.bySpecies : {}) as Record<string, unknown>
  const bySpecies: Partial<Record<SpeciesId, SpeciesStats>> = {}
  for (const [k, v] of Object.entries(bySpeciesIn)) {
    if (!isSpeciesId(k) || !v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    bySpecies[k] = { n: num(r.n), best: num(r.best) }
  }
  const tiersIn = (st.tiers && typeof st.tiers === 'object' ? st.tiers : {}) as Record<string, unknown>
  const achievementsIn = (s.achievements && typeof s.achievements === 'object' ? s.achievements : {}) as Record<string, unknown>
  return {
    tc: Math.floor(num(s.tc)),
    rods: ownedRods,
    boats: ownedBoats,
    items: Array.isArray(s.items) ? [...new Set(s.items.filter((i): i is string => typeof i === 'string' && i.length < 60))].slice(0, 400) : [],
    reel: Math.floor(num(s.reel, 0, 3)),
    motor: Math.floor(num(s.motor, 0, 3)),
    sonar: Math.floor(num(s.sonar, 0, 2)),
    rig: { rod, presentation },
    boat: typeof s.boat === 'string' && ownedBoats.includes(s.boat as BoatKind) ? (s.boat as BoatKind) : 'bass',
    look: s.look ? normalizeLook(s.look) : base.look,
    paint,
    stats: {
      landed: num(st.landed), lost: num(st.lost), missed: num(st.missed), tcEarned: num(st.tcEarned), seconds: num(st.seconds), nightSeconds: num(st.nightSeconds), miles: num(st.miles),
      bySpecies,
      lakes: Array.isArray(st.lakes) ? st.lakes.filter(isLakeId) : [],
      tiers: Object.fromEntries(Object.entries(tiersIn).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, num(v)])),
      months: Array.isArray(st.months) ? [...new Set(st.months.filter((m): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) < 12))] : [],
      lastDaily: typeof st.lastDaily === 'string' ? st.lastDaily.slice(0, 10) : '',
      social: num(st.social), records: num(st.records),
    },
    achievements: Object.fromEntries(Object.entries(achievementsIn).filter(([, v]) => Number.isInteger(v)).map(([k, v]) => [k, Math.min(4, Math.max(0, v as number))])),
  }
}

export function lakeOpen(profile: AnglerProfile, lake: LakeId): boolean {
  return profile.stats.landed >= LAKES[lake].opensAt
}

export function speciesSeen(profile: AnglerProfile): number {
  return Object.values(profile.stats.bySpecies).filter(s => s && s.best > 0).length
}

export const ozToLb = (oz10: number) => oz10 / 160
export const lbToOz10 = (lb: number) => Math.round(lb * 160)

export function speciesName(id: SpeciesId): string {
  return SPECIES[id].name
}

export function boatName(kind: BoatKind): string {
  return BOATS[kind].name
}
