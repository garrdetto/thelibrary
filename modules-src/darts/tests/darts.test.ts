import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RADII, SECTORS, label, ringAt, scoreAt, sectorAt, targetPoint, toPolar } from '../shared/Board'
import { cpuThrow } from '../shared/Cpu'
import type { DartThrow, GameState, MatchConfig, Multiplier } from '../shared/interfaces'
import { IDEAL_SPEED, RELEASE, SPREAD, aimDirection, launch, simulate, throwDart } from '../shared/Physics'
import { applyThrow, checkoutRoute, createMatch, forfeitTurn, nextTurn, removePlayer } from '../shared/Rules'
import { createRng, gaussian } from '../shared/Rng'
import { isRoomCode, roomCode } from '../shared/Room'

const mm = (value: number) => value / 1000

function bed(sector: number, multiplier: Multiplier): DartThrow {
  const point = targetPoint(sector, multiplier)
  return scoreAt(point.x, point.y)
}

const miss = (): DartThrow => scoreAt(0, 0.3)

function play(state: GameState, darts: DartThrow[]): GameState {
  let current = state
  for (const dart of darts) {
    const result = applyThrow(current, current.currentTurnPlayerId, dart)
    current = result.state
    if (result.turnOver) current = nextTurn(current).state
  }
  return current
}

const x01 = (start: 301 | 501, doubleIn: boolean, doubleOut: boolean, legsPerSet = 1, setsToWin = 1): MatchConfig => ({ rules: { mode: 'x01', start, doubleIn, doubleOut }, legsPerSet, setsToWin })

test('polar form measures clockwise from straight up', () => {
  assert.deepEqual(toPolar(0, 100), { radius: 100, angle: 0 })
  assert.equal(toPolar(100, 0).angle, 90)
  assert.equal(toPolar(0, -100).angle, 180)
  assert.equal(toPolar(-100, 0).angle, 270)
})

test('every wedge maps to the regulation number ring', () => {
  SECTORS.forEach((number, index) => {
    assert.equal(sectorAt(index * 18), number)
    assert.equal(sectorAt(index * 18 + 8.99), number)
    assert.equal(sectorAt(index * 18 - 8.99 + 360), number)
  })
  assert.equal(sectorAt(9.01), 1)
  assert.equal(sectorAt(350.99), 5)
  assert.equal(sectorAt(359.99), 20)
})

test('radial thresholds give the right bed', () => {
  assert.equal(ringAt(0), 'innerBull')
  assert.equal(ringAt(RADII.innerBull), 'innerBull')
  assert.equal(ringAt(RADII.innerBull + 0.01), 'outerBull')
  assert.equal(ringAt(RADII.outerBull + 0.01), 'singleInner')
  assert.equal(ringAt(RADII.tripleInner), 'triple')
  assert.equal(ringAt(RADII.tripleOuter + 0.01), 'singleOuter')
  assert.equal(ringAt(RADII.doubleInner), 'double')
  assert.equal(ringAt(RADII.doubleOuter), 'double')
  assert.equal(ringAt(RADII.doubleOuter + 0.01), 'miss')
})

test('scoring a point on the face', () => {
  assert.equal(scoreAt(0, 0).scoreValue, 50)
  assert.equal(scoreAt(0, mm(10)).scoreValue, 25)
  assert.equal(scoreAt(0, mm(103)).scoreValue, 60)
  assert.equal(scoreAt(0, mm(166)).scoreValue, 40)
  assert.equal(scoreAt(mm(103), 0).scoreValue, 18)
  assert.equal(scoreAt(0, mm(-166)).scoreValue, 6)
  assert.equal(scoreAt(0, mm(180)).scoreValue, 0)
  for (const sector of SECTORS) {
    for (const multiplier of [1, 2, 3] as Multiplier[]) {
      const dart = bed(sector, multiplier)
      assert.equal(dart.sector, sector)
      assert.equal(dart.multiplier, multiplier)
      assert.equal(dart.scoreValue, sector * multiplier)
    }
  }
  assert.equal(label(bed(25, 2)), 'Bull')
  assert.equal(label(bed(19, 3)), 'T19')
})

