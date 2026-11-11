import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RADII, SECTORS, label, ringAt, scoreAt, sectorAt, targetPoint, toPolar } from '../shared/Board'
import { cpuThrow } from '../shared/Cpu'
import type { DartThrow, GameState, MatchConfig, Multiplier } from '../shared/interfaces'
import { HOLE, IDEAL_SPEED, METER, RELEASE, SPREAD, aimDirection, launch, meterReach, meterZone, simulate, throwDart, crossDistance } from '../shared/Physics'
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

test('Double Bull scores the outer bull as a 50 double in x01', () => {
  const outer = scoreAt(0, mm(10))
  const plain = play(createMatch('t', x01(301, false, true), [{ id: 'a', name: 'A' }]), [outer])
  assert.equal(plain.players[0].score, 276)
  const doubleBull: MatchConfig = { rules: { mode: 'x01', start: 301, doubleIn: true, doubleOut: true, doubleBull: true }, legsPerSet: 1, setsToWin: 1 }
  const opened = play(createMatch('t', doubleBull, [{ id: 'a', name: 'A' }]), [outer])
  assert.equal(opened.players[0].opened, true)
  assert.equal(opened.players[0].score, 251)
  const finish = createMatch('t', doubleBull, [{ id: 'a', name: 'A' }])
  finish.players[0].score = 50
  finish.players[0].turnStartScore = 50
  finish.players[0].opened = true
  const result = applyThrow(finish, 'a', outer)
  assert.equal(result.state.players[0].score, 0)
  assert.equal(result.state.status, 'finished')
})

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

test('the computer throwing softer drops the dart, harder lifts it', () => {
  const intent = { aimX: 0, aimY: 0, speed: IDEAL_SPEED, yaw: 0, wobble: 0 }
  const soft = simulate(launch({ ...intent, speed: IDEAL_SPEED * 0.9 }, 'pro', createRng(1)))
  const hard = simulate(launch({ ...intent, speed: IDEAL_SPEED * 1.1 }, 'pro', createRng(1)))
  assert.ok(soft.point[1] < -0.03)
  assert.ok(hard.point[1] > 0.02)
})

/** How far (in holes) each of `n` player darts released `d` green half-widths from the middle lands from the aim point. */
function missHoles(d: number, level: 'easy' | 'normal' | 'hard', n: number, seed: number, aim = targetPoint(20, 3)): number[] {
  const rng = createRng(seed)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const hit = simulate(launch({ aimX: aim.x, aimY: aim.y, speed: IDEAL_SPEED * (1 + d * METER.perfect), yaw: 0, wobble: 0.12 }, level, rng))
    out.push(Math.hypot(hit.point[0] - aim.x, hit.point[1] - aim.y) / HOLE)
  }
  return out
}

test('meter: the dead centre of the green lands exactly on the aim point at every steadiness', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const rng = createRng(3)
    for (const aim of [targetPoint(20, 3), targetPoint(25, 2), targetPoint(11, 2)]) {
      for (const d of [0, 0.1, -0.1]) {
        const hit = simulate(launch({ aimX: aim.x, aimY: aim.y, speed: IDEAL_SPEED * (1 + d * METER.perfect), yaw: 0, wobble: 1 }, level, rng))
        assert.ok(Math.hypot(hit.point[0] - aim.x, hit.point[1] - aim.y) < 0.0005, `${level} d=${d}`)
      }
    }
  }
})

test('meter: anywhere in the green lands within `greenHoles` of the aim at every steadiness, early or late', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    for (const d of [0.3, 0.6, 0.9, 1, -0.5, -1]) {
      for (const aim of [targetPoint(20, 3), targetPoint(25, 2), targetPoint(6, 2), targetPoint(19, 1)]) {
        const worst = Math.max(...missHoles(d, level, 150, 40 + Math.round(d * 10), aim))
        assert.ok(worst <= METER.greenHoles + 0.05, `${level} d=${d} worst ${worst.toFixed(2)} holes`)
      }
    }
  }
})

