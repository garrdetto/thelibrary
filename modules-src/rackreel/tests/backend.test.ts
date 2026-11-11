import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wantsWebGpu, webGlAddress } from '../core/Backend'

test('WebGPU is tried first unless the address pins WebGL2', () => {
  assert.equal(wantsWebGpu(''), true)
  assert.equal(wantsWebGpu('?hour=22&room=ABC123'), true)
  assert.equal(wantsWebGpu('?gpu=webgl'), false)
  assert.equal(wantsWebGpu('?hour=22&gpu=webgl2'), false)
  assert.equal(wantsWebGpu('?gpu=webgpu'), true)
  assert.equal(wantsWebGpu('', false), false)
  assert.equal(wantsWebGpu('?gpu=webgpu', false), true)
  assert.equal(wantsWebGpu('?gpu=nonsense'), true)
})

test('the WebGL2 restart keeps the rest of the address', () => {
  const next = webGlAddress('https://example.test/modules/rackreel.html?hour=22&room=ABC123#x')
  const url = new URL(next)
  assert.equal(url.searchParams.get('gpu'), 'webgl')
  assert.equal(url.searchParams.get('hour'), '22')
  assert.equal(url.searchParams.get('room'), 'ABC123')
  assert.equal(url.hash, '#x')
  assert.equal(wantsWebGpu(url.search), false)
  assert.equal(new URL(webGlAddress(next)).searchParams.getAll('gpu').length, 1)
})
