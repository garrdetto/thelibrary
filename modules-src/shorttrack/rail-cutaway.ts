import * as THREE from 'three'
import type { Vec } from '../railsetup/sim/kin'
import { CAD, END_LINKS } from '../railsetup/sim/hardpoints'
import { affineMatrix, bakeChassis, loadChassisModel, nk, rodMatrix } from '../railsetup/ui/parts'
import type { RailState } from './next/sim/railDynamics'

/**
 * The 3D Show chassis view of the Setup Lab's track test: the car body (paint, glass, decals, numbers) is hidden and
 * the Lab's own chassis model (`/models/railsetup/chassis.glb`, the 143 CAD parts the Lab's setup page poses) is
 * fitted to the car's wheelbase and track and drawn in its place on the car's own wheels and tires. The frame and
 * every sprung part ride on the sprung body, so they pitch, roll, squat and dive with it (and with Motion ×3); the
 * front lower and upper A-arms swing about their inner pivots, the knuckles rise and steer with each wheel's live
 * travel and steer, the coilovers stretch between their frame mounts and the arms or axle (coloured blue extended
 * to red compressed, yellow on the bump spring, red at end of travel), and the rear axle housing heaves and rolls
 * with the rear wheels while its trailing links, third link and track bar follow it. Columns at each tire show its
 * live load and an arrow from the centre of gravity shows where the weight is moving.
 */

type Side = 'L' | 'R'
type Shock = { parts: THREE.Mesh[]; top: THREE.Mesh[]; bot: THREE.Mesh[]; U?: Vec; L?: Vec; mat: THREE.MeshStandardMaterial }
type FrontParts = { lower: THREE.Mesh[]; upper: THREE.Mesh[]; knuckle: THREE.Mesh[]; endlink: THREE.Mesh[] }

export type ChassisParts = {
  fit: THREE.Group
  wheel: Vec[]
  front: Record<Side, FrontParts>
  links: Record<string, THREE.Mesh[]>
  uns: THREE.Mesh[]
  shocks: Record<string, Shock>
  endLinks: Record<Side, { up: Vec; lo: Vec }>
}

type Corner = { hub0: THREE.Vector3; hub: THREE.Vector3; column: THREE.Mesh; columnMat: THREE.MeshStandardMaterial }
export type CutawayRig = {
  frame: THREE.Group
  ground: THREE.Group
  corners: Corner[]
  arrow: THREE.ArrowHelper
  cg: THREE.Vector3
  scale: number
  pivots: Set<THREE.Object3D>
}

export type CutawayModel = { body: THREE.Group; root: THREE.Group; tmg?: THREE.Group; wheels: { pivot: THREE.Object3D; front: boolean }[] }

const SHOCK_CORNER: Record<string, number> = { FL: 0, FR: 1, RL: 2, RR: 3 }
const _d = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _p = new THREE.Vector3()
const _M = new THREE.Matrix4(), _K = new THREE.Matrix4(), _T = new THREE.Matrix4(), _R = new THREE.Matrix4()
const matte = (color: number, rough = 0.85, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10)

const vec = (p: THREE.Vector3): Vec => [p.x, p.y, p.z]
const apply = (q: Vec, M: THREE.Matrix4): Vec => vec(_v.set(q[0], q[1], q[2]).applyMatrix4(M))

