export type Vec = number[]
export type Frame = [Vec, Vec, Vec]
export type Mat3 = number[][]

export const V = {
  add: (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec): Vec => {
    const l = Math.hypot(a[0], a[1], a[2])
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  dist: (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
}

const D = 180 / Math.PI
export const TIRE_R = 13.3

export function rot(p: Vec, o: Vec, k: Vec, t: number): Vec {
  const v = V.sub(p, o), c = Math.cos(t), s = Math.sin(t)
  return V.add(o, V.add(V.add(V.mul(v, c), V.mul(V.cross(k, v), s)), V.mul(k, V.dot(k, v) * (1 - c))))
}

export function rotVec(v: Vec, k: Vec, t: number): Vec {
  return rot(v, [0, 0, 0], k, t)
}

export function solve(f: (x: number) => number, x0: number, h = 1e-3): number {
  let a = x0, b = x0 + h, fa = f(a), fb = f(b)
  for (let i = 0; i < 40 && Math.abs(fb) > 1e-10; i++) {
    const d = fb - fa
    if (Math.abs(d) < 1e-14) break
    const c = b - fb * (b - a) / d
    a = b
    fa = fb
    b = c
    fb = f(b)
  }
  return b
}

export function frame(a: Vec, b: Vec, c: Vec): Frame {
  const x = V.norm(V.sub(b, a)), z = V.norm(V.cross(x, V.sub(c, a))), y = V.cross(z, x)
  return [x, y, z]
}

export function toLocal(p: Vec, o: Vec, F: Frame): Vec {
  const v = V.sub(p, o)
  return [V.dot(v, F[0]), V.dot(v, F[1]), V.dot(v, F[2])]
}

export function toWorld(l: Vec, o: Vec, F: Frame): Vec {
  return V.add(o, V.add(V.add(V.mul(F[0], l[0]), V.mul(F[1], l[1])), V.mul(F[2], l[2])))
}

export type CornerPoints = {
  LIF: Vec; LIR: Vec; UIF: Vec; UIR: Vec; LBJ: Vec; UBJ: Vec; TRI: Vec; TRO: Vec; WC: Vec
  AX?: Vec; SHU?: Vec; SHL?: Vec
}

export type FrontAdjust = {
  ufz: number; urz: number; ufx: number; urx: number; lfz: number; lrz: number; lfx: number; lrx: number
  lslug: number; uslug: number; camber: number; caster: number; tro: number; toe: number
  ucaLen: number; lcaLen: number; ucaX: number; tri: number; umh: number; lmh: number; wo: number
}

export type Corner = {
  s: number
  LIF: Vec; LIR: Vec; UIF: Vec; UIR: Vec; TRI: Vec; LBJ: Vec; UBJ: Vec; TRO: Vec; WC: Vec; AX: Vec
  L: { lf: number; lr: number; uf: number; ur: number; kp: number; tr: number }
  shU?: Vec; shLoc?: Vec
  F0: Frame
  loc: { WC: Vec; AXp: Vec; TRO: Vec; UBJ: Vec }
  kref: Vec[]
  kbody: Vec[]
}

export type Pose = { th: number; ps: number; st: number; LBJ: Vec; UBJ: Vec; TRO: Vec; WC: Vec; AX: Vec; F: Frame }

const ADJUST_ZERO: FrontAdjust = { ufz: 0, urz: 0, ufx: 0, urx: 0, lfz: 0, lrz: 0, lfx: 0, lrx: 0, lslug: 0, uslug: 0, camber: 0, caster: 0, tro: 0, toe: 0, ucaLen: 0, lcaLen: 0, ucaX: 0, tri: 0, umh: 0, lmh: 0, wo: 0 }

export function build(hp: CornerPoints, s: number, adjIn?: Partial<FrontAdjust>): Corner {
  const adj: FrontAdjust = { ...ADJUST_ZERO, ...(adjIn || {}) }
  const P = JSON.parse(JSON.stringify(hp)) as CornerPoints
  let LBJ = P.LBJ, UBJ = P.UBJ, TRO = P.TRO, WC = V.add(P.WC, [0, s * adj.wo, 0])
  let AX: Vec = P.AX ? ((a: Vec) => a[1] * s < 0 ? V.mul(a, -1) : a)(V.norm(P.AX)) : [0, s, 0]
  let KR: Vec[] = [P.LBJ, P.UBJ, P.TRO]
  const mid = (a: Vec, b: Vec) => V.mul(V.add(a, b), 0.5), side = (v: Vec) => V.norm([0, v[1], v[2]])
  if (adj.lcaLen) {
    const ul = side(V.sub(LBJ, mid(P.LIF, P.LIR))), q0 = V.sub(LBJ, UBJ), q1 = V.sub(V.add(LBJ, V.mul(ul, adj.lcaLen)), UBJ), ax0 = V.cross(q0, q1)
    if (V.len(ax0) > 1e-9) {
      const t = Math.acos(Math.min(1, V.dot(V.norm(q0), V.norm(q1)))), kk = V.norm(ax0)
      LBJ = rot(LBJ, UBJ, kk, t); TRO = rot(TRO, UBJ, kk, t); KR = KR.map(q => rot(q, UBJ, kk, t)); WC = rot(WC, UBJ, kk, t); AX = rotVec(AX, kk, t)
    }
  }
  const uu = side(V.sub(UBJ, mid(P.UIF, P.UIR)))
  const k0 = V.sub(UBJ, LBJ), k1 = V.sub(V.add(V.add(UBJ, [-adj.caster + adj.ucaX, s * adj.camber, 0]), V.mul(uu, adj.ucaLen)), LBJ)
  const ax = V.cross(k0, k1)
  if (V.len(ax) > 1e-9) {
    const t = Math.acos(Math.min(1, V.dot(V.norm(k0), V.norm(k1)))), kk = V.norm(ax)
    UBJ = rot(UBJ, LBJ, kk, t); TRO = rot(TRO, LBJ, kk, t); KR = KR.map(q => rot(q, LBJ, kk, t)); WC = rot(WC, LBJ, kk, t); AX = rotVec(AX, kk, t)
  }
  const toeOf = (a: Vec) => Math.atan2(-a[0], s * a[1]) * D
  const kp = V.norm(V.sub(UBJ, LBJ))
  const tt = solve(t => toeOf(rotVec(AX, kp, t)) - adj.toe, 0)
  KR = KR.map(q => rot(q, LBJ, kp, tt)); TRO = rot(TRO, LBJ, kp, tt); WC = rot(WC, LBJ, kp, tt); AX = rotVec(AX, kp, tt)
  const up = V.norm(V.sub(UBJ, LBJ))
  LBJ = V.add(LBJ, V.mul(up, -adj.lslug)); UBJ = V.add(UBJ, V.mul(up, adj.uslug))
  TRO = V.add(TRO, [0, 0, adj.tro])
  let KB: Vec[] = [KR[0], KR[1], KR[2]]
  const UIF = V.add(P.UIF, [adj.ufx + adj.ucaX, 0, adj.ufz]), UIR = V.add(P.UIR, [adj.urx + adj.ucaX, 0, adj.urz])
  const LIF = V.add(P.LIF, [adj.lfx, 0, adj.lfz]), LIR = V.add(P.LIR, [adj.lrx, 0, adj.lrz])
  const TRI = V.add(P.TRI, [0, 0, adj.tri])
  if (adj.umh || adj.lmh) {
    const kup = V.norm(V.sub(KR[1], KR[0]))
    const Lk = V.add(LBJ, V.mul(kup, adj.lmh)), Uk = V.add(UBJ, V.mul(kup, adj.umh)), kpn = V.dist(Lk, Uk), kk0 = V.norm(V.sub(Uk, Lk))
    const kl = V.norm(V.sub(LIR, LIF)), ku = V.norm(V.sub(UIR, UIF))
    KB = [V.add(KR[0], V.mul(kup, adj.lmh)), V.add(KR[1], V.mul(kup, adj.umh)), KR[2]]
    let ps = 0
    const place = (th: number) => {
      const L = rot(LBJ, LIF, kl, th)
      ps = solve(q => V.dist(rot(UBJ, UIF, ku, q), L) - kpn, ps)
      const U = rot(UBJ, UIF, ku, ps)
      const kpv = V.norm(V.sub(U, L)), r = V.cross(kk0, kpv), ang = Math.acos(Math.min(1, V.dot(kk0, kpv))), rn = V.len(r) > 1e-12 ? V.norm(r) : null
      const M = (q: Vec) => { const m = V.add(L, V.sub(q, Lk)); return rn ? rot(m, L, rn, ang) : m }
      const axr = rn ? rotVec(AX, rn, ang) : AX
      const t2 = solve(x => toeOf(rotVec(axr, kpv, x)) - adj.toe, 0), F = (q: Vec) => rot(M(q), L, kpv, t2)
      return { L, U, TRO: F(TRO), WC: F(WC), AX: rotVec(axr, kpv, t2), KR: KR.map(F), KB: KB.map(F) }
    }
    const th = solve(x => place(x).WC[2] - WC[2], 0), q = place(th)
    LBJ = q.L; UBJ = q.U; TRO = q.TRO; WC = q.WC; AX = q.AX; KR = q.KR; KB = q.KB
  }
  const F0 = frame(LBJ, UBJ, TRO)
  const c: Corner = {
    s, LIF, LIR, UIF, UIR, TRI, LBJ, UBJ, TRO, WC, AX,
    L: { lf: V.dist(LBJ, LIF), lr: V.dist(LBJ, LIR), uf: V.dist(UBJ, UIF), ur: V.dist(UBJ, UIR), kp: V.dist(LBJ, UBJ), tr: V.dist(TRO, TRI) },
    F0,
    loc: { WC: toLocal(WC, LBJ, F0), AXp: toLocal(V.add(WC, AX), LBJ, F0), TRO: toLocal(TRO, LBJ, F0), UBJ: toLocal(UBJ, LBJ, F0) },
    kref: KR.map(q => toLocal(q, LBJ, F0)),
    kbody: KB.map(q => toLocal(q, LBJ, F0)),
  }
  if (P.SHU && P.SHL) {
    c.shU = P.SHU
    c.shLoc = toLocal(P.SHL, P.LIF, frame(P.LIF, P.LIR, P.LBJ))
  }
  return c
}

export type Guess = { th: number; ps: number; st: number }

export function poseAt(c: Corner, th: number, guess?: Guess | null, steer?: number): Pose {
  const kl = V.norm(V.sub(c.LIR, c.LIF)), ku = V.norm(V.sub(c.UIR, c.UIF))
  const LBJ = rot(c.LBJ, c.LIF, kl, th)
  const ps = solve(p => V.dist(rot(c.UBJ, c.UIF, ku, p), LBJ) - c.L.kp, guess ? guess.ps : 0)
  const UBJ = rot(c.UBJ, c.UIF, ku, ps)
  const kp = V.norm(V.sub(UBJ, LBJ))
  const a0 = V.norm(V.sub(c.UBJ, c.LBJ)), r = V.cross(a0, kp)
  let TRO1 = V.add(LBJ, V.sub(c.TRO, c.LBJ))
  if (V.len(r) > 1e-12) {
    const t = Math.acos(Math.min(1, V.dot(a0, kp)))
    TRO1 = rot(V.add(LBJ, V.sub(c.TRO, c.LBJ)), LBJ, V.norm(r), t)
  }
  const TRI = steer ? V.add(c.TRI, [0, steer, 0]) : c.TRI
  const st = solve(t => V.dist(rot(TRO1, LBJ, kp, t), TRI) - c.L.tr, guess ? guess.st : 0)
  const TRO = rot(TRO1, LBJ, kp, st)
  const F = frame(LBJ, UBJ, TRO)
  const WC = toWorld(c.loc.WC, LBJ, F), AX = V.sub(toWorld(c.loc.AXp, LBJ, F), WC)
  return { th, ps, st, LBJ, UBJ, TRO, WC, AX, F }
}

export function poseH(c: Corner, h: number, guess?: Guess | null, steer?: number): Pose {
  const z0 = c.WC[2]
  let g: Guess = guess || { th: 0, ps: 0, st: 0 }
  if (steer && !guess) {
    const N = Math.max(4, Math.ceil(Math.abs(steer) / 0.05))
    let p: Pose | null = null
    for (let i = 1; i <= N; i++) { p = poseH(c, h, g, steer * i / N); g = p }
    return p as Pose
  }
  const th = solve(t => { const p = poseAt(c, t, g, steer); return p.WC[2] - z0 - h }, g.th, 0.01)
  return poseAt(c, th, g, steer)
}

export type Angles = { camber: number; toe: number; caster: number; kpi: number; scrub: number; trail: number; CP: Vec }

export function angles(c: Corner, p: Pose): Angles {
  const s = c.s, a = V.norm(p.AX), k = V.sub(p.UBJ, p.LBJ)
  const camber = Math.asin(-a[2]) * D
  const toe = Math.atan2(-a[0], s * a[1]) * D
  const caster = Math.atan2(-k[0], k[2]) * D
  const kpi = Math.atan2(-s * k[1], k[2]) * D
  const dn = V.norm(V.sub([0, 0, -1], V.mul(a, V.dot([0, 0, -1], a))))
  const CP = V.add(p.WC, V.mul(dn, TIRE_R))
  const t = -p.LBJ[2] / k[2] + CP[2] / k[2]
  const G = V.add(p.LBJ, V.mul(k, t))
  const scrub = s * (CP[1] - G[1])
  const trail = G[0] - CP[0]
  return { camber, toe, caster, kpi, scrub, trail, CP }
}

type Line2 = { a: number; b: number; d: number }

function cutX(i1: Vec, i2: Vec, bj: Vec, x0: number): Line2 {
  const n = V.cross(V.sub(i2, i1), V.sub(bj, i1))
  const d = V.dot(n, i1) - n[0] * x0
  return { a: n[1], b: n[2], d }
}

function cutY(i1: Vec, i2: Vec, bj: Vec, y0: number): Line2 {
  const n = V.cross(V.sub(i2, i1), V.sub(bj, i1))
  const d = V.dot(n, i1) - n[1] * y0
  return { a: n[0], b: n[2], d }
}

function meet(l1: Line2, l2: Line2): Vec | null {
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < 1e-12) return null
  return [(l1.d * l2.b - l2.d * l1.b) / det, (l1.a * l2.d - l2.a * l1.d) / det]
}

export function ics(c: Corner, p: Pose): { fv: Vec | null; sv: Vec | null } {
  const fv = meet(cutX(c.LIF, c.LIR, p.LBJ, p.WC[0]), cutX(c.UIF, c.UIR, p.UBJ, p.WC[0]))
  const sv = meet(cutY(c.LIF, c.LIR, p.LBJ, p.WC[1]), cutY(c.UIF, c.UIR, p.UBJ, p.WC[1]))
  return { fv, sv }
}

export function rollCenter(cL: Corner, pL: Pose, cR: Corner, pR: Pose): Vec | null {
  const aL = angles(cL, pL), aR = angles(cR, pR), iL = ics(cL, pL).fv, iR = ics(cR, pR).fv
  if (!iL || !iR) return null
  const line = (P: Vec, Q: Vec): Line2 => { const a = Q[1] - P[1], b = P[0] - Q[0]; return { a, b, d: a * P[0] + b * P[1] } }
  return meet(line([aL.CP[1], aL.CP[2]], iL), line([aR.CP[1], aR.CP[2]], iR))
}

export function shockEye(c: Corner, p: Pose): Vec | null {
  return c.shLoc ? toWorld(c.shLoc, c.LIF, frame(c.LIF, c.LIR, p.LBJ)) : null
}

export function shockLen(c: Corner, p: Pose): number | null {
  const e = shockEye(c, p)
  return e && c.shU ? V.dist(e, c.shU) : null
}

export function antiDive(c: Corner, p: Pose, hcg: number, wb: number, bf: number): number {
  const sv = ics(c, p).sv, cp = angles(c, p).CP
  if (!sv) return 0
  const tanT = (sv[1] - cp[2]) / (cp[0] - sv[0])
  return tanT * (wb / hcg) * bf * 100
}

export function selfTest(c: Corner): true {
  const ok = (w: string, t: boolean) => { if (!t) throw new Error('KIN.selfTest: ' + w) }
  const near = (a: number, b: number, tol: number, w: string) => ok(w + ' (' + a + ' vs ' + b + ')', Math.abs(a - b) <= tol)
  const p0 = poseH(c, 0, null), p0b = poseH(c, 0, null, 0)
  near(p0.WC[2], p0b.WC[2], 1e-9, 'steer 0 must match no steer')
  for (const r of [-0.6, -0.2, 0.2, 0.6]) {
    const p = poseH(c, 0, null, r), TRI = V.add(c.TRI, [0, r, 0])
    near(V.dist(p.TRO, TRI), c.L.tr, 1e-6, 'tie rod length held at steer ' + r)
    near(V.dist(p.LBJ, p.UBJ), c.L.kp, 1e-6, 'kingpin length held at steer ' + r)
    near(V.dist(p.LBJ, c.LIF), c.L.lf, 1e-6, 'lower arm length held at steer ' + r)
    near(p.WC[2] - c.WC[2], 0, 1e-6, 'poseH holds wheel height at steer ' + r)
  }
  const tp = angles(c, poseH(c, 0, null, 0.4)).toe - angles(c, p0).toe
  const tm = angles(c, poseH(c, 0, null, -0.4)).toe - angles(c, p0).toe
  near(tp, -tm, 0.05 + 0.05 * Math.abs(tp), 'steer must be near-symmetric about centre')
  ok('rack must actually steer the wheel', Math.abs(tp) > 1)
  return true
}

export const LINKS = ['LL', 'RL', 'UL', 'TB'] as const
export type LinkName = typeof LINKS[number]
export type AxlePose = number[]

export function Rq(q: AxlePose): Mat3 {
  const cr = Math.cos(q[3]), sr = Math.sin(q[3]), cp = Math.cos(q[4]), sp = Math.sin(q[4]), cy = Math.cos(q[5]), sy = Math.sin(q[5])
  return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr], [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]]
}

