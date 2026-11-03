import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tuning, type HoleData, type Polygon } from '../tuning'
import { simulateShot, type ShotParams } from '../systems/BallFlight'
import { createCourse, courseFor } from '../systems/Course'
import { springStep } from '../systems/Camera'
import { applyShot, createMatch, nextPlayer, pickHoles, placements, scoreLabel, shotParamsFor, shotRejection, windSeedsFor, type MatchState } from '../systems/Match'
import { parseMessage } from '../systems/Protocol'
import { MENU, reduceRound, tickRound } from '../systems/Round'
import { accuracyToCurve, idleMeter, stepMeter } from '../systems/SwingMeter'
import { liePowerFactor } from '../systems/Surfaces'
import { createRandom } from '../systems/Random'
import { windAtHeight } from '../systems/Wind'

const square = (x0: number, z0: number, x1: number, z1: number): Polygon => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

function flatHole(overrides: Partial<HoleData> = {}): HoleData {
  return {
    ...tuning.holes[0],
    hills: [],
    greenSlope: [0, 0],
    water: [],
    bunkers: [],
    paths: [],
    trees: [],
    drops: [],
    fairway: [square(-200, -700, 200, 10)],
    green: square(-12, -722, 12, -698),
    teeBox: square(-4, -4, 4, 4),
    tee: [0, 0],
    pin: [0, -710],
    bounds: [-400, -900, 400, 60],
    ...overrides,
  }
}

const flat = createCourse(0, tuning.terrain, flatHole())

function shot(overrides: Partial<ShotParams> = {}): ShotParams {
  return { hole: 0, origin: [0, 0, 0], yaw: Math.PI, club: 'driver', power: 1, curve: 0, spin: 0, lie: 'fairway', teeShot: false, wind: [0, 0], ...overrides }
}

const total = (params: ShotParams, course = flat, seed = 7) => {
  const result = simulateShot(params, seed, course)
  return Math.hypot(result.rest[0] - params.origin[0], result.rest[2] - params.origin[2])
}

