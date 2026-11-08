/**
 * Families: life stages, growing up, the social interactions between residents, and babies.
 * Ages are in sim days and follow the household clock, so children grow while the household plays
 * (and catch up when a resident comes home from a visit). Renderer-free and deterministic.
 */
import type { ActionDef } from './Catalog'
import { BODIES, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, type Look } from './Look'
import type { Need } from './Needs'

export const LIFE_STAGES = ['baby', 'toddler', 'child', 'teen', 'adult'] as const
export type LifeStage = (typeof LIFE_STAGES)[number]

/** Sim minutes in a sim day. */
export const DAY = 1440
/** The age in sim days each stage begins: a baby is a toddler after a day and grown up after nine. */
export const STAGE_START: Record<LifeStage, number> = { baby: 0, toddler: 1, child: 3, teen: 6, adult: 9 }
/** New grown-ups move in at this age. */
export const ADULT_AGE = 12
/** Residents made at move-in or added later may start at one of these stages. */
export const STARTING_STAGES = ['adult', 'teen', 'child'] as const
export type StartingStage = (typeof STARTING_STAGES)[number]
export const STARTING_AGE: Record<StartingStage, number> = { adult: ADULT_AGE, teen: 6.5, child: 3.5 }
/** A pregnancy lasts one sim day. */
export const PREGNANCY_MINUTES = DAY
/** How close two adults must be before they can try for a baby. */
export const BABY_FRIENDSHIP = 40
/** Chance that trying for a baby works. */
export const BABY_CHANCE = 0.75
/** Household members start out this close to each other. */
export const FAMILY_FRIENDSHIP = 30

export const STAGE_LABELS: Record<LifeStage, string> = { baby: 'Baby', toddler: 'Toddler', child: 'Child', teen: 'Teen', adult: 'Adult' }
/** How big each stage is drawn next to a grown-up. */
export const STAGE_SCALE: Record<LifeStage, number> = { baby: 0.4, toddler: 0.52, child: 0.68, teen: 0.9, adult: 1 }
/** Walking speed next to a grown-up: babies crawl, toddlers toddle. */
export const STAGE_SPEED: Record<LifeStage, number> = { baby: 0.4, toddler: 0.65, child: 1, teen: 1, adult: 1 }

export function stageOf(age: number): LifeStage {
  let out: LifeStage = 'baby'
  for (const stage of LIFE_STAGES) if (age >= STAGE_START[stage]) out = stage
  return out
}

export function stageRank(stage: LifeStage): number {
  return LIFE_STAGES.indexOf(stage)
}

export function atLeast(stage: LifeStage, min: LifeStage): boolean {
  return stageRank(stage) >= stageRank(min)
}

export function atMost(stage: LifeStage, max: LifeStage): boolean {
  return stageRank(stage) <= stageRank(max)
}

/** Sim days until the next stage, or null once grown up. */
export function daysToNextStage(age: number): number | null {
  const next = LIFE_STAGES[stageRank(stageOf(age)) + 1]
  return next ? Math.max(0, STAGE_START[next] - age) : null
}

export function nextStage(stage: LifeStage): LifeStage | null {
  return LIFE_STAGES[stageRank(stage) + 1] ?? null
}

export function sanitizeAge(input: unknown): number {
  const n = Number(input)
  return Number.isFinite(n) ? Math.max(0, Math.min(400, n)) : ADULT_AGE
}

export function growthLine(name: string, stage: LifeStage): string {
  switch (stage) {
    case 'toddler': return `${name} is a toddler now and starting to walk.`
    case 'child': return `${name} grew into a child!`
    case 'teen': return `${name} is a teenager now.`
    case 'adult': return `${name} grew up into an adult and can take a job.`
    default: return `${name} grew up a little.`
  }
}

/**
 * Who may use an action. Most things are for children and up; actions say otherwise with `ages`.
 * Sitting and watching TV are fine for toddlers too.
 */
export function actionAges(action: ActionDef): [LifeStage, LifeStage] {
  if (action.ages) return action.ages
  if (action.id === 'sit' || action.id === 'watch') return ['toddler', 'adult']
  return ['child', 'adult']
}

export function canDoAction(stage: LifeStage, action: ActionDef): boolean {
  const [min, max] = actionAges(action)
  return atLeast(stage, min) && atMost(stage, max)
}

export const STAGE_PLURALS: Record<LifeStage, string> = { baby: 'babies', toddler: 'toddlers', child: 'children', teen: 'teens', adult: 'adults' }

export function agesNote(action: ActionDef): string | null {
  const [min, max] = actionAges(action)
  if (min === 'child' && max === 'adult') return null
  if (min === max) return `${STAGE_PLURALS[min]} only`
  if (max === 'adult') return `${STAGE_PLURALS[min]} and up`
  return `${STAGE_PLURALS[min]} to ${STAGE_PLURALS[max]}`
}

// ---- Social interactions ----------------------------------------------------------------

