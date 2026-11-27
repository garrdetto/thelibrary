import * as THREE from 'three'
import type { RailState } from './next/sim/railDynamics'

/**
 * The 3D Show chassis view of the Setup Lab's track test: the body turns see-through and the car's chassis and
 * suspension are drawn inside it (frame rails and cage, front A-arms, coilover springs and shocks, front sway bar,
 * rear axle housing with its trailing links and track bar). The frame parts ride on the sprung body, so they pitch,
 * roll, squat and dive with it; the arms, axle and coilovers follow each wheel's live travel, so the springs
 * visibly compress and rebound (blue = extended, red = compressed, yellow bump rubber when the bump spring is working,
 * red flash at end of travel) and the sway bar warms up as it twists. Columns at each tire show its live load and
 * an arrow from the centre of gravity shows where the weight is moving.
 */

type Link = { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3 }
type Corner = {
  front: boolean
  sgn: number
  hub0: THREE.Vector3
  hub: THREE.Vector3
  coil: THREE.Mesh
  coilMat: THREE.MeshStandardMaterial
  shockBody: THREE.Mesh
  shockRod: THREE.Mesh
  bumpRubber: THREE.Mesh
  bumpMat: THREE.MeshStandardMaterial
  top: THREE.Vector3
  arms: Link[]
  column: THREE.Mesh
  columnMat: THREE.MeshStandardMaterial
}
export type CutawayRig = {
  frame: THREE.Group
  ground: THREE.Group
  corners: Corner[]
  axle: Link
  pumpkin: THREE.Mesh
  trackBar: Link
  barTube: THREE.Mesh
  barMat: THREE.MeshStandardMaterial
  endLinks: Link[]
  arrow: THREE.ArrowHelper
  cg: THREE.Vector3
  ghosts: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[]; shadow: boolean }[]
}

export type CutawayModel = { body: THREE.Group; root: THREE.Group; tmg?: THREE.Group; wheels: { pivot: THREE.Object3D; front: boolean }[] }

const UP = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3(), _c = new THREE.Color()
const matte = (color: number, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
const steel = () => matte(0x9aa3ad, 0.62, 0.35)

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10)
const coilGeo = (() => {
  const turns = 7, pts: THREE.Vector3[] = []
  for (let i = 0; i <= turns * 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a), i / (turns * 24), Math.sin(a)))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  return new THREE.TubeGeometry(curve, turns * 24, 0.11, 6, false)
})()

function link(parent: THREE.Object3D, r: number, mat: THREE.Material, a = new THREE.Vector3(), b = new THREE.Vector3()): Link {
  const mesh = new THREE.Mesh(cylGeo, mat)
  mesh.scale.set(r, 1, r)
  parent.add(mesh)
  const l = { mesh, a, b }
  place(l)
  return l
}

function place(l: Link) {
  _d.subVectors(l.b, l.a)
  const len = Math.max(1e-4, _d.length())
  l.mesh.position.addVectors(l.a, l.b).multiplyScalar(0.5)
  l.mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len))
  l.mesh.scale.y = len
}

function stretch(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  _d.subVectors(b, a)
  const len = Math.max(1e-4, _d.length())
  mesh.position.copy(a)
  mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len))
  mesh.scale.set(r, len, r)
}

function isWheelPart(o: THREE.Object3D, pivots: Set<THREE.Object3D>) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (pivots.has(p)) return true
  return false
}

