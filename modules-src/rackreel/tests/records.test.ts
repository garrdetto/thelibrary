import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BAIT_STYLE, gearEffects, defaultProfile } from '../shared/Economy'
import { BOARD_SIZE, RECORD_CATEGORIES, categoriesFor, categoryValues, formatRecord, placeOn, rankOn } from '../shared/Records'
import type { RecordBoard } from '../shared/Records'
import { SPECIES } from '../systems/LootTableManager'

test('every species has its record categories with a state benchmark', () => {
  for (const s of SPECIES) assert.ok(categoriesFor(s.id).length >= 2, s.id)
  assert.deepEqual(categoriesFor('whitetail').map((c) => c.metric), ['score', 'spread', 'points', 'dressed'])
  for (const c of RECORD_CATEGORIES) assert.ok(c.state.value > 0 && c.state.note.length > 5, c.id)
})

test('a catch fills every category it counts toward', () => {
  const buck = categoryValues('whitetail', 172.4)
  assert.deepEqual(Object.keys(buck).sort(), ['whitetail.dressed', 'whitetail.points', 'whitetail.score', 'whitetail.spread'])
  const fish = categoryValues('pike', 12.5)
  assert.equal(fish['pike.weight'], 12.5)
  assert.ok(fish['pike.length'] > 30)
})

test('the board keeps the top three, best first, ties to the earlier entry', () => {
  const board: RecordBoard = {}
  assert.equal(placeOn(board, 'pike.weight', { username: 'a', value: 10, at: 1 }), 1)
  assert.equal(placeOn(board, 'pike.weight', { username: 'b', value: 12, at: 2 }), 1)
  assert.equal(placeOn(board, 'pike.weight', { username: 'c', value: 11, at: 3 }), 2)
  assert.equal(placeOn(board, 'pike.weight', { username: 'd', value: 10, at: 4 }), 0)
  assert.equal(placeOn(board, 'pike.weight', { username: 'e', value: 10.5, at: 5 }), 3)
  assert.equal(board['pike.weight'].length, BOARD_SIZE)
  assert.deepEqual(board['pike.weight'].map((e) => e.username), ['b', 'c', 'e'])
  assert.equal(rankOn(board['pike.weight'], 9), 0)
  assert.equal(rankOn([], 1), 1)
})

test('values read the way the record keepers write them', () => {
  assert.equal(formatRecord('whitetail.score', 206.125), '206 1/8″')
  assert.equal(formatRecord('whitetail.spread', 20.25), '20 2/8″')
  assert.equal(formatRecord('whitetail.points', 12), '12 pts')
  assert.equal(formatRecord('muskie.weight', 69.6875), '69 lb 11 oz')
  assert.equal(formatRecord('pike.length', 46.25), '46 1/4″')
  assert.equal(formatRecord('blackbear.skull', 23.3125), '23 5/16″')
  assert.equal(formatRecord('blackbear.weight', 612.4), '612 lb')
})

test('live bait sits under a float, lures fish while reeled; bait sets the trophy odds', () => {
  assert.equal(BAIT_STYLE['bait-crawler'].kind, 'live')
  assert.equal(BAIT_STYLE['bait-minnow'].kind, 'live')
  assert.equal(BAIT_STYLE['bait-spinner'].kind, 'lure')
  assert.equal(BAIT_STYLE['bait-bucktail'].kind, 'lure')
  assert.ok(BAIT_STYLE['bait-bucktail'].trophyOdds > BAIT_STYLE['bait-spinner'].trophyOdds && BAIT_STYLE['bait-spinner'].trophyOdds > BAIT_STYLE['bait-crawler'].trophyOdds)
  assert.ok(BAIT_STYLE['bait-minnow'].hookWindow > BAIT_STYLE['bait-crawler'].hookWindow && BAIT_STYLE['bait-bucktail'].hookWindow < BAIT_STYLE['bait-crawler'].hookWindow)
  const p = defaultProfile()
  assert.equal(gearEffects(p.loadout).bait, BAIT_STYLE['bait-crawler'])
  assert.equal(gearEffects({ ...p.loadout, bait: 'bait-minnow' }).biteRate, 1.25)
})

