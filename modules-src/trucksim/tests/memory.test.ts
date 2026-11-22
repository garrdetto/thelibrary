import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SETTLE_SECONDS } from '../../rackreel/core/PerfTrend'
import { MemoryGuard } from '../systems/MemoryGuard'
import type { PressureLevel } from '../systems/MemoryGuard'

function makeScene() {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  return { engine, scene }
}

const SAMPLE_MS = 2000
const SETTLED_MS = (SETTLE_SECONDS + 2) * 1000

test('a steady scene reports ok', () => {
  const { engine, scene } = makeScene()
  new Mesh('steady', scene)
  const guard = new MemoryGuard(scene, { budget: { meshes: 1000 }, search: '' })
  for (let i = 0; i < 40; i++) guard.sample(SETTLED_MS + i * SAMPLE_MS)
  const report = guard.report()
  assert.equal(report.pressure, 'ok')
  assert.deepEqual(report.growing, [])
  assert.equal(report.counts.meshes, 1)
  guard.dispose()
  scene.dispose()
  engine.dispose()
})

test('a scripted mesh leak is reported as growing and raises pressure', () => {
  const { engine, scene } = makeScene()
  const guard = new MemoryGuard(scene, { budget: { meshes: 100000 }, search: '' })
  const levels: PressureLevel[] = []
  guard.onPressure((level) => levels.push(level))
  guard.sample(0)
  guard.sample(SETTLED_MS)
  for (let i = 0; i < 12; i++) {
    new Mesh(`leak${i}`, scene)
    guard.sample(SETTLED_MS + (i + 1) * SAMPLE_MS)
  }
  const report = guard.report()
  assert.ok(report.growing.includes('meshes'))
  assert.ok(report.pressure === 'warn' || report.pressure === 'critical')
  assert.ok(report.delta.meshes >= 6)
  assert.ok(levels.length >= 1)
  assert.equal(levels.filter((level, index) => index > 0 && level === levels[index - 1]).length, 0)
  guard.dispose()
  scene.dispose()
  engine.dispose()
})

test('going over a budget is critical and gauges appear in the report', () => {
  const { engine, scene } = makeScene()
  for (let i = 0; i < 5; i++) new Mesh(`m${i}`, scene)
  const guard = new MemoryGuard(scene, { budget: { meshes: 4 }, search: '' })
  let loaded = 12
  guard.registerGauge('chunks', () => loaded, 16)
  guard.sample(0)
  const report = guard.report()
  assert.equal(report.pressure, 'critical')
  const gauge = report.gauges.find((entry) => entry.name === 'chunks')
  assert.deepEqual(gauge && [gauge.value, gauge.limit], [12, 16])
  loaded = 17
  guard.sample(SAMPLE_MS)
  assert.equal(guard.report().pressure, 'critical')
  guard.dispose()
  scene.dispose()
  engine.dispose()
})

test('critical pressure repeats every 30 seconds and history holds 60 samples', () => {
  const { engine, scene } = makeScene()
  for (let i = 0; i < 5; i++) new Mesh(`m${i}`, scene)
  const guard = new MemoryGuard(scene, { budget: { meshes: 4 }, search: '' })
  let calls = 0
  guard.onPressure(() => { calls++ })
  for (let i = 0; i < 100; i++) guard.sample(i * SAMPLE_MS)
  assert.ok(calls >= 5 && calls <= 8)
  assert.equal(guard.report().historyLength, 60)
  guard.dispose()
  scene.dispose()
  engine.dispose()
})
