import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAD, parseHardpoints } from '../sim/hardpoints'
import { parseSetupFile, setupFile } from '../sim/files'
import { DEFAULTS, INPUT_IDS, SETUP_INPUTS } from '../sim/inputs'
import { Lab } from '../sim/lab'

test('every setup input has a default inside its range', () => {
  for (const s of SETUP_INPUTS) {
    if (s.min != null) assert.ok(s.def >= s.min, s.id)
    if (s.max != null) assert.ok(s.def <= s.max, s.id)
  }
  assert.ok(!INPUT_IDS.has('k-heave') && !INPUT_IDS.has('k-roll'), 'heave and roll are view controls, not saved')
})

test('a setup exported by the original app imports, keeping only known inputs', () => {
  const file = { app: 'StraightRailSetupLab', kind: 'setup', setup: { name: 'Night race', inputs: { lf: '725', g: '0.85', 'k-heave': '1', junk: 'x', bar: '' }, adj: { L: { camber: 0.25 }, R: {} }, radj: { TBtype: 1 }, out: { roll: 1.2 } } }
  const [s] = parseSetupFile(file)
  assert.equal(s.name, 'Night race')
  assert.deepEqual(s.inputs, { lf: 725, g: 0.85 })
  const lab = new Lab()
  lab.applySnapshot(s)
  assert.equal(lab.inputs.lf, 725)
  assert.equal(lab.inputs.bar, DEFAULTS.bar)
  assert.equal(lab.adj.L.camber, 0.25)
  assert.equal(lab.radj.TBtype, 1)
  assert.equal(lab.BASE?.name, 'Night race')
})

test('a saved setup round-trips through its own file', () => {
  const lab = new Lab()
  lab.inputs.rf = 800
  lab.adj.R.caster = 1
  lab.recompute()
  const [s] = parseSetupFile(JSON.parse(JSON.stringify(setupFile(lab.snapshot('Test')))))
  const other = new Lab()
  other.applySnapshot(s)
  assert.equal(other.inputs.rf, 800)
  assert.equal(other.adj.R.caster, 1)
  assert.ok(Math.abs(other.model.phi - lab.model.phi) < 1e-9)
})

test('files that are not setups are refused', () => {
  assert.throws(() => parseSetupFile({ hello: 1 }), /not a setup file/)
  assert.throws(() => parseSetupFile([]), /not a setup file/)
})

test('hardpoints files are checked point by point', () => {
  const hp = parseHardpoints(JSON.parse(JSON.stringify({ L: CAD.L, R: CAD.R })))
  assert.deepEqual(hp.rear, CAD.rear)
  const broken = JSON.parse(JSON.stringify({ L: CAD.L, R: CAD.R }))
  broken.R.UBJ = [1, 2]
  assert.throws(() => parseHardpoints(broken), /R\.UBJ/)
})

test('another car’s hardpoints run through the same math', () => {
  const lab = new Lab()
  const moved = JSON.parse(JSON.stringify({ L: CAD.L, R: CAD.R, rear: CAD.rear }))
  moved.L.UIF[2] += 1
  moved.L.UIR[2] += 1
  lab.useHardpoints(parseHardpoints(moved), 'moved.json')
  assert.equal(lab.customHardpoints, 'moved.json')
  assert.ok(Number.isFinite(lab.model.phi))
  assert.notEqual(lab.kc.L.L.uf, new Lab().kc.L.L.uf)
})

test('a lateral g with stiff right springs moves load to the right side', () => {
  const lab = new Lab()
  lab.inputs.g = 1
  lab.update()
  const [LF, RF, LR, RR] = lab.model.loads
  assert.ok(RF > LF && RR > LR)
  assert.ok(Math.abs(LF + RF + LR + RR - lab.inputs.wt) < 1e-6)
})