test('an ideal-speed throw with no spread lands on the aim point', () => {
  for (const [sector, multiplier] of [[20, 3], [19, 3], [16, 2], [25, 2], [6, 2], [11, 1]] as [number, Multiplier][]) {
    const point = targetPoint(sector, multiplier)
    const dir = aimDirection(point.x, point.y)
    const hit = simulate({ origin: RELEASE, velocity: [dir[0] * IDEAL_SPEED, dir[1] * IDEAL_SPEED, dir[2] * IDEAL_SPEED] })
    assert.ok(hit.reachedBoard)
    assert.ok(Math.hypot(hit.point[0] - point.x, hit.point[1] - point.y) < 0.0005, `${sector}x${multiplier}`)
    assert.equal(hit.dart.scoreValue, sector * multiplier)
  }
})

test('throwing softer drops the dart, harder lifts it', () => {
  const intent = { aimX: 0, aimY: 0, speed: IDEAL_SPEED, yaw: 0, wobble: 0 }
  const soft = simulate(launch({ ...intent, speed: IDEAL_SPEED * 0.9 }, 'easy', createRng(1)))
  const hard = simulate(launch({ ...intent, speed: IDEAL_SPEED * 1.1 }, 'easy', createRng(1)))
  assert.ok(soft.point[1] < -0.03)
  assert.ok(hard.point[1] > 0.02)
})

test('the same seed replays the same dart', () => {
  const intent = { aimX: 0.01, aimY: 0.1, speed: 6.3, yaw: 0.01, wobble: 0.3 }
  const a = throwDart(intent, 'normal', createRng(42))
  const b = throwDart(intent, 'normal', createRng(42))
  assert.deepEqual(a, b)
})

test('release spread matches the skill level', () => {
  const rng = createRng(7)
  let sum = 0
  let squares = 0
  const n = 20000
  for (let i = 0; i < n; i++) {
    const g = gaussian(rng)
    sum += g
    squares += g * g
  }
  assert.ok(Math.abs(sum / n) < 0.03)
  assert.ok(Math.abs(squares / n - 1) < 0.04)
  const spreadOf = (level: keyof typeof SPREAD) => {
    const rand = createRng(11)
    const point = targetPoint(20, 3)
    let total = 0
    for (let i = 0; i < 400; i++) {
      const hit = throwDart({ aimX: point.x, aimY: point.y, speed: IDEAL_SPEED, yaw: 0, wobble: 0 }, level, rand).impact
      total += Math.hypot(hit.point[0] - point.x, hit.point[1] - point.y)
    }
    return total / 400
  }
  assert.ok(spreadOf('pro') < spreadOf('league'))
  assert.ok(spreadOf('league') < spreadOf('pub'))
})

test('501 double out: checkout on a double wins the leg', () => {
  let state = createMatch('t', x01(501, false, true), [{ id: 'a', name: 'A' }])
  state = { ...state, players: state.players.map((p) => ({ ...p, score: 40, turnStartScore: 40 })) }
  const result = applyThrow(state, 'a', bed(20, 2))
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerId, 'a')
  assert.equal(result.state.players[0].stats.bestCheckout, 40)
})

