import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../sim/kin'
import { Lab } from '../sim/lab'
import { handlingDelta, railHandling, railTrackQuery, railVehicle } from '../sim/vehicle'

const state = (l: Lab) => JSON.stringify({ inputs: l.inputs, adj: l.adj, radj: l.radj, out: l.outSummary(), hp: l.rawHardpoints(), rg: l.RG, base: l.BASE, pose: [l.heave, l.roll, l.steerDeg] })

test('building the track test car and its handling leaves the Lab untouched', () => {
  const l = new Lab()
  Object.assign(l.inputs, { g: 1.1, gx: -0.3, bank: 14, cr: 52, lf: 650 })
  l.adj.L.camber = 1.5
  l.radj.ULlen = 0.5
  l.rearSet()
  l.update()
  const before = state(l)
  const base = new Lab()
  railVehicle(l, 'Test')
  handlingDelta(railHandling(l), railHandling(base))
  railTrackQuery(l)
  assert.equal(state(l), before)
})

test('the rear axle stays on its ride-height branch after link moves', () => {
  const l = new Lab()
  const moves: [string, number][] = [['LLa', 2.6], ['RLa', 2.9], ['RLc', -0.7], ['ULc', 0.26], ['ULlen', -0.8], ['ULya', -4.8], ['TBc', 1.25], ['LLc', -2.2], ['RLa', 0.42], ['LLc', 0.6], ['RLc', 2.5]]
  const radj = l.radj as unknown as Record<string, number>
  let guess: number[] | null = null
  let i = 0
  for (const [id, v] of moves) {
    radj[id] = v
    l.rearSet()
    for (const [h, roll] of [[1.8, 2], [-0.4, -3], [-1.6, 4], [-2, 1], [2.2, -1]]) {
      const psi = -roll * Math.PI / 180, p = K.rearPoseNear(l.RG, h, psi, guess)
      if (K.rearResidual(l.RG, p.q) > 1e-6) { guess = null; continue }
      guess = p.q
      assert.ok(Math.abs(p.q[4] - l.RG.q0[4]) < 0.4, `housing pitch ${(p.q[4] * 180 / Math.PI).toFixed(1)}° at step ${i}`)
      i++
    }
  }
  assert.ok(i > 20)
})
