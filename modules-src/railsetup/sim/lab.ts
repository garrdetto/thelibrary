import * as K from './kin'
import type { Angles, Corner, Pose, RearGeometry, RearPose, Vec } from './kin'
import { CAD, END_LINKS, reseat } from './hardpoints'
import type { Hardpoints } from './hardpoints'
import { ADJ0, DEFAULTS, RADJ0, withDefaults } from './inputs'
import type { FrontAdj, Inputs, RearAdj } from './inputs'

export type Side = 'L' | 'R'
export const SIDES: Record<Side, number> = { L: 1, R: -1 }

const MRFIX = 0.65, LBAR = 38, G = 11.5e6
const RBAR_L = 36, RBAR_ARM = 10, TIRE_RR = 13.3
export const PER = { pts: [[18.52, 13.5], [18.52, -15.5], [-58.63, 16.5], [-58.63, -15.5]], z: 3.68 }
const TIRE_IDS = ['tclf', 'tcrf', 'tclr', 'tcrr']
const WHEEL_IDS = ['wwlf', 'wwrf', 'wwlr', 'wwrr', 'bslf', 'bsrf', 'bslr', 'bsrr', 'hulr', 'hurr']

export const SW: number[] = []
for (let h = -3; h <= 3.001; h += 0.25) SW.push(+h.toFixed(2))
export const MRG: number[] = []
for (let h = -4; h <= 4.001; h += 0.2) MRG.push(+h.toFixed(2))
export const RX: number[] = []
for (let d = -3; d <= 3.001; d += 0.25) RX.push(+d.toFixed(2))
export const RACK: number[] = []
for (let r = -1.6; r <= 1.601; r += 0.05) RACK.push(+r.toFixed(2))
export const GX: number[] = []
for (let x = -1.2; x <= 0.801; x += 0.05) GX.push(+x.toFixed(2))

export const mu = (Fz: number) => Math.max(0.6, 1.5 - 0.0004 * Fz)

export function solveN(M: number[][], r: number[]): number[] {
  return K.solveLin(M, r)
}

export function solve3(M: number[][], r: number[]): number[] {
  const A = M.map((row, i) => [...row, r[i]])
  for (let i = 0; i < 3; i++) {
    let p = i
    for (let j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j
    ;[A[i], A[p]] = [A[p], A[i]]
    for (let j = i + 1; j < 3; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k < 4; k++) A[j][k] -= f * A[i][k] }
  }
  const x = [0, 0, 0]
  for (let i = 2; i >= 0; i--) { let t = A[i][3]; for (let k = i + 1; k < 3; k++) t -= A[i][k] * x[k]; x[i] = t / A[i][i] }
  return x
}

export function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let flo = f(lo)
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2, fm = f(m)
    if ((fm > 0) === (flo > 0)) { lo = m; flo = fm } else hi = m
  }
  return (lo + hi) / 2
}

export type MrTable = { s: number[]; mr: number[]; mr0: number; L0: number }

export function tblAt(T: MrTable, key: 's' | 'mr', h: number): number {
  const x = Math.max(MRG[0], Math.min(MRG[MRG.length - 1], h)), f = (x - MRG[0]) / 0.2, i = Math.min(MRG.length - 2, Math.floor(f)), u = f - i
  return T[key][i] + (T[key][i + 1] - T[key][i]) * u
}

function differentiate(Ls: number[]): MrTable {
  const i0 = MRG.indexOf(0)
  const s = Ls.map(l => Ls[i0] - l)
  const mr = s.map((_v, i) => { const a = Math.max(0, i - 1), b = Math.min(s.length - 1, i + 1); return (s[b] - s[a]) / (MRG[b] - MRG[a]) })
  return { s, mr, mr0: mr[i0], L0: Ls[i0] }
}

export function toeDeg(inch: number): number {
  return Math.atan(inch / 26.6) * 180 / Math.PI
}

export type SweepRow = Angles & { ad: number; WCx: number; dy: number; wx: number }
export type FrontJack = { L: number; R: number; tot: number; dz: number }
export type RearJack = { Fy: number; Fz: number; dz: number }
export type ThirdLink = { u: number; y: number; side: number; dLR: number }
export type Bump = { s: number; kb: number; into: number; left: number }
export type Ride = { lr: number; phi: number; dphR: number; dzF: number; dzR: number; t: number[]; ground: number }
export type AdvResult = { hts: number[]; loads: number[]; cross: number; sq: number[]; len: number[]; top: boolean[]; ok: boolean }
export type PoseRest = { dzF: number; dzR: number; phi: number; dphR: number }

export type Model = {
  rs: Ride
  rest: PoseRest & { hNow: number[]; rnd: number[] }
  pose0: PoseRest
  phiF: number; phiR: number; Kc: number; mrL: number; mrR: number; Kfront: number; Krear: number; Kb: number
  fjL: number; rjL: number; dWx: number; asq: number; bf: number; ad: number
  loads: number[]; phi: number; lltd: number; front: number; hf: number; hr: number
  ay: number; ayH: number; bank: number; nz: number; W: number; h: number; hs: number
  dzF: number; dzR: number; P: Record<Side, Pose>; rp: RearPose; fj: FrontJack; jk: RearJack
  cross: number; dStatic: number[]; gx: number; pitch: number; slackRoll: number; bump: Bump[]
  bal: number; stg: number; stgNeed: number; ta: RearPose
  settled: boolean
}

export type Baseline = { name: string; adj: Record<Side, FrontAdj>; radj: RearAdj; inputs: Record<string, unknown> }

export type Snapshot = {
  name: string
  inputs: Record<string, unknown>
  adj?: Partial<Record<Side, Partial<FrontAdj>>>
  radj?: Partial<RearAdj>
  out?: Record<string, number>
}

export const OUTROWS: [string, string, number][] = [
  ['Body roll, °', 'roll', 2], ['Front LLTD, %', 'lltd', 1], ['Cross, %', 'cross', 1], ['LF load, lb', 'LF', 0], ['RF load, lb', 'RF', 0], ['LR load, lb', 'LR', 0], ['RR load, lb', 'RR', 0],
  ['Front RC, in', 'fRC', 2], ['Rear RC, in', 'rRC', 2], ['Front jacking, lb', 'fjk', 0], ['Rear jacking, lb', 'rjk', 0], ['Rear steer, °', 'steer', 2], ['Balance', 'bal', 1], ['Stagger vs corner, in', 'stg', 2],
]

