import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MIN_LINES, TARGET_LINES, renderLines } from '../core/Resolution'

test('the frame renders at native size up to 1440 lines, whatever the device pixel ratio', () => {
  assert.equal(renderLines(720, 1, TARGET_LINES, 1), 720)
  assert.equal(renderLines(1080, 1, TARGET_LINES, 1), 1080)
  assert.equal(renderLines(900, 2, TARGET_LINES, 1), 1440)
  assert.equal(renderLines(1440, 1, TARGET_LINES, 1), 1440)
  assert.equal(renderLines(2160, 1, TARGET_LINES, 1), 1440)
  assert.equal(renderLines(2160, 1, Infinity, 1), 2160)
})

test('slowing down scales the render size but never under 720 lines (or the canvas when smaller)', () => {
  assert.ok(Math.abs(renderLines(1080, 1, TARGET_LINES, 1.15) - 1080 / 1.15) < 1e-9)
  assert.equal(renderLines(1080, 1, TARGET_LINES, 4), MIN_LINES)
  assert.equal(renderLines(600, 1, TARGET_LINES, 4), 600)
  assert.equal(renderLines(1080, 1, TARGET_LINES, 0.5), 1080)
})
