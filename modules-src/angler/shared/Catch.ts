/** The catch model: how active the fish are at a spot, which species bites, how big it is (a log-normal per species, so the size curve is the rarity) and whether it is landed. Used by the Worker for signed-in anglers and by the page for guests and tests. */
import { moonIllumination, moonPhase, moonPosition, sunPosition } from './Astro'
import { bottomAt, depthFeetAt, waterTempF } from './Lakes'
import type { Bottom, LakeDef } from './Lakes'
import { PRESENTATIONS, RODS } from './Gear'
import type { Rig } from './Gear'
import { SPECIES, normalCdf, speciesIds, tierOf } from './Species'
import type { SpeciesId, Tier } from './Species'
import { weatherAt } from './Weather'
import type { Weather } from './Weather'
import { clamp, gaussian, smoothstep } from './Random'

export interface FishingContext {
  lake: LakeDef
  x: number
  z: number
  date: Date
  rig: Rig
  /** Seconds the boat has been still. */
  settled: number
  /** Other boats fishing within 30 m. */
  crowd: number
}

export interface Conditions {
  depth: number
  bottom: Bottom
  waterTemp: number
  surfaceTemp: number
  weather: Weather
  light: [number, number, number, number]
  season: 0 | 1 | 2 | 3
  month: number
  moon: number
  moonPhase: number
  thermocline: number
}

export function conditionsAt(ctx: Pick<FishingContext, 'lake' | 'x' | 'z' | 'date'>): Conditions {
  const { lake, x, z, date } = ctx
  const depth = depthFeetAt(lake, x, z)
  const sun = sunPosition(date)
  const night = 1 - smoothstep(-14, -4, sun.altitude)
  const twilight = smoothstep(-14, -3, sun.altitude) * (1 - smoothstep(6, 18, sun.altitude))
  const day = smoothstep(5, 18, sun.altitude)
  const morning = sun.azimuth < 180
  const sum = night + twilight + day || 1
  const light: [number, number, number, number] = [night / sum, morning ? twilight / sum : 0, day / sum, morning ? 0 : twilight / sum]
  const month = new Date(date.getTime() - 6 * 3600000).getUTCMonth()
  const season = (month >= 2 && month <= 4 ? 0 : month >= 5 && month <= 7 ? 1 : month >= 8 && month <= 10 ? 2 : 3) as 0 | 1 | 2 | 3
  const phase = moonPhase(date)
  const moonAlt = moonPosition(date).altitude
  const peak = Math.max(1 - Math.abs(phase - 0.5) * 8, 1 - Math.min(phase, 1 - phase) * 8, 0)
  const moon = 1 + 0.12 * peak + 0.12 * (1 - smoothstep(4, 10, Math.abs(moonAlt))) + 0.04 * moonIllumination(phase) * night
  return {
    depth, bottom: bottomAt(lake, x, z), waterTemp: waterTempF(lake, date, depth * 0.9), surfaceTemp: waterTempF(lake, date, 0),
    weather: weatherAt(lake, date), light, season, month, moon, moonPhase: phase, thermocline: lake.thermocline[month],
  }
}

export interface SpeciesChance {
  id: SpeciesId
  weight: number
}

export function speciesChances(ctx: FishingContext, c: Conditions = conditionsAt(ctx)): SpeciesChance[] {
  const out: SpeciesChance[] = []
  const lowLight = c.light[0] + c.light[1] + c.light[3]
  for (const id of speciesIds) {
    const s = SPECIES[id]
    const abundance = s.lakes[ctx.lake.id] ?? 0
    if (!abundance) continue
    let [lo, hi] = s.depth[c.season]
    if (['walleye', 'musky', 'pike', 'largemouth', 'smallmouth', 'crappie', 'sauger'].includes(id)) {
      lo *= 1 - 0.35 * lowLight
      hi *= 1 - 0.3 * lowLight
    }
    let depthFit = c.depth >= lo && c.depth <= hi ? 1 : c.depth > hi ? 0.55 : Math.max(0.04, Math.exp(-(((lo - c.depth) / 6) ** 2)))
    if (s.coldWater && c.thermocline > 0 && c.depth < c.thermocline + 6) depthFit *= 0.06
    if (c.depth < 1.5) depthFit *= 0.2
    const t = c.waterTemp
    const tempFit = t < s.temp[0] ? Math.max(0.25, 1 - (s.temp[0] - t) * 0.045) : t > s.temp[1] ? Math.max(0.2, 1 - (t - s.temp[1]) * 0.06) : 1
    const bottom = s.bottom[c.bottom] ?? 0.85
    const bait = s.baits[ctx.rig.presentation] ?? 0.06
    const light = s.light[0] * c.light[0] + s.light[1] * c.light[1] + s.light[2] * c.light[2] + s.light[3] * c.light[3]
    const month = s.months[c.month]
    const weight = abundance * depthFit * tempFit * bottom * bait * light * month
    if (weight > 0) out.push({ id, weight })
  }
  return out
}

