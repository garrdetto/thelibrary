import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreAt, targetPoint } from '../shared/Board'
import type { DartThrow, GameState, MatchConfig, Multiplier } from '../shared/interfaces'
import { simulateMatch } from '../shared/QuickSim'
import { countsForAverages, legResults } from '../shared/Records'
import { applyThrow, createMatch, nextTurn, type SeatSpec } from '../shared/Rules'
import { createRng } from '../shared/Rng'
import { createTournament, legConfig, legOrder, nextTournamentMatch, recordTournamentLeg, type Entrant, type TournamentRules } from '../shared/Tournament'

function bed(sector: number, multiplier: Multiplier): DartThrow {
  const point = targetPoint(sector, multiplier)
  return scoreAt(point.x, point.y)
}

function play(state: GameState, darts: DartThrow[]): GameState {
  let current = state
  for (const dart of darts) {
    const result = applyThrow(current, current.currentTurnPlayerId, dart)
    current = result.state
    if (result.turnOver && current.status !== 'finished') current = nextTurn(current).state
  }
  return current
}

const countup = (teamPlay: 'stacked' | 'regular', rounds = 1): MatchConfig => ({ rules: { mode: 'countup', rounds }, legsPerSet: 1, setsToWin: 1, teamPlay })

test('shared-score teammates take turns on one score', () => {
  const seats: SeatSpec[] = [
    { id: 't1', name: 'Red', team: 0, members: [{ name: 'Ann', cpu: false, cpuLevel: 'league' }, { name: 'Bo', cpu: false, cpuLevel: 'league' }] },
    { id: 't2', name: 'Blue', team: 1, members: [{ name: 'Cy', cpu: false, cpuLevel: 'league' }, { name: 'Di', cpu: true, cpuLevel: 'pro' }] },
  ]
  let state = createMatch('t', countup('stacked', 2), seats)
  assert.equal(state.players[0].thrower, 'Ann')
  assert.equal(state.players[1].thrower, 'Cy')
  state = play(state, [bed(20, 1), bed(20, 1), bed(20, 1), bed(1, 1), bed(1, 1), bed(1, 1)])
  assert.equal(state.players[0].thrower, 'Bo')
  assert.equal(state.players[1].thrower, 'Di')
  assert.equal(state.players[1].cpu, true, 'the computer throws for its member')
  state = play(state, [bed(20, 1), bed(20, 1), bed(20, 1), bed(1, 1), bed(1, 1), bed(1, 1)])
  assert.equal(state.status, 'finished')
  assert.equal(state.winnerId, 't1')
  assert.equal(state.players[0].score, 120)
  assert.equal(countsForAverages(state), false)
})

test('own-score teams add their totals at the round limit and win legs together', () => {
  const seats: SeatSpec[] = [
    { id: 'a1', name: 'A1', team: 0, teamName: 'Red' },
    { id: 'b1', name: 'B1', team: 1, teamName: 'Blue' },
    { id: 'a2', name: 'A2', team: 0, teamName: 'Red' },
    { id: 'b2', name: 'B2', team: 1, teamName: 'Blue' },
  ]
  const darts = [
    ...[1, 1, 1].map(() => bed(5, 1)),
    ...[1, 1, 1].map(() => bed(20, 1)),
    ...[1, 1, 1].map(() => bed(20, 1)),
    ...[1, 1, 1].map(() => bed(1, 1)),
  ]
  const state = play(createMatch('t', countup('regular'), seats), darts)
  assert.equal(state.status, 'finished')
  assert.equal(state.sets.won.a1, 1)
  assert.equal(state.sets.won.a2, 1)
  assert.equal(state.sets.won.b1 ?? 0, 0)
  assert.deepEqual(legResults(state), [])
})

test('own-score teams allow eight players and a checkout wins for the team', () => {
  const seats: SeatSpec[] = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, team: i % 4 }))
  const config: MatchConfig = { rules: { mode: 'x01', start: 301, doubleIn: false, doubleOut: false }, legsPerSet: 1, setsToWin: 1, teamPlay: 'regular' }
  const start = createMatch('t', config, seats)
  assert.equal(start.players.length, 8)
  start.players[0].score = 20
  start.players[0].turnStartScore = 20
  const done = applyThrow(start, 's0', bed(20, 1)).state
  assert.equal(done.status, 'finished')
  assert.equal(done.sets.won.s4, 1, 'the teammate shares the win')
  assert.throws(() => createMatch('t', { ...config, teamPlay: undefined }, seats))
})

const entrants: Entrant[] = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, cpu: true, cpuLevel: 'pro' }))
const rules: TournamentRules = { board: 'spider', rotation: ['501', 'cricket', 'countup'], doubleIn: false, doubleOut: false, doubleBull: true, cricketScoring: true, cricketRounds: 20, countupRounds: 8 }

test('tournament matches are best of three with the leg formats from the rotation', () => {
  let tournament = createTournament(rules, entrants)
  const first = nextTournamentMatch(tournament)!
  assert.equal(first.a, 'p1')
  assert.equal(legConfig(tournament, first).rules.mode, 'x01')
  assert.deepEqual(legOrder(first), ['p1', 'p2'])
  tournament = recordTournamentLeg(tournament, first.id, 'p2')
  const again = nextTournamentMatch(tournament)!
  assert.equal(legConfig(tournament, again).rules.mode, 'cricket')
  assert.deepEqual(legOrder(again), ['p2', 'p1'])
  tournament = recordTournamentLeg(tournament, first.id, 'p1')
  assert.equal(legConfig(tournament, nextTournamentMatch(tournament)!).rules.mode, 'countup')
  tournament = recordTournamentLeg(tournament, first.id, 'p1')
  const done = tournament.matches.find((match) => match.id === first.id)!
  assert.equal(done.winnerId, 'p1')
  assert.equal(tournament.matches.find((match) => match.id === 'r1m0')!.a, 'p1')
})

test('a simulated tournament crowns one champion after seven matches', () => {
  const rng = createRng(7)
  let tournament = createTournament(rules, entrants, rng)
  let guard = 0
  for (let match = nextTournamentMatch(tournament); match && guard < 30; match = nextTournamentMatch(tournament), guard++) {
    const seats = legOrder(match).map((id) => entrants.find((entrant) => entrant.id === id)!)
    const state = simulateMatch(legConfig(tournament, match), seats, rng)
    assert.ok(state.winnerId)
    tournament = recordTournamentLeg(tournament, match.id, state.winnerId!)
  }
  assert.ok(tournament.championId)
  assert.equal(tournament.matches.filter((match) => match.winnerId).length, 7)
})
