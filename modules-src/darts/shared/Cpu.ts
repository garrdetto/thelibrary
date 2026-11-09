/** The computer opponent: picks the bed a sensible player would go for (scoring trebles, checkout routes, open Cricket numbers) and throws at it through the same physics with its level's spread. */
import { targetPoint } from './Board'
import type { CpuLevel, GameState, Multiplier, Player, ThrowIntent } from './interfaces'
import { IDEAL_SPEED } from './Physics'
import { CRICKET_TARGETS, checkoutRoute, dartsLeft } from './Rules'
import { gaussian, type Rng } from './Rng'

const STEADINESS: Record<CpuLevel, number> = { pub: 0.45, league: 0.25, county: 0.12, pro: 0.04 }

export interface CpuChoice {
  bed: string
  intent: ThrowIntent
}

function parseBed(bed: string): { sector: number; multiplier: Multiplier } {
  if (bed === 'Bull') return { sector: 25, multiplier: 2 }
  if (bed === '25') return { sector: 25, multiplier: 1 }
  const kind = bed[0]
  const sector = Number(bed.slice(1))
  return { sector, multiplier: kind === 'T' ? 3 : kind === 'D' ? 2 : 1 }
}

function x01Bed(state: GameState, player: Player): string {
  const rules = state.config.rules
  if (rules.mode !== 'x01') return 'T20'
  if (!player.opened) return 'D20'
  const route = checkoutRoute(player.score, dartsLeft(state), rules.doubleOut)
  if (route) return route[0]
  if (player.score <= 60) {
    const route2 = checkoutRoute(player.score, 3, rules.doubleOut)
    if (route2) return route2[0]
  }
  return 'T20'
}

function cricketBed(state: GameState, player: Player): string {
  const opponents = state.players.filter((other) => other.id !== player.id)
  const behind = opponents.some((other) => other.score > player.score)
  const scoring = state.config.rules.mode === 'cricket' && state.config.rules.scoring
  if (behind && scoring) {
    const point = CRICKET_TARGETS.find((target) => player.marks[target] >= 3 && opponents.some((other) => other.marks[target] < 3))
    if (point !== undefined) return point === 25 ? 'Bull' : `T${point}`
  }
  const open = CRICKET_TARGETS.find((target) => player.marks[target] < 3)
  if (open !== undefined) return open === 25 ? 'Bull' : `T${open}`
  return 'Bull'
}

export function chooseBed(state: GameState, player: Player): string {
  if (state.gameMode === 'x01') return x01Bed(state, player)
  if (state.gameMode === 'cricket') return cricketBed(state, player)
  return 'T20'
}

/** The bed the computer goes for and the intent it throws with; the release error comes later from its spread in `launch`. */
export function cpuThrow(state: GameState, player: Player, rng: Rng): CpuChoice {
  const bed = chooseBed(state, player)
  const { sector, multiplier } = parseBed(bed)
  const point = targetPoint(sector, multiplier)
  const steady = STEADINESS[player.cpuLevel]
  return {
    bed,
    intent: {
      aimX: point.x,
      aimY: point.y,
      speed: IDEAL_SPEED * (1 + gaussian(rng) * 0.004 * (1 + steady * 4)),
      yaw: 0,
      wobble: steady,
    },
  }
}