export class Lab {
  HP: Hardpoints
  RG0: RearGeometry
  RG: RearGeometry
  MRTR: Record<Side, MrTable>
  MRT: Record<Side, MrTable | null> = { L: null, R: null }
  MRF = MRFIX
  MRR = 1
  TF0 = 0
  TR0 = 0
  TF = 0
  TR = 0
  WB = 0
  HF: Record<Side, number> = { L: 0, R: 0 }
  WOUT: Record<Side, number> = { L: 0, R: 0 }
  TIRE: number[][]
  TIRE0: number[][]
  kc = {} as Record<Side, Corner>
  base = {} as Record<Side, Corner>
  curves: { L: SweepRow[]; R: SweepRow[]; bL: SweepRow[]; bR: SweepRow[] } | null = null
  STEER = 0
  steerDeg = 0
  heave = 0
  roll = 0
  calcGuess: Record<Side, Pose | null> = { L: null, R: null }
  adj: Record<Side, FrontAdj> = { L: { ...ADJ0 }, R: { ...ADJ0 } }
  radj: RearAdj = { ...RADJ0 }
  defaults: Inputs = DEFAULTS
  inputs: Inputs = { ...DEFAULTS }
  mrFixedFlag = false
  model!: Model
  adv: AdvResult | null = null
  BASE: Baseline | null = null
  customHardpoints: string | null = null
  private wheelKey = ''

  constructor(hp?: Hardpoints) {
    this.HP = reseat(hp ?? CAD)
    this.RG0 = K.rearBuild(this.HP.rear)
    this.RG = this.RG0
    const w = this.rearW(this.RG0)
    this.TIRE = [[this.HP.L.WC[0], this.HP.L.WC[1]], [this.HP.R.WC[0], this.HP.R.WC[1]], [w.L[0], w.L[1]], [w.R[0], w.R[1]]]
    this.TIRE0 = this.TIRE.map(a => a.slice())
    for (const k of ['L', 'R'] as Side[]) this.base[k] = this.buildCorner(k, ADJ0)
    this.MRTR = this.rearMr(this.RG)
    this.rearSet()
    this.setDims()
    this.recompute()
  }

  num(id: string): number {
    const v = this.inputs[id]
    return Number.isFinite(v) ? v : this.defaults[id]
  }

  rearW(g: RearGeometry) {
    return K.rearPose(g, 0, 0).W
  }

  buildCorner(k: Side, a: FrontAdj, hp: Hardpoints = this.HP): Corner {
    return K.build(hp[k], SIDES[k], { ufz: a.ufz, urz: a.urz, ufx: a.ufx, urx: a.urx, lfz: a.lfz, lrz: a.lrz, lfx: a.lfx, lrx: a.lrx, lslug: a.lslug, uslug: a.uslug, camber: a.camber, caster: a.caster, tro: a.tro, toe: toeDeg(a.toeIn), ucaLen: a.ucaLen, lcaLen: a.lcaLen, ucaX: a.ucaX, tri: a.tri, umh: a.umh, lmh: a.lmh, wo: this.WOUT[k] })
  }

  mrFixed(): boolean {
    return this.mrFixedFlag || !this.MRT.L || !this.MRT.R
  }

  mr0(s: Side): number {
    return this.mrFixed() ? MRFIX : (this.MRT[s] as MrTable).mr0
  }

  tireOff(loads: number[]): number[] {
    const k = Math.max(1, this.num('tk'))
    return TIRE_IDS.map((id, i) => this.num(id) / (2 * Math.PI) - Math.max(0, loads[i]) / k - K.TIRE_R)
  }

  tireAxles(d: number[]) {
    const pF = (d[0] - d[1]) / (this.HF.L + this.HF.R), pR = (d[2] - d[3]) / this.TR
    return { aF: d[0] - this.HF.L * pF, pF, aR: (d[2] + d[3]) / 2, pR }
  }

  scaleLoads(): number[] {
    const W = this.num('wt'), L = W * this.num('ls') / 100, F = W * (1 - this.num('rp') / 100), X = W * this.num('cr') / 100
    const b = [(L + F - X) / 2]
    b[1] = F - b[0]
    b[2] = L - b[0]
    b[3] = W - b[0] - b[1] - b[2]
    return b
  }

  rideSet(): Ride {
    const d = (id: string) => this.num(id) - PER.z, P = PER.pts
    const [a, b, c] = solve3([0, 1, 3].map(i => [1, P[i][0], P[i][1]]), [d('hlf'), d('hrf'), d('hrr')]), at = (x: number, y: number) => a + b * x + c * y
    const t = this.tireOff(this.scaleLoads()), A = this.tireAxles(t)
    return { lr: PER.z + at(P[2][0], P[2][1]), phi: c - A.pF, dphR: A.pF - A.pR, dzF: at(this.TIRE[0][0], 0) - A.aF, dzR: at(this.TIRE[2][0], 0) - A.aR, t, ground: c }
  }