test('double out busts below zero, on one and on a single to zero', () => {
  const at = (score: number) => {
    const state = createMatch('t', x01(501, false, true), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    state.players[0].score = score
    state.players[0].turnStartScore = score
    return state
  }
  let r = applyThrow(at(32), 'a', bed(20, 1))
  r = applyThrow(r.state, 'a', bed(13, 1))
  assert.equal(r.turnOver, true)
  assert.equal(r.state.players[0].score, 32)
  assert.ok(r.announcements.some((a) => a.kind === 'bust'))
  r = applyThrow(at(21), 'a', bed(20, 1))
  assert.equal(r.state.players[0].score, 21)
  assert.equal(r.state.status, 'turnEnd')
  r = applyThrow(at(20), 'a', bed(20, 1))
  assert.equal(r.state.players[0].score, 20)
  assert.ok(r.announcements.some((a) => a.kind === 'bust'))
})

test('straight out finishes on any bed', () => {
  const state = createMatch('t', x01(301, false, false), [{ id: 'a', name: 'A' }])
  state.players[0].score = 20
  state.players[0].turnStartScore = 20
  assert.equal(applyThrow(state, 'a', bed(20, 1)).state.status, 'finished')
})

test('double in: nothing counts until a double', () => {
  let state = createMatch('t', x01(301, true, true), [{ id: 'a', name: 'A' }])
  let r = applyThrow(state, 'a', bed(20, 3))
  assert.equal(r.state.players[0].score, 301)
  r = applyThrow(r.state, 'a', bed(20, 2))
  assert.equal(r.state.players[0].score, 261)
  r = applyThrow(r.state, 'a', bed(20, 3))
  assert.equal(r.state.players[0].score, 201)
  state = r.state
  assert.equal(state.players[0].opened, true)
})

test('180 is announced and counted', () => {
  const state = createMatch('t', x01(501, false, true), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  let r = applyThrow(state, 'a', bed(20, 3))
  r = applyThrow(r.state, 'a', bed(20, 3))
  r = applyThrow(r.state, 'a', bed(20, 3))
  assert.ok(r.announcements.some((a) => a.kind === 'oneEighty'))
  assert.equal(r.state.players[0].stats.oneEighties, 1)
  assert.equal(r.state.players[0].stats.average, 180)
  const next = nextTurn(r.state).state
  assert.equal(next.currentTurnPlayerId, 'b')
  assert.equal(next.players[0].currentRoundThrows.length, 0)
})

test('legs and sets: the starter alternates and sets reset legs', () => {
  let state = createMatch('t', x01(301, false, false, 2, 2), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  const winLeg = (s: GameState, id: string) => {
    const copy: GameState = JSON.parse(JSON.stringify(s))
    while (copy.currentTurnPlayerId !== id) {
      const forfeited = forfeitTurn(copy, copy.currentTurnPlayerId)
      Object.assign(copy, nextTurn(forfeited.state).state)
    }
    const player = copy.players.find((p) => p.id === id)!
    player.score = 20
    player.turnStartScore = 20
    return applyThrow(copy, id, bed(20, 1)).state
  }
  state = winLeg(state, 'a')
  assert.equal(state.status, 'legOver')
  state = nextTurn(state).state
  assert.equal(state.currentTurnPlayerId, 'b')
  assert.equal(state.legs.current, 2)
  state = nextTurn(winLeg(state, 'a')).state
  assert.equal(state.sets.won.a, 1)
  assert.equal(state.legs.won.a, 0)
  assert.equal(state.sets.current, 2)
  state = nextTurn(winLeg(state, 'a')).state
  state = winLeg(state, 'a')
  assert.equal(state.status, 'finished')
  assert.equal(state.winnerId, 'a')
})

test('cricket: closing, points and the win', () => {
  const config: MatchConfig = { rules: { mode: 'cricket', scoring: true, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }
  let state = createMatch('t', config, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  let r = applyThrow(state, 'a', bed(20, 3))
  assert.equal(r.state.players[0].marks[20], 3)
  assert.ok(r.announcements.some((a) => a.kind === 'closed'))
  r = applyThrow(r.state, 'a', bed(20, 3))
  assert.equal(r.state.players[0].score, 60)
  r = applyThrow(r.state, 'a', bed(7, 3))
  state = nextTurn(r.state).state
  state = play(state, [bed(20, 3), bed(20, 3), miss()])
  assert.equal(state.players[1].score, 0, 'closed by both: no points')
  const winner: GameState = JSON.parse(JSON.stringify(state))
  for (const target of [19, 18, 17, 16, 15] as const) winner.players[0].marks[target] = 3
  r = applyThrow(winner, 'a', bed(25, 2))
  assert.equal(r.state.players[0].marks[25], 2)
  assert.notEqual(r.state.status, 'finished')
  r = applyThrow(r.state, 'a', bed(25, 1))
  assert.equal(r.state.status, 'finished')
  assert.equal(r.state.winnerId, 'a')
})

test('cricket: all closed but behind on points is not a win', () => {
  const config: MatchConfig = { rules: { mode: 'cricket', scoring: true, roundLimit: 20 }, legsPerSet: 1, setsToWin: 1 }
  const state = createMatch('t', config, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  for (const target of [20, 19, 18, 17, 16, 15] as const) state.players[0].marks[target] = 3
  state.players[1].score = 100
  const r = applyThrow(state, 'a', bed(25, 2))
  const s2 = applyThrow(r.state, 'a', bed(25, 1))
  assert.equal(s2.state.players[0].marks[25], 3)
  assert.notEqual(s2.state.status, 'finished')
})

test('count up: eight rounds, highest total wins', () => {
  const config: MatchConfig = { rules: { mode: 'countup', rounds: 8 }, legsPerSet: 1, setsToWin: 1 }
  let state = createMatch('t', config, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  for (let round = 0; round < 8; round++) {
    state = play(state, [bed(20, 3), bed(20, 1), bed(1, 1)])
    state = play(state, [bed(20, 1), bed(20, 1), bed(20, 1)])
  }
  assert.equal(state.status, 'finished')
  assert.equal(state.winnerId, 'a')
  assert.equal(state.players[0].score, 81 * 8)
  assert.equal(state.players[1].score, 60 * 8)
})

test('count up solo ends after the last round', () => {
  const config: MatchConfig = { rules: { mode: 'countup', rounds: 2 }, legsPerSet: 1, setsToWin: 1 }
  let state = createMatch('t', config, [{ id: 'a', name: 'A' }])
  state = play(state, [bed(20, 3), bed(20, 3), bed(20, 3)])
  assert.equal(state.status, 'playing')
  const r1 = applyThrow(state, 'a', bed(25, 2))
  const r2 = applyThrow(r1.state, 'a', bed(25, 2))
  const r3 = applyThrow(r2.state, 'a', bed(25, 1))
  assert.equal(r3.state.status, 'finished')
  assert.equal(r3.state.players[0].score, 305)
})

test('throws out of turn are ignored', () => {
  const state = createMatch('t', x01(501, false, true), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  assert.equal(applyThrow(state, 'b', bed(20, 3)).state, state)
})

test('a player who leaves hands the win to the last one standing', () => {
  const state = createMatch('t', x01(501, false, true), [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  const after = removePlayer(state, 'a')
  assert.equal(after.status, 'finished')
  assert.equal(after.winnerId, 'b')
})

test('checkout routes', () => {
  assert.deepEqual(checkoutRoute(170, 3, true), ['T20', 'T20', 'Bull'])
  assert.deepEqual(checkoutRoute(40, 1, true), ['D20'])
  assert.deepEqual(checkoutRoute(100, 3, true), ['T20', 'D20'])
  assert.deepEqual(checkoutRoute(60, 2, true), ['S20', 'D20'])
  assert.equal(checkoutRoute(169, 3, true), null)
  assert.equal(checkoutRoute(41, 1, true), null)
  assert.deepEqual(checkoutRoute(41, 1, false), null)
  assert.deepEqual(checkoutRoute(57, 1, false), ['T19'])
})

test('the computer goes for T20 and checks out', () => {
  const state = createMatch('t', x01(501, false, true), [{ id: 'c', name: 'CPU', cpu: true, cpuLevel: 'pro' }])
  assert.equal(cpuThrow(state, state.players[0], createRng(3)).bed, 'T20')
  state.players[0].score = 32
  assert.equal(cpuThrow(state, state.players[0], createRng(3)).bed, 'D16')
  let s = state
  const rng = createRng(99)
  let guard = 0
  s = createMatch('t', x01(301, false, true), [{ id: 'c', name: 'CPU', cpu: true, cpuLevel: 'pro' }])
  while (s.status !== 'finished' && guard++ < 300) {
    if (s.status !== 'playing') {
      s = nextTurn(s).state
      continue
    }
    const choice = cpuThrow(s, s.players[0], rng)
    const { impact } = throwDart(choice.intent, 'pro', rng)
    s = applyThrow(s, 'c', impact.dart).state
  }
  assert.equal(s.status, 'finished')
})

test('room codes', () => {
  const code = roomCode(createRng(5))
  assert.equal(code.length, 6)
  assert.ok(isRoomCode(code))
  assert.ok(!isRoomCode('ABCDE0'))
})

test('power meter: swings up and back, and its green band is the ideal speed', async () => {
  const { chargeLevel, speedFromLevel, speedFromCharge } = await import('../systems/ThrowInput')
  const { config } = await import('../config')
  const period = config.gesture.chargeSeconds
  assert.equal(chargeLevel(0), 0)
  assert.equal(chargeLevel(period / 2), 1)
  assert.ok(Math.abs(chargeLevel(period) - 0) < 1e-9)
  assert.ok(Math.abs(chargeLevel(period / 4) - 0.5) < 1e-9)
  assert.ok(speedFromLevel(0) < IDEAL_SPEED && speedFromLevel(1) > IDEAL_SPEED)
  const idealLevel = (1 - config.gesture.chargeLow) / (config.gesture.chargeHigh - config.gesture.chargeLow)
  assert.ok(Math.abs(speedFromLevel(idealLevel) - IDEAL_SPEED) < 1e-9)
  const rising = (idealLevel * period) / 2
  assert.ok(Math.abs(speedFromCharge(rising) - IDEAL_SPEED) < 1e-9)
  assert.ok(Math.abs(speedFromCharge(period - rising) - IDEAL_SPEED) < 1e-9)
})
