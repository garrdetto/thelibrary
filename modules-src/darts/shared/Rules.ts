/** The match state machine for x01 (301/501/701 with double-in and double-out), Cricket and Count Up, plus legs, sets, statistics and announcements. Pure functions over GameState: the page, the computer opponent and the DartsRoom authority all call the same code. */
import { label, spokenLabel } from './Board'
import type {
  Announcement,
  CpuLevel,
  CricketTarget,
  DartThrow,
  GameState,
  MatchConfig,
  ModeConfig,
  Player,
  PlayerStats,
  TurnRecord,
} from './interfaces'

export const DARTS_PER_TURN = 3
export const CRICKET_TARGETS: readonly CricketTarget[] = [20, 19, 18, 17, 16, 15, 25]
export const MAX_PLAYERS = 4

export const DEFAULT_RULES: Record<ModeConfig['mode'], ModeConfig> = {
  x01: { mode: 'x01', start: 501, doubleIn: false, doubleOut: true },
  cricket: { mode: 'cricket', scoring: true, roundLimit: 20 },
  countup: { mode: 'countup', rounds: 8 },
}

export interface SeatSpec {
  id: string
  name: string
  cpu?: boolean
  cpuLevel?: CpuLevel
  connectionStatus?: Player['connectionStatus']
}

export interface ThrowResult {
  state: GameState
  announcements: Announcement[]
  turnOver: boolean
}

function emptyMarks(): Record<CricketTarget, number> {
  return { 15: 0, 16: 0, 17: 0, 18: 0, 19: 0, 20: 0, 25: 0 }
}

function emptyStats(): PlayerStats {
  return { darts: 0, points: 0, average: 0, marks: 0, tons: 0, oneEighties: 0, highestTurn: 0, doublesHit: 0, doublesTried: 0, checkouts: 0, bestCheckout: 0, bulls: 0, legsWon: 0 }
}

function startScore(rules: ModeConfig): number {
  return rules.mode === 'x01' ? rules.start : 0
}

export function normalizeConfig(config: MatchConfig): MatchConfig {
  const whole = (value: number, min: number, max: number, fallback: number) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback)
  const rules = config.rules
  let clean: ModeConfig
  if (rules.mode === 'x01') clean = { mode: 'x01', start: [301, 501, 701].includes(rules.start) ? rules.start : 501, doubleIn: !!rules.doubleIn, doubleOut: !!rules.doubleOut, doubleBull: !!rules.doubleBull }
  else if (rules.mode === 'cricket') clean = { mode: 'cricket', scoring: rules.scoring !== false, roundLimit: whole(rules.roundLimit, 5, 50, 20) }
  else clean = { mode: 'countup', rounds: whole(rules.rounds, 1, 20, 8) }
  return { rules: clean, legsPerSet: whole(config.legsPerSet, 1, 11, 1), setsToWin: whole(config.setsToWin, 1, 7, 1) }
}

export function createMatch(roomId: string, config: MatchConfig, seats: readonly SeatSpec[]): GameState {
  if (!seats.length || seats.length > MAX_PLAYERS) throw new Error('A match needs one to four players.')
  const clean = normalizeConfig(config)
  const players: Player[] = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    score: startScore(clean.rules),
    currentRoundThrows: [],
    connectionStatus: seat.connectionStatus ?? (seat.cpu ? 'cpu' : 'local'),
    stats: emptyStats(),
    marks: emptyMarks(),
    opened: !(clean.rules.mode === 'x01' && clean.rules.doubleIn),
    turnStartScore: startScore(clean.rules),
    cpu: !!seat.cpu,
    cpuLevel: seat.cpuLevel ?? 'league',
  }))
  const won = Object.fromEntries(players.map((player) => [player.id, 0]))
  return {
    roomId,
    gameMode: clean.rules.mode,
    config: clean,
    status: 'playing',
    players,
    currentTurnPlayerId: players[0].id,
    legStarter: 0,
    round: 1,
    legs: { current: 1, won: { ...won } },
    sets: { current: 1, won: { ...won } },
    history: [],
    winnerId: null,
    legWinnerId: null,
    version: 0,
  }
}

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState
}