  advSolve(): AdvResult {
    const v = (id: string) => this.num(id), W = v('wt'), ls = v('ls') / 100, rp = v('rp') / 100, sb = v('rsb') / 2, Uf = v('unf') / 2, Ur = v('unr') / 2
    const ids = ['lf', 'rf', 'lr', 'rr'], k = ids.map(c => v(c)), fl = ids.map(c => v('fl' + c)), pl = ids.map(c => v('pl' + c)), so = ids.map(c => v('so' + c))
    const fixed = this.mrFixed()
    const T: (MrTable | null)[] = [fixed ? null : this.MRT.L, fixed ? null : this.MRT.R, this.MRTR.L, this.MRTR.R], L0 = T.map(t => t ? t.L0 : 19.4)
    const corner = (i: number, h: number) => {
      const t = T[i]
      const s = t ? tblAt(t, 's', h) : MRFIX * h, mr = t ? tblAt(t, 'mr', h) : MRFIX
      const sq = pl[i] + s - (L0[i] - so[i])
      return { f: mr * k[i] * Math.max(0, sq), sq, top: s < L0[i] - so[i] }
    }
    type C = ReturnType<typeof corner>
    const run = ([zF, zR, ph]: number[]) => {
      let loads = [W / 4, W / 4, W / 4, W / 4]
      let c: C[] = []
      for (let it = 0; it < 10; it++) {
        const A = this.tireAxles(this.tireOff(loads))
        const h = [-zF - this.HF.L * ph + A.aF + this.HF.L * A.pF, -zF + this.HF.R * ph + A.aF - this.HF.R * A.pF, -zR - sb * ph + A.aR + sb * A.pR, -zR + sb * ph + A.aR - sb * A.pR]
        c = h.map((x, i) => corner(i, x))
        const rS = c[2].f + c[3].f, rD = (c[3].f - c[2].f) * sb * 2 / this.TR
        loads = [c[0].f + Uf, c[1].f + Uf, (rS - rD) / 2 + Ur, (rS + rD) / 2 + Ur]
      }
      return { c, loads }
    }
    const res = (x: number[]) => { const L = run(x).loads; return [L[0] + L[1] + L[2] + L[3] - W, L[0] + L[1] - W * (1 - rp), L[0] + L[2] - W * ls] }
    let x = [0, 0, 0]
    for (let it = 0; it < 40; it++) {
      const r = res(x)
      if (Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) < 1e-3) break
      const J: number[][] = [[], [], []]
      for (let j = 0; j < 3; j++) { const e = j < 2 ? 1e-4 : 1e-6, xp = [...x]; xp[j] += e; const rp2 = res(xp); for (let q = 0; q < 3; q++) J[q][j] = (rp2[q] - r[q]) / e }
      const d = solve3(J, r.map(t => -t))
      x = x.map((t, j) => t + Math.max(-1, Math.min(1, d[j])))
    }
    const [zF, zR, ph] = x, out = run(x), at = (X: number, Y: number) => PER.z + zR + (zF - zR) * (X - this.TIRE[2][0]) / (this.TIRE[0][0] - this.TIRE[2][0]) + ph * Y
    return {
      hts: PER.pts.map(p => at(p[0], p[1])), loads: out.loads, cross: (out.loads[1] + out.loads[2]) / W,
      sq: out.c.map(c => c.sq), len: out.c.map((c, i) => fl[i] - c.sq), top: out.c.map(c => c.top), ok: Math.abs(res(x)[0]) < 1,
    }
  }

  frontJack(P: Record<Side, Pose> | null, mdl: { loads: number[]; ay: number } | null, Kc?: Record<Side, Corner>): FrontJack {
    const KK = Kc || this.kc
    const out = { L: 0, R: 0, tot: 0, dz: 0 }
    if (!P || !mdl) return out
    for (const s of ['L', 'R'] as Side[]) {
      const ic = K.ics(KK[s], P[s]).fv, cp = K.angles(KK[s], P[s]).CP
      if (!ic) continue
      const Fy = Math.max(0, mdl.loads[s === 'L' ? 0 : 1]) * mdl.ay
      out[s] = Fy * (ic[1] - cp[2]) / (ic[0] - cp[1])
    }
    out.tot = out.L + out.R
    out.dz = out.tot / ((this.inputs.lf + this.inputs.rf) * this.MRF * this.MRF)
    return out
  }

  wheelGeom() {
    const w = (c: string) => this.num('ww' + c) / 2 - this.num('bs' + c)
    const o = { lf: w('lf'), rf: w('rf'), lr: w('lr') + this.num('hulr'), rr: w('rr') + this.num('hurr') }
    this.WOUT.L = o.lf
    this.WOUT.R = o.rf
    this.HF.L = this.TF0 / 2 + o.lf
    this.HF.R = this.TF0 / 2 + o.rf
    this.TF = this.HF.L + this.HF.R
    this.TR = this.TR0 + o.lr + o.rr
    this.TIRE[0][1] = this.TIRE0[0][1] + o.lf
    this.TIRE[1][1] = this.TIRE0[1][1] - o.rf
    this.TIRE[2][1] = this.TIRE0[2][1] + o.lr
    this.TIRE[3][1] = this.TIRE0[3][1] - o.rr
    return o
  }

  steerLift(c: Corner, h: number): number {
    if (!this.STEER) return 0
    const p0 = K.poseH(c, h, null)
    let g: Pose = p0
    const N = Math.max(4, Math.ceil(Math.abs(this.STEER) / 0.05))
    for (let i = 1; i <= N; i++) g = K.poseAt(c, p0.th, g, this.STEER * i / N)
    return g.WC[2] - p0.WC[2]
  }

  steerRack(deg: number): number {
    if (!deg) return 0
    const avg = (r: number) => {
      const aL = K.angles(this.kc.L, K.poseH(this.kc.L, 0, null, r)).toe, aR = K.angles(this.kc.R, K.poseH(this.kc.R, 0, null, r)).toe
      return (aL - aR) / 2
    }
    const b = avg(0)
    return bisect(r => avg(r) - b - deg, -2, 2)
  }

  casterNow(s: Side): number {
    return K.angles(this.kc[s], K.poseH(this.kc[s], 0, null)).caster
  }

  thirdLink(rp: RearPose, m: { gx: number; W: number; bf: number; Kfront: number; Krear: number }, gg?: RearGeometry): ThirdLink {
    const g = gg || this.RG
    const Fx = m.gx < 0 ? m.W * m.gx * (1 - m.bf) : m.W * m.gx, VV = K.V, e = (k: K.LinkName) => VV.norm(VV.sub(g.C[k], rp.P[k]))
    const wx = (rp.W.L[0] + rp.W.R[0]) / 2, wz = (rp.W.L[2] + rp.W.R[2]) / 2, eU = e('UL'), eL = VV.mul(VV.add(e('LL'), e('RL')), 0.5), pL = VV.mul(VV.add(rp.P.LL, rp.P.RL), 0.5)
    const mom = (p: Vec, d: Vec) => (p[2] - wz) * d[0] - (p[0] - wx) * d[2], mL = mom(pL, eL), mU = mom(rp.P.UL, eU)
    const u = (eL[0] * K.TIRE_R * Fx + mL * Fx) / (eL[0] * mU - eU[0] * mL)
    const y = rp.P.UL[1] - rp.q[1]
    return { u, y, side: u * eU[1], dLR: -u * eU[2] * y / this.TR * m.Kfront / (m.Kfront + m.Krear) }
  }

  jacking(rp: RearPose, mdl: { W: number; front: number; ay: number }): RearJack {
    const Fy = Math.max(0, mdl.W * (1 - mdl.front) - this.inputs.unr) * mdl.ay
    const Fz = Fy * rp.ratio
    return { Fy, Fz, dz: Fz / (this.inputs.lr + this.inputs.rr) }
  }

  rearMr(g: RearGeometry): Record<Side, MrTable> {
    const P = MRG.map(h => K.rearPose(g, h, 0))
    return { L: differentiate(P.map(p => p.shock.L)), R: differentiate(P.map(p => p.shock.R)) }
  }

  rearSet() {
    this.RG = K.rearAdjust(this.RG0, this.radj)
    this.MRTR = this.rearMr(this.RG)
    this.MRR = (this.MRTR.L.mr0 + this.MRTR.R.mr0) / 2
  }

  mrTable(c: Corner): MrTable | null {
    if (!c.shLoc) return null
    const i0 = MRG.indexOf(0), Ls = new Array<number>(MRG.length)
    let g: Pose | null = null
    for (let i = i0; i < MRG.length; i++) { const p = K.poseH(c, MRG[i], g); g = p; Ls[i] = K.shockLen(c, p) as number }
    g = null
    for (let i = i0; i >= 0; i--) { const p = K.poseH(c, MRG[i], g); g = p; Ls[i] = K.shockLen(c, p) as number }
    return differentiate(Ls)
  }

  sweep(c: Corner, hcg = this.num('cg'), bfPct = this.num('bb')): SweepRow[] {
    const idx0 = SW.indexOf(0), res = new Array<SweepRow>(SW.length), bf = bfPct / 100
    const at = (p: Pose) => Object.assign(K.angles(c, p), { ad: K.antiDive(c, p, hcg, this.WB, bf), WCx: p.WC[0], dy: 0, wx: 0 })
    let g: Pose | null = null
    for (let i = idx0; i < SW.length; i++) { const p = K.poseH(c, SW[i], g); g = p; res[i] = at(p) }
    g = null
    for (let i = idx0; i >= 0; i--) { const p = K.poseH(c, SW[i], g); g = p; res[i] = at(p) }
    res.forEach(r => { r.dy = c.s * (r.CP[1] - res[idx0].CP[1]); r.wx = r.WCx - res[idx0].WCx })
    return res
  }

  setDims() {
    const w = this.rearW(this.RG0)
    this.TIRE0[0] = [this.HP.L.WC[0], this.HP.L.WC[1]]
    this.TIRE0[1] = [this.HP.R.WC[0], this.HP.R.WC[1]]
    this.TIRE0[2] = [w.L[0], w.L[1]]
    this.TIRE0[3] = [w.R[0], w.R[1]]
    this.TF0 = this.TIRE0[0][1] - this.TIRE0[1][1]
    this.TR0 = this.TIRE0[2][1] - this.TIRE0[3][1]
    this.WB = (this.TIRE0[0][0] + this.TIRE0[1][0] - this.TIRE0[2][0] - this.TIRE0[3][0]) / 2
    this.TIRE.forEach((t, i) => { t[0] = this.TIRE0[i][0]; t[1] = this.TIRE0[i][1] })
    this.wheelGeom()
  }

  useHardpoints(hp: Hardpoints, name: string | null, seat = true) {
    this.HP = seat ? reseat(hp) : hp
    this.RG0 = K.rearBuild(this.HP.rear)
    this.rearSet()
    this.setDims()
    for (const k of ['L', 'R'] as Side[]) this.base[k] = this.buildCorner(k, ADJ0)
    this.curves = null
    this.customHardpoints = name
    this.recompute()
  }

  /** A fresh Lab with this one's hardpoints exactly as they stand (no second seating), defaults, fixed-MR switch and setup; view sliders at zero. */
  copy(name = ''): Lab {
    const lab = new Lab()
    lab.useHardpoints(JSON.parse(JSON.stringify(this.rawHardpoints())) as Hardpoints, this.customHardpoints, false)
    lab.defaults = this.defaults
    lab.inputs = { ...this.defaults }
    lab.mrFixedFlag = this.mrFixedFlag
    lab.applySnapshot(this.snapshot(name))
    return lab
  }

  rawHardpoints(): Hardpoints {
    return { L: this.HP.L, R: this.HP.R, rear: this.HP.rear }
  }

  recompute() {
    this.wheelGeom()
    for (const k of ['L', 'R'] as Side[]) { this.kc[k] = this.buildCorner(k, this.adj[k]); this.MRT[k] = this.mrTable(this.kc[k]) }
    this.MRF = this.mrFixed() ? MRFIX : ((this.MRT.L as MrTable).mr0 + (this.MRT.R as MrTable).mr0) / 2
    this.calcGuess = { L: null, R: null }
    this.STEER = this.steerRack(this.steerDeg)
    this.curves = { L: this.sweep(this.kc.L), R: this.sweep(this.kc.R), bL: this.sweep(this.base.L), bR: this.sweep(this.base.R) }
    this.wheelKey = WHEEL_IDS.map(id => this.inputs[id]).join('/')
    this.update()
  }

  setSteer(deg: number) {
    this.steerDeg = deg
    this.STEER = this.steerRack(deg)
    this.update()
  }

  update(): Model {
    const key = WHEEL_IDS.map(id => this.inputs[id]).join('/')
    if (key !== this.wheelKey) { this.recompute(); return this.model }
    this.wheelGeom()
    this.adv = null
    if (this.inputs.adv === 1) {
      const A = this.advSolve()
      this.adv = A
      ;(['hlf', 'hrf', 'hrr'] as const).forEach((id, i) => { this.inputs[id] = +A.hts[[0, 1, 3][i]].toFixed(4) })
      this.inputs.cr = +(A.cross * 100).toFixed(2)
    }
    this.model = this.calc()
    return this.model
  }

  calc(): Model {
    const v = (id: string) => this.num(id)
    const W = v('wt'), lf = v('lf'), rf = v('rf'), lr = v('lr'), rr = v('rr'), od = v('bar'), id = Math.min(v('bid'), v('bar') - 0.125), ay = v('g'), h = v('cg')
    const ls = v('ls') / 100, rp = v('rp') / 100, cr = v('cr') / 100, mrb = v('mrb'), arm = v('arm'), sbase = v('rsb')
    const Uf = v('unf'), Ur = v('unr'), rbar = v('rbar'), pre = v('bpre'), gx = v('gx'), bf = v('bb') / 100
    const bk = (v('bank') || 0) * Math.PI / 180, ayH = ay, ayT = ayH * Math.cos(bk) - Math.sin(bk), nz = Math.cos(bk) + ayH * Math.sin(bk)
    const L = W * ls, F = W * (1 - rp), X = W * cr
    const base = [(L + F - X) / 2, 0, 0, 0]
    base[1] = F - base[0]; base[2] = L - base[0]; base[3] = W - base[0] - base[1] - base[2]
    const TF0 = this.TF0, TR0 = this.TR0, TF = this.TF, TR = this.TR, HF = this.HF, WB = this.WB, TIRE = this.TIRE, kc = this.kc
    const Kb = G * (Math.PI * (od ** 4 - id ** 4) / 32) / LBAR * (TF0 * mrb / arm) ** 2
    const Krb = rbar > 0 ? G * (Math.PI * rbar ** 4 / 32) / RBAR_L * (TR0 / RBAR_ARM) ** 2 : 0
    const phiB = pre / (TF0 * mrb)
    const Kc = v('ctor') * 12 * 180 / Math.PI
    const fixed = this.mrFixed()
    type Cn = { k: number; mr: number; a: number; c: number; kb: number; gap: number; T: MrTable | null }
    const C: Cn[] = [
      { k: lf, mr: this.mr0('L'), a: HF.L, c: -1, kb: v('blf'), gap: v('glf'), T: fixed ? null : this.MRT.L },
      { k: rf, mr: this.mr0('R'), a: HF.R, c: 1, kb: v('brf'), gap: v('grf'), T: fixed ? null : this.MRT.R },
      { k: lr, mr: this.MRTR.L.mr0, a: sbase / 2, c: -1, kb: v('blr'), gap: v('glr'), T: this.MRTR.L },
      { k: rr, mr: this.MRTR.R.mr0, a: sbase / 2, c: 1, kb: v('brr'), gap: v('grr'), T: this.MRTR.R },
    ]
    const rs = this.rideSet()
    let phS = rs.phi
    const slL = -this.steerLift(kc.L, -rs.dzF - HF.L * phS), slR = -this.steerLift(kc.R, -rs.dzF + HF.R * phS)
    const tpi = v('tpi') > 0 ? v('tpi') : 8, rnd = ['rnlf', 'rnrf', 'rnlr', 'rnrr'].map(k => (v(k) || 0) / tpi)
    const Kbs = pre >= 0 ? Kb : 0, phiBs = Math.max(phiB, 0), seat = [slL, slR, 0, 0].map((s, i) => s + rnd[i] / C[i].mr), xs = [WB, WB, 0, 0]
    const w = C.map(q => q.k * q.mr * q.mr), g4 = (i: number) => [1, i < 2 ? C[i].c * C[i].a : 0, i < 2 ? 0 : C[i].c * C[i].a, xs[i]]
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], r = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      const gi = g4(i)
      for (let row = 0; row < 4; row++) { for (let col = 0; col < 4; col++) M[row][col] += w[i] * gi[row] * gi[col]; r[row] -= w[i] * gi[row] * seat[i] }
    }
    M[1][1] += Kbs + Kc; M[1][2] -= Kc; M[2][1] -= Kc; M[2][2] += Krb + Kc; r[1] -= Kbs * phiBs
    const [z0, pf0, pr0, t0] = solveN(M, r), dF = [0, 1, 2, 3].map(i => w[i] * (z0 + (i < 2 ? C[i].c * C[i].a * pf0 : C[i].c * C[i].a * pr0) + xs[i] * t0 + seat[i])), Mb0 = Kbs * (pf0 + phiBs)
    const rS = dF[2] + dF[3], rD = (dF[3] - dF[2]) * sbase / TR
    const Mr0 = Krb * pr0
    const dStatic = [dF[0] - Mb0 / TF, dF[1] + Mb0 / TF, (rS - rD) / 2 - Mr0 / TR, (rS + rD) / 2 + Mr0 / TR]
    const [LF, RF, LR, RR] = base.map((x, i) => x + dStatic[i])
    const pr = (pf0 + pr0) / 2, rise = (x: number, y: number) => -z0 - t0 * (x - TIRE[2][0]) + pr * y
    const rest = {
      dzF: rs.dzF + rise(TIRE[0][0], 0), dzR: rs.dzR + rise(TIRE[2][0], 0), phi: rs.phi + pr, dphR: rs.dphR,
      hNow: [v('hlf'), v('hrf'), rs.lr, v('hrr')].map((hh, i) => hh + rise(PER.pts[i][0], PER.pts[i][1])), rnd,
    }
    const mh = -this.heave, pose0 = { dzF: rest.dzF + mh, dzR: rest.dzR + mh, phi: rest.phi + this.roll * Math.PI / 180, dphR: rest.dphR }
    phS = pose0.phi
    const slackRoll = pre < 0 ? -phiB : 0
    const travel = (i: number, phi: number, dzJ: number) => -dzJ + C[i].c * C[i].a * phi
    const force = (i: number, t: number) => {
      const q = C[i]
      if (q.T) { const s = tblAt(q.T, 's', t), m = tblAt(q.T, 'mr', t); return m * (q.k * s + q.kb * Math.max(0, s - q.gap)) }
      const s = q.mr * t
      return q.mr * (q.k * s + q.kb * Math.max(0, s - q.gap))
    }
    const barM = (phi: number) => pre < 0 ? Kb * Math.max(0, phi - slackRoll) : Kb * phi
    const Mf = (phi: number, zf: number) => -force(0, travel(0, phi, zf)) * C[0].a + force(1, travel(1, phi, zf)) * C[1].a + barM(phi)
    const Mr = (phi: number, zr: number) => -force(2, travel(2, phi, zr)) * C[2].a + force(3, travel(3, phi, zr)) * C[3].a + Krb * phi
    const Wf = F, Wr = W - F, Ws = W - Uf - Ur, aS = (Wr - Ur) / Ws
    const hs0 = (W * h - (Uf + Ur) * TIRE_RR) / Ws
    let phi = 0, phiF = 0, phiR = 0, zJF = 0, zJR = 0, dzF = pose0.dzF, dzR = pose0.dzR, hf = 2, hr = 10
    let P = null as Record<Side, Pose> | null, rpo = null as RearPose | null, fj = null as FrontJack | null, jk = null as RearJack | null
    let loads: number[] = [0, 0, 0, 0], dWf = 0, dWr = 0, hs = hs0
    const g = this.RG, dWx = W * gx * h / WB
    let ad = 0, asq = 0, sF = 0, sR = 0
    let settled = false
    for (let it = 0; it < 12; it++) {
      dzF = pose0.dzF + zJF; dzR = pose0.dzR + zJR
      const hL = -dzF - HF.L * (phiF + phS), hR = -dzF + HF.R * (phiF + phS)
      P = { L: K.poseH(kc.L, Math.max(-3.5, Math.min(3.5, hL)), this.calcGuess.L, this.STEER), R: K.poseH(kc.R, Math.max(-3.5, Math.min(3.5, hR)), this.calcGuess.R, this.STEER) }
      this.calcGuess = { L: P.L, R: P.R }
      const rc = K.rollCenter(kc.L, P.L, kc.R, P.R)
      if (rc) hf = rc[1] + dzF
      rpo = K.rearPose(g, -dzR, -(phiR + phS + pose0.dphR), rpo && rpo.q)
      hr = rpo.rcz
      hs = hs0 + dzF + (dzR - dzF) * aS
      const hra = hf + (hr - hf) * aS
      const Mapp = Ws * ayT * (hs - hra)
      const MappF = Mapp * (1 - aS), MappR = Mapp * aS
      let pF = phiF, pR = phiR
      for (let k = 0; k < 40; k++) {
        const a = pF, b = pR
        const pRc = pR
        pF = bisect(x => Mf(x, zJF) + Kc * (x - pRc) - MappF, -0.3, 0.3)
        const pFc = pF
        pR = bisect(x => Mr(x, zJR) - Kc * (pFc - x) - MappR, -0.3, 0.3)
        if (Math.abs(pF - a) + Math.abs(pR - b) < 1e-9) break
      }
      const phiN = pF * (1 - aS) + pR * aS
      dWf = (Wf - Uf) * ayT * hf / TF + Mf(pF, zJF) / TF + Uf * ayT * TIRE_RR / TF
      dWr = (Wr - Ur) * ayT * hr / TR + Mr(pR, zJR) / TR + Ur * ayT * TIRE_RR / TR
      loads = [LF * nz - dWf - dWx / 2, RF * nz + dWf - dWx / 2, LR * nz - dWr + dWx / 2, RR * nz + dWr + dWx / 2]
      ad = (K.antiDive(kc.L, P.L, h, WB, bf) + K.antiDive(kc.R, P.R, h, WB, bf)) / 200
      asq = rpo.tanSV * WB / h
      if (gx < 0) { sF = -dWx * (1 - ad); sR = dWx * (1 - asq * (1 - bf)) } else { sF = -dWx; sR = dWx * (1 - asq) }
      sF += (nz - 1) * (Wf - Uf); sR += (nz - 1) * (Wr - Ur)
      const m = { loads, ay: ayT, W, front: F / W }
      fj = this.frontJack(P, m); jk = this.jacking(rpo, m)
      const fjt = fj.tot, jkz = jk.Fz, pFv = pF, pRv = pR, sFv = sF, sRv = sR
      const zF = bisect(zz => force(0, travel(0, pFv, zz)) + force(1, travel(1, pFv, zz)) + fjt - sFv, -6, 6)
      const zR = bisect(zz => force(2, travel(2, pRv, zz)) + force(3, travel(3, pRv, zz)) + jkz - sRv, -6, 6)
      const d = Math.abs(pF - phiF) + Math.abs(pR - phiR) + Math.abs(zF - zJF) + Math.abs(zR - zJR)
      phi = phiN; phiF = pF; phiR = pR; zJF += (zF - zJF) * 0.6; zJR += (zR - zJR) * 0.6
      if (d < 1e-5) { settled = true; break }
    }
    dzF = pose0.dzF + zJF; dzR = pose0.dzR + zJR
    const bump = C.map((q, i) => {
      const t = travel(i, i < 2 ? phiF : phiR, i < 2 ? zJF : zJR), s = q.T ? tblAt(q.T, 's', t) : q.mr * t
      return { s, kb: q.kb, into: q.kb ? Math.max(0, s - q.gap) : 0, left: q.gap - s }
    })
    const cap = (i: number) => mu(Math.max(loads[i], 0)) * Math.max(loads[i], 0)
    const Fxf = gx < 0 ? W * -gx * bf : 0, Fxr = gx < 0 ? W * -gx * (1 - bf) : W * gx
    const uf = Math.hypot(Wf * ayT, Fxf) / (cap(0) + cap(1)), ur = Math.hypot(Wr * ayT, Fxr) / (cap(2) + cap(3))
    const stgNeed = (v('tclr') + v('tcrr')) / 2 * TR / (v('rad') * 12)
    const fjL = gx < 0 ? -dWx * ad : 0, rjL = gx < 0 ? dWx * asq * (1 - bf) : dWx * asq
    const Kfront = Kb + lf * C[0].mr ** 2 * HF.L ** 2 + rf * C[1].mr ** 2 * HF.R ** 2, Krear = (lr + rr) * this.MRR * this.MRR * (sbase / 2) ** 2 + Krb
    const rpf = rpo as RearPose
    return {
      rs, rest, pose0, phiF, phiR, Kc, mrL: C[0].mr, mrR: C[1].mr, Kfront, Krear, Kb, fjL, rjL, dWx, asq, bf, ad, loads, phi, lltd: dWf / (dWf + dWr), front: F / W, hf, hr,
      ay: ayT, ayH, bank: bk, nz, W, h: hs0, hs, dzF, dzR, P: P as Record<Side, Pose>, rp: rpf, fj: fj as FrontJack, jk: jk as RearJack, cross: (LR + RF) / W, dStatic, gx,
      pitch: Math.atan((dzF - dzR) / WB), slackRoll, bump, bal: (uf - ur) * 100, stg: v('tcrr') - v('tclr') - stgNeed, stgNeed, ta: rpf, settled,
    }
  }

  outSummary(m: Model = this.model): Record<string, number> {
    return {
      roll: m.phi * 180 / Math.PI, lltd: m.lltd * 100, cross: m.cross * 100, LF: m.loads[0], RF: m.loads[1], LR: m.loads[2], RR: m.loads[3],
      fRC: m.hf, rRC: m.hr, fjk: m.fj.tot + m.fjL, rjk: m.jk.Fz + m.rjL, steer: m.ta.steer, bal: m.bal, stg: m.stg,
    }
  }

  snapshot(name: string): Snapshot {
    return { name, inputs: { ...this.inputs }, adj: JSON.parse(JSON.stringify(this.adj)), radj: { ...this.radj }, out: this.outSummary() }
  }

  setBaseline(x: Snapshot | null) {
    this.BASE = x ? {
      name: x.name,
      adj: { L: { ...ADJ0, ...(x.adj && x.adj.L) }, R: { ...ADJ0, ...(x.adj && x.adj.R) } },
      radj: { ...RADJ0, ...x.radj },
      inputs: x.inputs || {},
    } : null
  }

  applySnapshot(x: Snapshot) {
    this.inputs = withDefaults({ ...this.inputs, ...(x.inputs || {}) }, this.defaults)
    for (const s of ['L', 'R'] as Side[]) this.adj[s] = { ...ADJ0, ...(x.adj && x.adj[s]) }
    this.radj = { ...RADJ0, ...x.radj }
    this.rearSet()
    this.setBaseline(x)
    this.recompute()
  }

  resetAll() {
    this.setBaseline(null)
    this.inputs = { ...this.defaults }
    this.adj = { L: { ...ADJ0 }, R: { ...ADJ0 } }
    this.radj = { ...RADJ0 }
    this.rearSet()
    this.recompute()
  }

  baseNum(id: string): number {
    const b = this.BASE
    const raw = b ? b.inputs[id] : undefined
    return b && raw != null && raw !== '' ? +(raw as number) : this.num(id)
  }

  jackModel() {
    return this.model.ay >= 0.05 ? this.model : { ...this.model, ay: 1 }
  }

  partsRows() {
    const rows: [string, keyof Corner['L']][] = [['Upper arm, front leg', 'uf'], ['Upper arm, rear leg', 'ur'], ['Lower arm, front leg', 'lf'], ['Lower arm, rear leg', 'lr'], ['Kingpin (BJ to BJ)', 'kp'], ['Tie rod', 'tr']]
    return rows.map(([name, k]) => ({ name, L: this.kc.L.L[k], R: this.kc.R.L[k], dL: this.kc.L.L[k] - this.base.L.L[k], dR: this.kc.R.L[k] - this.base.R.L[k] }))
  }

  bumpSteer(s: Side): number {
    const c = this.curves as NonNullable<Lab['curves']>
    const i = SW.indexOf(1), j = SW.indexOf(-1)
    return (c[s][i].toe - c[s][j].toe) / 2
  }

  live(P: Record<Side, Pose>, rollDeg: number, hb = 0) {
    const A = { L: K.angles(this.kc.L, P.L), R: K.angles(this.kc.R, P.R) }
    const cg = { L: A.L.camber - rollDeg, R: A.R.camber + rollDeg }
    const bf = this.inputs.bb / 100, hcg = this.inputs.cg
    const ad = { L: K.antiDive(this.kc.L, P.L, hcg, this.WB, bf), R: K.antiDive(this.kc.R, P.R, hcg, this.WB, bf) }
    const fj = this.frontJack(P, this.model)
    if (this.model.gx < 0) for (const s of ['L', 'R'] as Side[]) fj[s] += -this.model.dWx / 2 * ad[s] / 100
    fj.tot = fj.L + fj.R
    fj.dz = fj.tot / ((this.inputs.lf + this.inputs.rf) * this.MRF * this.MRF)
    const rc = K.rollCenter(this.kc.L, P.L, this.kc.R, P.R)
    return { A, cg, ad, fj, rc, rch: rc ? rc[1] - hb : NaN, bs: { L: this.bumpSteer('L'), R: this.bumpSteer('R') } }
  }

  rearReport(rp: RearPose) {
    const m = this.model, jk = this.jacking(rp, m), tl = this.thirdLink(rp, m), g = this.RG, g0 = this.RG0
    const as = rp.tanSV * this.WB / this.inputs.cg
    jk.Fz += m.gx < 0 ? m.dWx * as * (1 - m.bf) : m.dWx * as
    jk.dz = jk.Fz / (this.inputs.lr + this.inputs.rr)
    const len = (k: K.LinkName) => ({ v: g.L[k], d: g.L[k] - g0.L[k] })
    const ang = (k: K.LinkName) => { const a = rp.P[k], c = g.C[k]; return Math.atan2(c[2] - a[2], Math.abs(c[0] - a[0])) * 180 / Math.PI }
    return { jk, tl, as, len: { TB: len('TB'), UL: len('UL'), LL: len('LL'), RL: len('RL') }, ang: { UL: ang('UL'), LL: ang('LL'), RL: ang('RL') } }
  }

  barArmAngle(k: Side, c: Corner, p: Pose): number {
    const E = END_LINKS[k], h = CAD[k], BARAX = CAD.barAxis
    if (!E.up.some(x => x !== 0) || !E.lo.some(x => x !== 0)) return NaN
    const lo = affinePoint(h.LIF, h.LIR, h.LBJ, c.LIF, c.LIR, p.LBJ, E.lo)
    const dx = E.up[0] - BARAX[0], dz = E.up[2] - BARAX[1], Ll = K.V.dist(E.up, E.lo)
    const tip = (t: number) => [BARAX[0] + dx * Math.cos(t) + dz * Math.sin(t), E.up[1], BARAX[1] - dx * Math.sin(t) + dz * Math.cos(t)]
    return K.solve(t => K.V.dist(tip(t), lo) - Ll, 0) * 180 / Math.PI
  }

  frontRollAll(cL: Corner, cR: Corner) {
    const out = new Array<{ rc: number; y: number; camL: number; camR: number; jL: number; jR: number; jT: number; twist: number }>(RX.length), i0 = RX.indexOf(0), mJ = this.jackModel()
    const run = (st: number) => {
      let gL: Pose | null = null, gR: Pose | null = null
      for (let i = i0; i >= 0 && i < RX.length; i += st) {
        const d = RX[i], ph = d * Math.PI / 180, pL = K.poseH(cL, -this.HF.L * ph, gL), pR = K.poseH(cR, this.HF.R * ph, gR)
        gL = pL; gR = pR
        const rc = K.rollCenter(cL, pL, cR, pR), fj = this.frontJack({ L: pL, R: pR }, mJ, { L: cL, R: cR })
        out[i] = { rc: rc ? rc[1] : NaN, y: rc ? rc[0] : NaN, camL: K.angles(cL, pL).camber - d, camR: K.angles(cR, pR).camber + d, jL: fj.L, jR: fj.R, jT: fj.tot, twist: this.barArmAngle('L', cL, pL) - this.barArmAngle('R', cR, pR) }
      }
    }
    run(1); run(-1)
    const t0 = out[i0].twist
    out.forEach(o => o.twist -= t0)
    return out
  }

  steerAll(cL: Corner, cR: Corner) {
    const i0 = RACK.indexOf(0), out = new Array<{ x: number; lf: number; rf: number; lL: number; lR: number }>(RACK.length), C = { L: cL, R: cR }
    const p0 = { L: K.poseH(cL, 0, null), R: K.poseH(cR, 0, null) }, a0 = { L: K.angles(cL, p0.L).toe, R: K.angles(cR, p0.R).toe }
    const run = (st: number) => {
      const g = { ...p0 }, q = { ...p0 }
      for (let i = i0; i >= 0 && i < RACK.length; i += st) {
        const o = {} as Record<Side, { toe: number; lift: number }>
        for (const k of ['L', 'R'] as Side[]) {
          g[k] = K.poseH(C[k], 0, g[k], RACK[i]); q[k] = K.poseAt(C[k], p0[k].th, q[k], RACK[i])
          o[k] = { toe: K.angles(C[k], g[k]).toe - a0[k], lift: -(q[k].WC[2] - p0[k].WC[2]) }
        }
        out[i] = { x: (o.L.toe - o.R.toe) / 2, lf: o.L.toe, rf: -o.R.toe, lL: o.L.lift, lR: o.R.lift }
      }
    }
    run(1); run(-1)
    return out
  }

  rearRollAll(g: RearGeometry) {
    const mJ = this.jackModel()
    return RX.map(d => {
      const p = K.rearPose(g, 0, -d * Math.PI / 180)
      return { rc: p.rcz, jack: this.jacking(p, mJ).Fz, shift: p.shift, steer: p.steer, lead: p.W.L[0] - p.W.R[0], tb: p.tbAng }
    })
  }

  rearHeaveAll(g: RearGeometry, T: Record<Side, MrTable>, n: (id: string) => number = id => this.num(id)) {
    const hcg = n('cg'), bf = n('bb') / 100, k = { L: n('lr'), R: n('rr') }
    return SW.map(h => {
      const p = K.rearPose(g, h, 0), as = p.tanSV * this.WB / hcg * 100
      const mr = (s: Side) => tblAt(T[s], 'mr', h)
      return {
        ula: Math.atan2(g.C.UL[2] - p.P.UL[2], Math.abs(g.C.UL[0] - p.P.UL[0])) * 180 / Math.PI, as, al: as * (1 - bf), pin: p.pinion, steer: p.steer, wbL: p.wbL, wbR: p.wbR,
        lead: p.W.L[0] - p.W.R[0], shift: p.shift, rc: p.rcz, mrL: mr('L'), mrR: mr('R'), wrL: k.L * mr('L') ** 2, wrR: k.R * mr('R') ** 2,
      }
    })
  }

  thirdAll(g: RearGeometry) {
    const p = K.rearPose(g, 0, 0)
    return GX.map(gx => this.thirdLink(p, { ...this.model, gx }, g))
  }

  warnings(): string[] {
    const m = this.model, n = ['LF', 'RF', 'LR', 'RR'], msg: string[] = []
    const lift = n.filter((_x, i) => m.loads[i] < 0), far = n.filter((_x, i) => Math.abs(m.bump[i].s / (i < 2 ? this.MRF : this.MRR)) > 3.5)
    if (lift.length) msg.push(lift.join(' and ') + ' lifted off the ground. This model doesn’t move the extra load to the other tires, so the numbers past this point aren’t real.')
    if (far.length) msg.push(far.join(', ') + ' travel is past ±3.5 in, beyond the modeled suspension range. A real car would be on the bump stops or bottomed out.')
    if (K.rearResidual(this.RG, m.rp.q) > 1e-6) msg.push('The rear links can’t reach this position: they bind before the axle gets there, so the rear numbers here aren’t real. Check the link moves on the Kinematics tab.')
    return msg
  }
}

function affinePoint(a: Vec, b: Vec, c: Vec, A: Vec, B: Vec, C: Vec, p: Vec): Vec {
  const VV = K.V
  const e1 = VV.sub(b, a), e2 = VV.sub(c, a), n = VV.mul(VV.norm(VV.cross(e1, e2)), 5)
  const E1 = VV.sub(B, A), E2 = VV.sub(C, A), N = VV.mul(VV.norm(VV.cross(E1, E2)), 5)
  const coef = K.solveLin([[e1[0], e2[0], n[0]], [e1[1], e2[1], n[1]], [e1[2], e2[2], n[2]]], VV.sub(p, a))
  return VV.add(A, VV.add(VV.add(VV.mul(E1, coef[0]), VV.mul(E2, coef[1])), VV.mul(N, coef[2])))
}