test('meter: the miss grows with how far from the middle you let go', () => {
  assert.equal(meterReach(IDEAL_SPEED, 'normal'), 0)
  const at = (d: number) => meterReach(IDEAL_SPEED * (1 + d * METER.perfect), 'normal')
  const line = METER.exact
  assert.ok(at(line + 0.05) > 0 && at(line + 0.05) < at(line + 0.2) && at(line + 0.2) < at(2) && at(2) < at(3))
  assert.ok(at(2) <= METER.yellowHoles * HOLE)
  assert.ok(Math.abs(at(2) - meterReach(IDEAL_SPEED * (1 - 2 * METER.perfect), 'normal')) < 1e-12, 'early and late releases miss alike')
  assert.ok(meterReach(IDEAL_SPEED * 1.015, 'easy') < meterReach(IDEAL_SPEED * 1.015, 'normal'))
  assert.ok(meterReach(IDEAL_SPEED * 1.03, 'normal') < meterReach(IDEAL_SPEED * 1.03, 'hard'))
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const near = avg(missHoles(line + 0.1, 'normal', 300, 21))
  const edge = avg(missHoles(2, 'normal', 300, 22))
  const yellow = avg(missHoles(8, 'normal', 300, 23))
  assert.ok(near < edge && edge < yellow, `${near} ${edge} ${yellow}`)
  assert.ok(edge >= 1.75 && edge <= 6, `two green half-widths out ${edge}`)
})

test('meter: in the green outside the white lines every dart misses, slightly, and more the further from the lines', () => {
  const line = METER.exact
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const near = missHoles(line + 0.05, 'normal', 200, 51)
  const mid = missHoles((line + 1) / 2, 'normal', 200, 52)
  const edge = missHoles(0.99, 'normal', 200, 53)
  assert.ok(Math.min(...near) > 0, 'just past the lines never lands dead on')
  assert.ok(avg(near) < avg(mid) && avg(mid) < avg(edge), `${avg(near)} ${avg(mid)} ${avg(edge)}`)
  assert.ok(Math.max(...edge) <= METER.nearMissHoles[1] + 0.2, `worst in the green ${Math.max(...edge)}`)
  const fewHoles = near.filter((m) => m >= METER.nearMissHoles[0] - 0.2).length / near.length
  assert.ok(fewHoles > 0.37 && fewHoles < 0.57, `just past the lines, a few holes off ${fewHoles}`)
  assert.ok(Math.max(...near) <= METER.nearMissHoles[1] + 0.2, `just past the lines, worst ${Math.max(...near)}`)
  const far = missHoles(10, 'normal', 400, 54)
  assert.ok(Math.min(...far) >= METER.greenEdgeHoles * METER.floorSpread - 0.2, 'the yellow misses at least as much as the green edge')
  assert.ok(Math.max(...far) <= METER.yellowHoles * 1.25 + 0.1, `worst ${Math.max(...far)}`)
})

test('cross meter: the height reading misses high or low and the side reading left or right, by how far off the middle', () => {
  const aim = targetPoint(20, 1)
  const at = (speedOff: number, side: number) => {
    const hit = simulate(launch({ aimX: aim.x, aimY: aim.y, speed: IDEAL_SPEED * (1 + speedOff), yaw: 0, wobble: 0.12, cross: side }, 'normal', createRng(7)))
    return { x: (hit.point[0] - aim.x) / HOLE, y: (hit.point[1] - aim.y) / HOLE }
  }
  const centre = at(0, 0)
  assert.ok(Math.hypot(centre.x, centre.y) < 0.15, 'both in the white lines flies true')
  const inside = METER.perfect * METER.exact * 0.9
  assert.ok(Math.hypot(at(inside, -inside).x, at(inside, -inside).y) < 0.15)
  assert.ok(at(0, -0.02).x < -0.5 && Math.abs(at(0, -0.02).y) < 0.15, 'stopped left misses left')
  assert.ok(at(0, 0.02).x > 0.5, 'stopped right misses right')
  assert.ok(at(0.02, 0).y > 0.5 && Math.abs(at(0.02, 0).x) < 0.15, 'height above the green misses high')
  assert.ok(at(-0.02, 0).y < -0.5, 'height below the green misses low')
  assert.ok(at(0, 0.06).x > at(0, 0.02).x && at(0, 0.12).x > at(0, 0.06).x, 'further out sideways misses further')
  const a = at(0.03, -0.04)
  const b = at(0.03, -0.04)
  assert.deepEqual(a, b, 'the cross meter has no luck in it')
  for (const off of [0.001, 0.003, 0.005]) assert.ok(crossDistance(off + 0.001, 'normal', true) >= crossDistance(off, 'normal', true))
})