export function currentPlayer(state: GameState): Player {
  return state.players.find((player) => player.id === state.currentTurnPlayerId) ?? state.players[0]
}

export function dartsLeft(state: GameState): number {
  return state.status === 'playing' ? DARTS_PER_TURN - currentPlayer(state).currentRoundThrows.length : 0
}

function isDouble(dart: DartThrow): boolean {
  return dart.multiplier === 2
}

function cricketTarget(dart: DartThrow): CricketTarget | null {
  if (dart.multiplier === 0) return null
  return (CRICKET_TARGETS as readonly number[]).includes(dart.sector) ? (dart.sector as CricketTarget) : null
}

function totalMarks(player: Player): number {
  return CRICKET_TARGETS.reduce((sum, target) => sum + player.marks[target], 0)
}

function allClosed(player: Player): boolean {
  return CRICKET_TARGETS.every((target) => player.marks[target] >= 3)
}

function say(list: Announcement[], kind: Announcement['kind'], text: string, playerId: string): void {
  list.push({ kind, text, playerId })
}

function refreshAverage(state: GameState, player: Player): void {
  const stats = player.stats
  if (!stats.darts) {
    stats.average = 0
    return
  }
  const per = state.gameMode === 'cricket' ? stats.marks : stats.points
  stats.average = Math.round((per / stats.darts) * 3 * 100) / 100
}

/** True if `score` can be finished with one dart (any double, or the bull). */
export function isFinishingDouble(score: number): boolean {
  return score === 50 || (score >= 2 && score <= 40 && score % 2 === 0)
}

function dartAnnouncement(list: Announcement[], dart: DartThrow, playerId: string): void {
  if (dart.multiplier === 0) say(list, 'miss', 'Missed the board', playerId)
  else if (dart.sector === 25) say(list, dart.multiplier === 2 ? 'innerBull' : 'bull', spokenLabel(dart), playerId)
  else if (dart.multiplier === 3) say(list, 'triple', spokenLabel(dart), playerId)
  else if (dart.multiplier === 2) say(list, 'double', spokenLabel(dart), playerId)
  else say(list, 'score', label(dart), playerId)
}

/** With Double Bull on in x01, an outer-bull dart scores 50 and counts as a double, like the inner bull. */
export function scoredDart(rules: ModeConfig, dart: DartThrow): DartThrow {
  if (rules.mode !== 'x01' || !rules.doubleBull || dart.ring !== 'outerBull') return dart
  return { ...dart, multiplier: 2, scoreValue: 50 }
}

function applyX01(state: GameState, player: Player, dart: DartThrow, list: Announcement[]): { bust: boolean; won: boolean } {
  const rules = state.config.rules
  if (rules.mode !== 'x01') return { bust: false, won: false }
  if (!player.opened) {
    if (!isDouble(dart)) {
      if (dart.multiplier !== 0) say(list, 'notOpened', 'Hit a double to start scoring', player.id)
      return { bust: false, won: false }
    }
    player.opened = true
    say(list, 'opened', `${player.name} is in`, player.id)
  }
  const before = player.score
  if (rules.doubleOut && isFinishingDouble(before)) player.stats.doublesTried++
  const after = before - dart.scoreValue
  const bust = after < 0 || (rules.doubleOut && after === 1) || (after === 0 && rules.doubleOut && !isDouble(dart))
  if (bust) {
    player.score = player.turnStartScore
    say(list, 'bust', 'Bust!', player.id)
    return { bust: true, won: false }
  }
  player.score = after
  if (after === 0) {
    if (isDouble(dart)) player.stats.doublesHit++
    const checkout = player.turnStartScore
    player.stats.checkouts++
    player.stats.bestCheckout = Math.max(player.stats.bestCheckout, checkout)
    say(list, 'checkout', `Checkout ${checkout}!`, player.id)
    return { bust: false, won: true }
  }
  return { bust: false, won: false }
}