export function weatherFactor(w: Weather): number {
  let f = 1
  if (w.pressureTrend < -0.03) f *= 1.15
  else if (w.pressureTrend > 0.04) f *= 0.82
  if (w.windMph >= 5 && w.windMph <= 16) f *= 1.08
  if (w.windMph > 22) f *= 0.85
  if (w.rain > 0.05 && w.rain < 0.6) f *= 1.06
  f *= 0.95 + w.cloud * 0.1
  return f
}

/** Bite activity: 1 is a decent spot, 0.15 a dead one, 3 a hot bite. */
export function activity(ctx: FishingContext, c: Conditions = conditionsAt(ctx), chances = speciesChances(ctx, c)): number {
  const total = chances.reduce((s, x) => s + x.weight, 0)
  const settle = 0.6 + 0.55 * smoothstep(0, 60, ctx.settled)
  const crowd = Math.pow(0.9, Math.max(0, ctx.crowd))
  return clamp((0.1 + total * 0.55) * weatherFactor(c.weather) * c.moon * settle * crowd, 0.15, 3)
}

export const BASE_BITE_SECONDS = 150
export const MIN_BITE_SECONDS = 45

export function biteDelay(act: number, random: () => number): number {
  const mean = BASE_BITE_SECONDS / act
  return Math.max(MIN_BITE_SECONDS, -Math.log(1 - random() * 0.999) * mean)
}

export type CatchKind = 'landed' | 'lost' | 'missed'

export interface CatchResult {
  kind: CatchKind
  species: SpeciesId
  weight: number
  length: number
  tier: Tier
  percentile: number
  fight: number
}

export function rollCatch(ctx: FishingContext, random: () => number, reelBonus = 0, c: Conditions = conditionsAt(ctx)): CatchResult {
  const chances = speciesChances(ctx, c)
  const total = chances.reduce((s, x) => s + x.weight, 0)
  let pick = random() * total
  let id: SpeciesId = chances[0]?.id ?? 'bluegill'
  for (const ch of chances) { pick -= ch.weight; if (pick <= 0) { id = ch.id; break } }
  const s = SPECIES[id]
  const bias = PRESENTATIONS[ctx.rig.presentation].size * 0.5 * (s.median > 1 ? 1 : 0.4)
  const z = gaussian(random) + bias
  let weight = s.median * Math.exp(s.sigma * z)
  const percentile = normalCdf(z)
  weight = clamp(weight, s.min, s.cap)
  const length = Math.cbrt((weight * 1000) / s.form) * (1 + gaussian(random) * 0.02)
  const tier = tierOf(percentile)
  const fight = clamp(4 + 8 * Math.sqrt(weight) * s.power, 5, 120)
  const result: CatchResult = { kind: 'landed', species: id, weight: Math.round(weight * 1000) / 1000, length: Math.round(length * 4) / 4, tier, percentile, fight: Math.round(fight * 10) / 10 }
  if (random() > 0.85) return { ...result, kind: 'missed', fight: 1.5 }
  const test = RODS[ctx.rig.rod].lineTest
  const load = (weight * s.power) / test
  const land = clamp(1 - 0.35 * load * load, 0.25, 0.97) + reelBonus
  if (random() > Math.min(0.99, land)) return { ...result, kind: 'lost', fight: Math.round(fight * (0.3 + random() * 0.5) * 10) / 10 }
  return result
}

const tierBonus: Record<Tier, number> = { Common: 1, Keeper: 1.5, Quality: 3, Trophy: 10, Legendary: 40 }

export function creditsFor(weight: number, tier: Tier): number {
  return Math.max(1, Math.round(12 * Math.pow(weight, 0.8) * tierBonus[tier]))
}

/** Plain-language bite outlook for the HUD. */
export function outlook(ctx: FishingContext, c: Conditions = conditionsAt(ctx)): { activity: number; text: string; top: SpeciesId[] } {
  const chances = speciesChances(ctx, c).sort((a, b) => b.weight - a.weight)
  const act = activity(ctx, c, chances)
  const word = act > 1.8 ? 'Hot bite' : act > 1.1 ? 'Good bite' : act > 0.6 ? 'Fair bite' : act > 0.3 ? 'Slow bite' : 'Dead water'
  const top = chances.slice(0, 3).map(x => x.id)
  return { activity: act, text: `${word}${top.length ? `: ${top.map(id => SPECIES[id].name.toLowerCase()).join(', ')}` : ''}`, top }
}

export { normalCdf }
