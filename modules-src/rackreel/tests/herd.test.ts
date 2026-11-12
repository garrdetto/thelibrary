import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PANIC_DISTANCE, SAFE_DISTANCE, coverMatters, detectRadius, fleeSpeed, react } from '../systems/Herd'
import type { DeerMood } from '../systems/Herd'
import { LEGENDARY_CHANCE, LootTableManager, RARITY, mulberry32 } from '../systems/LootTableManager'

const calm = { noise: 0.45, approaching: false, cover: 0, hearing: 1 }

test('record-class bucks and fish are 0.06% (near-record plus record)', () => {
  assert.equal(LEGENDARY_CHANCE, RARITY.record + RARITY.nearRecord)
  const loot = new LootTableManager(mulberry32(11))
  for (const species of ['whitetail', 'walleye'] as const) {
    let hits = 0
    const n = 400_000
    for (let i = 0; i < n; i++) if (loot.createSpecimen(species).legendary) hits++
    assert.ok(Math.abs(hits / n - LEGENDARY_CHANCE) < LEGENDARY_CHANCE * 0.3, `${species} rate ${hits / n}`)
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

test('cover is only worked out where it can change what an animal does', () => {
  const moods: DeerMood[] = ['graze', 'walk', 'alert', 'flee', 'wounded', 'down']
  let skipped = 0
  let needed = 0
  for (const mood of moods) {
    for (const noise of [0.03, 0.04, 0.15, 0.45, 1, 1.4]) {
      for (const hearing of [0.5, 0.75, 1, 1.3]) {
        for (let distance = 1; distance < 220; distance += 1.7) {
          for (const approaching of [false, true]) {
            for (const alertLeft of [0, 2]) {
              const open = { distance, noise, approaching, cover: 0, hearing }
              if (coverMatters(mood, open)) {
                needed++
                continue
              }
              skipped++
              const answer = react(mood, open, alertLeft)
              for (const cover of [0.25, 0.6, 1]) assert.equal(react(mood, { ...open, cover }, alertLeft), answer, `${mood} at ${distance} m, cover ${cover}`)
            }
          }
        }
      }
    }
  }
  assert.ok(skipped > needed && needed > 0)
  assert.equal(coverMatters('graze', { ...calm, distance: 30 }), true)
  assert.equal(coverMatters('graze', { ...calm, distance: 30, noise: 0.03 }), false)
})