export function onAxle(q: AxlePose, R: Mat3, l: Vec): Vec {
  return [0, 1, 2].map(i => q[i] + R[i][0] * l[0] + R[i][1] * l[1] + R[i][2] * l[2])
}

export function solveLin(M: number[][], r: number[]): number[] {
  const n = r.length, A = M.map((row, i) => [...row, r[i]])
  for (let i = 0; i < n; i++) {
    let p = i
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j
    ;[A[i], A[p]] = [A[p], A[i]]
    for (let j = i + 1; j < n; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k <= n; k++) A[j][k] -= f * A[i][k] }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let t = A[i][n]; for (let k = i + 1; k < n; k++) t -= A[i][k] * x[k]; x[i] = t / A[i][i] }
  return x
}

export type RearPoints = {
  LL: Vec[]; RL: Vec[]; UL: Vec[]; TB: Vec[]; SL: Vec[]; SR: Vec[]
  WL: Vec; WR: Vec; AX: Vec; JB?: Vec[]; JBm?: Vec
}

export type RearGeometry = {
  qc: AxlePose
  q0: AxlePose
  A: Record<LinkName, Vec>
  C: Record<LinkName, Vec>
  L: Record<LinkName, number>
  W: { L: Vec; R: Vec }
  S: { L: Vec[]; R: Vec[] }
  z0: number
  JB?: { A: Vec; C: Vec }
}

