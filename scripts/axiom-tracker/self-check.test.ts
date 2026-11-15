import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coreLoops, guardQuietMs, guardStatus, settleMs, stalledLoops } from './self-check-rules.js'

const startedAt = 1_800_000_000_000
const later = startedAt + settleMs + 60 * 60_000

test('a loop that reported and then went quiet is stalled', () => {
  const heartbeats = [{ component: 'discovery', updated_at: later - coreLoops.discovery - 1 }, { component: 'scoring', updated_at: later - 5_000 }]
  assert.deepEqual(stalledLoops(heartbeats, later, startedAt), ['discovery'])
})

test('loops that are reporting are not stalled', () => {
  const heartbeats = Object.keys(coreLoops).map(component => ({ component, updated_at: later - 10_000 }))
  assert.deepEqual(stalledLoops(heartbeats, later, startedAt), [])
})

test('a loop that has not reported since this start is not counted', () => {
  const heartbeats = [{ component: 'site-publisher', updated_at: startedAt - 60_000 }]
  assert.deepEqual(stalledLoops(heartbeats, later, startedAt), [])
  assert.deepEqual(stalledLoops([], later, startedAt), [])
})

test('nothing is stalled while the tracker is still starting', () => {
  const heartbeats = [{ component: 'discovery', updated_at: startedAt + 1 }]
  assert.deepEqual(stalledLoops(heartbeats, startedAt + settleMs - 1, startedAt), [])
})

test('the guard reads as not installed, quiet or checking', () => {
  assert.equal(guardStatus(null, later).status, 'waiting')
  assert.match(guardStatus(null, later).detail, /Not installed/)
  assert.equal(guardStatus({ at: later - guardQuietMs - 1 }, later).status, 'waiting')
  const fine = guardStatus({ at: later - 40_000, lastAction: null }, later)
  assert.equal(fine.status, 'ok')
  assert.match(fine.detail, /40s ago; it has not had to step in/)
  assert.match(guardStatus({ at: later - 5_000, lastAction: { at: later - 3_600_000, reason: 'PM2 has nothing running', outcome: 'brought back' } }, later).detail, /PM2 has nothing running: brought back/)
})
