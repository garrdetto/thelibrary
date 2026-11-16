import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_DETAIL, DETAIL, loadDetail } from '../core/Detail'

test('everyone starts on Standard detail, and a visit can ask for either level', () => {
  assert.equal(DEFAULT_DETAIL, 'standard')
  assert.equal(loadDetail(''), 'standard')
  assert.equal(loadDetail('?detail=high'), 'high')
  assert.equal(loadDetail('?detail=standard'), 'standard')
  assert.equal(loadDetail('?detail=ultra'), 'standard')
})

test('Standard draws less than High in every way, and never past what High draws', () => {
  const s = DETAIL.standard
  const h = DETAIL.high
  assert.ok(s.lines < h.lines && h.lines === 1440)
  assert.ok(s.cullReach < h.cullReach)
  assert.ok(s.grass < h.grass && h.grass === 1)
  assert.ok(s.treeLow < h.treeLow && s.treeOut < h.treeOut)
  assert.ok(s.treeOut <= s.cullReach, 'trees are gone before their stand is culled')
  assert.ok(s.crowdCloth < h.crowdCloth)
  assert.equal(s.bloom, false)
})
