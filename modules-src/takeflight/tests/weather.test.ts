import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWeatherState, weatherAt, weatherWind, WEATHER_KINDS } from '../shared/Weather'
import { INPUT_BYTES, createInput, decodeInput, encodeInput } from '../sim/Controls'
import { SIM_HZ } from '../sim/Simulation'
import { TERRAIN } from '../shared/Terrain'
import { makeSim, snapshot } from './helpers'

const BASE = { direction: 270, speed: 5, gust: 2, turbulence: 0.2 }

test('every preset is sane and storms stir the wind more than fair weather', () => {
  for (const kind of WEATHER_KINDS) {
    const w = weatherAt(kind, 7, 0, createWeatherState())
    assert.ok(w.cover >= 0 && w.cover <= 1 && w.visibility > 500 && w.base >= 0 && w.depth > 100, kind)
  }
  const fair = weatherWind(BASE, weatherAt('fair', 1, 0, createWeatherState()), { ...BASE })
  const storm = weatherWind(BASE, weatherAt('storm', 1, 0, createWeatherState()), { ...BASE })
  assert.ok(storm.gust > fair.gust && storm.turbulence > fair.turbulence && storm.speed > fair.speed)
})

test('changing weather drifts through the cycle and is the same for the same seed', () => {
  const seen = new Set<number>()
  for (let s = 0; s < 36 * 60; s += 60) seen.add(Math.round(weatherAt('changing', 42, s, createWeatherState()).cover * 10))
  assert.ok(seen.size >= 3, `cover took ${seen.size} values`)
  assert.deepEqual(weatherAt('changing', 42, 777, createWeatherState()), weatherAt('changing', 42, 777, createWeatherState()))
  assert.notDeepEqual(weatherAt('changing', 42, 777, createWeatherState()), weatherAt('changing', 43, 777, createWeatherState()))
})

test('a flight in changing weather replays and continues from a snapshot bit for bit', () => {
  const run = () => {
    const sim = makeSim(BASE, 99)
    sim.reset({ wind: BASE, seed: 99, temperatureOffset: 0, seaLevelPressure: sim.setup.seaLevelPressure, assists: sim.setup.assists, weather: 'changing' })
    sim.aircraft.placeOnGround(TERRAIN, -560, 0, 90)
    sim.settle()
    return sim
  }
  const live = run()
  const log: Uint8Array[] = []
  let saved: ReturnType<typeof live.saveState> | null = null
  live.onTick((tick, input) => {
    const bytes = new Uint8Array(INPUT_BYTES)
    encodeInput(input, bytes, 0)
    log.push(bytes)
    if (tick === SIM_HZ * 25 + 37) saved = live.saveState()
  })
  for (let i = 0; i < SIM_HZ * 60; i++) {
    live.pilot.throttle = 1
    live.pilot.pitch = i > SIM_HZ * 12 ? 0.25 : 0
    live.stepPilot()
  }
  const replay = run()
  const input = createInput()
  for (const bytes of log) replay.stepWith(decodeInput(bytes, 0, input))
  assert.deepEqual(snapshot(replay), snapshot(live))
  const resumed = run()
  assert.ok(saved)
  resumed.loadState(saved)
  for (let i = SIM_HZ * 25 + 37; i < log.length; i++) resumed.stepWith(decodeInput(log[i], 0, input))
  assert.deepEqual(snapshot(resumed), snapshot(live))
  assert.deepEqual(resumed.env.wind.spec, live.env.wind.spec)
})
