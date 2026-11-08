import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PANIC_DISTANCE, SAFE_DISTANCE, detectRadius, fleeSpeed, react } from '../systems/Herd'
import { LEGENDARY_CHANCE, LootTableManager, mulberry32 } from '../systems/LootTableManager'

const calm = { noise: 0.45, approaching: false, cover: 0, hearing: 1 }

test('records are a 4% chance for bucks and fish', () => {
  assert.equal(LEGENDARY_CHANCE, 0.04)
  const loot = new LootTableManager(mulberry32(11))
  for (const species of ['whitetail', 'walleye'] as const) {
    let hits = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (loot.createSpecimen(species).legendary) hits++
    assert.ok(Math.abs(hits / n - 0.04) < 0.006, `${species} rate ${hits / n}`)
  }
})

test('deer bolt when the hunter gets too close, whatever the noise', () => {
  assert.equal(react('graze', { ...calm, noise: 0, distance: PANIC_DISTANCE - 1 }, 5), 'flee')
  assert.equal(react('walk', { ...calm, noise: 0, distance: PANIC_DISTANCE - 1 }, 5), 'flee')
})

test('deer look up first, then flee if the hunter keeps coming', () => {
  const r = detectRadius(calm)
  assert.equal(react('graze', { ...calm, distance: r - 1 }, 5), 'alert')
  assert.equal(react('alert', { ...calm, distance: r - 1, approaching: true }, 2), 'flee')
  assert.equal(react('alert', { ...calm, distance: r * 0.9 }, 2), 'keep')
  assert.equal(react('alert', { ...calm, distance: r * 1.5 }, 0), 'calm')
})

test('a quiet hunter in a stand goes unnoticed where a walking one is spotted', () => {
  const walking = detectRadius({ noise: 0.45, cover: 0, hearing: 1 })
  const stand = detectRadius({ noise: 0.03, cover: 0, hearing: 1 })
  assert.ok(stand < PANIC_DISTANCE + 5 && walking > 40)
  assert.ok(detectRadius({ noise: 0.45, cover: 1, hearing: 1 }) < walking)
})

test('fleeing deer burst away, settle to a run and stop once safe', () => {
  assert.ok(fleeSpeed(0, true) > 13 && fleeSpeed(10, true) < 10)
  assert.equal(react('flee', { ...calm, distance: SAFE_DISTANCE + 1 }, 0), 'calm')
  assert.equal(react('flee', { ...calm, distance: SAFE_DISTANCE - 1 }, 0), 'keep')
})