/** Hub positions in the body's frame (m, x left, y up, z forward) from the posed wheel pivots. */
function hubs(m: CutawayModel, sc: number, out: THREE.Vector3[]) {
  const g = m.tmg
  if (!g) return
  g.updateMatrix()
  m.wheels.forEach((w, i) => out[i].copy(w.pivot.position).applyMatrix4(g.matrix).multiplyScalar(sc))
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
    raw.forEach((p, i) => h0[corner[i]].copy(p))
  }
  const fz = (h0[0].z + h0[1].z) / 2, rz = (h0[2].z + h0[3].z) / 2, hy = (h0[0].y + h0[1].y + h0[2].y + h0[3].y) / 4
  const rail = matte(0x5c6b7d, 0.7, 0.3), cage = matte(0x7f8b99, 0.66, 0.3), arm = steel()
  const railY = Math.max(0.16, hy - 0.1), halfW = Math.min(0.4, Math.abs(h0[0].x - h0[1].x) / 2 - 0.36)
  const frontZ = fz + 0.85, rearZ = rz - 0.75
  for (const s of [1, -1]) {
    link(frame, 0.035, rail, new THREE.Vector3(s * halfW, railY, rearZ), new THREE.Vector3(s * halfW, railY, frontZ - 0.25))
    link(frame, 0.03, rail, new THREE.Vector3(s * halfW, railY, frontZ - 0.25), new THREE.Vector3(s * (halfW - 0.08), railY - 0.02, frontZ))
  }
  for (const z of [frontZ, fz - 0.15, (fz + rz) / 2, rz + 0.25, rearZ]) link(frame, 0.028, rail, new THREE.Vector3(halfW, railY, z), new THREE.Vector3(-halfW, railY, z))
  const hoopZ = (fz + rz) / 2 - 0.15, roofY = railY + 0.95
  const hoop = [new THREE.Vector3(halfW, railY, hoopZ), new THREE.Vector3(halfW - 0.05, roofY, hoopZ), new THREE.Vector3(-halfW + 0.05, roofY, hoopZ), new THREE.Vector3(-halfW, railY, hoopZ)]
  for (let i = 0; i < 3; i++) link(frame, 0.022, cage, hoop[i].clone(), hoop[i + 1].clone())
  for (const s of [1, -1]) {
    link(frame, 0.02, cage, new THREE.Vector3(s * (halfW - 0.05), roofY, hoopZ), new THREE.Vector3(s * halfW, railY + 0.25, fz - 0.1))
    link(frame, 0.02, cage, new THREE.Vector3(s * (halfW - 0.05), roofY, hoopZ), new THREE.Vector3(s * halfW, railY + 0.15, rz + 0.3))
  }

  const corners: Corner[] = h0.map((hub0, ci) => {
    const front = ci < 2, sgn = Math.sign(hub0.x) || 1
    const coilMat = matte(0x4fb3ff, 0.6, 0.2), bumpMat = matte(0x3a3f47)
    const coil = new THREE.Mesh(coilGeo, coilMat), shockBody = new THREE.Mesh(cylGeo, matte(0xd8dde4, 0.6, 0.35)), shockRod = new THREE.Mesh(cylGeo, steel())
    const bumpRubber = new THREE.Mesh(cylGeo, bumpMat)
    frame.add(coil, shockBody, shockRod, bumpRubber)
    const arms: Link[] = []
    if (front) {
      const inX = sgn * (halfW - 0.02)
      for (const dz of [0.17, -0.17]) arms.push(link(frame, 0.017, arm, new THREE.Vector3(inX, hub0.y - 0.1, hub0.z + dz)))
      for (const dz of [0.12, -0.12]) arms.push(link(frame, 0.015, arm, new THREE.Vector3(inX - sgn * 0.04, hub0.y + 0.17, hub0.z + dz)))
    } else {
      for (const dy of [-0.1, 0.1]) arms.push(link(frame, 0.018, arm, new THREE.Vector3(sgn * halfW, hub0.y + dy, hub0.z + 0.6)))
    }
    const columnMat = new THREE.MeshStandardMaterial({ color: 0x5ad17a, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false })
    const column = new THREE.Mesh(cylGeo, columnMat)
    ground.add(column)
    const lower0 = mount(front, sgn, hub0, hub0, halfW)
    const top = lower0.clone().add(new THREE.Vector3(front ? -sgn * 0.06 : 0, 0.34, 0))
    return { front, sgn, hub0, hub: hub0.clone(), coil, coilMat, shockBody, shockRod, bumpRubber, bumpMat, top, arms, column, columnMat }
  })

  const axle = link(frame, 0.045, matte(0x6f7782, 0.6, 0.3))
  const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), matte(0x6f7782, 0.6, 0.3))
  frame.add(pumpkin)
  const trackBar = link(frame, 0.02, matte(0xffcc00, 0.65, 0.2), new THREE.Vector3(-halfW, railY + 0.14, rz - 0.05))
  const barMat = matte(0x9aa3ad, 0.6, 0.35)
  const barZ = fz + 0.26, barY = railY - 0.02
  const barTube = new THREE.Mesh(cylGeo, barMat)
  frame.add(barTube)
  barTube.position.set(0, barY, barZ)
  barTube.quaternion.setFromUnitVectors(UP, new THREE.Vector3(1, 0, 0))
  barTube.scale.set(0.018, halfW * 2, 0.018)
  const endLinks: Link[] = []
  for (const s of [1, -1]) {
    const tip = new THREE.Vector3(s * (halfW + 0.02), barY, fz + 0.05)
    link(frame, 0.016, barMat, new THREE.Vector3(s * halfW, barY, barZ), tip)
    endLinks.push(link(frame, 0.01, arm, tip.clone()))
  }
  const cg = new THREE.Vector3(h0[0].x - v.tires[0][1], v.cgH, h0[0].z - v.tires[0][0])
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), cg.clone(), 0.5, 0xffcc00, 0.16, 0.1)
  ground.add(arrow)
  const cgBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), matte(0xffcc00))
  cgBall.position.copy(cg)
  frame.add(cgBall)

  const pivots = new Set(m.wheels.map((w) => w.pivot))
  const ghosts: CutawayRig['ghosts'] = []
  m.tmg?.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || isWheelPart(mesh, pivots)) return
    ghosts.push({ mesh, mat: mesh.material, shadow: mesh.castShadow })
  })
  return { frame, ground, corners, axle, pumpkin, trackBar, barTube, barMat, endLinks, arrow, cg, ghosts }
}

