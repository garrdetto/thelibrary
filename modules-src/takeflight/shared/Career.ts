/**
 * Career rules, shared by the page (guests, and the instant debrief) and the Worker (signed-in saves, which it recomputes):
 * XP per flight, career level 1–100, licences Student → Private → Instrument → Multi-engine → Commercial → Airline Transport
 * with scored checkrides, type ratings, hours per class, and the Pilot Rating (a recency-weighted mean of recent scores per class
 * and overall). A flight arrives as a `FlightSummary` built from its `FlightScore`; `applyFlight` returns the new profile and
 * what changed. Pure and deterministic; uses `SimMath.pow` only.
 */
import type { AircraftSpec } from './AircraftSpec'
import type { AssistSettings } from '../sim/Assists'
import type { CategoryId, FlightScore } from '../sim/Scoring'
import { pow } from '../sim/SimMath'
import type { StartKind } from '../sim/Starts'
import { WEATHER_XP } from './Weather'
import type { WeatherKind } from './Weather'

export const CAREER_VERSION = 1
export const MAX_LEVEL = 100

export type PilotClass = 'single' | 'multi' | 'turboprop' | 'jet'
export type LicenceId = 'student' | 'ppl' | 'instrument' | 'multi' | 'commercial' | 'atp'
export type CheckrideId = Exclude<LicenceId, 'student'>
export type WindKind = 'calm' | 'light' | 'crosswind' | 'gusty'
export type TimeKind = 'morning' | 'noon' | 'evening' | 'night'

export const PILOT_CLASSES: readonly PilotClass[] = ['single', 'multi', 'turboprop', 'jet']
export const LICENCES: readonly LicenceId[] = ['student', 'ppl', 'instrument', 'multi', 'commercial', 'atp']
export const CHECKRIDES: readonly CheckrideId[] = ['ppl', 'instrument', 'multi', 'commercial', 'atp']
export const CLASS_LABELS: Record<PilotClass, string> = { single: 'Single-engine', multi: 'Multi-engine', turboprop: 'Turboprop', jet: 'Jet' }
export const LICENCE_LABELS: Record<LicenceId, string> = {
  student: 'Student Pilot',
  ppl: 'Private Pilot',
  instrument: 'Instrument Rating',
  multi: 'Multi-engine Rating',
  commercial: 'Commercial Pilot',
  atp: 'Airline Transport Pilot',
}

export function pilotClassOf(category: AircraftSpec['category']): PilotClass {
  if (category === 'trainer' || category === 'complex') return 'single'
  if (category === 'twin') return 'multi'
  if (category === 'turboprop') return 'turboprop'
  return 'jet'
}

export interface CheckrideRecord {
  passed: boolean
  attempts: number
  best: number
  at: number
}

export interface RecentFlight {
  at: number
  aircraft: string
  total: number
  xp: number
  checkride: CheckrideId | null
  passed: boolean | null
}

export interface CareerProfile {
  version: number
  xp: number
  flights: number
  landings: number
  /** Seconds flown per class. */
  seconds: Record<PilotClass, number>
  licences: LicenceId[]
  /** Aircraft families the pilot is rated on. */
  typeRatings: string[]
  checkrides: Partial<Record<CheckrideId, CheckrideRecord>>
  /** Newest-first flight totals per class (at most `RATING_FLIGHTS`). */
  ratings: Record<PilotClass, number[]>
  bestLanding: { sinkFpm: number; g: number; total: number; at: number } | null
  recent: RecentFlight[]
  /** When the last flight was saved (ms), for plausibility checks. */
  lastAt: number
}

export interface FlightSummary {
  aircraft: string
  airport: string
  start: StartKind
  wind: WindKind
  weather: WeatherKind
  time: TimeKind
  /** Seconds flown since the last summary of this flight (all of it for a first summary). */
  seconds: number
  /** True when this continues a flight already summarised once (Keep flying). */
  resumed: boolean
  total: number
  crashed: boolean
  assists: AssistSettings
  /** True when the HUD showed only the essentials and no glidepath guidance (instrument checkride). */
  instrumentsOnly: boolean
  /** Scores of the categories flown, 0..100. */
  categories: Partial<Record<CategoryId, number>>
  /** Metric scores 0..1 keyed `category.metric`. */
  metrics: Record<string, number>
  landing: { tick: number; sinkFpm: number; g: number; centreline: number; fromAim: number; bounces: number; onRunway: boolean } | null
  checkride: CheckrideId | null
}

