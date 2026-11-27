import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Lab } from '../sim/lab'
import { DEFAULTS } from '../sim/inputs'
import { railTrackQuery, railVehicle } from '../sim/vehicle'
import { lookup, parseRailVehicle } from '../../shorttrack/next/sim/railCar'

const LB = 4.4482216152605, IN = 0.0254
const lab = (inputs: Record<string, number> = {}) => {
  const l = new Lab()
  Object.assign(l.inputs, inputs)
  l.update()
  return l
}

test('the track test car is valid, weighs what the scales say and sits at rest', () => {
  const v = railVehicle(lab(), 'Defaults')
  assert.ok(parseRailVehicle(JSON.parse(JSON.stringify(v))), 'passes the track page schema')
  const total = v.staticLoad.reduce((a, b) => a + b, 0) / LB
  assert.ok(Math.abs(total - DEFAULTS.wt) < 1, `corner loads add up to the weight (${total})`)
  const left = (v.staticLoad[0] + v.staticLoad[2]) / LB / DEFAULTS.wt, cross = (v.staticLoad[1] + v.staticLoad[2]) / LB / DEFAULTS.wt
  assert.ok(Math.abs(left - DEFAULTS.ls / 100) < 1e-6 && Math.abs(cross - DEFAULTS.cr / 100) < 1e-6, 'left and cross from the scales')
  for (const t of v.spring) {
    assert.ok(Math.abs(lookup(t, 0)) < 0.5, 'spring tables are the change from ride height')
    assert.ok(lookup(t, 0.02) > 0 && lookup(t, -0.02) < 0, 'bump pushes, droop unloads')
  }
  assert.deepEqual(v.bumpTravel.slice(2), [1, 1], 'no rear bump springs on the default setup')
  assert.ok(v.bumpTravel[0] > 0.01 && v.bumpTravel[0] < 0.06 && v.bumpTravel[1] > 0.01 && v.bumpTravel[1] < 0.06, 'front bump springs after their 1 in gap')
  assert.equal(v.clearance.at(-1)?.name, 'Nose')
  assert.ok(Math.abs(v.clearance[0].h / IN - DEFAULTS.hlf) < 1e-6, 'LF frame height is the LF ride height')
})

test('the Lab’s Move the car sliders do not leak into the car on track', () => {
  const a = railVehicle(lab(), 'x'), b = railVehicle(lab({ g: 1.1, gx: -0.6, bank: 14 }), 'x')
  assert.deepEqual(a.staticLoad, b.staticLoad)
  assert.deepEqual(a.spring, b.spring)
  assert.deepEqual(railTrackQuery(lab({ bank: 14, rad: 200 })), { rad: 200, bank: 14 })
})

test('setup changes reach the car on track', () => {
  const base = railVehicle(lab(), 'x')
  const rf = railVehicle(lab({ rf: 900 }), 'x')
  assert.ok(lookup(rf.spring[1], 0.03) > lookup(base.spring[1], 0.03) * 1.2, 'a stiffer RF spring is a stiffer RF wheel')
  const bump = railVehicle(lab({ brf: 3000, grf: 0.5 }), 'x')
  assert.ok(bump.bumpTravel[1] > 0.005 && bump.bumpTravel[1] < 0.03, 'the RF bump spring starts working after its gap')
  assert.ok(lookup(bump.spring[1], 0.05) > lookup(railVehicle(lab({ brf: 0 }), 'x').spring[1], 0.05) * 1.5, 'and stiffens the corner past it')
  const wedge = railVehicle(lab({ cr: 55 }), 'x')
  assert.ok(wedge.staticLoad[1] > base.staticLoad[1] && wedge.staticLoad[0] < base.staticLoad[0], 'more cross puts weight on the RF and LR')
  const stag = railVehicle(lab({ tcrr: 89 }), 'x')
  assert.ok(stag.rollout[3] - stag.rollout[2] > base.rollout[3] - base.rollout[2], 'stagger')
  const low = railVehicle(lab({ hlf: 2, hrf: 2 }), 'x')
  assert.ok(low.clearance[0].h < base.clearance[0].h && low.clearance.at(-1)!.h < base.clearance.at(-1)!.h, 'lower ride heights lower the frame and nose')
  const bar = railVehicle(lab({ bar: 2 }), 'x')
  assert.ok(bar.barF > base.barF, 'a bigger bar is a stiffer bar')
})
