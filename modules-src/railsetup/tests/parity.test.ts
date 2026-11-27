import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../sim/kin'
import { Lab, MRG, SW } from '../sim/lab'
import type { Side } from '../sim/lab'
import { ADJ0, RADJ0, withDefaults } from '../sim/inputs'
import type { FrontAdj, RearAdj } from '../sim/inputs'
import fixture from './fixtures/parity.json'

type Case = {
  name: string
  inputs: Record<string, number>
  adj: Record<Side, Partial<FrontAdj>>
  radj: Partial<RearAdj>
  mrFixed: boolean
  steer: number
  out: unknown
}

const SKIP = 'outside the linkage reach'
const R = (x: unknown): unknown => typeof x === 'number' ? (Number.isFinite(x) ? +x.toPrecision(11) : null) : Array.isArray(x) ? x.map(R) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, R(v)])) : x
const pickRows = <T extends Record<string, number>>(rows: T[], keys: (keyof T)[], every = 1) => rows.filter((_r, i) => i % every === 0).map(o => keys.map(k => o[k]))

function replay(c: Case) {
  const lab = new Lab()
  lab.inputs = withDefaults(c.inputs)
  lab.adj = { L: { ...ADJ0, ...c.adj.L }, R: { ...ADJ0, ...c.adj.R } }
  lab.radj = { ...RADJ0, ...c.radj }
  lab.rearSet()
  lab.mrFixedFlag = c.mrFixed
  lab.steerDeg = c.steer
  lab.recompute()
  const m = lab.model, kc = lab.kc, curves = lab.curves as NonNullable<Lab['curves']>
  const AK = ['camber', 'caster', 'toe', 'kpi', 'scrub', 'trail', 'ad', 'dy', 'wx'] as const
  const live = (s: Side) => { const a = K.angles(kc[s], m.P[s]); return [a.camber, a.caster, a.kpi, a.toe, a.scrub, a.trail] }
  const adv = lab.inputs.adv === 1 ? lab.advSolve() : null
  const even = (a: number[] | undefined) => a && a.filter((_v, i) => i % 2 === 0)
  const out = R({
    steerRack: lab.STEER,
    inputsAfter: { hlf: lab.inputs.hlf, hrf: lab.inputs.hrf, hrr: lab.inputs.hrr, cr: lab.inputs.cr },
    model: {
      phi: m.phi, phiF: m.phiF, phiR: m.phiR, lltd: m.lltd, hf: m.hf, hr: m.hr, loads: m.loads, dzF: m.dzF, dzR: m.dzR, pitch: m.pitch, bal: m.bal, stg: m.stg,
      cross: m.cross, fjtot: m.fj.tot, jkFz: m.jk.Fz, fjL: m.fjL, rjL: m.rjL, Kfront: m.Kfront, Krear: m.Krear, Kb: m.Kb, dStatic: m.dStatic, hNow: m.rest.hNow,
      bump: m.bump.map(b => b.s), mrL: m.mrL, mrR: m.mrR, ad: m.ad, asq: m.asq, pose0phi: m.pose0.phi, rsLr: m.rs.lr, nz: m.nz, ay: m.ay,
    },
    adv: adv && { hts: adv.hts, loads: adv.loads, cross: adv.cross, len: adv.len },
    lengths: { L: kc.L.L, R: kc.R.L },
    caster: { L: lab.casterNow('L'), R: lab.casterNow('R') },
    curves: { L: pickRows(curves.L as unknown as Record<string, number>[], [...AK]), R: pickRows(curves.R as unknown as Record<string, number>[], [...AK]) },
    mrt: { L: even(lab.MRT.L?.mr) ?? null, R: even(lab.MRT.R?.mr) ?? null, RL: even(lab.MRTR.L.mr), RR: even(lab.MRTR.R.mr) },
    roll: pickRows(lab.frontRollAll(kc.L, kc.R), ['rc', 'y', 'camL', 'camR', 'jT', 'twist'], 2),
    steer: pickRows(lab.steerAll(kc.L, kc.R), ['x', 'lf', 'rf', 'lL', 'lR'], 4),
    rearRoll: pickRows(lab.rearRollAll(lab.RG), ['rc', 'jack', 'shift', 'steer', 'lead', 'tb'], 2),
    rearHeave: pickRows(lab.rearHeaveAll(lab.RG, lab.MRTR), ['as', 'pin', 'steer', 'rc', 'mrL', 'mrR', 'ula'], 2),
    third: pickRows(lab.thirdAll(lab.RG), ['u', 'side', 'dLR'], 4),
    live: { L: live('L'), R: live('R') },
    rear: { jack: lab.jacking(m.rp, m), third: lab.thirdLink(m.rp, m) },
    summary: lab.outSummary(),
  })
  return { out, lab }
}

