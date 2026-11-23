import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HARROW_FIELD } from '../shared/Airports'
import { RECORD_VERSION, RecordWriter, readRecord } from '../shared/FlightRecord'
import type { RecordHeader } from '../shared/FlightRecord'
import { TERRAIN } from '../shared/Terrain'
import { Reflight } from '../sim/Reflight'
import { band, scoreFlight } from '../sim/Scoring'
import type { FlightData } from '../sim/Scoring'
import { SIM_HZ } from '../sim/Simulation'
import { placeStart, startsAirborne } from '../sim/Starts'
import type { StartKind } from '../sim/Starts'
import { FlightRecorder } from '../sim/Telemetry'
import { WREN, landingPilot, makeSim } from './helpers'

const LIGHT = { direction: 90, speed: 3.1, gust: 0, turbulence: 0.12 }

function fly(start: StartKind, seconds: number, options: { flareHeight?: number; sinkTarget?: number } = {}, warmup = false) {
  const sim = makeSim(LIGHT, 2024)
  if (warmup) {
    placeStart(sim.aircraft, sim.pilot, HARROW_FIELD, TERRAIN, 'runway1')
    sim.settle()
    sim.pilot.throttle = 1
    for (let i = 0; i < SIM_HZ * 20; i++) sim.stepPilot()
  }
  const header: RecordHeader = { version: RECORD_VERSION, aircraft: WREN.id, airport: HARROW_FIELD.id, start, wind: LIGHT, seed: 2024, temperatureOffset: 0, seaLevelPressure: sim.setup.seaLevelPressure, assists: { ...sim.setup.assists } }
  sim.reset({ wind: header.wind, seed: header.seed, temperatureOffset: 0, seaLevelPressure: header.seaLevelPressure, assists: header.assists })
  placeStart(sim.aircraft, sim.pilot, HARROW_FIELD, TERRAIN, start)
  sim.settle()
  const recorder = new FlightRecorder()
  recorder.attach(sim)
  recorder.reset(startsAirborne(start))
  const level = () => {
    sim.pilot.pitch = Math.max(-1, Math.min(1, -sim.aircraft.vy * 0.05 - sim.aircraft.wz * 2))
    sim.pilot.roll = -sim.aircraft.bank * 0.02
  }
  const pilot = start === 'cruise' ? level : landingPilot(sim, options)
  for (let i = 0; i < SIM_HZ * seconds && !sim.aircraft.crashed; i++) {
    pilot(i / SIM_HZ)
    sim.stepPilot()
  }
  const data: FlightData = { spec: WREN, assists: header.assists, telemetry: recorder.telemetryLog(), samples: recorder.samples, touchdowns: recorder.touchdowns, crashed: sim.aircraft.crashed, ended: 'stopped' }
  return { sim, recorder, header, data, score: scoreFlight(data) }
}

test('band scores between its good and bad thresholds', () => {
  assert.equal(band(1, 2, 4), 1)
  assert.equal(band(3, 2, 4), 0.5)
  assert.equal(band(5, 2, 4), 0)
})

test('a stable approach and gentle landing scores well in every category', () => {
  const { score, sim } = fly('final1', 200)
  assert.equal(sim.aircraft.crashed, null)
  assert.ok(score.landing, 'a landing was found')
  assert.equal(score.landing.runway, '09')
  assert.equal(score.landing.surface, 'runway')
  assert.equal(score.landing.bounces, 0)
  assert.ok(score.landing.sinkFpm < 300, `sink ${score.landing.sinkFpm} fpm`)
  for (const c of score.categories) assert.notEqual(c.score, null, `${c.id} scored`)
  assert.ok(score.total >= 70, `total ${score.total}: ${JSON.stringify(score.categories.map((c) => [c.id, c.score]))}`)
  assert.ok(score.tips.length > 0)
  assert.ok(score.graph && score.graph.to > score.graph.from)
})

test('a firm, late flare scores lower on the landing', () => {
  const soft = fly('final1', 200).score
  const firm = fly('final1', 200, { flareHeight: 1.2, sinkTarget: 2.6 }).score
  const landing = (s: typeof soft) => s.categories.find((c) => c.id === 'landing')?.score ?? 0
  assert.ok(firm.landing && soft.landing && firm.landing.sinkFpm > soft.landing.sinkFpm, `firm ${firm.landing?.sinkFpm} soft ${soft.landing?.sinkFpm}`)
  assert.ok(landing(firm) < landing(soft), `firm ${landing(firm)} soft ${landing(soft)}`)
})

test('a flight without a landing scores only smoothness and procedure', () => {
  const { score } = fly('cruise', 30)
  assert.equal(score.landing, null)
  const scored = score.categories.filter((c) => c.score !== null).map((c) => c.id)
  assert.deepEqual(scored, ['smoothness', 'procedure'])
  assert.equal(score.grade, 'Incomplete')
  assert.ok(score.total <= 30, `an unfinished flight scored ${score.total}`)
})

test('a crash scores zero', () => {
  const { data } = fly('final1', 20)
  const score = scoreFlight({ ...data, crashed: 'impact', ended: 'crash' })
  assert.equal(score.total, 0)
  assert.equal(score.grade, 'Crashed')
})

test('re-flying the input log reproduces the telemetry and the score exactly', () => {
  const live = fly('final1', 200, {}, true)
  const replay = new Reflight(WREN, TERRAIN, live.header, live.recorder.inputLog(), true)
  while (replay.step(5000) > 0);
  assert.equal(replay.flown, live.recorder.ticks)
  assert.deepEqual(Array.from(replay.recorder!.telemetryLog()), Array.from(live.recorder.telemetryLog()))
  assert.deepEqual(replay.recorder!.touchdowns, live.recorder.touchdowns)
  const again = scoreFlight({ ...live.data, telemetry: replay.recorder!.telemetryLog(), samples: replay.recorder!.samples, touchdowns: replay.recorder!.touchdowns })
  assert.deepEqual(again, live.score)
})

test('a compressed record decodes to the same log and re-scores identically', async () => {
  const live = fly('final1', 200)
  const writer = new RecordWriter(live.header)
  for (const chunk of live.recorder.takeFull()) {
    writer.addInputs(chunk.inputs)
    writer.addTelemetry(chunk.telemetry)
  }
  const tail = live.recorder.takeTail()
  writer.addInputs(tail.inputs)
  writer.addTelemetry(tail.telemetry)
  const bytes = await writer.finish({ ticks: live.recorder.ticks, samples: live.recorder.samples, touchdowns: live.recorder.touchdowns, crashed: null, ended: 'stopped', score: live.score.total })
  assert.ok(bytes.length < writer.rawBytes / 3, `compressed ${bytes.length} of ${writer.rawBytes} bytes`)
  const record = await readRecord(bytes)
  assert.deepEqual(record.header, live.header)
  assert.deepEqual(record.inputs, live.recorder.inputLog())
  assert.deepEqual(Array.from(record.telemetry), Array.from(live.recorder.telemetryLog()))
  const score = scoreFlight({ ...live.data, telemetry: record.telemetry, samples: record.footer.samples, touchdowns: record.footer.touchdowns })
  assert.equal(score.total, live.score.total)
})
