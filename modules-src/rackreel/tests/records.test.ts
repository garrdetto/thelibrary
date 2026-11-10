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