describe('ball flight', () => {
  it('carries the driver at full power inside the configured range', () => {
    const result = simulateShot(shot(), 1, flat)
    const [min, max] = tuning.flight.carryRange
    assert.ok(result.carry >= min && result.carry <= max, `driver carry ${result.carry.toFixed(1)} m outside ${min}–${max} m`)
    assert.equal(result.outcome, 'rest')
    assert.ok(total(shot()) > result.carry, 'the ball should bounce and roll on past the landing spot')
  })

  it('is deterministic for the same parameters and seed', () => {
    const a = simulateShot(shot({ curve: 0.3, spin: 0.4, lie: 'rough' }), 99, flat)
    const b = simulateShot(shot({ curve: 0.3, spin: 0.4, lie: 'rough' }), 99, flat)
    assert.deepEqual(a.samples, b.samples)
    assert.deepEqual(a.rest, b.rest)
  })

  it('shortens the carry into a headwind and lengthens it downwind', () => {
    const calm = simulateShot(shot(), 1, flat).carry
    const into = simulateShot(shot({ wind: [0, 6] }), 1, flat).carry
    const behind = simulateShot(shot({ wind: [0, -6] }), 1, flat).carry
    assert.ok(into < calm - 5, `headwind carry ${into.toFixed(1)} should be well short of ${calm.toFixed(1)}`)
    assert.ok(behind > calm, 'a tailwind should add carry')
  })

  it('steepens the descent with more backspin and flattens it with topspin', () => {
    const base = simulateShot(shot(), 1, flat).descentDegrees ?? 0
    const back = simulateShot(shot({ spin: 1 }), 1, flat).descentDegrees ?? 0
    const top = simulateShot(shot({ spin: -1 }), 1, flat).descentDegrees ?? 0
    assert.ok(back > base + 2, `backspin descent ${back.toFixed(1)}° should exceed ${base.toFixed(1)}°`)
    assert.ok(top < base, 'topspin should land flatter')
  })

  it('curves a slice right and a hook left', () => {
    const slice = simulateShot(shot({ curve: 1 }), 1, flat).rest
    const hook = simulateShot(shot({ curve: -1 }), 1, flat).rest
    assert.ok(slice[0] > 20, 'heading −z, the right-hand side is +x')
    assert.ok(hook[0] < -20)
  })

  it('at least halves the distance from a bunker lie', () => {
    const fairway = total(shot({ club: 'iron7' }))
    const bunker = total(shot({ club: 'iron7', lie: 'bunker' }))
    assert.ok(bunker <= fairway * 0.55, `bunker ${bunker.toFixed(1)} m vs fairway ${fairway.toFixed(1)} m`)
    assert.equal(simulateShot(shot({ club: 'iron7', lie: 'bunker' }), 1, flat).spinRpm, 0, 'sand takes the spin off')
  })

  it('rolls a seeded rough penalty between 0.6 and 0.8 and gives tee shots the fairway factor', () => {
    const values = Array.from({ length: 50 }, (_, seed) => liePowerFactor('rough', false, createRandom(seed)))
    assert.ok(values.every((value) => value >= 0.6 && value <= 0.8))
    assert.ok(new Set(values.map((value) => value.toFixed(3))).size > 10)
    assert.equal(liePowerFactor('rough', true, createRandom(3)), 1)
  })

  it('ends the shot in water with a one-stroke penalty and a drop', () => {
    const course = createCourse(0, tuning.terrain, flatHole({ water: [square(-60, -260, 60, -150)], drops: [[5, -140]] }))
    const result = simulateShot(shot(), 1, course)
    assert.equal(result.outcome, 'water')
    assert.equal(result.penalty, 1)
    assert.equal(result.next[0], 5)
    assert.equal(result.next[2], -140)
  })

  it('returns an out-of-bounds shot to the previous spot with stroke and distance', () => {
    const course = createCourse(0, tuning.terrain, flatHole({ bounds: [-15, -900, 15, 60] }))
    const origin: [number, number, number] = [2, 0, -3]
    const result = simulateShot(shot({ origin, curve: 1 }), 1, course)
    assert.equal(result.outcome, 'out')
    assert.equal(result.penalty, 1)
    assert.equal(result.next[0], origin[0])
    assert.equal(result.next[2], origin[2])
  })

  it('breaks a putt downhill across a tilted green', () => {
    const tilted = createCourse(0, tuning.terrain, flatHole({ fairway: [], green: square(-40, -60, 40, 20), greenSlope: [0.02, 0] }))
    const result = simulateShot(shot({ club: 'putter', lie: 'green', power: 0.5 }), 1, tilted)
    assert.ok(result.rest[0] < -0.5, `the ball should drift toward −x (downhill), ended at x=${result.rest[0].toFixed(2)}`)
  })

  it('holes a putt that reaches the cup slowly', () => {
    const course = createCourse(0, tuning.terrain, flatHole({ fairway: [], green: square(-20, -20, 20, 20), pin: [0, -3] }))
    let holed = false
    for (let power = 0.05; power < 0.4 && !holed; power += 0.005) holed = simulateShot(shot({ club: 'putter', lie: 'green', power }), 1, course).outcome === 'holed'
    assert.ok(holed, 'some putt strength should drop in a three-metre putt')
  })

  it('keeps the wind weaker near the ground', () => {
    assert.ok(windAtHeight([5, 0], 0)[0] < windAtHeight([5, 0], 30)[0])
  })
})

describe('swing meter', () => {
  it('climbs, locks power on the second click and samples accuracy on the third', () => {
    let meter = stepMeter(idleMeter(), true, 1 / 60)
    assert.equal(meter.phase, 'climbing')
    for (let step = 0; step < 60; step++) meter = stepMeter(meter, false, 1 / 60)
    meter = stepMeter(meter, true, 1 / 60)
    assert.equal(meter.phase, 'returning')
    assert.ok(Math.abs(meter.power - tuning.meter.climbRate) < 0.05)
    const steps = Math.round(((meter.needle - tuning.meter.accuracyLine) / tuning.meter.returnRate) * 60)
    for (let step = 0; step < steps; step++) meter = stepMeter(meter, false, 1 / 60)
    meter = stepMeter(meter, true, 1 / 60)
    assert.equal(meter.phase, 'done')
    assert.equal(meter.curve, 0, 'a click on the line is straight')
  })

  it('hooks early, slices late and takes a maximum miss on overshoot', () => {
    assert.ok(accuracyToCurve(0.08) < 0)
    assert.ok(accuracyToCurve(-0.08) > 0)
    let meter = stepMeter(idleMeter(), true, 1 / 60)
    meter = stepMeter(meter, true, 1 / 60)
    for (let step = 0; step < 600 && meter.phase !== 'done'; step++) meter = stepMeter(meter, false, 1 / 60)
    assert.equal(meter.phase, 'done')
    assert.equal(meter.overshot, true)
    assert.equal(meter.curve, 1)
  })
})