test('meter: zones run perfect, then yellow, then red, with the white lines inside the solid green', () => {
  assert.equal(meterZone(IDEAL_SPEED), 'perfect')
  assert.equal(meterZone(IDEAL_SPEED * (1 + METER.perfect * METER.exact * 0.5)), 'perfect')
  assert.equal(meterZone(IDEAL_SPEED * (1 - METER.perfect * METER.exact * 0.98)), 'perfect')
  assert.equal(meterZone(IDEAL_SPEED * (1 - METER.perfect * 1.5)), 'yellow')
  assert.equal(meterZone(IDEAL_SPEED * (1 - METER.band - 0.01)), 'low')
  assert.equal(meterZone(IDEAL_SPEED * (1 + METER.band + 0.01)), 'high')
})

test('meter: past the yellow, a soft release drops the dart and a hard one lifts it', () => {
  const aim = targetPoint(20, 1)
  let soft = 0
  let hard = 0
  const rng = createRng(31)
  for (let i = 0; i < 200; i++) {
    soft += simulate(launch({ aimX: aim.x, aimY: aim.y, speed: IDEAL_SPEED * 0.85, yaw: 0, wobble: 0 }, 'normal', rng)).point[1] - aim.y
    hard += simulate(launch({ aimX: aim.x, aimY: aim.y, speed: IDEAL_SPEED * 1.15, yaw: 0, wobble: 0 }, 'normal', rng)).point[1] - aim.y
  }
  assert.ok(soft / 200 < -0.03, `soft ${soft / 200}`)
  assert.ok(hard / 200 > 0.02, `hard ${hard / 200}`)
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

test('soft-tip dart: black point on the axis, gunmetal barrel, four white flights at right angles', async () => {
  const { NodeIO } = await import('@gltf-transform/core')
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
  const { MeshoptDecoder } = await import('meshoptimizer')
  const { config } = await import('../config')
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read('public/models/darts/dart-soft.glb')
  const parts = new Map<string, Float32Array>()
  const colours = new Map<string, { color: number[]; metal: number }>()
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const matrix = node.getWorldMatrix()
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()!
      const position = primitive.getAttribute('POSITION')!
      const points = new Float32Array(position.getCount() * 3)
      const v = [0, 0, 0]
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, v)
        for (let k = 0; k < 3; k++) points[i * 3 + k] = matrix[k] * v[0] + matrix[4 + k] * v[1] + matrix[8 + k] * v[2] + matrix[12 + k]
      }
      parts.set(material.getName(), points)
      colours.set(material.getName(), { color: material.getBaseColorFactor(), metal: material.getMetallicFactor() })
    }
  }
  assert.deepEqual([...parts.keys()].sort(), ['barrel', 'flight-white', 'shaft', 'tip'])
  const extent = (points: Float32Array) => {
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
    for (let i = 0; i < points.length / 3; i++) {
      box.x0 = Math.min(box.x0, points[i * 3]); box.x1 = Math.max(box.x1, points[i * 3])
      box.y0 = Math.min(box.y0, points[i * 3 + 1]); box.y1 = Math.max(box.y1, points[i * 3 + 1])
      box.z0 = Math.min(box.z0, points[i * 3 + 2]); box.z1 = Math.max(box.z1, points[i * 3 + 2])
    }
    return box
  }
  const tip = extent(parts.get('tip')!)
  assert.ok(Math.abs(tip.z0) < 1e-5, `nose at the origin: ${tip.z0}`)
  assert.ok(Math.abs(tip.x0 + tip.x1) < 1e-4 && Math.abs(tip.y0 + tip.y1) < 1e-4, 'point centred on the axis')
  const flights = extent(parts.get('flight-white')!)
  assert.ok(Math.abs(flights.z1 - config.dart.length) < 1e-4, `dart length ${flights.z1}`)
  const fins = new Set<number>()
  const points = parts.get('flight-white')!
  for (let i = 0; i < points.length / 3; i++) {
    const x = points[i * 3], y = points[i * 3 + 1]
    if (Math.hypot(x, y) > 0.008) fins.add(Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 / 90 - 0.5))
  }
  assert.equal(fins.size, 4, 'four fins, one in each quadrant')
  const brightness = (name: string) => colours.get(name)!.color.slice(0, 3).reduce((sum, c) => sum + c, 0) / 3
  assert.ok(brightness('tip') < 0.05 && colours.get('tip')!.metal === 0, 'black plastic point')
  assert.ok(brightness('flight-white') > 0.85, 'white flights')
  assert.ok(colours.get('barrel')!.metal === 1 && brightness('barrel') > 0.15 && brightness('barrel') < 0.7, 'metallic gray barrel')
})