export interface CheckrideSetup {
  /** Checkrides are flown from Harrow Field. */
  airport: string
  start: StartKind
  wind: WindKind
  weather: WeatherKind
  time: TimeKind
  instrumentsOnly: boolean
}

export interface Criterion {
  label: string
  test(summary: FlightSummary): boolean
}

export interface CheckrideSpec {
  id: CheckrideId
  title: string
  brief: string
  /** Licences that must be held first. */
  needs: LicenceId[]
  level: number
  hours: number
  /** The class the checkride is flown in. */
  pilotClass: PilotClass
  setup: CheckrideSetup
  criteria: Criterion[]
}

const noAssists: Criterion = { label: 'No assists', test: (s) => !s.assists.autoTrim && !s.assists.stallProtection && !s.assists.landingGuidance }
const noCrash: Criterion = { label: 'No crash', test: (s) => !s.crashed }
const onRunway: Criterion = { label: 'Landed on the runway', test: (s) => s.landing !== null && s.landing.onRunway }
const noBounce: Criterion = { label: 'No bounces', test: (s) => s.landing !== null && s.landing.bounces === 0 }
const category = (id: CategoryId, min: number, label: string): Criterion => ({ label: `${label} ${min} or better`, test: (s) => (s.categories[id] ?? 0) >= min })
const metricAtLeast = (key: string, min: number, label: string): Criterion => ({ label, test: (s) => (s.metrics[key] ?? 0) >= min })

export const CHECKRIDE_SPECS: Record<CheckrideId, CheckrideSpec> = {
  ppl: {
    id: 'ppl',
    title: 'Private Pilot checkride',
    brief: 'Take off from runway 09 with a 12 kt crosswind, fly a circuit, land and stop on the runway. No assists.',
    needs: ['student'],
    level: 3,
    hours: 0.5,
    pilotClass: 'single',
    setup: { airport: 'harrow', start: 'runway1', wind: 'crosswind', weather: 'fair', time: 'noon', instrumentsOnly: false },
    criteria: [noAssists, noCrash, onRunway, category('landing', 70, 'Landing'), category('procedure', 75, 'Procedure'), { label: 'Total 70 or better', test: (s) => s.total >= 70 }, { label: 'At least 2 minutes flown', test: (s) => s.seconds >= 120 }],
  },
  instrument: {
    id: 'instrument',
    title: 'Instrument Rating checkride',
    brief: 'A 3-mile final to runway 09 in fog, on the gauges: only the essential HUD figures, no glidepath guidance. Hold the glidepath and centreline to touchdown.',
    needs: ['ppl'],
    level: 8,
    hours: 2,
    pilotClass: 'single',
    setup: { airport: 'harrow', start: 'final1', wind: 'light', weather: 'fog', time: 'evening', instrumentsOnly: true },
    criteria: [noAssists, noCrash, onRunway, { label: 'Flown on instruments', test: (s) => s.instrumentsOnly }, category('approach', 80, 'Approach'), metricAtLeast('approach.glidepath', 0.75, 'Glidepath within about 0.8 dots'), metricAtLeast('approach.tracking', 0.75, 'Centreline tracking within about 1.3°'), category('landing', 65, 'Landing')],
  },
  multi: {
    id: 'multi',
    title: 'Multi-engine checkride',
    brief: 'A circuit in a twin with an engine failure after take-off.',
    needs: ['ppl'],
    level: 12,
    hours: 5,
    pilotClass: 'multi',
    setup: { airport: 'harrow', start: 'runway1', wind: 'light', weather: 'fair', time: 'noon', instrumentsOnly: false },
    criteria: [noAssists, noCrash, onRunway, category('landing', 75, 'Landing'), category('procedure', 85, 'Procedure')],
  },
  commercial: {
    id: 'commercial',
    title: 'Commercial Pilot checkride',
    brief: 'Depart runway 27 in gusty wind, fly a circuit and land with commercial precision. No assists, no bounces.',
    needs: ['instrument'],
    level: 20,
    hours: 10,
    pilotClass: 'single',
    setup: { airport: 'harrow', start: 'runway2', wind: 'gusty', weather: 'overcast', time: 'morning', instrumentsOnly: false },
    criteria: [noAssists, noCrash, onRunway, noBounce, category('landing', 80, 'Landing'), category('smoothness', 80, 'Smoothness'), category('procedure', 90, 'Procedure'), { label: 'Total 85 or better', test: (s) => s.total >= 85 }],
  },
  atp: {
    id: 'atp',
    title: 'Airline Transport Pilot checkride',
    brief: 'A full flight in a multi-crew aircraft to airline standards.',
    needs: ['commercial', 'multi'],
    level: 35,
    hours: 25,
    pilotClass: 'jet',
    setup: { airport: 'harrow', start: 'runway1', wind: 'crosswind', weather: 'fair', time: 'noon', instrumentsOnly: false },
    criteria: [noAssists, noCrash, onRunway, noBounce, category('landing', 85, 'Landing'), category('approach', 85, 'Approach'), category('smoothness', 85, 'Smoothness'), { label: 'Total 90 or better', test: (s) => s.total >= 90 }],
  },
}