/** Sorts the baked CAD parts into the groups the track test poses; the rims are hidden so the car's own tires carry it. */
export function chassisParts(root: THREE.Object3D): ChassisParts {
  const fit = new THREE.Group()
  fit.matrixAutoUpdate = false
  const mats = { sprung: matte(0x7d8b99), link: matte(0xe8590c, 0.8), uns: matte(0x343a40) }
  const front: Record<Side, FrontParts> = { L: { lower: [], upper: [], knuckle: [], endlink: [] }, R: { lower: [], upper: [], knuckle: [], endlink: [] } }
  const links: Record<string, THREE.Mesh[]> = { LL: [], RL: [], UL: [], TB: [] }
  const shocks: Record<string, Shock> = {}
  for (const k of Object.keys(SHOCK_CORNER)) shocks[k] = { parts: [], top: [], bot: [], mat: matte(0x4fb3ff, 0.8) }
  const endLinks: Record<Side, { up: Vec; lo: Vec }> = { L: { ...END_LINKS.L }, R: { ...END_LINKS.R } }
  const wheel: Vec[] = [CAD.L.WC, CAD.R.WC, CAD.rear.WL, CAD.rear.WR]
  const uns: THREE.Mesh[] = []
  for (const { mesh: o, name, center: c, cls, side } of bakeChassis(root)) {
    const n = nk(name)
    o.castShadow = true
    fit.add(o)
    if (/wheels/.test(n)) {
      const ci = cls === 'knuckle' ? (side === 'L' ? 0 : 1) : c.y > 0 ? 2 : 3
      wheel[ci] = vec(c)
      o.visible = false
      continue
    }
    if (cls === 'sprung' || cls === 'bar' || cls === 'barArm') o.material = mats.sprung
    else if (cls === 'shock') {
      const [k, e] = side as [string, string], S = shocks[k]
      o.material = S.mat
      S.parts.push(o)
      if (e === 'U' || e === 'L') { S[e] = vec(c); S[e === 'U' ? 'top' : 'bot'].push(o) } else S[e as 'top' | 'bot'].push(o)
    } else if (cls === 'uns') {
      o.material = mats.uns
      if (side === 'JB') o.visible = false
      else uns.push(o)
    } else if (cls === 'JB') o.visible = false
    else if (links[cls]) { o.material = mats.link; links[cls].push(o) } else if (cls === 'endlink') {
      o.material = mats.link
      front[side as Side].endlink.push(o)
      if (/^balljoint3/.test(n)) endLinks[side as Side][c.z > 9 ? 'up' : 'lo'] = vec(c)
    } else if (cls === 'lower' || cls === 'upper' || cls === 'knuckle') {
      o.material = cls === 'knuckle' ? mats.uns : mats.link
      front[side as Side][cls].push(o)
    } else o.material = mats.sprung
  }
  return { fit, wheel, front, links, uns, shocks, endLinks }
}

/** Angle about the hinge F→R that lifts point P by dz (in the hinge's own frame), the solution nearest zero. */
export function hingeAngle(F: Vec, R: Vec, P: Vec, dz: number): number {
  _a.set(R[0] - F[0], R[1] - F[1], R[2] - F[2]).normalize()
  _d.set(P[0] - F[0], P[1] - F[1], P[2] - F[2])
  _p.copy(_a).multiplyScalar(_d.dot(_a))
  _d.sub(_p)
  const rho = _d.length()
  if (rho < 1e-6) return 0
  const uz = _d.z, wz = _v.crossVectors(_a, _d).z
  const A = uz, B = wz, C = uz + dz, Rr = Math.hypot(A, B)
  if (Rr < 1e-9) return 0
  const phi = Math.atan2(B, A), ac = Math.acos(THREE.MathUtils.clamp(C / Rr, -1, 1))
  const wrap = (t: number) => Math.atan2(Math.sin(t), Math.cos(t))
  const t1 = wrap(phi + ac), t2 = wrap(phi - ac)
  return Math.abs(t1) < Math.abs(t2) ? t1 : t2
}

function hinge(F: Vec, R: Vec, ang: number, out: THREE.Matrix4) {
  _a.set(R[0] - F[0], R[1] - F[1], R[2] - F[2]).normalize()
  return out.makeTranslation(F[0], F[1], F[2]).multiply(_R.makeRotationAxis(_a, ang)).multiply(_T.makeTranslation(-F[0], -F[1], -F[2]))
}

function poseShock(S: Shock, U1: Vec, L1: Vec) {
  if (!S.U || !S.L) return
  rodMatrix(S.U, S.L, U1, L1, _M); S.top.forEach(o => o.matrix.copy(_M))
  rodMatrix(S.L, S.U, L1, U1, _M); S.bot.forEach(o => o.matrix.copy(_M))
}

/**
 * Poses the Lab's chassis from each corner's vertical wheel travel `dz` (inches, + = bump) and the front road-wheel
 * steer (rad): a rigid frame, front arms swung about their inner pivots, knuckles riding the ball joints, the rear
 * housing heaved and rolled, links and coilovers stretched between their mounts.
 */