export const SOCIAL_KINDS = ['chat', 'hug', 'play', 'feed', 'change', 'rock', 'flirt', 'baby'] as const
export type SocialKind = (typeof SOCIAL_KINDS)[number]

export interface SocialDef {
  label: (target: string) => string
  /** Longest it runs, in sim minutes. */
  minutes: number
  /** Gains per sim minute for whoever started it, and for the other person. */
  self: Partial<Record<Need, number>>
  other: Partial<Record<Need, number>>
  /** Friendship gained per sim minute. */
  friend: number
  /** Ends early once the other person's needs it feeds are full. */
  early: boolean
  /** Ages that may start it and ages it may be done to. */
  by: [LifeStage, LifeStage]
  to: [LifeStage, LifeStage]
  /** Only household members may start it (caring for the household's little ones, babies). */
  household?: boolean
  /** Needs this much friendship unless both live together. */
  friendship?: number
  bubble: string
}

export const SOCIALS: Record<SocialKind, SocialDef> = {
  chat: { label: t => `Chat with ${t}`, minutes: 25, self: { social: 0.9, fun: 0.2 }, other: { social: 0.9, fun: 0.2 }, friend: 0.12, early: true, by: ['child', 'adult'], to: ['toddler', 'adult'], bubble: 'How have you been?' },
  hug: { label: t => `Hug ${t}`, minutes: 8, self: { social: 2.2, fun: 0.3 }, other: { social: 2.2, fun: 0.3 }, friend: 0.6, early: false, by: ['toddler', 'adult'], to: ['toddler', 'adult'], friendship: 20, bubble: 'Come here, you!' },
  play: { label: t => `Play with ${t}`, minutes: 30, self: { fun: 0.6, social: 0.4 }, other: { fun: 1.6, social: 0.8 }, friend: 0.25, early: true, by: ['child', 'adult'], to: ['baby', 'child'], bubble: 'Peekaboo!' },
  feed: { label: t => `Feed ${t}`, minutes: 20, self: { social: 0.2 }, other: { hunger: 3.2, social: 0.3 }, friend: 0.15, early: true, by: ['teen', 'adult'], to: ['baby', 'toddler'], household: true, bubble: 'Here comes the airplane!' },
  change: { label: t => `Change ${t}`, minutes: 10, self: {}, other: { hygiene: 6, bladder: 9 }, friend: 0.1, early: true, by: ['teen', 'adult'], to: ['baby', 'toddler'], household: true, bubble: 'All fresh and clean.' },
  rock: { label: t => `Rock ${t} to sleep`, minutes: 60, self: { social: 0.1 }, other: { energy: 0.9, social: 0.2 }, friend: 0.1, early: true, by: ['teen', 'adult'], to: ['baby', 'toddler'], household: true, bubble: 'Shh, shh...' },
  flirt: { label: t => `Flirt with ${t}`, minutes: 20, self: { social: 1.4, fun: 0.6 }, other: { social: 1.4, fun: 0.6 }, friend: 0.8, early: false, by: ['adult', 'adult'], to: ['adult', 'adult'], friendship: 25, bubble: 'You look nice today.' },
  baby: { label: t => `Try for a baby with ${t}`, minutes: 30, self: { social: 1.2, fun: 1.0, energy: -0.05 }, other: { social: 1.2, fun: 1.0, energy: -0.05 }, friend: 0.5, early: false, by: ['adult', 'adult'], to: ['adult', 'adult'], household: true, friendship: BABY_FRIENDSHIP, bubble: 'Let\'s grow our family.' },
}

export interface SocialParty {
  id: string
  stage: LifeStage
  /** Lives in this household. */
  hh: boolean
  /** Household record id, so parents and siblings can be told apart. */
  rec?: string
  parents?: string[]
  expecting?: boolean
}

export interface SocialContext {
  /** Friendship between the two, -100 to 100. */
  friendship: number
  /** The household has room for another resident. */
  room: boolean
}

/** Parents and children, and brothers and sisters, never flirt or try for a baby with each other. */
export function related(a: SocialParty, b: SocialParty): boolean {
  if (!a.rec || !b.rec) return false
  if (a.parents?.includes(b.rec) || b.parents?.includes(a.rec)) return true
  return !!a.parents?.length && !!b.parents?.length && a.parents.some(p => b.parents!.includes(p))
}