const RATING_FLIGHTS = 20
const RATING_DECAY = 0.85
const RECENT_FLIGHTS = 10
const MIN_SECONDS = 30
const MAX_FLIGHT_XP = 2500
const WIND_FACTOR: Record<WindKind, number> = { calm: 1, light: 1.1, crosswind: 1.3, gusty: 1.5 }

export function defaultCareer(): CareerProfile {
  return {
    version: CAREER_VERSION,
    xp: 0,
    flights: 0,
    landings: 0,
    seconds: { single: 0, multi: 0, turboprop: 0, jet: 0 },
    licences: ['student'],
    typeRatings: ['wren'],
    checkrides: {},
    ratings: { single: [], multi: [], turboprop: [], jet: [] },
    bestLanding: null,
    recent: [],
    lastAt: 0,
  }
}

/** Total XP needed to reach `level` (level 1 needs none). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.round(120 * pow(level - 1, 1.7))
}

export function levelFor(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++
  return level
}

/** Share of the way from the current level to the next, 0..1 (1 at the top level). */
export function levelProgress(xp: number): number {
  const level = levelFor(xp)
  if (level >= MAX_LEVEL) return 1
  const from = xpForLevel(level)
  return (xp - from) / (xpForLevel(level + 1) - from)
}

export function hoursTotal(profile: CareerProfile): number {
  let seconds = 0
  for (const c of PILOT_CLASSES) seconds += profile.seconds[c]
  return seconds / 3600
}

/** The newest licence held, for the title under the pilot's name. */
export function currentLicence(profile: CareerProfile): LicenceId {
  let best: LicenceId = 'student'
  for (const licence of LICENCES) if (profile.licences.includes(licence)) best = licence
  return best
}

/** Recency-weighted mean of a class's recent scores, or null with fewer than three flights. */
export function classRating(profile: CareerProfile, pilotClass: PilotClass): number | null {
  const scores = profile.ratings[pilotClass]
  if (scores.length < 3) return null
  let sum = 0
  let weights = 0
  let weight = 1
  for (const score of scores) {
    sum += score * weight
    weights += weight
    weight *= RATING_DECAY
  }
  return Math.round((sum / weights) * 10) / 10
}

/** Overall Pilot Rating: class ratings weighted by hours in each class. */
export function pilotRating(profile: CareerProfile): number | null {
  let sum = 0
  let weights = 0
  for (const c of PILOT_CLASSES) {
    const rating = classRating(profile, c)
    if (rating === null) continue
    const weight = profile.seconds[c] + 60
    sum += rating * weight
    weights += weight
  }
  return weights > 0 ? Math.round((sum / weights) * 10) / 10 : null
}

export interface Availability {
  available: boolean
  reasons: string[]
}

/** Whether the pilot may take a checkride now, and what is missing if not. `classes` lists the classes in the hangar. */
export function checkrideAvailability(profile: CareerProfile, id: CheckrideId, classes: readonly PilotClass[]): Availability {
  const spec = CHECKRIDE_SPECS[id]
  const reasons: string[] = []
  if (profile.licences.includes(id)) reasons.push('Already held')
  for (const need of spec.needs) if (!profile.licences.includes(need)) reasons.push(`Needs the ${LICENCE_LABELS[need]}`)
  const level = levelFor(profile.xp)
  if (level < spec.level) reasons.push(`Needs career level ${spec.level} (you are ${level})`)
  const hours = hoursTotal(profile)
  if (hours < spec.hours) reasons.push(`Needs ${spec.hours} h flown (you have ${hours.toFixed(1)} h)`)
  if (!classes.includes(spec.pilotClass)) reasons.push(`Needs a ${CLASS_LABELS[spec.pilotClass].toLowerCase()} aircraft, not in the hangar yet`)
  return { available: reasons.length === 0, reasons }
}