export function poseChassis(P: ChassisParts, dz: number[], steer: [number, number] = [0, 0]) {
  ;(['L', 'R'] as Side[]).forEach((k, i) => {
    const h = CAD[k], F = P.front[k]
    const LM = hinge(h.LIF, h.LIR, hingeAngle(h.LIF, h.LIR, h.LBJ, dz[i]), new THREE.Matrix4())
    const UM = hinge(h.UIF, h.UIR, hingeAngle(h.UIF, h.UIR, h.UBJ, dz[i]), new THREE.Matrix4())
    F.lower.forEach(o => o.matrix.copy(LM))
    F.upper.forEach(o => o.matrix.copy(UM))
    const lbj = apply(h.LBJ, LM), ubj = apply(h.UBJ, UM), tro: Vec = [h.TRO[0], h.TRO[1], h.TRO[2] + dz[i]]
    affineMatrix(h.LBJ, h.UBJ, h.TRO, lbj, ubj, tro, _K)
    hinge(lbj, ubj, steer[i], _M)
    _K.premultiply(_M)
    F.knuckle.forEach(o => o.matrix.copy(_K))
    const S = P.shocks['F' + k]
    if (S.U && S.L) poseShock(S, S.U, apply(S.L, LM))
    const E = P.endLinks[k]
    rodMatrix(E.lo, E.up, apply(E.lo, LM), E.up, _M)
    F.endlink.forEach(o => o.matrix.copy(_M))
  })
  const WL = CAD.rear.WL, WR = CAD.rear.WR, cy = (WL[1] + WR[1]) / 2, cz = (WL[2] + WR[2]) / 2
  const roll = Math.atan2(dz[2] - dz[3], WL[1] - WR[1]), heave = (dz[2] + dz[3]) / 2
  const HM = new THREE.Matrix4().makeTranslation(0, cy, cz + heave).multiply(_R.makeRotationX(roll)).multiply(_T.makeTranslation(0, -cy, -cz))
  P.uns.forEach(o => o.matrix.copy(HM))
  const rear = CAD.rear as unknown as Record<string, Vec[]>
  for (const k of Object.keys(P.links)) {
    const c = rear[k]
    rodMatrix(c[1], c[0], c[1], apply(c[0], HM), _M)
    P.links[k].forEach(o => o.matrix.copy(_M))
  }
  for (const k of ['RL', 'RR']) {
    const S = P.shocks[k]
    if (S.U && S.L) poseShock(S, S.U, apply(S.L, HM))
  }
  return HM
}

function isUnder(o: THREE.Object3D, set: Set<THREE.Object3D>) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (set.has(p)) return true
  return false
}

/** Hub positions in the body's frame (m, x left, y up, z forward) from the posed wheel pivots. */
function hubs(m: CutawayModel, sc: number, out: THREE.Vector3[]) {
  const g = m.tmg
  if (!g) return
  g.updateMatrix()
  m.wheels.forEach((w, i) => out[i].copy(w.pivot.position).applyMatrix4(g.matrix).multiplyScalar(sc))
}

/** Maps the Lab's frame (inches, x forward, y left, z up) onto the body's (m, x left, y up, z forward) so its four wheel centres meet the car's hubs. */
export function fitMatrix(wheel: Vec[], hub: THREE.Vector3[], out: THREE.Matrix4) {
  const lw = (wheel[0][0] + wheel[1][0]) / 2 - (wheel[2][0] + wheel[3][0]) / 2
  const cw = (hub[0].z + hub[1].z) / 2 - (hub[2].z + hub[3].z) / 2
  const lt = (wheel[0][1] - wheel[1][1] + wheel[2][1] - wheel[3][1]) / 2
  const ct = (hub[0].x - hub[1].x + hub[2].x - hub[3].x) / 2
  const s = cw / lw, sx = Math.abs(lt) > 1e-6 ? ct / lt : s
  const lc = [0, 1, 2].map(j => wheel.reduce((a, w) => a + w[j], 0) / 4)
  const hc = hub.reduce((a, h) => a.add(h), new THREE.Vector3()).multiplyScalar(1 / 4)
  out.set(0, sx, 0, hc.x - sx * lc[1], 0, 0, s, hc.y - s * lc[2], s, 0, 0, hc.z - s * lc[0], 0, 0, 0, 1)
  return s
}

function build(m: CutawayModel, st: RailState, sc: number, corner: number[]): CutawayRig {
  const frame = new THREE.Group(), ground = new THREE.Group()
  frame.scale.setScalar(1 / sc)
  ground.scale.setScalar(1 / sc)
  m.body.add(frame)
  m.root.add(ground)
  const v = st.veh
  const h0: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3())
  {
    const raw = m.wheels.map(() => new THREE.Vector3())
    hubs(m, sc, raw)
    raw.forEach((p, i) => h0[corner[i]].copy(p).setY(p.y - st.travel[corner[i]]))
  }
  const corners: Corner[] = h0.map((hub0) => {
    const columnMat = new THREE.MeshStandardMaterial({ color: 0x5ad17a, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false })
    const column = new THREE.Mesh(cylGeo, columnMat)
    ground.add(column)
    return { hub0, hub: hub0.clone(), column, columnMat }
  })
  const cg = new THREE.Vector3(h0[0].x - v.tires[0][1], v.cgH, h0[0].z - v.tires[0][0])
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), cg.clone(), 0.5, 0xffcc00, 0.16, 0.1)
  ground.add(arrow)
  const cgBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), matte(0xffcc00, 0.85, 0))
  cgBall.position.copy(cg)
  frame.add(cgBall)
  return { frame, ground, corners, arrow, cg, scale: 1, pivots: new Set(m.wheels.map((w) => w.pivot)) }
}

