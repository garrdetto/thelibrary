import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreAt, targetPoint } from '../shared/Board'
import type { DartThrow, GameState, MatchConfig, Multiplier } from '../shared/interfaces'
import { HOLE, IDEAL_SPEED, METER, meterReach } from '../shared/Physics'
import { averageValue, countsForAverages, legJustEnded, legResults, matchAverages, recordMode } from '../shared/Records'
import { applyThrow, createMatch, nextTurn } from '../shared/Rules'

function bed(sector: number, multiplier: Multiplier): DartThrow {
  const point = targetPoint(sector, multiplier)
  return scoreAt(point.x, point.y)
}

const miss = (): DartThrow => scoreAt(0, 0.3)

/** Throws every dart in order, moving to the next turn after each finished turn except the last, so the state is the one right after the final dart. */
function throwAll(state: GameState, darts: DartThrow[]): GameState {
  let current = state
  darts.forEach((dart, index) => {
    const result = applyThrow(current, current.currentTurnPlayerId, dart)
    current = result.state
    if (result.turnOver && index < darts.length - 1) current = nextTurn(current).state
  })
  return current
}

const x01 = (start: 301 | 501, doubleOut: boolean, board: 'steel' | 'spider', legsPerSet = 1): MatchConfig => ({ rules: { mode: 'x01', start, doubleIn: false, doubleOut, doubleBull: board === 'spider' }, legsPerSet, setsToWin: 1, board })

test('records: which rules go on the record book, per board', () => {
  assert.equal(recordMode(x01(501, true, 'steel')), '501')
  assert.equal(recordMode(x01(501, false, 'steel')), null, 'steel tip 501 needs double out')
  assert.equal(recordMode(x01(301, false, 'spider')), '301', 'soft tip may finish on any bed')
  assert.equal(recordMode({ rules: { mode: 'x01', start: 701, doubleIn: false, doubleOut: true }, legsPerSet: 1, setsToWin: 1 }), null)
  assert.equal(recordMode({ rules: { mode: 'cricket', scoring: true, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }), 'cricket')
  assert.equal(recordMode({ rules: { mode: 'cricket', scoring: false, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }), null)
  assert.equal(recordMode({ rules: { mode: 'countup', rounds: 8 }, legsPerSet: 1, setsToWin: 1 }), 'countup')
  assert.equal(recordMode({ rules: { mode: 'countup', rounds: 4 }, legsPerSet: 1, setsToWin: 1 }), null)
})

test('records: a soft-tip 301 single-out leg counts the darts to zero', () => {
  const start = createMatch('t', x01(301, false, 'spider'), [{ id: 'p1', name: 'A' }])
  const t20 = bed(20, 3)
  const state = throwAll(start, [t20, t20, t20, t20, t20, bed(1, 1)])
  assert.equal(state.status, 'finished')
  assert.ok(legJustEnded(state))
  assert.deepEqual(legResults(state), [{ playerId: 'p1', mode: '301', value: 6 }])
})

test('records: only the leg winner of 501 gets a record, and misses count as darts', () => {
  const start = createMatch('t', x01(501, true, 'steel', 2), [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }])
  const t20 = bed(20, 3)
  const darts: DartThrow[] = []
  for (let turn = 0; turn < 2; turn++) darts.push(t20, t20, t20, miss(), miss(), miss())
  darts.push(t20, bed(19, 3), bed(12, 2))
  const state = throwAll(start, darts)
  assert.equal(state.status, 'legOver')
  assert.equal(state.players[0].score, 0)
  assert.deepEqual(legResults(state), [{ playerId: 'p1', mode: '501', value: 9 }])
  const next = nextTurn(state).state
  assert.equal(next.history.length, 0, 'the next leg starts with an empty history')
  assert.deepEqual(legResults(next), [])
})

test('records: Cricket counts darts to close everything, Count Up every total', () => {
  const cricket = createMatch('t', { rules: { mode: 'cricket', scoring: true, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }, [{ id: 'p1', name: 'A' }])
  const closed = throwAll(cricket, [bed(20, 3), bed(19, 3), bed(18, 3), bed(17, 3), bed(16, 3), bed(15, 3), bed(25, 2), bed(25, 1)])
  assert.equal(closed.status, 'finished')
  assert.deepEqual(legResults(closed), [{ playerId: 'p1', mode: 'cricket', value: 8 }])

  const countup = createMatch('t', { rules: { mode: 'countup', rounds: 8 }, legsPerSet: 1, setsToWin: 1 }, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }])
  const darts: DartThrow[] = []
  for (let round = 0; round < 8; round++) darts.push(bed(20, 1), bed(20, 1), bed(20, 1), bed(5, 1), miss(), miss())
  const done = throwAll(countup, darts)
  assert.ok(legJustEnded(done))
  assert.deepEqual(legResults(done), [{ playerId: 'p1', mode: 'countup', value: 480 }, { playerId: 'p2', mode: 'countup', value: 40 }])
})