export type RearAdjust = {
  LLa: number; LLc: number; RLa: number; RLc: number; ULa: number; ULc: number; ULlen: number
  ULya: number; ULyc: number; TBa: number; TBc: number; TBtype: number; TBflip: number
}

export function rearSolve(g: RearGeometry, z: number, psi: number, q0?: AxlePose | null): AxlePose {
  const q = (q0 || g.q0 || g.qc).slice()
  q[2] = z
  q[3] = psi
  const J4 = [0, 1, 4, 5]
  const res = (qq: AxlePose) => { const R = Rq(qq); return LINKS.map(k => V.dist(onAxle(qq, R, g.A[k]), g.C[k]) - g.L[k]) }
  for (let it = 0; it < 40; it++) {
    const r = res(q)
    if (Math.max(...r.map(Math.abs)) < 1e-11) break
    const J = r.map(() => [0, 0, 0, 0])
    J4.forEach((j, c) => { const qp = q.slice(); qp[j] += 1e-6; res(qp).forEach((v, i) => J[i][c] = (v - r[i]) / 1e-6) })
    solveLin(J, r.map(v => -v)).forEach((d, c) => q[J4[c]] += Math.max(-0.5, Math.min(0.5, d)))
  }
  return q
}

export function rearResidual(g: RearGeometry, q: AxlePose): number {
  const R = Rq(q)
  return Math.max(...LINKS.map(k => Math.abs(V.dist(onAxle(q, R, g.A[k]), g.C[k]) - g.L[k])))
}

