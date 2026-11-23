import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INPUT_BYTES, createInput, decodeInput, encodeInput } from '../sim/Controls'
import { SIM_HZ } from '../sim/Simulation'
import { TERRAIN } from '../shared/Terrain'
import { makeSim, snapshot } from './helpers'

const GUSTY = { direction: 240, speed: 7.2, gust: 5.1, turbulence: 0.5 }

function scripted(seed: number) {
  const sim = makeSim(GUSTY, seed)
  sim.aircraft.placeOnGround(TERRAIN, -560, 0, 90)
  sim.settle()
  const log: Uint8Array[] = []
  sim.onTick((_tick, input) => {
    const bytes = new Uint8Array(INPUT_BYTES)
    encodeInput(input, bytes, 0)
    log.push(bytes)
  })
  for (let t = 0; t < SIM_HZ * 70; t++) {
    const s = t / SIM_HZ
    sim.pilot.throttle = s < 1 ? 0 : 1
    sim.pilot.pitch = s > 15 ? 0.3 * Math.sin(s * 0.7) + 0.1 : 0
    sim.pilot.roll = s > 25 ? 0.4 * Math.sin(s * 0.31) : 0
    sim.pilot.yaw = s < 20 ? 0.2 : 0
    sim.pilot.flaps = s > 40 ? 1 : 0
    sim.pilot.trim = s > 30 && s < 32 ? 1 : 0
    sim.stepPilot()
  }
  return { sim, log }
}

test('the same inputs and seed give bit-identical flights', () => {
  const a = scripted(1234)
  const b = scripted(1234)
  assert.deepEqual(snapshot(a.sim), snapshot(b.sim))
  assert.notDeepEqual(snapshot(a.sim), snapshot(scripted(99).sim))
})

test('a recorded input log replays to the exact same state', () => {
  const live = scripted(4321)
  const replay = makeSim(GUSTY, 4321)
  replay.aircraft.placeOnGround(TERRAIN, -560, 0, 90)
  replay.settle()
  const input = createInput()
  for (const bytes of live.log) replay.stepWith(decodeInput(bytes, 0, input))
  assert.deepEqual(snapshot(replay), snapshot(live.sim))
})