export interface CriterionResult {
  label: string
  passed: boolean
}

export function evaluateCheckride(id: CheckrideId, summary: FlightSummary): { passed: boolean; criteria: CriterionResult[] } {
  const criteria = CHECKRIDE_SPECS[id].criteria.map((c) => ({ label: c.label, passed: c.test(summary) }))
  return { passed: criteria.every((c) => c.passed), criteria }
}

/** XP for a flight segment: score × duration × wind × night, plus a landing bonus; nothing for a crash or a hop under 30 s. */
export function flightXp(summary: FlightSummary): number {
  if (summary.crashed || summary.seconds < MIN_SECONDS) return 0
  const minutes = summary.seconds / 60
  const duration = Math.min(3, 0.5 + minutes / 10)
  const night = summary.time === 'night' ? 1.2 : 1
  let xp = summary.total * 2 * duration * WIND_FACTOR[summary.wind] * (WEATHER_XP[summary.weather] ?? 1) * night
  if (summary.landing && summary.landing.onRunway) xp += 20 + (summary.categories.landing ?? 0)
  return Math.min(MAX_FLIGHT_XP, Math.round(xp))
}

export interface FlightResult {
  profile: CareerProfile
  xp: number
  levelBefore: number
  levelAfter: number
  ratingBefore: number | null
  ratingAfter: number | null
  checkride: { id: CheckrideId; passed: boolean; criteria: CriterionResult[]; bonus: number } | null
  licence: LicenceId | null
}

export interface FlightContext {
  now: number
  pilotClass: PilotClass
  family: string
  /** Classes in the hangar (checkrides need one). */
  classes: readonly PilotClass[]
}

/** Adds a flight to the career. Never mutates `profile`. */
export function applyFlight(profile: CareerProfile, summary: FlightSummary, context: FlightContext): FlightResult {
  const next: CareerProfile = {
    ...profile,
    seconds: { ...profile.seconds },
    licences: [...profile.licences],
    typeRatings: [...profile.typeRatings],
    checkrides: { ...profile.checkrides },
    ratings: { single: [...profile.ratings.single], multi: [...profile.ratings.multi], turboprop: [...profile.ratings.turboprop], jet: [...profile.ratings.jet] },
    recent: [...profile.recent],
  }
  const levelBefore = levelFor(profile.xp)
  const ratingBefore = pilotRating(profile)
  let xp = flightXp(summary)
  let checkride: FlightResult['checkride'] = null
  let licence: LicenceId | null = null
  if (summary.checkride && !summary.resumed) {
    const id = summary.checkride
    const availability = checkrideAvailability(profile, id, context.classes)
    const evaluation = evaluateCheckride(id, summary)
    const passed = availability.available && evaluation.passed
    const bonus = passed ? 400 + CHECKRIDE_SPECS[id].level * 40 : 0
    xp += bonus
    const before = profile.checkrides[id]
    next.checkrides[id] = { passed: passed || (before?.passed ?? false), attempts: (before?.attempts ?? 0) + 1, best: Math.max(before?.best ?? 0, summary.total), at: context.now }
    checkride = { id, passed, criteria: availability.available ? evaluation.criteria : [{ label: availability.reasons.join('; '), passed: false }, ...evaluation.criteria], bonus }
    if (passed && !next.licences.includes(id)) {
      next.licences.push(id)
      licence = id
    }
  }
  next.xp = profile.xp + xp
  next.seconds[context.pilotClass] += Math.max(0, summary.seconds)
  if (!summary.resumed) next.flights++
  const landed = summary.landing !== null && summary.landing.onRunway && !summary.crashed
  if (landed) next.landings++
  if (!next.typeRatings.includes(context.family)) next.typeRatings.push(context.family)
  if (summary.seconds >= MIN_SECONDS || summary.crashed) {
    const list = next.ratings[context.pilotClass]
    if (summary.resumed && list.length > 0) list[0] = summary.total
    else list.unshift(summary.total)
    if (list.length > RATING_FLIGHTS) list.length = RATING_FLIGHTS
  }
  if (landed && summary.landing && summary.landing.bounces === 0 && (!next.bestLanding || summary.landing.sinkFpm < next.bestLanding.sinkFpm)) {
    next.bestLanding = { sinkFpm: summary.landing.sinkFpm, g: summary.landing.g, total: summary.total, at: context.now }
  }
  next.recent.unshift({ at: context.now, aircraft: summary.aircraft, total: summary.total, xp, checkride: checkride ? checkride.id : null, passed: checkride ? checkride.passed : null })
  if (next.recent.length > RECENT_FLIGHTS) next.recent.length = RECENT_FLIGHTS
  next.lastAt = context.now
  return { profile: next, xp, levelBefore, levelAfter: levelFor(next.xp), ratingBefore, ratingAfter: pilotRating(next), checkride, licence }
}