export function rearBuild(rp: RearPoints): RearGeometry {
  const c0 = V.mul(V.add(rp.WL, rp.WR), 0.5), a = V.norm(rp.AX)
  const qc = [c0[0], c0[1], c0[2], Math.asin(a[2]), 0, Math.atan2(-a[0], a[1])], Rc = Rq(qc)
  const loc = (p: Vec) => { const d = V.sub(p, c0); return [0, 1, 2].map(j => Rc[0][j] * d[0] + Rc[1][j] * d[1] + Rc[2][j] * d[2]) }
  const g = {
    qc, q0: [qc[0], 0, TIRE_R, 0, 0, 0], A: {}, C: {}, L: {},
    W: { L: loc(rp.WL), R: loc(rp.WR) },
    S: { L: [loc(rp.SL[0]), rp.SL[1]], R: [loc(rp.SR[0]), rp.SR[1]] },
    z0: TIRE_R,
  } as RearGeometry
  const R0 = Rq(g.q0)
  LINKS.forEach(k => { g.A[k] = loc(rp[k][0]); g.C[k] = rp[k][1].slice(); g.L[k] = V.dist(onAxle(g.q0, R0, g.A[k]), g.C[k]) })
  if (rp.JB) g.JB = { A: loc(rp.JB[0]), C: rp.JB[1].slice() }
  return g
}

