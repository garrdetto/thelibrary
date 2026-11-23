import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { bootFailure } from '../game/BootRecovery'
import '../render/world/Pipeline'

test('a failed boot retries once on WebGL2, then shows the real error', () => {
  const first = bootFailure('https://example.test/modules/trucksim.html?quality=high', new Error('boom'))
  assert.equal(first.retry, 'https://example.test/modules/trucksim.html?quality=high&gpu=webgl')
  const second = bootFailure(first.retry!, new Error('boom'))
  assert.equal(second.retry, null)
  assert.match(second.message, /\(boom\)/)
})

test('the post pipeline brings the multi-render extension to both engines', () => {
  assert.equal(typeof (WebGPUEngine.prototype as unknown as Record<string, unknown>).createMultipleRenderTarget, 'function')
  assert.equal(typeof (Engine.prototype as unknown as Record<string, unknown>).createMultipleRenderTarget, 'function')
})
