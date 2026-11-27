import * as K from './kin'
import { Lab, MRG, PER, RX, SW, tblAt } from './lab'
import type { MrTable } from './lab'
import type { Quad, RailVehicle, Table } from '../../shorttrack/next/sim/railCar'

const IN = 0.0254, LB = 4.4482216152605, LBM = 0.45359237, DEG = Math.PI / 180, INLB = IN * LB
const NOSE_AHEAD = 32, NOSE_ABOVE = 0.75

const grid = (xs: number[], scale: number, ys: number[]): Table => ({ x0: xs[0] * scale, dx: (xs[1] - xs[0]) * scale, y: ys.map(v => +v.toFixed(7)) })

/**
 * The car on the setup sheet as plain SI numbers for the track test (`shorttrack/next/sim/railDynamics.ts`). The Lab is
 * copied and re-solved at rest (no g, no banking, no steer) so the sliders under Move the car don't leak into the car.
 */
export function railVehicle(src: Lab, name: string): RailVehicle {
  const lab = new Lab(src.rawHardpoints())
  lab.mrFixedFlag = src.mrFixedFlag
  lab.applySnapshot(src.snapshot(name))
  Object.assign(lab.inputs, { g: 0, gx: 0, bank: 0 })
  lab.recompute()
  const m = lab.model, v = (id: string) => lab.num(id)
  const W = v('wt'), Uf = v('unf'), Ur = v('unr'), loads = m.loads
  const cgx = loads.reduce((s, l, i) => s + l * lab.TIRE[i][0], 0) / W
  const fixed = lab.mrFixed()
  type Spring = { k: number; kb: number; gap: number; T: MrTable | null; mr: number }
  const corner = (k: string, b: string, g: string, T: MrTable | null, mr: number): Spring => ({ k: v(k), kb: v(b), gap: v(g), T, mr })
  const C: Spring[] = [
    corner('lf', 'blf', 'glf', fixed ? null : lab.MRT.L, lab.mr0('L')),
    corner('rf', 'brf', 'grf', fixed ? null : lab.MRT.R, lab.mr0('R')),
    corner('lr', 'blr', 'glr', lab.MRTR.L, lab.MRTR.L.mr0),
    corner('rr', 'brr', 'grr', lab.MRTR.R, lab.MRTR.R.mr0),
  ]
  const force = (q: Spring, t: number) => {
    if (q.T) { const s = tblAt(q.T, 's', t), r = tblAt(q.T, 'mr', t); return r * (q.k * s + q.kb * Math.max(0, s - q.gap)) }
    const s = q.mr * t
    return q.mr * (q.k * s + q.kb * Math.max(0, s - q.gap))
  }
  const bumpAt = (q: Spring) => {
    if (!(q.kb > 0)) return 1
    for (let t = 0; t <= 4; t += 0.01) if ((q.T ? tblAt(q.T, 's', t) : q.mr * t) >= q.gap) return t * IN
    return 1
  }
  const sbase = v('rsb')
  const Krb = Math.max(0, m.Krear - (v('lr') + v('rr')) * lab.MRR * lab.MRR * (sbase / 2) ** 2)
  const fr = lab.frontRollAll(lab.kc.L, lab.kc.R), rr = lab.rearRollAll(lab.RG), rh = lab.rearHeaveAll(lab.RG, lab.MRTR)
  const curves = lab.curves as NonNullable<Lab['curves']>
  const ratioR = RX.map(d => K.rearPose(lab.RG, 0, -d * DEG).ratio)
  const per = (i: number) => ({ x: (PER.pts[i][0] - cgx) * IN, y: PER.pts[i][1] * IN, h: m.rest.hNow[i] * IN })
  const names = ['LF frame', 'RF frame', 'LR frame', 'RR frame']
  const clearance = names.map((n, i) => ({ name: n, ...per(i) }))
  const frontX = (lab.TIRE[0][0] + lab.TIRE[1][0]) / 2
  clearance.push({ name: 'Nose', x: (frontX + NOSE_AHEAD - cgx) * IN, y: 0, h: ((m.rest.hNow[0] + m.rest.hNow[1]) / 2 + NOSE_ABOVE) * IN })
  const quad = <T>(f: (i: number) => T): Quad<T> => [f(0), f(1), f(2), f(3)]
  return {
    v: 1,
    name: name.slice(0, 80),
    mass: W * LBM,
    unsprung: [Uf * LBM, Ur * LBM],
    cgH: v('cg') * IN,
    hs: m.h * IN,
    wheelbase: lab.WB * IN,
    tires: quad(i => [(lab.TIRE[i][0] - cgx) * IN, lab.TIRE[i][1] * IN] as [number, number]),
    trackF: lab.TF * IN,
    trackR: lab.TR * IN,
    springY: [lab.HF.L * IN, -lab.HF.R * IN, (sbase / 2) * IN, -(sbase / 2) * IN],
    spring: quad(i => grid(MRG, IN, MRG.map(t => force(C[i], t) * LB))),
    bumpTravel: quad(i => bumpAt(C[i])),
    staticLoad: quad(i => loads[i] * LB),
    barF: m.Kb * INLB,
    barPre: (m.slackRoll ? -m.slackRoll : 0),
    barSlack: v('bpre') < 0,
    barR: Krb * INLB,
    twist: m.Kc * INLB,
    rcF: grid(RX, DEG, fr.map(o => (Number.isFinite(o.rc) ? o.rc : m.hf) * IN)),
    rcR: grid(RX, DEG, rr.map(o => o.rc * IN)),
    jackLF: grid(RX, DEG, fr.map(o => (Number.isFinite(o.jL) ? o.jL : 0) / Math.max(1, loads[0]))),
    jackRF: grid(RX, DEG, fr.map(o => (Number.isFinite(o.jR) ? o.jR : 0) / Math.max(1, loads[1]))),
    jackR: grid(RX, DEG, ratioR.map(r => (Number.isFinite(r) ? r : 0))),
    antiDive: grid(SW, IN, SW.map((_h, i) => (curves.L[i].ad + curves.R[i].ad) / 200)),
    antiSquat: grid(SW, IN, rh.map(o => o.as / 100)),
    camber: [grid(SW, IN, curves.L.map(r => r.camber)), grid(SW, IN, curves.R.map(r => r.camber))],
    toe: [grid(SW, IN, curves.L.map(r => r.toe)), grid(SW, IN, curves.R.map(r => r.toe))],
    rearSteerRoll: grid(RX, DEG, rr.map(o => o.steer)),
    rearSteerHeave: grid(SW, IN, rh.map(o => o.steer)),
    rollout: quad(i => v(['tclf', 'tcrf', 'tclr', 'tcrr'][i]) * IN),
    tireRate: Math.max(1, v('tk')) * LB / IN,
    brakeFront: v('bb') / 100,
    clearance,
    scales: { left: v('ls'), rear: v('rp'), cross: m.cross * 100, weightLb: W },
  }
}

/** The test track the setup describes, as the track page's query: corner radius (ft) and banking (°). */
export function railTrackQuery(lab: Lab): { rad: number; bank: number } {
  return { rad: lab.num('rad'), bank: lab.num('bank') }
}