/** Builds the summary the career and the Worker read from a scored flight. */
export function summarizeFlight(score: FlightScore, info: { aircraft: string; airport: string; start: StartKind; wind: WindKind; weather: WeatherKind; time: TimeKind; seconds: number; resumed: boolean; assists: AssistSettings; instrumentsOnly: boolean; checkride: CheckrideId | null }): FlightSummary {
  const categories: Partial<Record<CategoryId, number>> = {}
  const metrics: Record<string, number> = {}
  for (const c of score.categories) {
    if (c.score !== null) categories[c.id] = c.score
    for (const m of c.metrics) metrics[`${c.id}.${m.id}`] = m.score
  }
  const l = score.landing
  return {
    ...info,
    assists: { ...info.assists },
    total: score.total,
    crashed: score.crashed !== null,
    categories,
    metrics,
    landing: l ? { tick: l.tick, sinkFpm: l.sinkFpm, g: l.g, centreline: l.centreline, fromAim: l.fromAim, bounces: l.bounces, onRunway: l.surface === 'runway' } : null,
  }
}

/** Fills anything missing from a stored profile (older versions, hand-edited guests) with defaults. */
export function normalizeCareer(value: unknown): CareerProfile {
  const base = defaultCareer()
  if (!value || typeof value !== 'object') return base
  const v = value as Partial<CareerProfile>
  const num = (x: unknown, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : fallback)
  const seconds = { ...base.seconds }
  const ratings = { ...base.ratings }
  for (const c of PILOT_CLASSES) {
    seconds[c] = num(v.seconds?.[c])
    const list = v.ratings?.[c]
    ratings[c] = Array.isArray(list) ? list.filter((x) => typeof x === 'number' && x >= 0 && x <= 100).slice(0, RATING_FLIGHTS) : []
  }
  const licences = Array.isArray(v.licences) ? LICENCES.filter((l) => l === 'student' || v.licences?.includes(l)) : base.licences
  const checkrides: CareerProfile['checkrides'] = {}
  for (const id of CHECKRIDES) {
    const r = v.checkrides?.[id]
    if (r && typeof r === 'object') checkrides[id] = { passed: r.passed === true, attempts: num(r.attempts), best: Math.min(100, num(r.best)), at: num(r.at) }
  }
  return {
    version: CAREER_VERSION,
    xp: num(v.xp),
    flights: num(v.flights),
    landings: num(v.landings),
    seconds,
    licences,
    typeRatings: Array.isArray(v.typeRatings) ? v.typeRatings.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 40) : base.typeRatings,
    checkrides,
    ratings,
    bestLanding: v.bestLanding && typeof v.bestLanding === 'object' ? { sinkFpm: num(v.bestLanding.sinkFpm), g: num(v.bestLanding.g), total: num(v.bestLanding.total), at: num(v.bestLanding.at) } : null,
    recent: Array.isArray(v.recent) ? v.recent.slice(0, RECENT_FLIGHTS).filter((r) => r && typeof r === 'object').map((r) => ({ at: num(r.at), aircraft: String(r.aircraft ?? '').slice(0, 40), total: Math.min(100, num(r.total)), xp: num(r.xp), checkride: CHECKRIDES.includes(r.checkride as CheckrideId) ? (r.checkride as CheckrideId) : null, passed: typeof r.passed === 'boolean' ? r.passed : null })) : [],
    lastAt: num(v.lastAt),
  }
}
