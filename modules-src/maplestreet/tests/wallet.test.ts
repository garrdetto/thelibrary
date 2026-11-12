import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NeighborhoodLogic } from '../shared/RoomLogic'
import { START_MONEY } from '../shared/Economy'
import type { ServerMsg } from '../shared/Protocol'
import { WORLD_HALF, inTownWorld } from '../shared/WorldLayout'

test('the shared wallet credits and debits a member and never overdraws', () => {
  const logic = new NeighborhoodLogic({ send: () => {}, broadcast: () => {} }, null)
  assert.equal(logic.adjustMoney('member:u1', 'angler', 250), START_MONEY + 250, 'a member who never played Fox Plains gets an account, then the credit')
  assert.equal(logic.adjustMoney('member:u1', 'angler', -380), START_MONEY - 130)
  assert.equal(logic.adjustMoney('member:u1', 'angler', -(START_MONEY * 2)), null, 'an overdraw is refused')
  assert.equal(logic.adjustMoney('member:u1', 'angler', 0), START_MONEY - 130, 'a zero delta reads the balance')
  assert.equal(logic.adjustMoney('member:u1', 'angler', Number.NaN), null)
  assert.ok(logic.dirty.accounts.has('member:u1'), 'the account is saved')
})

test('a connected member hears about wallet changes made from Rack & Reel', () => {
  const sent: { to: string; msg: ServerMsg }[] = []
  const logic = new NeighborhoodLogic({ send: (to, msg) => { sent.push({ to, msg }) }, broadcast: () => {} }, null)
  logic.join('s1', { key: 'x', name: 'angler', color: '#336699' }, { key: 'member:u2', name: 'angler', member: true })
  sent.length = 0
  const balance = logic.adjustMoney('member:u2', 'angler', 75)
  const update = sent.find((s) => s.to === 's1' && s.msg.t === 'account')
  assert.ok(update, 'the session gets an account update')
  assert.equal(update.msg.t === 'account' ? update.msg.account.money : -1, balance)
})

test('classic Fox Plains hides anyone beyond the town square (out in the Fox Lake country)', () => {
  assert.equal(inTownWorld({ x: 87, z: 200 }), true)
  assert.equal(inTownWorld({ x: 87, z: WORLD_HALF + 300 }), false)
  assert.equal(inTownWorld({ x: -WORLD_HALF - 1, z: 0 }), false)
})