/** Why one person can't start an interaction with another, or null when they can. */
export function socialBlock(kind: SocialKind, by: SocialParty, to: SocialParty, ctx: SocialContext): string | null {
  const def = SOCIALS[kind]
  if (!def) return 'That is not something Sims do.'
  if (!atLeast(by.stage, def.by[0]) || !atMost(by.stage, def.by[1])) {
    return def.by[0] === 'adult' ? 'Only adults can do that.' : def.by[0] === 'teen' ? 'Only teens and adults can do that.' : `${STAGE_PLURALS[by.stage][0].toUpperCase()}${STAGE_PLURALS[by.stage].slice(1)} can't do that yet.`
  }
  if (!atLeast(to.stage, def.to[0]) || !atMost(to.stage, def.to[1])) {
    if (def.to[1] === 'toddler') return 'That is for babies and toddlers.'
    if (def.to[1] === 'child') return 'That is for little ones.'
    if (def.to[0] === 'adult') return 'Only with another adult.'
    return 'They are too little for that.'
  }
  if (def.household && !(by.hh && to.hh)) return 'Only for people who live together.'
  if ((kind === 'flirt' || kind === 'baby') && related(by, to)) return 'They are family.'
  if (def.friendship !== undefined && !(by.hh && to.hh && kind !== 'baby') && ctx.friendship < def.friendship) return `They need to be closer first (${Math.round(ctx.friendship)} of ${def.friendship}).`
  if (kind === 'baby') {
    if (by.expecting || to.expecting) return 'A baby is already on the way.'
    if (!ctx.room) return 'The household is full.'
  }
  return null
}

/** Every interaction one person could start with another, with the reason when it is not possible right now. */
export function socialOptions(by: SocialParty, to: SocialParty & { name: string }, ctx: SocialContext): { kind: SocialKind; label: string; why: string | null }[] {
  const out: { kind: SocialKind; label: string; why: string | null }[] = []
  for (const kind of SOCIAL_KINDS) {
    const def = SOCIALS[kind]
    const why = socialBlock(kind, by, to, ctx)
    // Hide what can never apply between these two (wrong ages, not housemates); keep the rest with a reason.
    const ageMismatch = !atLeast(by.stage, def.by[0]) || !atMost(by.stage, def.by[1]) || !atLeast(to.stage, def.to[0]) || !atMost(to.stage, def.to[1])
    if (ageMismatch) continue
    if (def.household && !(by.hh && to.hh)) continue
    if ((kind === 'flirt' || kind === 'baby') && related(by, to)) continue
    out.push({ kind, label: def.label(to.name), why })
  }
  return out
}

// ---- Babies --------------------------------------------------------------------------------

const BABY_NAMES = [
  'Avery', 'Rowan', 'Milo', 'Juniper', 'Theo', 'Hazel', 'Ezra', 'Nora', 'Leo', 'Ivy', 'Felix', 'Clara', 'Jasper', 'Ruby', 'Otis', 'Mabel',
  'Kai', 'Wren', 'Arlo', 'Luna', 'Silas', 'Iris', 'Finn', 'Stella', 'Remy', 'June', 'Hugo', 'Pearl', 'Quinn', 'Sage', 'Rio', 'Maya',
]

export function babyName(roll: () => number, taken: string[]): string {
  const used = new Set(taken.map(n => n.toLowerCase()))
  const start = Math.floor(roll() * BABY_NAMES.length)
  for (let i = 0; i < BABY_NAMES.length; i++) {
    const name = BABY_NAMES[(start + i) % BABY_NAMES.length]
    if (!used.has(name.toLowerCase())) return name
  }
  return `Baby ${taken.length + 1}`
}

/** A baby takes after its parents: skin and hair from one or the other, any outfit. */
export function babyLook(a: Look, b: Look | null, roll: () => number): Look {
  const pickParent = () => (b && roll() < 0.5 ? b : a)
  const skinFrom = pickParent()
  const hairFrom = pickParent()
  return {
    skin: skinFrom.skin,
    hair: roll() < 0.85 ? hairFrom.hair : Math.floor(roll() * HAIR_COLORS.length),
    hairStyle: HAIR_STYLES[Math.floor(roll() * (HAIR_STYLES.length - 1))],
    top: Math.floor(roll() * OUTFIT_COLORS.length),
    bottom: Math.floor(roll() * OUTFIT_COLORS.length),
    build: pickParent().build,
    body: BODIES[Math.floor(roll() * BODIES.length)],
    height: Math.round((((a.height + (b?.height ?? a.height)) / 2) + (roll() - 0.5) * 0.06) * 100) / 100,
  }
}

export interface Expecting {
  /** Household record id of the other parent, if they live here. */
  partner: string | null
  /** Sim minutes until the baby arrives. */
  left: number
}

export function sanitizeExpecting(input: unknown): Expecting | null {
  if (!input || typeof input !== 'object') return null
  const e = input as Record<string, unknown>
  const left = Number(e.left)
  if (!Number.isFinite(left)) return null
  return { partner: typeof e.partner === 'string' ? e.partner.slice(0, 12) : null, left: Math.max(0, Math.min(PREGNANCY_MINUTES, left)) }
}

export function sanitizeParents(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out = input.filter((p): p is string => typeof p === 'string').map(p => p.slice(0, 12)).slice(0, 2)
  return out.length ? out : undefined
}

/** A free household record id (`s1`, `s2`, ...). */
export function freeSimId(taken: string[]): string {
  const set = new Set(taken)
  for (let i = 1; i < 1000; i++) if (!set.has(`s${i}`)) return `s${i}`
  return `s${Date.now() % 100000}`
}