test('averages: PPD from points per dart, MPR from marks that close or score', () => {
  const cricket = createMatch('t', { rules: { mode: 'cricket', scoring: true, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }])
  const state = throwAll(cricket, [bed(20, 3), bed(20, 3), bed(20, 1)])
  const [mine] = matchAverages(state)
  assert.equal(mine.mode, 'cricket')
  assert.equal(mine.darts, 3)
  assert.equal(mine.total, 7, 'three to close, four that scored')
  assert.equal(averageValue('cricket', mine.darts, mine.total), 7)
  assert.equal(averageValue('501', 9, 501).toFixed(2), '55.67')
})

test('averages: count real against real or against the Pro computer only', () => {
  const config = x01(501, true, 'steel')
  assert.equal(countsForAverages(createMatch('t', config, [{ id: 'p1', name: 'A' }])), false)
  assert.equal(countsForAverages(createMatch('t', config, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }])), true)
  assert.equal(countsForAverages(createMatch('t', config, [{ id: 'p1', name: 'A' }, { id: 'cpu', name: 'C', cpu: true, cpuLevel: 'pro' }])), true)
  assert.equal(countsForAverages(createMatch('t', config, [{ id: 'p1', name: 'A' }, { id: 'cpu', name: 'C', cpu: true, cpuLevel: 'county' }])), false)
})

test('meter: the yellow is wider and a release just past the green costs little', () => {
  const at = (d: number) => meterReach(IDEAL_SPEED * (1 + d * METER.perfect), 'normal') / HOLE
  assert.ok(METER.band / METER.perfect >= 4, 'the yellow runs at least three green half-widths past the green')
  assert.ok(at(1.25) < 10.2, `a frame past the green reaches ${at(1.25).toFixed(2)} holes`)
  assert.ok(at(METER.band / METER.perfect) <= METER.yellowHoles + 1e-9)
})

test('meter: the green is a third of ±1.7 %, fades to yellow before the band edge, and misses grow slowly', () => {
  const at = (d: number) => meterReach(IDEAL_SPEED * (1 + d * METER.perfect), 'normal') / HOLE
  assert.ok(Math.abs(METER.perfect - 0.017 / 3) < 1e-12)
  assert.ok(METER.fade > METER.perfect && METER.fade < METER.band)
  assert.ok(at(3) < 10.5, `a release at the old green edge reaches ${at(3).toFixed(2)} holes`)
  for (let d = 1; d < METER.band / METER.perfect; d += 0.25) assert.ok(at(d + 0.25) >= at(d) - 1e-12)
})

test('meter: the white lines sit at ±0.24 % with the colour zones unchanged, and between them lands exactly', () => {
  const at = (d: number) => meterReach(IDEAL_SPEED * (1 + d * METER.perfect), 'hard')
  assert.ok(Math.abs(METER.perfect * METER.exact - (0.00625 * 1.15) / 3) < 1e-12)
  assert.ok(Math.abs(METER.perfect - 0.017 / 3) < 1e-12 && METER.fade === 0.03 && METER.band === 0.085)
  const edge = METER.exact
  assert.equal(at(edge * 0.98), 0, 'inside the white lines lands on the aim')
  assert.equal(at(-edge * 0.98), 0)
  assert.ok(at(edge * 1.02) > 0, 'just outside the lines is not Perfect')
  assert.ok(at(edge * 1.02) / HOLE < 1, 'just outside the lines still lands close')
})