function applyCricket(state: GameState, player: Player, dart: DartThrow, list: Announcement[]): { won: boolean } {
  const rules = state.config.rules
  if (rules.mode !== 'cricket') return { won: false }
  const target = cricketTarget(dart)
  if (target !== null) {
    const opponents = state.players.filter((other) => other.id !== player.id)
    let marks: number = dart.multiplier
    while (marks > 0) {
      marks--
      if (player.marks[target] < 3) {
        player.marks[target]++
        player.stats.marks++
        if (player.marks[target] === 3) say(list, 'closed', `${target === 25 ? 'Bull' : target} closed`, player.id)
      } else if (rules.scoring && opponents.some((other) => other.marks[target] < 3)) {
        player.score += target
      }
    }
  }
  const leads = state.players.every((other) => other.id === player.id || player.score >= other.score)
  return { won: allClosed(player) && leads }
}

/** The order players throw in this leg, starting from the leg starter. */
function turnOrder(state: GameState): Player[] {
  const n = state.players.length
  return Array.from({ length: n }, (_, i) => state.players[(state.legStarter + i) % n])
}

function isLastInRound(state: GameState, player: Player): boolean {
  const order = turnOrder(state)
  return order[order.length - 1].id === player.id
}

/** Winner of a leg that ran out of rounds (Count Up, or Cricket at its round limit): most points, then most Cricket marks; null for a tie. */
function roundLimitWinner(state: GameState): Player | null {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || (state.gameMode === 'cricket' ? totalMarks(b) - totalMarks(a) : 0))
  if (ranked.length === 1) return ranked[0]
  const [first, second] = ranked
  const tie = first.score === second.score && (state.gameMode !== 'cricket' || totalMarks(first) === totalMarks(second))
  return tie ? null : first
}

function finishTurn(state: GameState, player: Player, bust: boolean): TurnRecord {
  const throws = player.currentRoundThrows
  let scored = 0
  if (state.gameMode === 'x01') scored = bust ? 0 : player.turnStartScore - player.score
  else if (state.gameMode === 'countup') scored = player.score - player.turnStartScore
  else scored = player.score - player.turnStartScore
  if (state.gameMode !== 'cricket') {
    player.stats.points += scored
    player.stats.highestTurn = Math.max(player.stats.highestTurn, scored)
    if (scored >= 100 && scored < 180) player.stats.tons++
    if (scored === 180) player.stats.oneEighties++
  }
  refreshAverage(state, player)
  return { playerId: player.id, set: state.sets.current, leg: state.legs.current, round: state.round, throws: [...throws], scored, bust, scoreAfter: player.score }
}

function legWon(state: GameState, winner: Player, list: Announcement[]): void {
  state.legWinnerId = winner.id
  winner.stats.legsWon++
  state.legs.won[winner.id] = (state.legs.won[winner.id] ?? 0) + 1
  const legsNeeded = state.config.legsPerSet
  if (state.legs.won[winner.id] >= legsNeeded) {
    state.sets.won[winner.id] = (state.sets.won[winner.id] ?? 0) + 1
    if (state.sets.won[winner.id] >= state.config.setsToWin) {
      state.status = 'finished'
      state.winnerId = winner.id
      say(list, 'matchWon', `${winner.name} wins!`, winner.id)
      return
    }
    say(list, 'setWon', `${winner.name} takes the set`, winner.id)
  } else {
    say(list, 'legWon', `${winner.name} takes the leg`, winner.id)
  }
  state.status = 'legOver'
}

/**
 * Applies one dart for the player whose turn it is. Returns the new state (the input is never changed), what to announce, and whether the turn is over. A turn ends after three darts, on a bust, or when the dart wins the leg; the state then waits in `turnEnd`, `legOver` or `finished` until `nextTurn`.
 */