test('bucks carry up to 20 points; anything more is a 0.005% freak rack', async () => {
  const { FREAK_RACK_CHANCE, MAX_TYPICAL_POINTS, measure, mulberry32 } = await import('../systems/LootTableManager')
  const rng = mulberry32(77)
  let freaks = 0
  let twenty = 0
  const n = 2_000_000
  for (let i = 0; i < n; i++) {
    const value = 75 + rng() * 140
    const pts = measure('whitetail', Math.round(value * 10) / 10, Math.floor(rng() * 2147483647)).points!
    if (pts > MAX_TYPICAL_POINTS) freaks++
    else if (pts === MAX_TYPICAL_POINTS) twenty++
    assert.ok(pts >= 3 && pts <= MAX_TYPICAL_POINTS + 11)
  }
  assert.ok(twenty > 0, 'big racks reach 20 points')
  assert.ok(freaks / n > FREAK_RACK_CHANCE * 0.5 && freaks / n < FREAK_RACK_CHANCE * 1.6, `freak rate ${freaks / n}`)
  const avg = Array.from({ length: 2000 }, (_, i) => measure('whitetail', 115, i).points!).reduce((a, b) => a + b, 0) / 2000
  assert.ok(avg > 7 && avg < 11, `an average buck carries about 8–10 points (${avg})`)
})

test('the same animal measures the same everywhere; a new seed gives a new rack', async () => {
  const { measure } = await import('../systems/LootTableManager')
  assert.deepEqual(measure('whitetail', 172.4, 99), measure('whitetail', 172.4, 99))
  const racks = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(measure('whitetail', 172.4, i))))
  assert.ok(racks.size > 10)
})

test('everyone starts unverified; making a character verifies and dresses them', async () => {
  const { CHARACTER_CHOICES, createCharacter, defaultProfile, normalizeProfile } = await import('../shared/Economy')
  assert.equal(defaultProfile().verified, false)
  assert.equal(normalizeProfile({ cash: 900 }).verified, false, 'older saves start unverified')
  const p = defaultProfile()
  assert.ok(createCharacter(p, { jacket: 'jacket-flannel', vest: 'vest-none', cap: 'cap-bucket', pants: 'pants-jeans', pack: 'pack-none' }) === null)
  assert.equal(p.verified, true)
  assert.equal(p.loadout.jacket, 'jacket-flannel')
  assert.ok(p.owned.includes('pants-jeans'))
  assert.equal(normalizeProfile(JSON.parse(JSON.stringify(p))).verified, true)
  assert.ok(createCharacter(defaultProfile(), { jacket: 'jacket-camo', vest: 'vest-fishing', cap: 'cap-blaze', pants: 'pants-camo', pack: 'pack-none' }), 'gear with an effect is not handed out')
  assert.ok(!CHARACTER_CHOICES.pants.includes('pants-waders'))
})

test('fish find a working bait a third sooner', async () => {
  const { EncounterDirector, FISH_SPEEDUP, LINE_IN_WATER_RATE } = await import('../systems/EncounterDirector')
  assert.ok(Math.abs(LINE_IN_WATER_RATE / 3 - FISH_SPEEDUP) < 1e-9 && FISH_SPEEDUP >= 1.33)
  const d = new EncounterDirector(() => 0.5)
  let t = 0
  while (!d.update(0.1, { exploring: false, lineInWater: true, onLand: false })) t += 0.1
  assert.ok(t < 120 / 3 / 1.3, `bite after ${t.toFixed(1)} s`)
})

test('cloth and wood patterns tile without seams', async () => {
  const { fabricHeight, tileNoise, woodSample } = await import('../world/SurfacePatterns')
  for (let v = 0; v < 1; v += 0.13) {
    assert.ok(Math.abs(tileNoise(0, v, 5, 7, 3) - tileNoise(1, v, 5, 7, 3)) < 1e-9)
    assert.ok(Math.abs(fabricHeight(0, v) - fabricHeight(1 - 1e-9, v)) < 0.05)
    const a = woodSample(0, v, 4)
    const b = woodSample(1 - 1e-9, v, 4)
    assert.ok(Math.abs(a.shade - b.shade) < 0.05 && a.height >= 0 && a.height <= 1)
  }
})
