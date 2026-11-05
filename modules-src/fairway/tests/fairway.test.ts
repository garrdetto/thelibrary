import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tuning, type HoleData, type Polygon, type ShotKind } from '../tuning'
import { simulateShot, type ShotParams } from '../systems/BallFlight'
import { addressSetup, poseFor, solveRig } from '../systems/GolferRig'
import { defaultShotKind, perfectParams, powerForDistance } from '../systems/ShotPlanner'
import { createCourse, courseFor } from '../systems/Course'
import { springStep } from '../systems/Camera'
import { applyShot, createMatch, nextPlayer, pickHoles, placements, scoreLabel, shotParamsFor, shotRejection, windSeedsFor, type MatchState } from '../systems/Match'
import { parseMessage } from '../systems/Protocol'
import { MENU, reduceRound, tickRound } from '../systems/Round'
import { effectivePower, signedMiss, startMeter, stepMeter, type MeterState, type SwingButton } from '../systems/SwingMeter'
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
  const dt = 1 / 60
  const held: SwingButton = { pressed: false, released: false, down: true }
  const up: SwingButton = { pressed: false, released: true, down: false }
  const idle: SwingButton = { pressed: false, released: false, down: false }
  const tap: SwingButton = { pressed: true, released: false, down: true }
  const run = (meter: MeterState, button: SwingButton, seconds: number) => {
    for (let step = 0; step < Math.round(seconds * 60); step++) meter = stepMeter(meter, button, dt)
    return meter
  }
  const perfectSwing = (holdSeconds: number, rhythmSeconds = tuning.meter.rhythmSeconds) => {
    let meter = run(startMeter(), held, holdSeconds)
    meter = stepMeter(meter, up, dt)
    assert.equal(meter.phase, 'path')
    meter = run(meter, idle, tuning.meter.pathSeconds)
    meter = stepMeter(meter, tap, dt)
    assert.equal(meter.phase, 'contact')
    meter = run(meter, idle, tuning.meter.contactSeconds)
    meter = stepMeter(meter, tap, dt)
    assert.equal(meter.phase, 'rhythm')
    meter = run(meter, held, rhythmSeconds)
    meter = stepMeter(meter, up, dt)
    assert.equal(meter.phase, 'strike')
    return run(meter, idle, tuning.meter.strikeSeconds + 0.05)
  }

  it('locks power on release, then path, contact and rhythm on the marks give a pure strike', () => {
    const meter = perfectSwing(1)
    assert.equal(meter.phase, 'done')
    assert.ok(Math.abs(meter.power - tuning.meter.powerRate) < 0.03, `power ${meter.power}`)
    assert.equal(meter.push, 0)
    assert.equal(meter.curve, 0)
    assert.equal(meter.rhythmLoss, 0)
    assert.equal(effectivePower(meter), meter.power)
  })

  it('pushes a late path tap, pulls an early one, and hooks an early contact click', () => {
    assert.ok(signedMiss(0.1) > 0)
    assert.ok(signedMiss(-0.1) < 0)
    assert.equal(signedMiss(0.01), 0, 'inside the perfect zone')
    let meter = stepMeter(run(startMeter(), held, 0.5), up, dt)
    meter = run(meter, idle, tuning.meter.pathSeconds * 1.12)
    meter = stepMeter(meter, tap, dt)
    assert.ok(meter.push > 0, 'late path tap pushes right')
    meter = run(meter, idle, tuning.meter.contactSeconds * 0.85)
    meter = stepMeter(meter, tap, dt)
    assert.ok(meter.curve < 0, 'early contact closes the face')
  })

  it('costs up to the full rhythm loss for an early release or a tap instead of a hold', () => {
    const early = perfectSwing(1, tuning.meter.rhythmSeconds * 0.5)
    assert.ok(early.rhythmLoss > 0.02 && early.rhythmLoss <= tuning.meter.maxRhythmLoss + 1e-9)
    assert.ok(effectivePower(early) < early.power)
    let tapped = stepMeter(run(startMeter(), held, 1), up, dt)
    tapped = stepMeter(run(tapped, idle, tuning.meter.pathSeconds), tap, dt)
    tapped = stepMeter(run(tapped, idle, tuning.meter.contactSeconds), tap, dt)
    tapped = stepMeter(tapped, up, dt)
    assert.equal(tapped.phase, 'strike')
    assert.ok(Math.abs(tapped.rhythmLoss - tuning.meter.maxRhythmLoss) < 1e-9)
  })

  it('takes a full miss when the cursor runs past the overrun', () => {
    let meter = stepMeter(run(startMeter(), held, 0.4), up, dt)
    meter = run(meter, idle, 5)
    assert.equal(meter.phase, 'done')
    assert.equal(meter.overran, true)
    assert.equal(meter.push, 1)
    assert.equal(meter.curve, 1)
  })

  it('auto-locks power at the cap while the button stays down', () => {
    const meter = run(startMeter(), held, 5)
    assert.notEqual(meter.phase, 'power')
    assert.equal(meter.power, tuning.meter.powerCap)
  })
})

