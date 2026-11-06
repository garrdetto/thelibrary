import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { TRACKS, applyTrackConfig, createTrackGeometry, trackIdFrom, type TrackCfg } from '../sim/track'

type Fixture = Record<string, {
  consts: Record<string, number | boolean>
  cfg: Record<string, number>
  center: unknown[]
  bank: number[]
  groove: number[]
  height: number[]
  normal: number[][]
  aMax: number[]
  toTrack: unknown[]
  inputs: { S: number[]; LAT: number[]; MU: number[]; XZ: [number, number][] }
}>

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'modules-src/shorttrack/tests/fixtures/track-classic.json'), 'utf8')) as Fixture

const baseCfg = (): TrackCfg & Record<string, number> => ({
  L: 180, R: 62, W: 16, APRON: 7, turnBank: 24, straightBank: 6, bankIn: 60, bankOut: 40,
  g: 9.81, grip: 1.05, apronGrip: 0.82, offTrack: 0.7, concreteTurn: 0.1, concreteSpeed: 0.8, contactSlow: 0.4,
  packBoost: 0.02, power: 360, maxAccel: 11, drag: 0.0009, roll: 0.3, engineBrake: 4.6, brake: 7, reverseMax: 6,
  scrub: 0.0065, slideScrub: 0.5, wheelbase: 2.8, steerLow: 0.47, steerSpeed: 0.07, steerRampIn: 8, steerRampOut: 6,
  carScale: 1.15, spinThreshold: 1.6, spinRate: 0.8, wallRest: 0.22, carRest: 0.15, carBounce: 0.7, damageScale: 0.7,
  paceSpeed: 31.0, aiPaceSpeed: 30.5, cautionSpeed: 29, cautionTime: 25, aiDecel: 5.5, maxCars: 20,
})

test('track ids fall back to Prison Speedway', () => {
  assert.equal(trackIdFrom('?track=dirt'), 'dirt')
  assert.equal(trackIdFrom('?track=nope'), 'prison')
  assert.equal(trackIdFrom('?track=toString'), 'prison')
  assert.equal(trackIdFrom(''), 'prison')
})

for (const [id, expected] of Object.entries(fixture)) {
  test(`${id}: geometry matches the classic module exactly`, () => {
    const cfg = baseCfg()
    const dirt = applyTrackConfig(cfg, TRACKS[id])
    assert.deepEqual(JSON.parse(JSON.stringify(cfg)), expected.cfg)
    const g = createTrackGeometry(cfg, TRACKS[id])
    const { S, LAT, MU, XZ } = expected.inputs
    const consts = { L: g.L, R: g.R, W: g.W, AP: g.AP, HW: g.HW, TURN: g.TURN, P: g.P, S_LINE: g.S_LINE, T1: g.T1, T2: g.T2, GROOVE_HIGH: g.GROOVE_HIGH, GROOVE_LOW: g.GROOVE_LOW, GROOVE_SPAN: g.GROOVE_SPAN, LINE_MIN: g.LINE_MIN, LINE_MAX: g.LINE_MAX, DIRT: dirt }
    assert.deepEqual(consts, expected.consts)
    assert.deepEqual(JSON.parse(JSON.stringify(S.map((s) => g.center(s)))), expected.center)
    assert.deepEqual(S.map((s) => g.bankAt(s)), expected.bank)
    assert.deepEqual(S.map((s) => g.grooveLat(s)), expected.groove)
    assert.deepEqual(S.flatMap((s) => LAT.map((l) => g.heightAt(s, l))), expected.height)
    assert.deepEqual(JSON.parse(JSON.stringify(S.filter((_, i) => i % 3 === 0).flatMap((s) => LAT.map((l) => g.normalAt(s, l))))), expected.normal)
    assert.deepEqual(S.filter((_, i) => i % 2 === 0).flatMap((s) => LAT.flatMap((l) => MU.map((m) => g.aMaxAt(s, l, m)))), expected.aMax)
    assert.deepEqual(JSON.parse(JSON.stringify(XZ.map(([x, z]) => g.toTrack(x, z)))), expected.toTrack)
  })
}