/** Where the coilover sits on the lower arm (front) or the axle housing (rear), following the hub. */
function mount(front: boolean, sgn: number, hub: THREE.Vector3, hub0: THREE.Vector3, halfW: number) {
  if (front) {
    const bj = new THREE.Vector3(hub.x - sgn * 0.06, hub.y - 0.11, hub.z), inner = new THREE.Vector3(sgn * (halfW - 0.02), hub0.y - 0.1, hub.z)
    return bj.lerp(inner, 0.35)
  }
  return new THREE.Vector3(hub.x * 0.8, hub.y + 0.06, hub.z - 0.02)
}

const ghostCache = new WeakMap<THREE.Material, THREE.Material>()
function ghostOf(mat: THREE.Material): THREE.Material {
  let g = ghostCache.get(mat)
  if (!g) {
    g = mat.clone()
    g.transparent = true
    g.opacity = Math.min(g.opacity, 0.13)
    g.depthWrite = false
    g.side = THREE.DoubleSide
    ghostCache.set(mat, g)
  }
  return g
}

export function createCutaway(carScale: number) {
  const rigs = new WeakMap<CutawayModel, CutawayRig>()
  let shown: CutawayRig | null = null

  function setGhost(r: CutawayRig, on: boolean) {
    for (const g of r.ghosts) {
      g.mesh.material = on ? (Array.isArray(g.mat) ? g.mat.map(ghostOf) : ghostOf(g.mat)) : g.mat
      g.mesh.castShadow = on ? false : g.shadow
    }
    r.frame.visible = on
    r.ground.visible = on
  }

  function hide() {
    if (shown) setGhost(shown, false)
    shown = null
  }

  /** Poses the chassis for this frame; `corner` maps each wheel pivot to its corner (LF, RF, LR, RR). */
  function update(m: CutawayModel, st: RailState, corner: number[], on: boolean) {
    if (!on || !m.tmg) return hide()
    let r = rigs.get(m)
    if (!r) {
      r = build(m, st, carScale, corner)
      rigs.set(m, r)
    }
    if (shown !== r) {
      hide()
      setGhost(r, true)
      shown = r
    }
    const raw = m.wheels.map(() => new THREE.Vector3())
    hubs(m, carScale, raw)
    raw.forEach((p, i) => r.corners[corner[i]].hub.copy(p))
    const halfW = Math.abs(r.trackBar.a.x)
    const v = st.veh, avg = v.mass * 9.81 / 4
    r.corners.forEach((c, ci) => {
      const low = mount(c.front, c.sgn, c.hub, c.hub0, halfW)
      stretch(c.coil, low, c.top, 0.05)
      _d.subVectors(c.top, low)
      const len = _d.length()
      stretch(c.shockBody, c.top, low.clone().addScaledVector(_d, 0.45 / Math.max(len, 1e-4)), 0.024)
      stretch(c.shockRod, low, c.top, 0.009)
      stretch(c.bumpRubber, c.top, c.top.clone().addScaledVector(_d, -0.06 / Math.max(len, 1e-4)), 0.03)
      const tr = st.travel[ci]
      const t = THREE.MathUtils.clamp((tr + 0.04) / 0.12, 0, 1)
      c.coilMat.color.setHSL(0.58 - t * 0.58, 0.8, 0.55)
      c.coilMat.emissive.setHex(st.stop[ci] ? 0x661010 : 0x000000)
      c.bumpMat.color.setHex(st.stop[ci] ? 0xff4a4a : st.bump[ci] ? 0xffcc00 : 0x3a3f47)
      if (c.front) {
        const lbj = new THREE.Vector3(c.hub.x - c.sgn * 0.06, c.hub.y - 0.11, c.hub.z), ubj = new THREE.Vector3(c.hub.x - c.sgn * 0.09, c.hub.y + 0.13, c.hub.z)
        c.arms[0].b.copy(lbj); c.arms[1].b.copy(lbj); c.arms[2].b.copy(ubj); c.arms[3].b.copy(ubj)
        const el = r.endLinks[ci]
        el.b.copy(lbj).lerp(new THREE.Vector3(c.sgn * halfW, c.hub0.y - 0.1, c.hub.z), 0.5)
        place(el)
      } else {
        c.arms[0].b.set(c.hub.x * 0.85, c.hub.y - 0.1, c.hub.z)
        c.arms[1].b.set(c.hub.x * 0.85, c.hub.y + 0.1, c.hub.z)
      }
      c.arms.forEach(place)
      const load = Math.max(0, st.fz[ci]), hgt = Math.max(0.01, (load / avg) * 0.45)
      c.column.position.set(c.hub0.x, hgt / 2, c.hub0.z)
      c.column.scale.set(0.09, hgt, 0.09)
      const use = THREE.MathUtils.clamp(st.use[ci], 0, 1.2)
      c.columnMat.color.copy(load <= 0 ? _c.setHex(0x3a4458) : _c.setHSL(Math.max(0, 0.33 - use * 0.33), 0.75, 0.5))
    })
    const L = r.corners[2].hub, R = r.corners[3].hub
    r.axle.a.copy(L).lerp(R, 0.04)
    r.axle.b.copy(R).lerp(L, 0.04)
    place(r.axle)
    r.pumpkin.position.copy(L).lerp(R, 0.45)
    const fx = THREE.MathUtils.clamp((0.3 - L.x) / (R.x - L.x || 1), 0, 1)
    r.trackBar.b.copy(L).lerp(R, fx)
    r.trackBar.b.y += 0.04
    place(r.trackBar)
    const twist = Math.abs(st.travel[0] - st.travel[1])
    r.barMat.color.setHSL(0.6 - Math.min(1, twist / 0.06) * 0.52, Math.min(1, twist / 0.06) * 0.8, 0.6)
    _d.set(-st.ay, 0, -st.ax).multiplyScalar(1 / 9.81)
    const g = _d.length()
    if (g > 0.03) {
      r.arrow.visible = true
      r.arrow.position.copy(r.cg)
      r.arrow.setDirection(_d.divideScalar(g))
      r.arrow.setLength(0.25 + g * 0.6, 0.16, 0.1)
    } else r.arrow.visible = false
  }

  return { update, hide }
}