function unreachable(lab: Lab): Set<number> {
  const g = lab.RG, bad = new Set<number>()
  MRG.forEach((h, i) => { if (K.rearResidual(g, K.rearSolve(g, g.z0 + h, 0)) > 1e-6) [i - 1, i, i + 1].forEach(j => bad.add(j)) })
  return bad
}

function expectedFor(c: Case, lab: Lab): Record<string, unknown> {
  const expected = JSON.parse(JSON.stringify(c.out)) as Record<string, Record<string, unknown>>
  const bad = unreachable(lab)
  for (const key of ['RL', 'RR']) {
    const arr = expected.mrt[key] as unknown[]
    expected.mrt[key] = arr.map((v, j) => bad.has(j * 2) ? SKIP : v)
  }
  const g = lab.RG
  expected.rearHeave = (expected.rearHeave as unknown as unknown[]).map((row, j) => {
    const h = SW[j * 2], i = Math.min(MRG.length - 2, Math.floor((h - MRG[0]) / 0.2 + 1e-9))
    return K.rearResidual(g, K.rearSolve(g, g.z0 + h, 0)) > 1e-6 || bad.has(i) || bad.has(i + 1) ? SKIP : row
  }) as never
  if (K.rearResidual(lab.RG, lab.model.rp.q) > 1e-6) for (const key of ['model', 'live', 'rear', 'summary', 'roll', 'inputsAfter', 'adv']) expected[key] = SKIP as never
  return expected
}

function compare(actual: unknown, expected: unknown, path: string, fails: string[]) {
  if (fails.length > 8 || expected === SKIP) return
  if (typeof expected === 'number' || expected === null) {
    if (expected === null) { if (actual !== null) fails.push(`${path}: expected NaN, got ${actual}`); return }
    if (typeof actual !== 'number') { fails.push(`${path}: expected ${expected}, got ${actual}`); return }
    if (Math.abs(actual - expected) > 1e-6 + 1e-6 * Math.abs(expected)) fails.push(`${path}: expected ${expected}, got ${actual}`)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) { fails.push(`${path}: length ${Array.isArray(actual) ? actual.length : 'none'} vs ${expected.length}`); return }
    expected.forEach((e, i) => compare(actual[i], e, `${path}[${i}]`, fails))
    return
  }
  if (expected && typeof expected === 'object') {
    for (const [k, e] of Object.entries(expected)) compare((actual as Record<string, unknown> | null)?.[k], e, `${path}.${k}`, fails)
  }
}

for (const c of (fixture as { cases: Case[] }).cases) {
  test(`matches the original app: ${c.name}`, () => {
    const fails: string[] = []
    const { out, lab } = replay(c)
    const expected = expectedFor(c, lab)
    compare(out, expected, 'out', fails)
    assert.deepEqual(fails, [])
    if (expected.model === SKIP) assert.ok(lab.warnings().length > 0, 'a pose past the linkage reach must warn')
  })
}

test('steering self-check passes on both front corners', () => {
  const lab = new Lab()
  assert.equal(K.selfTest(lab.kc.L), true)
  assert.equal(K.selfTest(lab.kc.R), true)
})