export function rearAdjust(g0: RearGeometry, adj: Partial<RearAdjust>): RearGeometry {
  const g = JSON.parse(JSON.stringify(g0)) as RearGeometry, R = Rq(g0.q0)
  const a = adj as Record<string, number | undefined>
  if (adj.TBtype && g.JB) { g.A.TB = g.JB.A.slice(); g.C.TB = g.JB.C.slice() }
  if (adj.TBflip) { g.A.TB[1] *= -1; g.C.TB[1] *= -1 }
  g.A.UL[1] += adj.ULya || 0
  g.C.UL[1] += adj.ULyc || 0
  LINKS.forEach(k => { g.A[k][2] += a[k + 'a'] || 0; g.C[k][2] += a[k + 'c'] || 0; g.L[k] = V.dist(onAxle(g0.q0, R, g.A[k]), g.C[k]) })
  g.L.UL += adj.ULlen || 0
  if (adj.ULlen) g.q0 = rearSolve(g, g.z0, 0, g0.q0)
  return g
}

const BRANCH = 0.4

/**
 * `rearPose` from a previous pose, kept on the axle's ride-height branch: four links can also close with the housing
 * pitched or yawed far round, and a stale guess (after a link move or an unreachable pose) can land there and stay.
 * Such a pose, or one that misses the link lengths, is solved again from the design pose and the nearer valid one kept.
 */
