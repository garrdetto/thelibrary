/** Seeded rosters: thirteen position players and twelve pitchers per club, with ratings shaped by position and role. */
import { teamById } from './league'
import { generateName } from './names'
import { PITCH_ORDER } from './pitches'
import { Rng, stringSeed } from './random'
import type { BatSide, BodyType, Hand, LineupPosition, PitchGrade, PitchType, Player, Ratings, Roster } from './types'

const HITTER_SLOTS: readonly LineupPosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'C', 'SS', 'CF', '1B']
const RIGHT_ONLY: ReadonlySet<LineupPosition> = new Set(['C', '2B', '3B', 'SS'])
const BODIES: readonly BodyType[] = ['lean', 'stocky', 'belly', 'tall', 'short']

const POSITION_BIAS: Readonly<Record<LineupPosition, Partial<Ratings>>> = {
  P: {},
  C: { arm: 10, fielding: 8, speed: -14, power: 2 },
  '1B': { power: 10, speed: -8, fielding: -4, arm: -6 },
  '2B': { contact: 4, speed: 4, fielding: 6, power: -6 },
  '3B': { arm: 10, power: 5, fielding: 4 },
  SS: { fielding: 12, arm: 8, speed: 6, power: -6 },
  LF: { power: 6, fielding: -4 },
  CF: { speed: 12, fielding: 8, power: -2 },
  RF: { arm: 12, power: 6 },
  DH: { power: 12, contact: 4, fielding: -18, speed: -8, arm: -10 },
}

function clamp(value: number, min = 20, max = 99): number {
  return Math.round(Math.min(max, Math.max(min, value)))
}

function side(rng: Rng, rightOnly: boolean): { bats: BatSide; throws: Hand } {
  const throws: Hand = rightOnly || rng.chance(0.78) ? 'R' : 'L'
  const roll = rng.next()
  const bats: BatSide = roll < 0.09 ? 'S' : roll < (throws === 'L' ? 0.8 : 0.4) ? 'L' : 'R'
  return { bats, throws }
}

function hitterRatings(rng: Rng, position: LineupPosition, teamOffset: number): Ratings {
  const bias = POSITION_BIAS[position]
  const roll = (key: keyof Ratings) => clamp(rng.normal(54 + teamOffset, 13) + (bias[key] ?? 0))
  return { contact: roll('contact'), power: roll('power'), eye: roll('eye'), speed: roll('speed'), arm: roll('arm'), fielding: roll('fielding') }
}

function repertoire(rng: Rng, knuckler: boolean, reliever: boolean): PitchGrade[] {
  if (knuckler) return [{ type: 'KN', grade: clamp(rng.normal(72, 8)) }, { type: 'FF', grade: clamp(rng.normal(35, 8)) }]
  const primary: PitchType = rng.chance(0.3) ? 'SI' : 'FF'
  const grades: PitchGrade[] = [{ type: primary, grade: clamp(rng.normal(60, 12)) }]
  const extras = PITCH_ORDER.filter((type) => type !== primary && type !== 'KN')
  const count = reliever ? rng.int(1, 2) : rng.int(2, 4)
  const pool = [...extras]
  for (let index = 0; index < count && pool.length; index++) {
    const choice = rng.weighted(pool, (type) => (type === 'SL' || type === 'CH' ? 3 : type === 'CU' ? 2 : 1.2))
    pool.splice(pool.indexOf(choice), 1)
    grades.push({ type: choice, grade: clamp(rng.normal(56, 13)) })
  }
  return grades
}

function bodyAndHeight(rng: Rng): { body: BodyType; height: number } {
  const body = rng.pick(BODIES)
  const base = body === 'tall' ? 1.96 : body === 'short' ? 1.72 : 1.85
  return { body, height: Math.round((base + rng.normal(0, 0.035)) * 100) / 100 }
}

export function buildRoster(teamId: string): Roster {
  const team = teamById(teamId)
  const rng = new Rng(stringSeed(`roster:${teamId}`))
  const teamOffset = rng.normal(0, 3.5)
  const numbers = new Set<number>()
  const uniqueNumber = () => {
    let value = rng.int(1, 99)
    while (numbers.has(value)) value = (value % 99) + 1
    numbers.add(value)
    return value
  }

  const hitters: Player[] = HITTER_SLOTS.map((position, index) => {
    const name = generateName(rng)
    const hands = side(rng, RIGHT_ONLY.has(position))
    const ratings = hitterRatings(rng, position, teamOffset - (index >= 9 ? 4 : 0))
    return { id: `${teamId}-h${index}`, ...name, number: uniqueNumber(), ...hands, position, ...bodyAndHeight(rng), ratings, pitching: null }
  })

  const pitchers: Player[] = []
  for (let index = 0; index < 12; index++) {
    const starter = index < 5
    const knuckler = rng.chance(0.03)
    const name = generateName(rng)
    const throws: Hand = rng.chance(0.28) ? 'L' : 'R'
    const bats: BatSide = rng.chance(0.15) ? 'S' : throws
    const velocity = knuckler ? 34 : rng.normal(starter ? 41.3 : 42.0, 1.2) + teamOffset * 0.05
    pitchers.push({
      id: `${teamId}-p${index}`,
      ...name,
      number: uniqueNumber(),
      bats,
      throws,
      position: 'P',
      ...bodyAndHeight(rng),
      ratings: { contact: clamp(rng.normal(22, 8)), power: clamp(rng.normal(20, 8)), eye: clamp(rng.normal(25, 8)), speed: clamp(rng.normal(40, 10)), arm: clamp(rng.normal(70, 8)), fielding: clamp(rng.normal(50, 10)) },
      pitching: {
        velocity: Math.round(velocity * 10) / 10,
        control: clamp(rng.normal(55 + teamOffset, 12)),
        stamina: starter ? clamp(rng.normal(78, 8), 55, 99) : clamp(rng.normal(34, 8), 20, 55),
        stuff: clamp(rng.normal(index === 5 ? 72 : 55 + teamOffset, 11)),
        repertoire: repertoire(rng, knuckler, !starter),
        role: starter ? 'SP' : 'RP',
      },
    })
  }
  return { team, hitters, pitchers }
}

export function fullName(player: Player): string {
  return `${player.first} ${player.last}`
}

export function shortName(player: Player): string {
  return `${player.first[0]}. ${player.last}`
}