export function applyThrow(input: GameState, playerId: string, thrown: DartThrow): ThrowResult {
  if (input.status !== 'playing' || input.currentTurnPlayerId !== playerId) return { state: input, announcements: [], turnOver: false }
  const dart = scoredDart(input.config.rules, thrown)
  const state = clone(input)
  const player = currentPlayer(state)
  const list: Announcement[] = []
  player.currentRoundThrows.push(dart)
  player.stats.darts++
  if (dart.sector === 25) player.stats.bulls++
  state.version++
  dartAnnouncement(list, dart, player.id)

  let bust = false
  let won = false
  if (state.gameMode === 'x01') ({ bust, won } = applyX01(state, player, dart, list))
  else if (state.gameMode === 'cricket') ({ won } = applyCricket(state, player, dart, list))
  else player.score += dart.scoreValue

  const turnOver = bust || won || player.currentRoundThrows.length >= DARTS_PER_TURN
  if (!turnOver) {
    refreshAverage(state, player)
    return { state, announcements: list, turnOver: false }
  }

  const record = finishTurn(state, player, bust)
  state.history.push(record)
  if (!bust && !won && state.gameMode !== 'cricket') {
    if (record.scored === 180) say(list, 'oneEighty', 'One hundred and eighty!', player.id)
    else if (record.scored >= 100) say(list, 'ton', `Ton${record.scored > 100 ? ` ${record.scored}` : ''}!`, player.id)
  }

  const rules = state.config.rules
  const lastRound =
    (rules.mode === 'countup' && state.round >= rules.rounds) || (rules.mode === 'cricket' && state.round >= rules.roundLimit)
  if (won) legWon(state, player, list)
  else if (lastRound && isLastInRound(state, player)) {
    const winner = roundLimitWinner(state)
    if (winner) legWon(state, winner, list)
    else {
      state.legWinnerId = null
      state.status = 'legOver'
      say(list, 'legWon', 'Tied leg: it will be replayed', player.id)
    }
  } else state.status = 'turnEnd'
  return { state, announcements: list, turnOver: true }
}

/** Moves on from `turnEnd` (next player's turn) or `legOver` (fresh leg, the next player starts). Returns the input unchanged in any other status. */
export function nextTurn(input: GameState): { state: GameState; announcements: Announcement[] } {
  if (input.status !== 'turnEnd' && input.status !== 'legOver') return { state: input, announcements: [] }
  const state = clone(input)
  const list: Announcement[] = []
  const n = state.players.length
  state.version++
  if (state.status === 'legOver') {
    const setOver = state.legWinnerId !== null && Object.values(state.legs.won).some((won) => won >= state.config.legsPerSet)
    if (setOver) {
      for (const id of Object.keys(state.legs.won)) state.legs.won[id] = 0
      state.sets.current++
      state.legs.current = 1
    } else state.legs.current++
    state.legStarter = (state.legStarter + 1) % n
    state.round = 1
    state.legWinnerId = null
    for (const player of state.players) {
      player.score = startScore(state.config.rules)
      player.turnStartScore = player.score
      player.marks = emptyMarks()
      player.currentRoundThrows = []
      player.opened = !(state.config.rules.mode === 'x01' && state.config.rules.doubleIn)
    }
    const starter = state.players[state.legStarter]
    state.currentTurnPlayerId = starter.id
    state.status = 'playing'
    say(list, 'score', `Set ${state.sets.current}, leg ${state.legs.current}: ${starter.name} to throw`, starter.id)
    return { state, announcements: list }
  }
  const index = state.players.findIndex((player) => player.id === state.currentTurnPlayerId)
  const finished = state.players[index]
  finished.currentRoundThrows = []
  const next = state.players[(index + 1) % n]
  if ((index + 1) % n === state.legStarter) state.round++
  next.turnStartScore = next.score
  next.currentRoundThrows = []
  state.currentTurnPlayerId = next.id
  state.status = 'playing'
  return { state, announcements: list }
}

/** Ends the current turn early with misses for whatever darts are left (a player who ran out of time or left the room). */
export function forfeitTurn(input: GameState, playerId: string): ThrowResult {
  let state = input
  const announcements: Announcement[] = []
  let turnOver = false
  while (state.status === 'playing' && state.currentTurnPlayerId === playerId && !turnOver) {
    const miss: DartThrow = { coordinates: [0, -2, 0], sector: 0, multiplier: 0, ring: 'miss', scoreValue: 0, angle: 0, radius: 2000 }
    const result = applyThrow(state, playerId, miss)
    state = result.state
    turnOver = result.turnOver
    announcements.push(...result.announcements.filter((item) => item.kind !== 'miss'))
  }
  return { state, announcements, turnOver }
}

