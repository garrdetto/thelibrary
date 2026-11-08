import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Difficulty, TrackId } from '../next/sim/config'
import { runRace } from './physicsRun'

const TRACKS: TrackId[] = ['prison', 'bullring', 'dells', 'dellswide', 'dirt']

function classicMean(track: TrackId, diff: Difficulty): number {
  const f = JSON.parse(readFileSync(join(process.cwd(), 'modules-src', 'shorttrack', 'tests', 'fixtures', `${track}-${diff}.json`), 'utf8')) as { laps: Record<string, number[]> }
  const laps = Object.values(f.laps).flat()
  return laps.reduce((a, b) => a + b, 0) / laps.length
}

for (const track of TRACKS) {
  test(`next vehicle model: ${track} medium AI laps within ${track === 'dirt' ? 5 : 3} % of the classic traces`, () => {
    const r = runRace(track, 'medium', 5, 'next')
    const ref = classicMean(track, 'medium'), err = Math.abs(r.meanLap / ref - 1) * 100
    assert.equal(r.done, true)
    assert.equal(r.nan, 0)
    assert.deepEqual(r.stuck, [])
    assert.ok(err <= (track === 'dirt' ? 5 : 3), `${track}: ${r.meanLap.toFixed(3)} s against ${ref.toFixed(3)} s (${err.toFixed(2)} %)`)
  })
}

test('next vehicle model: 20 cars, 25 laps at Prison Speedway with no NaN, tunnelling or stuck car', () => {
  const r = runRace('prison', 'hard', 25, 'next')
  assert.equal(r.done, true)
  assert.equal(r.nan, 0)
  assert.equal(r.tunnel, 0)
  assert.deepEqual(r.stuck, [])
  assert.ok(r.laps.length >= 19 * 25, `only ${r.laps.length} laps`)
})
