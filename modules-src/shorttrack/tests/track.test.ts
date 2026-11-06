import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { TRACKS, makeConfig, trackIdOf } from '../next/sim/config'
import type { TrackId } from '../next/sim/config'
import { Track } from '../next/sim/track'

const trackIdFrom = (search: string): TrackId => trackIdOf(new URLSearchParams(search).get('track'))

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

test('track ids fall back to Prison Speedway', () => {
  assert.equal(trackIdFrom('?track=dirt'), 'dirt')
  assert.equal(trackIdFrom('?track=nope'), 'prison')
  assert.equal(trackIdFrom('?track=toString'), 'prison')
  assert.equal(trackIdFrom(''), 'prison')
})

for (const [id, expected] of Object.entries(fixture)) {
  test(`${id}: geometry matches the classic module exactly`, () => {
    const def = TRACKS[id as TrackId]
    const cfg = makeConfig(def)
    assert.deepEqual(JSON.parse(JSON.stringify(cfg)), expected.cfg)
    const g = new Track(def, cfg)
    const dirt = g.dirt
    const { S, LAT, MU, XZ } = expected.inputs
    const consts = { L: g.L, R: g.R, W: g.W, AP: g.AP, HW: g.HW, TURN: g.TURN, P: g.P, S_LINE: g.S_LINE, T1: g.T1, T2: g.T2, GROOVE_HIGH: g.GROOVE_HIGH, GROOVE_LOW: g.GROOVE_LOW, GROOVE_SPAN: g.GROOVE_SPAN, LINE_MIN: g.LINE_MIN, LINE_MAX: g.LINE_MAX, DIRT: dirt }
    assert.deepEqual(consts, expected.consts)
    assert.deepEqual(JSON.parse(JSON.stringify(S.map((s) => g.center(s)))), expected.center)
    assert.deepEqual(S.map((s) => g.bankAt(s)), expected.bank)
    assert.deepEqual(S.map((s) => g.grooveLat(s)), expected.groove)
    assert.deepEqual(S.flatMap((s) => LAT.map((l) => g.heightAt(s, l))), expected.height)
    assert.deepEqual(JSON.parse(JSON.stringify(S.filter((_, i) => i % 3 === 0).flatMap((s) => LAT.map((l) => {
      const n = g.normalAt(s, l, { x: 0, y: 0, z: 0 })
      return [n.x, n.y, n.z]
    })))), expected.normal)
    assert.deepEqual(S.filter((_, i) => i % 2 === 0).flatMap((s) => LAT.flatMap((l) => MU.map((m) => g.aMaxAt(s, l, m)))), expected.aMax)
    assert.deepEqual(JSON.parse(JSON.stringify(XZ.map(([x, z]) => g.toTrack(x, z)))), expected.toTrack)
  })
}