/** Removes a player who left a match for good; if one player is left in a multi-player match, they win. */
export function removePlayer(input: GameState, playerId: string): GameState {
  const state = clone(input)
  const index = state.players.findIndex((player) => player.id === playerId)
  if (index < 0 || state.status === 'finished') return input
  const wasTurn = state.currentTurnPlayerId === playerId
  state.players.splice(index, 1)
  delete state.legs.won[playerId]
  delete state.sets.won[playerId]
  state.version++
  if (!state.players.length) {
    state.status = 'finished'
    return state
  }
  if (index < state.legStarter) state.legStarter--
  state.legStarter %= state.players.length
  if (state.players.length === 1 && input.players.length > 1) {
    state.status = 'finished'
    state.winnerId = state.players[0].id
    return state
  }
  if (wasTurn) {
    const next = state.players[index % state.players.length]
    next.turnStartScore = next.score
    next.currentRoundThrows = []
    state.currentTurnPlayerId = next.id
    if (state.status === 'turnEnd') state.status = 'playing'
  }
  return state
}

const BEDS: { name: string; value: number }[] = (() => {
  const beds: { name: string; value: number }[] = []
  for (let n = 20; n >= 1; n--) beds.push({ name: `T${n}`, value: n * 3 })
  beds.push({ name: '25', value: 25 })
  for (let n = 20; n >= 1; n--) beds.push({ name: `S${n}`, value: n })
  return beds
})()

const FINISHES: { name: string; value: number }[] = [
  ...[20, 16, 8, 18, 12, 10, 14, 4, 6, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1].map((n) => ({ name: `D${n}`, value: n * 2 })),
  { name: 'Bull', value: 50 },
]

/** The usual checkout route for a score with the darts left (doubles to finish under double-out), or null when it can't be finished this turn. Among the shortest routes it picks the one with the friendliest finish (D20, D16, D8 first) and the most common set-up darts. */
export function checkoutRoute(score: number, darts: number, doubleOut: boolean): string[] | null {
  if (!Number.isInteger(score) || score <= 0 || darts <= 0 || score > 180) return null
  const finishes = doubleOut ? FINISHES : [...FINISHES, ...BEDS]
  const setup = [...BEDS, ...FINISHES]
  for (let used = 1; used <= Math.min(darts, 3); used++) {
    let best: { route: string[]; cost: number } | null = null
    const walk = (left: number, route: string[], cost: number) => {
      if (route.length === used - 1) {
        const index = finishes.findIndex((item) => item.value === left)
        if (index < 0) return
        const total = cost + index * 3
        if (!best || total < best.cost) best = { route: [...route, finishes[index].name], cost: total }
        return
      }
      for (const bed of setup) if (left - bed.value > 0) walk(left - bed.value, [...route, bed.name], cost + setupCost(bed.name))
    }
    walk(score, [], 0)
    if (best) return (best as { route: string[] }).route
  }
  return null
}

function setupCost(name: string): number {
  if (name === '25') return 6
  if (name === 'Bull') return 8
  const n = Number(name.slice(1))
  if (name[0] === 'S') return 20 - n
  if (name[0] === 'T') return 21 - n
  return 30 - n
}

/** Final placings: the winner first, then by sets, legs and the current score (lower is better in x01). */
export function standings(state: GameState): Player[] {
  const better = (a: Player, b: Player) =>
    (state.sets.won[b.id] ?? 0) - (state.sets.won[a.id] ?? 0) ||
    (state.legs.won[b.id] ?? 0) - (state.legs.won[a.id] ?? 0) ||
    (state.gameMode === 'x01' ? a.score - b.score : b.score - a.score)
  return [...state.players].sort((a, b) => (a.id === state.winnerId ? -1 : b.id === state.winnerId ? 1 : better(a, b)))
}

export function modeLabel(config: MatchConfig): string {
  const rules = config.rules
  const match = config.setsToWin > 1 ? ` · first to ${config.setsToWin} sets of ${config.legsPerSet}` : config.legsPerSet > 1 ? ` · first to ${config.legsPerSet} legs` : ''
  if (rules.mode === 'x01') return `${rules.start}${rules.doubleIn ? ' · double in' : ''}${rules.doubleOut ? ' · double out' : ' · straight out'}${match}`
  if (rules.mode === 'cricket') return `Cricket${rules.scoring ? '' : ' · no points'} · ${rules.roundLimit} rounds${match}`
  return `Count Up · ${rules.rounds} rounds${match}`
}