export function rearPoseNear(g: RearGeometry, h: number, psi: number, guess?: AxlePose | null): RearPose {
  const off = (q: AxlePose) => Math.max(Math.abs(q[4] - g.q0[4]), Math.abs(q[5] - g.q0[5]))
  const ok = (q: AxlePose) => rearResidual(g, q) < 1e-6
  if (!guess) return rearPose(g, h, psi)
  const p = rearPose(g, h, psi, guess)
  if (ok(p.q) && off(p.q) < BRANCH) return p
  const f = rearPose(g, h, psi)
  return ok(f.q) && (!ok(p.q) || off(f.q) < off(p.q)) ? f : p
}

export type RearPose = {
  q: AxlePose; R: Mat3; P: Record<LinkName, Vec>; W: { L: Vec; R: Vec }; h: number
  shift: number; ratio: number; rcz: number; steer: number; pinion: number; wbL: number; wbR: number
  tanSV: number; ic: { L: Vec | null; R: Vec | null }; tbAng: number; shock: { L: number; R: number }
}

export function rearPose(g: RearGeometry, h: number, psi: number, guess?: AxlePose | null): RearPose {
  const z = g.z0 + h, q = rearSolve(g, z, psi, guess), R = Rq(q), e = 1e-3
  const dy = (a: number, b: number) => rearSolve(g, z + a, psi + b, q)[1]
  const k = (dy(e, 0) - dy(-e, 0)) / (2 * e)
  const rcz = q[2] + (dy(0, e) - dy(0, -e)) / (2 * e) - h
  const P = {} as Record<LinkName, Vec>
  LINKS.forEach(x => P[x] = onAxle(q, R, g.A[x]))
  const W = { L: onAxle(q, R, g.W.L), R: onAxle(q, R, g.W.R) }, W0 = (s: 'L' | 'R') => onAxle(g.q0, Rq(g.q0), g.W[s])
  const svic = (lo: LinkName): Vec | null => {
    const a = P[lo], b = g.C[lo], c = P.UL, d = g.C.UL, d1 = [b[0] - a[0], b[2] - a[2]], d2 = [d[0] - c[0], d[2] - c[2]], den = d1[0] * d2[1] - d1[1] * d2[0]
    if (Math.abs(den) < 1e-9) return null
    const t = ((c[0] - a[0]) * d2[1] - (c[2] - a[2]) * d2[0]) / den
    return [a[0] + d1[0] * t, a[2] + d1[1] * t]
  }
  const tanAt = (lo: LinkName, s: 'L' | 'R') => { const ic = svic(lo); return ic ? (ic[1] - (W[s][2] - TIRE_R)) / (ic[0] - W[s][0]) : 0 }
  const tb = V.sub(P.TB, g.C.TB)
  return {
    q, R, P, W, h, shift: q[1] - g.q0[1], ratio: -k, rcz, steer: -q[5] * D, pinion: (q[4] - g.q0[4]) * D,
    wbL: W.L[0] - W0('L')[0], wbR: W.R[0] - W0('R')[0], tanSV: (tanAt('LL', 'L') + tanAt('RL', 'R')) / 2, ic: { L: svic('LL'), R: svic('RL') },
    tbAng: Math.atan2(g.C.TB[2] - P.TB[2], Math.hypot(tb[0], tb[1])) * D,
    shock: { L: V.dist(onAxle(q, R, g.S.L[0]), g.S.L[1]), R: V.dist(onAxle(q, R, g.S.R[0]), g.S.R[1]) },
  }
}
