import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HARROW_FIELD } from '../shared/Airports'
import { WINDS } from '../shared/Conditions'
import { RECORD_VERSION, RecordWriter, readRecord } from '../shared/FlightRecord'
import type { FlightRecordData, RecordFooter, RecordHeader } from '../shared/FlightRecord'
import { TERRAIN } from '../shared/Terrain'
import { verifyRecord } from '../shared/Verify'
import { scoreFlight } from '../sim/Scoring'
import { SIM_HZ } from '../sim/Simulation'
import { placeStart, startsAirborne } from '../sim/Starts'
import { FlightRecorder } from '../sim/Telemetry'
import { WREN, landingPilot, makeSim } from './helpers'

async function flown(overrides: Partial<RecordHeader> = {}): Promise<FlightRecordData> {
  const header: RecordHeader = { version: RECORD_VERSION, aircraft: WREN.id, airport: HARROW_FIELD.id, start: 'final1', wind: { ...WINDS.light }, seed: 4242, temperatureOffset: 0, seaLevelPressure: 101325, assists: { autoTrim: false, stallProtection: false, landingGuidance: false }, weather: 'clear', failure: null, payload: null, job: null, route: null, flight: 'abc123def456', windKind: 'light', time: 'noon', checkride: null, ...overrides }
  const sim = makeSim(header.wind, header.seed)
  sim.reset({ wind: header.wind, seed: header.seed, temperatureOffset: 0, seaLevelPressure: header.seaLevelPressure, assists: header.assists, weather: header.weather, failure: null, payload: null })
  placeStart(sim.aircraft, sim.pilot, HARROW_FIELD, TERRAIN, header.start)
  sim.settle()
  const recorder = new FlightRecorder()
  recorder.attach(sim)
  recorder.reset(startsAirborne(header.start))
  const pilot = landingPilot(sim)
  for (let i = 0; i < SIM_HZ * 120 && !sim.aircraft.crashed; i++) {
    pilot(i / SIM_HZ)
    sim.stepPilot()
  }
  const score = scoreFlight({ spec: WREN, assists: header.assists, telemetry: recorder.telemetryLog(), samples: recorder.samples, touchdowns: recorder.touchdowns, crashed: sim.aircraft.crashed, ended: 'stopped' })
  const writer = new RecordWriter(header)
  for (const chunk of recorder.takeFull()) {
    writer.addInputs(chunk.inputs)
    writer.addTelemetry(chunk.telemetry)
  }
  const tail = recorder.takeTail()
  writer.addInputs(tail.inputs)
  writer.addTelemetry(tail.telemetry)
  const footer: RecordFooter = { ticks: recorder.ticks, samples: recorder.samples, touchdowns: recorder.touchdowns, crashed: null, ended: 'stopped', score: score.total }
  return readRecord(await writer.finish(footer))
}

test('an honest record verifies and its summary comes from the re-flown score', async () => {
  const record = await flown()
  const result = verifyRecord(record)
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(result.summary.total, record.footer.score)
  assert.equal(result.summary.wind, 'light')
  assert.equal(result.summary.time, 'noon')
  assert.equal(result.flight, 'abc123def456')
})

test('a record whose score, conditions or log were changed is refused', async () => {
  const record = await flown()
  const refuse = (changed: FlightRecordData, pattern: RegExp) => {
    const result = verifyRecord(changed)
    assert.equal(result.ok, false, String(pattern))
    if (!result.ok) assert.match(result.error, pattern)
  }
  refuse({ ...record, footer: { ...record.footer, score: Math.min(100, record.footer.score + 5) } }, /same score/)
  refuse({ ...record, header: { ...record.header, windKind: 'calm' } }, /wind/)
  refuse({ ...record, header: { ...record.header, wind: { ...record.header.wind, speed: 0 } } }, /wind/)
  refuse({ ...record, header: { ...record.header, seaLevelPressure: 103000 } }, /atmosphere/)
  refuse({ ...record, header: { ...record.header, payload: 50 } }, /payload/)
  refuse({ ...record, header: { ...record.header, checkride: 'ppl' } }, /checkride/)
  refuse({ ...record, header: { ...record.header, failure: { engine: 0, agl: 100 } } }, /checkride/)
  refuse({ ...record, inputs: record.inputs.subarray(0, record.inputs.length - 12) }, /incomplete/)
  const flipped = record.inputs.slice()
  for (let tick = 1200; tick < 1800; tick++) flipped[tick * 12] = 100
  refuse({ ...record, inputs: flipped }, /same (score|ending)/)
})
