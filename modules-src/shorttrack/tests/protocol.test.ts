import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROTOCOL_VERSION, helloAccepted } from '../next/net/protocol'

test('hello: the host accepts only its own protocol version', () => {
  assert.equal(helloAccepted({ t: 'hello', lv: {}, pv: PROTOCOL_VERSION }), true)
  assert.equal(helloAccepted({ t: 'hello', lv: {} }), false)
  assert.equal(helloAccepted({ t: 'hello', lv: {}, pv: PROTOCOL_VERSION + 1 }), false)
  assert.equal(helloAccepted({ t: 'hello', pv: String(PROTOCOL_VERSION) }), false)
  assert.equal(helloAccepted(null), false)
})

test('hello: the host refuses a guest on the other vehicle model', () => {
  assert.equal(helloAccepted({ t: 'hello', pv: PROTOCOL_VERSION }, 'classic'), true)
  assert.equal(helloAccepted({ t: 'hello', pv: PROTOCOL_VERSION, ph: 'classic' }, 'classic'), true)
  assert.equal(helloAccepted({ t: 'hello', pv: PROTOCOL_VERSION }, 'next'), false)
  assert.equal(helloAccepted({ t: 'hello', pv: PROTOCOL_VERSION, ph: 'next' }, 'classic'), false)
  assert.equal(helloAccepted({ t: 'hello', pv: PROTOCOL_VERSION, ph: 'next' }, 'next'), true)
})
