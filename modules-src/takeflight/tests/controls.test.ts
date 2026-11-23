import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INPUT_BYTES, createInput, decodeInput, encodeInput, quantizeInput } from '../sim/Controls'

test('inputs survive encoding and quantising is idempotent', () => {
  const input = createInput()
  Object.assign(input, { pitch: 0.333, roll: -0.71, yaw: 1.4, throttle: 0.62, brakeLeft: 0.2, brakeRight: 1, flaps: 2, gear: 0, spoilers: 0.5, reverse: 1, trim: -1, parkingBrake: 1 })
  quantizeInput(input)
  const bytes = new Uint8Array(INPUT_BYTES)
  encodeInput(input, bytes, 0)
  const back = decodeInput(bytes, 0, createInput())
  assert.deepEqual(back, input)
  assert.deepEqual(quantizeInput({ ...back }), back)
  assert.equal(back.yaw, 1)
  assert.equal(back.trim, -1)
})
