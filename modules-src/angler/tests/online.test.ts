import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREW_SIZE, CROWD_RADIUS, crowdAt, freeSeat, inviteCode, parseInvite, peerCode } from '../shared/Online'
import { lakeIds } from '../shared/Lakes'
import { mulberry32 } from '../shared/Random'
import { activity, conditionsAt } from '../shared/Catch'
import { LAKES, spotsOf } from '../shared/Lakes'

test('invite codes round-trip and fit the library chat format', () => {
  const rand = mulberry32(3)
  for (const lake of lakeIds) for (let instance = 0; instance < 8; instance++) {
    const boat = peerCode(rand)
    const code = inviteCode(lake, instance, boat)
    assert.match(code, /^[A-Z0-9]{4,8}$/)
    assert.deepEqual(parseInvite(code), { lake, instance, boat })
  }
  assert.equal(parseInvite('99ABCD'), null)
  assert.equal(parseInvite('0ABC'), null)
  assert.equal(parseInvite('08ABCD'), null)
})

test('crews fill seats one to three and stop at four', () => {
  assert.equal(freeSeat([0]), 1)
  assert.equal(freeSeat([0, 1, 3]), 2)
  assert.equal(freeSeat([0, 1, 2, 3]), -1)
  assert.equal(CREW_SIZE, 4)
})

test('nearby boats thin the bite, distant ones do not', () => {
  const near = [{ x: 10, z: 0 }, { x: 0, z: -30 }]
  const far = [{ x: CROWD_RADIUS + 5, z: 0 }]
  assert.equal(crowdAt(0, 0, [...near, ...far]), 2)
  let thinner = 0
  for (const id of lakeIds) for (const spot of spotsOf(LAKES[id])) for (const hour of [3, 11, 17, 23]) {
    const ctx = (crowd: number) => ({ lake: LAKES[id], x: spot.x, z: spot.z, date: new Date(Date.UTC(2026, 5, 10, hour)), rig: { rod: 'walleye' as const, presentation: 'jig' as const }, settled: 60, crowd })
    const alone = activity(ctx(0), conditionsAt(ctx(0)))
    const crowded = activity(ctx(3), conditionsAt(ctx(3)))
    assert.ok(crowded <= alone)
    if (crowded < alone) thinner++
  }
  assert.ok(thinner > 10)
})