describe('camera spring', () => {
  it('settles on the target without overshooting', () => {
    let value = 0
    let velocity = 0
    let peak = 0
    for (let step = 0; step < 240; step++) {
      ;[value, velocity] = springStep(value, velocity, 10, 4, 1 / 60)
      peak = Math.max(peak, value)
    }
    assert.ok(Math.abs(value - 10) < 0.01)
    assert.ok(peak <= 10 + 1e-9)
  })
})

describe('match', () => {
  const seats = [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Bo' },
  ]
  const make = (mode: 'solo' | 'pin' | 'online' = 'online'): MatchState => {
    const holes = mode === 'online' ? [0, 4, 8] : pickHoles(mode, 5)
    return createMatch({ mode, holes, windSeeds: windSeedsFor(holes, 5), matchSeed: 5, players: mode === 'online' ? seats : seats.slice(0, 1) })
  }

  it('plays all nine holes solo and three online', () => {
    assert.equal(pickHoles('solo', 1).length, 9)
    const online = pickHoles('online', 1)
    assert.equal(online.length, 3)
    assert.equal(new Set(online).size, 3)
  })

  it('validates turns and sends the farthest player next', () => {
    let state = make()
    assert.equal(state.current, 'a')
    assert.ok(shotRejection(state, 'b'))
    const params = shotParamsFor(state, 'a', { yaw: Math.PI, club: 'driver', power: 1, curve: 0, spin: 0 })
    const result = simulateShot(params, 1)
    state = applyShot(state, 'a', result).state
    assert.equal(state.current, 'b', 'the player still on the tee is farthest from the pin')
    assert.equal(nextPlayer(state), 'b')
  })

  it('applies the water penalty and drop through the match', () => {
    const state = make('solo')
    const course = courseFor(state.holes[0])
    const fake = { ...simulateShot(shotParamsFor(state, 'a', { yaw: Math.PI, club: 'driver', power: 0.5, curve: 0, spin: 0 }), 1), outcome: 'water' as const, penalty: 1, next: course.dropPosition(0), nextLie: 'rough' as const }
    const next = applyShot(state, 'a', fake)
    assert.equal(next.state.players[0].strokes[0], 2)
    assert.deepEqual(next.state.players[0].ball, course.dropPosition(0))
    assert.ok(next.events.some((event) => event.type === 'penalty' && event.reason === 'water'))
  })

  it('keeps an out-of-bounds ball on the tee with stroke and distance', () => {
    const state = make('solo')
    const params = shotParamsFor(state, 'a', { yaw: Math.PI, club: 'driver', power: 1, curve: 0, spin: 0 })
    const result = { ...simulateShot(params, 1), outcome: 'out' as const, penalty: 1, next: params.origin, nextLie: 'tee' as const }
    const next = applyShot(state, 'a', result).state.players[0]
    assert.equal(next.strokes[0], 2)
    assert.deepEqual(next.ball, params.origin)
    assert.equal(next.teeShot, true)
  })

  it('records one closest-to-the-pin shot per hole and moves on', () => {
    const state = make('pin')
    const params = shotParamsFor(state, 'a', { yaw: Math.PI, club: 'iron7', power: 0.8, curve: 0, spin: 0 })
    const update = applyShot(state, 'a', simulateShot(params, 1))
    assert.ok(update.events.some((event) => event.type === 'pin'))
    assert.ok(update.events.some((event) => event.type === 'holeComplete'))
    assert.equal(update.state.holeIndex, 1)
  })

  it('ranks players by total strokes with shared places', () => {
    const state = make()
    const tied: MatchState = { ...state, players: state.players.map((player) => ({ ...player, strokes: [4, 4, 4] })) }
    assert.deepEqual(placements(tied).map((row) => row.place), [1, 1])
    assert.equal(scoreLabel(3, 4), 'Birdie')
    assert.equal(scoreLabel(1, 3), 'Hole in one')
  })
})

describe('protocol and round flow', () => {
  it('drops malformed peer messages', () => {
    assert.equal(parseMessage({ type: 'shot', playerId: 'x' }), null)
    assert.equal(parseMessage({ type: 'nope' }), null)
    assert.deepEqual(parseMessage({ type: 'turn', playerId: 'p1' }), { type: 'turn', playerId: 'p1' })
  })

  it('walks menu → preview → aiming → swinging', () => {
    let state = reduceRound(MENU, { type: 'begin', mode: 'solo' })
    assert.equal(state.phase, 'preview')
    state = tickRound(state, 10, false, 1).state
    assert.equal(state.phase, 'aiming')
    state = reduceRound(state, { type: 'swingPressed' })
    assert.equal(state.phase, 'swinging')
  })
})
