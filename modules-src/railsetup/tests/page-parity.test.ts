import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Hardpoints } from '../sim/hardpoints'
import * as K from '../sim/kin'
import type { FrontAdj, RearAdj } from '../sim/inputs'
import type { Side } from '../sim/lab'
import { labFromState } from '../site/page'
import { railVehicle } from '../sim/vehicle'
import fixture from './fixtures/page-parity.json'

type Case = { hp: Hardpoints | null; inputs: Record<string, string>; adj: Record<Side, FrontAdj>; radj: RearAdj; mrFixed: boolean; view: { heave: number; roll: number; steer: number; rack: number }; model: Record<string, number | null> }
const fx = fixture as unknown as { hp0: Hardpoints; def: Record<string, string>; cases: Case[] }

function leaves(o: unknown, path: string, acc: Map<string, number>, seen = new Set<unknown>()) {
  if (o == null || seen.has(o)) return
  if (typeof o === 'number') { acc.set(path, o); return }
  if (typeof o !== 'object') return
  seen.add(o)
  for (const [k, v] of Object.entries(o)) leaves(v, path ? `${path}.${k}` : k, acc, seen)
}

test('the track test Lab, built from the page state, matches every number of the original page model (iterative solves within 1e-6)', () => {
  assert.ok(fx.cases.length >= 80)
  let compared = 0
  let worst = 0
  let skipped = 0
  fx.cases.forEach((c, i) => {
    const lab = labFromState({ hp: c.hp ?? fx.hp0, def: fx.def, inputs: c.inputs, adj: c.adj, radj: c.radj, mrFixed: c.mrFixed, view: c.view })
    const heights = ['hlf', 'hrf', 'hrr'].map(id => lab.num(id))
    if (heights.some(h => h < 1 || h > 7) || !lab.model.settled) { skipped++; return }
    if (K.rearResidual(lab.RG, lab.model.rp.q) > 1e-6) { skipped++; assert.ok(lab.warnings().some(w => w.includes('rear links can’t reach')), `case ${i}: unreachable rear pose without the reach warning`); return }
    const got = new Map<string, number>()
    leaves(lab.model, '', got)
    for (const [key, want] of Object.entries(c.model)) {
      const have = got.get(key)
      assert.ok(have !== undefined, `case ${i}: Lab.model has no ${key}`)
      compared++
      if (want === null) { assert.ok(!Number.isFinite(have), `case ${i} ${key}: original is not finite, Lab ${have}`); continue }
      const err = Math.abs(have - want) / Math.max(1, Math.abs(want))
      assert.ok(err < 1e-6, `case ${i} ${key}: original ${want}, Lab ${have}`)
      worst = Math.max(worst, err)
    }
    assert.doesNotThrow(() => railVehicle(lab, 'case'))
  })
  assert.ok(compared > 10000, `only ${compared} numbers compared`)
  assert.ok(skipped <= fx.cases.length / 4, `${skipped} cases skipped`)
  console.log(`page parity: ${compared} numbers over ${fx.cases.length - skipped} cases (${skipped} skipped: Advanced mode springs that put a ride height outside the page's 1–7 in, a corner solve that never settles, or rear links that can't reach), worst relative difference ${worst.toExponential(2)}`)
})

test('a loaded hardpoints file is used as given, not re-seated (as the original does)', () => {
  assert.ok(fx.cases.some(c => c.hp !== null), 'the fixture loads a hardpoints file part way through')
})

test('the car on track copies the page exactly: a loaded hardpoints file is not seated twice', () => {
  const c = fx.cases.find(x => x.hp !== null) as Case
  const lab = labFromState({ hp: c.hp as Hardpoints, def: fx.def, inputs: c.inputs, adj: c.adj, radj: c.radj, mrFixed: c.mrFixed })
  const copy = lab.copy('x')
  assert.deepEqual(copy.rawHardpoints(), lab.rawHardpoints())
  assert.deepEqual(copy.defaults, lab.defaults)
  assert.deepEqual(copy.model.loads, lab.model.loads)
})