describe('shot types', () => {
  const near = (overrides: Partial<ShotParams>) => shot({ club: 'sand', power: 0.7, ...overrides })
  const roll = (params: ShotParams) => {
    const result = simulateShot(params, 1, flat)
    assert.ok(result.landing, 'the ball should land')
    const toLanding = Math.hypot(result.landing[0] - params.origin[0], result.landing[2] - params.origin[2])
    const toRest = Math.hypot(result.rest[0] - params.origin[0], result.rest[2] - params.origin[2])
    return { result, roll: toRest - toLanding }
  }

  it('flies a flop highest and a chip lowest', () => {
    const chip = roll(near({ shot: 'chip' })).result
    const flop = roll(near({ shot: 'flop' })).result
    const full = roll(near({})).result
    assert.ok(flop.launchDegrees > full.launchDegrees && full.launchDegrees > chip.launchDegrees)
    assert.ok(flop.apex > chip.apex * 2, `flop apex ${flop.apex.toFixed(1)} vs chip ${chip.apex.toFixed(1)}`)
  })

  it('lets a chip release and stops a flop soft', () => {
    const chip = roll(near({ shot: 'chip', power: 0.6 }))
    const flop = roll(near({ shot: 'flop', power: 0.6 }))
    assert.ok(chip.roll > flop.roll * 2, `chip roll ${chip.roll.toFixed(1)} m vs flop ${flop.roll.toFixed(1)} m`)
  })

  it('makes a spinner bite harder than a chip on the green', () => {
    const green = createCourse(0, tuning.terrain, flatHole({ fairway: [], green: square(-60, -120, 60, 20) }))
    const run = (kind: ShotKind) => {
      const params = near({ club: 'pitching', shot: kind, power: 0.6, lie: 'fairway' })
      const result = simulateShot(params, 1, green)
      const landing = result.landing ?? result.rest
      return Math.hypot(result.rest[0] - landing[0], result.rest[2] - landing[2])
    }
    assert.ok(run('spinner') < run('chip') * 0.6, `spinner run-out ${run('spinner').toFixed(1)} m vs chip ${run('chip').toFixed(1)} m`)
  })

  it('pushes the start line right and ignores the shot type on a putt', () => {
    const straight = simulateShot(shot({ club: 'iron7' }), 1, flat).rest
    const pushed = simulateShot(shot({ club: 'iron7', push: 1 }), 1, flat).rest
    assert.ok(pushed[0] > straight[0] + 5, 'heading −z, the right-hand side is +x')
    const putt = shot({ club: 'putter', lie: 'green', power: 0.3 })
    assert.deepEqual(simulateShot({ ...putt, shot: 'flop' }, 1, flat).rest, simulateShot(putt, 1, flat).rest)
  })

  it('plans the power that carries a target and defaults to a chip near the green', () => {
    const params = shot({ club: 'iron7' })
    const power = powerForDistance(params, 120, flat)
    const carry = simulateShot(perfectParams(params, power), tuning.shortGame.previewSeed, flat).carry
    assert.ok(Math.abs(carry - 120) < 1.5, `planned carry ${carry.toFixed(1)} m`)
    assert.equal(powerForDistance(params, 5000, flat), 1)
    assert.equal(defaultShotKind(25, 'fairway'), 'chip')
    assert.equal(defaultShotKind(25, 'green'), 'full')
    assert.equal(defaultShotKind(120, 'rough'), 'full')
  })

  it('carries the shot type and push through the match and the wire', () => {
    const state = createMatch({ mode: 'solo', holes: [0], windSeeds: [1], matchSeed: 1, players: [{ id: 'a', name: 'Ada' }] })
    const params = shotParamsFor(state, 'a', { yaw: 1, club: 'sand', power: 0.5, curve: 0, spin: 0, push: 0.4, shot: 'flop' })
    assert.equal(params.shot, 'flop')
    assert.equal(params.push, 0.4)
    const message = parseMessage({ type: 'shot', playerId: 'a', params, seed: 3 })
    assert.ok(message && message.type === 'shot' && message.params.shot === 'flop')
  })
})

describe('golfer rig', () => {
  it('puts the club head on the ball at address and at impact', () => {
    for (const club of ['driver', 'iron7', 'sand', 'putter'] as const) {
      const setup = addressSetup(club)
      for (const pose of [poseFor({ stage: 'address', progress: 0, amount: 1, club, shot: 'full', time: 0 }), poseFor({ stage: 'down', progress: 1, amount: 1, club, shot: 'full', time: 0 })]) {
        const solved = solveRig(setup, pose)
        const miss = Math.hypot(solved.clubHead[0] - setup.ball[0], solved.clubHead[1] - setup.ball[1], solved.clubHead[2] - setup.ball[2])
        assert.ok(miss < 0.12, `${club} head ${miss.toFixed(3)} m from the ball`)
      }
    }
  })

  it('keeps both hands on the grip through the swing', () => {
    const setup = addressSetup('iron7')
    for (const [stage, progress] of [['back', 1], ['down', 0.5], ['follow', 0.5], ['follow', 1]] as const) {
      const solved = solveRig(setup, poseFor({ stage, progress, amount: 1, club: 'iron7', shot: 'full', time: 0 }))
      const gap = Math.hypot(solved.wrists[0][0] - solved.wrists[1][0], solved.wrists[0][1] - solved.wrists[1][1], solved.wrists[0][2] - solved.wrists[1][2])
      assert.ok(gap < 0.14, `${stage} ${progress}: wrists ${gap.toFixed(3)} m apart`)
      assert.ok(solved.bones.every((bone) => bone.quaternion.every(Number.isFinite)))
    }
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
    state = tickRound(state, 10, { pressed: false, released: false, down: false }, 1).state
    assert.equal(state.phase, 'aiming')
    state = reduceRound(state, { type: 'swingPressed' })
    assert.equal(state.phase, 'swinging')
  })
})
