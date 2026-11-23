import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SWING_DELAY, TOSS_GRAVITY, TOSS_SPEED, ZONE_HALF, ZONE_Y } from '../sim/constants'
import { launch, simulateToRest, stepFlight } from '../sim/flight'
import { resolveSwing, sweetSpotPressTime, tossHeight, tossLandTime } from '../sim/swing'
import { Track } from '../sim/track'

const emptyTrack = (): Track => {
  const track = new Track(1)
  track.ensure(30000)
  track.elements.length = 0
  return track
}

const pressFor = (quality: number): number => {
  const target = ZONE_Y + quality * ZONE_HALF
  let lo = sweetSpotPressTime() + SWING_DELAY - 0.6
  let hi = tossLandTime()
  const peak = TOSS_SPEED / TOSS_GRAVITY
  lo = Math.max(lo, peak)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (tossHeight(mid) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2 - SWING_DELAY
}

test('sweet spot launches a line drive at 35-45 degrees with full power', () => {
  const swing = resolveSwing(sweetSpotPressTime())
  assert.equal(swing.kind, 'homer')
  assert.ok(swing.angleDeg >= 35 && swing.angleDeg <= 45, `angle ${swing.angleDeg}`)
  assert.ok(swing.power > 0.99)
})

test('early swing pops the fish up high and short', () => {
  const swing = resolveSwing(pressFor(0.7))
  assert.equal(swing.kind, 'pop')
  assert.ok(swing.angleDeg > 55)
  const sweet = simulateToRest(resolveSwing(sweetSpotPressTime()), emptyTrack(), 0).state
  const pop = simulateToRest(swing, emptyTrack(), 0).state
  assert.ok(pop.peak / pop.x > sweet.peak / sweet.x)
  assert.ok(pop.x < sweet.x)
})

test('late swing sends a low grounder that skips', () => {
  const swing = resolveSwing(pressFor(-0.75))
  assert.equal(swing.kind, 'grounder')
  assert.ok(swing.angleDeg < 20)
  const { state } = simulateToRest(swing, emptyTrack(), 0)
  assert.ok(state.bounces >= 2, `bounces ${state.bounces}`)
})

test('swinging far too early or after the fish lands whiffs', () => {
  assert.equal(resolveSwing(0.05).kind, 'whiff')
  assert.equal(resolveSwing(tossLandTime()).kind, 'whiff')
})

test('a sweet hit on an empty plain travels a long way and slides to rest', () => {
  const { state } = simulateToRest(resolveSwing(sweetSpotPressTime()), emptyTrack(), 0)
  assert.equal(state.reason, 'slide')
  assert.ok(state.x > 100 && state.x < 400, `distance ${state.x}`)
})

test('a steep nose-dive embeds and stops at once', () => {
  const state = launch(resolveSwing(sweetSpotPressTime()))
  state.x = 50
  state.y = 6
  state.vx = 3
  state.vy = -25
  const track = emptyTrack()
  while (state.mode !== 'stopped') stepFlight(state, track, 0)
  assert.equal(state.reason, 'nosedive')
  assert.ok(state.x < 51)
})

test('slick ice carries a sliding fish farther than snow', () => {
  const slide = (slick: boolean) => {
    const track = emptyTrack()
    if (slick) track.elements.push({ kind: 'slick', id: 99, x0: 40, x1: 400 })
    const state = launch(resolveSwing(sweetSpotPressTime()))
    Object.assign(state, { x: 50, y: 0, vx: 15, vy: 0, mode: 'slide' })
    while (state.mode !== 'stopped') stepFlight(state, track, 0)
    return state.x
  }
  assert.ok(slide(true) - 50 > (slide(false) - 50) * 3)
})

test('holes and snowbanks stop the fish, bouncers relaunch it', () => {
  const run = (element: Parameters<Track['elements']['push']>[0]) => {
    const track = emptyTrack()
    track.elements.push(element)
    const state = launch(resolveSwing(sweetSpotPressTime()))
    Object.assign(state, { x: 50, y: 0, vx: 12, vy: 0, mode: 'slide' })
    const events = []
    while (state.mode !== 'stopped') events.push(...stepFlight(state, track, 0))
    return { state, events }
  }
  assert.equal(run({ kind: 'hole', id: 1, x: 56, radius: 1.5 }).state.reason, 'hole')
  assert.equal(run({ kind: 'bank', id: 2, x0: 56, x1: 59, height: 1.5 }).state.reason, 'bank')
  const bounced = run({ kind: 'bouncer', id: 3, type: 'walrus', x: 56, radius: 1.5, top: 1.35, boost: 12.5 })
  assert.equal(bounced.state.combo, 1)
  assert.ok(bounced.events.some(e => e.type === 'bouncer'))
  assert.ok(bounced.state.x > 70)
})

test('tracks are deterministic per seed and keep a clear start', () => {
  const a = new Track(42)
  const b = new Track(42)
  a.ensure(2000)
  b.ensure(2000)
  assert.deepEqual(a.elements, b.elements)
  assert.ok(a.elements.length > 10)
  assert.ok(a.elements.every(e => (e.kind === 'slick' || e.kind === 'bank' ? e.x0 : e.x) >= 30))
  const kinds = new Set(a.elements.map(e => e.kind))
  for (const kind of ['slick', 'bouncer', 'hole', 'bank']) assert.ok(kinds.has(kind as never), kind)
})

test('the same shot on the same track lands on the same spot', () => {
  const swing = resolveSwing(sweetSpotPressTime() + 0.02)
  const one = simulateToRest(swing, new Track(7), 1.5).state.x
  const two = simulateToRest(swing, new Track(7), 1.5).state.x
  assert.equal(one, two)
})
