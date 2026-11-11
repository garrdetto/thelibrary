import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POSITION_SLACK, SHADOW_RECENTRE, SLACK_FAR, SLACK_NEAR, TURN_SLACK, drifted, needsRecentre, slackAt } from '../core/ShadowPolicy'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function moved(dx: number, turn = 0): number[] {
  const m = IDENTITY.slice()
  m[12] += dx
  m[0] -= turn
  return m
}

test('a caster that has barely moved keeps its shadow', () => {
  assert.equal(drifted(IDENTITY, IDENTITY), false)
  assert.equal(drifted(IDENTITY, moved(POSITION_SLACK * 0.9)), false)
  assert.equal(drifted(IDENTITY, moved(POSITION_SLACK * 1.1)), true)
  assert.equal(drifted(IDENTITY, moved(0, TURN_SLACK * 0.9)), false)
  assert.equal(drifted(IDENTITY, moved(0, TURN_SLACK * 1.1)), true)
})

test('drift is measured from the snapshot, wherever it sits in a longer array', () => {
  const snapshot = new Float32Array(1 + 16 * 2)
  snapshot.set(IDENTITY, 1)
  snapshot.set(moved(5), 17)
  assert.equal(drifted(snapshot, IDENTITY, 1), false)
  assert.equal(drifted(snapshot, moved(5), 17), false)
  assert.equal(drifted(snapshot, IDENTITY, 17), true)
})

test('a run of bone matrices counts as moved when any one of them has', () => {
  const pose = [...IDENTITY, ...IDENTITY, ...IDENTITY]
  const next = pose.slice()
  assert.equal(drifted(pose, next), false)
  next[16 * 2 + 13] += POSITION_SLACK * 2
  assert.equal(drifted(pose, next), true)
})

test('slow drift adds up against the last drawn pose', () => {
  const drawn = IDENTITY
  let frames = 0
  let x = 0
  while (!drifted(drawn, moved(x))) {
    x += POSITION_SLACK / 7
    frames++
  }
  assert.ok(frames >= 7 && frames <= 9, `redrawn after ${frames} frames`)
})

test('far casters may drift further before a redraw', () => {
  assert.equal(slackAt(0), 1)
  assert.equal(slackAt(SLACK_NEAR), 1)
  assert.equal(slackAt(SLACK_NEAR * 4), 4)
  assert.equal(slackAt(10000), SLACK_FAR)
  const step = moved(POSITION_SLACK * 3)
  assert.equal(drifted(IDENTITY, step, 0, slackAt(3)), true, 'at arm’s length it shows')
  assert.equal(drifted(IDENTITY, step, 0, slackAt(60)), false, 'across the clearing it does not')
})

test('the shadow frame follows in steps', () => {
  const at = { x: 100, y: 5, z: -40 }
  assert.equal(needsRecentre(at, { x: 100 + SHADOW_RECENTRE - 0.1, y: 5, z: -40 }), false)
  assert.equal(needsRecentre(at, { x: 100, y: 5, z: -40 - SHADOW_RECENTRE - 0.1 }), true)
  assert.equal(needsRecentre(at, { x: 100, y: 5 + SHADOW_RECENTRE + 1, z: -40 }), true)
  assert.equal(needsRecentre({ x: Number.NaN, y: 0, z: 0 }, at), true, 'never placed yet')
})
