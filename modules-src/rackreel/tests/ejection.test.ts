import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EJECT_DEFLECT, Ejection, ejectHeading } from '../game/Ejection'

const flat = { groundAt: () => 2, blocked: () => false }

test('a thrown driver flies forward, rolls, lies face down and stands back up', () => {
  const e = new Ejection({ x: 0, y: 3, z: 0 }, 0, 16, flat)
  const seen = new Set<string>()
  let landedAt = 0
  for (let i = 0; i < 60 * 10 && !e.done; i++) {
    e.step(1 / 60)
    seen.add(e.phase)
    if (e.phase === 'roll' && !landedAt) landedAt = e.hip.z
    assert.ok(e.hip.y >= 2, 'never below the ground')
  }
  assert.ok(e.done, 'back on his feet within ten seconds')
  for (const phase of ['fly', 'roll', 'lie', 'rise']) assert.ok(seen.has(phase), `went through ${phase}`)
  assert.ok(landedAt > 3, `landed well in front: ${landedAt}`)
  assert.ok(e.hip.z > landedAt + 1, 'rolled on past where he landed')
  assert.ok(Math.abs(e.hip.x) < 1e-6, 'straight ahead')
  assert.ok(Math.abs(e.pitch) < 1e-6, 'upright again')
  assert.ok(Math.abs(e.hip.y - 2.98) < 1e-6, 'standing at hip height')
})

test('a trunk or deep water stops the slide', () => {
  const e = new Ejection({ x: 0, y: 1, z: 0 }, 0, 16, { groundAt: () => 0, blocked: (_x, z) => z > 2 })
  for (let i = 0; i < 600 && !e.done; i++) e.step(1 / 60)
  assert.ok(e.done)
  assert.ok(e.hip.z <= 2, `stopped at ${e.hip.z}`)
})

test('the driver is flung away from the side the trunk is on', () => {
  assert.equal(ejectHeading(0, { x: 0, z: 0 }, { x: 0.4, z: 1.5 }), -EJECT_DEFLECT)
  assert.equal(ejectHeading(0, { x: 0, z: 0 }, { x: -0.4, z: 1.5 }), EJECT_DEFLECT)
})
