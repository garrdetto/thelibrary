import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TRACKS, makeConfig } from '../next/sim/config'
import { applyHandling, handlingBase, sanitizeHandling, settingsFor } from '../shared/Handling'

test('dirt drift settings show only on dirt tracks', () => {
  assert.ok(settingsFor('dirt').some(setting => setting.key === 'rearGrip'))
  assert.ok(!settingsFor('prison').some(setting => setting.key === 'rearGrip'))
  assert.deepEqual(sanitizeHandling({ rearGrip: 0.9, grip: 1.1 }, 'prison'), { grip: 1.1 })
  assert.deepEqual(sanitizeHandling({ rearGrip: 0.9, wheelspin: 9 }, 'dirt'), { rearGrip: 0.9, wheelspin: 2.5 })
})

test('a published dirt tune scales the stock dirt tire numbers', () => {
  const cfg = makeConfig(TRACKS.dirt)
  applyHandling(cfg, handlingBase(cfg), { rearGrip: 0.9, wheelspin: 2 })
  assert.equal(cfg.dirtRearGrip, 0.8 * 0.9)
  assert.equal(cfg.dirtWheelspin, 0.35 * 2)
  assert.equal(cfg.dirtFrontGrip, 1.05)
})