export function createCutaway(carScale: number, load: () => Promise<THREE.Object3D> = loadChassisModel) {
  const rigs = new WeakMap<CutawayModel, CutawayRig>()
  let shown: CutawayRig | null = null
  let shownModel: CutawayModel | null = null
  let parts: ChassisParts | null = null
  let failed = false
  let loading: Promise<void> | null = null
  const hidden = new Map<THREE.Object3D, boolean>()

  function ready() {
    if (!loading) loading = load().then((root) => { parts = chassisParts(root) }, () => { failed = true })
    return loading
  }

  function restoreBody() {
    hidden.forEach((vis, o) => { o.visible = vis })
    hidden.clear()
  }

  function hideBody(m: CutawayModel, r: CutawayRig) {
    const keep = new Set<THREE.Object3D>([r.frame, ...r.pivots])
    m.body.traverse((o) => {
      if (o === m.body || !(o as THREE.Mesh).isMesh || !o.visible || isUnder(o, keep)) return
      if (!hidden.has(o)) hidden.set(o, o.visible)
      o.visible = false
    })
  }

  function hide() {
    if (shown) {
      shown.frame.visible = false
      shown.ground.visible = false
    }
    restoreBody()
    shown = null
    shownModel = null
  }

  /** Poses the chassis for this frame; `corner` maps each wheel pivot to its corner (LF, RF, LR, RR). */
  function update(m: CutawayModel, st: RailState, corner: number[], on: boolean) {
    if (!on || !m.tmg) return hide()
    ready()
    let r = rigs.get(m)
    if (!r) {
      r = build(m, st, carScale, corner)
      rigs.set(m, r)
    }
    if (shown !== r) {
      hide()
      shown = r
      shownModel = m
      r.frame.visible = true
      r.ground.visible = true
    }
    if (parts && parts.fit.parent !== r.frame) {
      r.frame.add(parts.fit)
      r.scale = fitMatrix(parts.wheel, r.corners.map((c) => c.hub0), parts.fit.matrix)
      parts.fit.matrixWorldNeedsUpdate = true
    }
    if (parts) hideBody(m, r)
    else if (failed) restoreBody()
    const raw = m.wheels.map(() => new THREE.Vector3())
    hubs(m, carScale, raw)
    raw.forEach((p, i) => r.corners[corner[i]].hub.copy(p))
    const v = st.veh, avg = v.mass * 9.81 / 4
    if (parts) {
      const dz = r.corners.map((c) => (c.hub.y - c.hub0.y) / (r.scale || 1))
      poseChassis(parts, dz, [st.steerL, st.steerR])
      for (const [k, S] of Object.entries(parts.shocks)) {
        const ci = SHOCK_CORNER[k], t = THREE.MathUtils.clamp((st.travel[ci] + 0.04) / 0.12, 0, 1)
        if (st.stop[ci]) S.mat.color.setHex(0xff4a4a)
        else if (st.bump[ci]) S.mat.color.setHex(0xffcc00)
        else S.mat.color.setHSL(0.58 - t * 0.58, 0.8, 0.55)
      }
    }
    r.corners.forEach((c, ci) => {
      const load = Math.max(0, st.fz[ci]), hgt = Math.max(0.01, (load / avg) * 0.45)
      c.column.position.set(c.hub0.x, hgt / 2, c.hub0.z)
      c.column.scale.set(0.09, hgt, 0.09)
      const use = THREE.MathUtils.clamp(st.use[ci], 0, 1.2)
      c.columnMat.color.copy(load <= 0 ? _c.setHex(0x3a4458) : _c.setHSL(Math.max(0, 0.33 - use * 0.33), 0.75, 0.5))
    })
    _d.set(-st.ay, 0, -st.ax).multiplyScalar(1 / 9.81)
    const g = _d.length()
    if (g > 0.03) {
      r.arrow.visible = true
      r.arrow.position.copy(r.cg)
      r.arrow.setDirection(_d.divideScalar(g))
      r.arrow.setLength(0.25 + g * 0.6, 0.16, 0.1)
    } else r.arrow.visible = false
  }

  return { update, hide, ready, get model() { return shownModel } }
}
