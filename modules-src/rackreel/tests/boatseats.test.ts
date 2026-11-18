import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DECK_SEATS, DECK_SEAT_NAMES, nextSeat, otherSeat } from '../game/BoatSeats'
import type { DeckSeat } from '../game/BoatSeats'
import { beamLit, lensGlow } from '../game/Headlights'

test('the bass boat has four fishing seats, and the crew always sits apart from the captain', () => {
  assert.equal(DECK_SEATS.length, 4)
  assert.equal(DECK_SEAT_NAMES.length, 4)
  const seen = new Set<number>()
  let s: DeckSeat = 0
  for (let i = 0; i < 4; i++) {
    seen.add(s)
    assert.notEqual(otherSeat(s), s)
    assert.equal(otherSeat(otherSeat(s)), s)
    s = nextSeat(s)
  }
  assert.equal(seen.size, 4)
  assert.equal(s, 0)
})

test('the side-by-side headlights start on, glow by day and throw a beam only after dark', () => {
  assert.ok(lensGlow(true, 0) > lensGlow(false, 0))
  assert.ok(lensGlow(true, 1) > lensGlow(true, 0))
  assert.equal(beamLit(true, 0, 10), false)
  assert.equal(beamLit(true, 1, 10), true)
  assert.equal(beamLit(false, 1, 10), false)
  assert.equal(beamLit(true, 1, 1000), false)
})
