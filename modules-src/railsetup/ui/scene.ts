import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as K from '../sim/kin'
import type { Corner, Pose, RearPose, Vec } from '../sim/kin'
import { CAD, END_LINKS } from '../sim/hardpoints'
import type { FrontAdj } from '../sim/inputs'
import type { Lab, Model, Side } from '../sim/lab'
import { SIDES } from '../sim/lab'
import { affineMatrix, bakeChassis, loadChassisModel, nk, rodMatrix } from './parts'

const GROUND = 0

type CornerParts = { knuckle: THREE.Mesh[]; lower: THREE.Mesh[]; upper: THREE.Mesh[]; bar: THREE.Mesh[]; barArm: THREE.Mesh[] }
type Shock = { top: THREE.Mesh[]; bot: THREE.Mesh[]; U?: Vec; L?: Vec }
type EndLink = { parts: THREE.Mesh[]; up?: Vec; lo?: Vec; t?: number }

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

export class ChassisScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly cam = new THREE.PerspectiveCamera(35, 1, 0.25, 2000)
  readonly controls: OrbitControls
  readonly sprung = new THREE.Group()
  readonly links = new THREE.Group()
  readonly uns = new THREE.Group()
  readonly discs: THREE.Mesh[] = []
  readonly tags: HTMLDivElement[] = []
  readonly axisLine: THREE.Line
  readonly cgDot: THREE.Mesh
  readonly rcDot: THREE.Mesh
  readonly rrcDot: THREE.Mesh
  readonly icLines: Record<Side, THREE.Line> = {} as Record<Side, THREE.Line>
  readonly svLines: Record<Side, THREE.Line> = {} as Record<Side, THREE.Line>
  readonly kpLines: Record<Side, THREE.Line> = {} as Record<Side, THREE.Line>
  readonly kpRef: Record<Side, THREE.Line> = {} as Record<Side, THREE.Line>
  readonly kpDots: Record<Side, THREE.Mesh[]> = {} as Record<Side, THREE.Mesh[]>
  readonly fjArrows: Record<Side, THREE.ArrowHelper> = {} as Record<Side, THREE.ArrowHelper>
  readonly tbLine: THREE.Line
  readonly jackArrow: THREE.ArrowHelper
  loaded = false
  rearGuess: number[] | null = null
  private rearGuessFor: K.RearGeometry | null = null
  private readonly grid: THREE.GridHelper
  private readonly mats = {
    sprung: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.85 }),
    link: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.8 }),
    uns: new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.85 }),
  }
  private readonly corner: Record<Side, CornerParts> = { L: { knuckle: [], lower: [], upper: [], bar: [], barArm: [] }, R: { knuckle: [], lower: [], upper: [], bar: [], barArm: [] } }
  private readonly tieRod = {} as Record<Side, THREE.Mesh>
  private readonly RLM: Record<string, THREE.Mesh[]> = { LL: [], RL: [], UL: [], TB: [], JB: [] }
  private readonly HOUS: Record<string, THREE.Mesh[]> = { TB: [], JB: [] }
  private readonly ENDL: Record<Side, EndLink> = { L: { parts: [] }, R: { parts: [] } }
  private readonly SHK: Record<string, Shock> = { FL: { top: [], bot: [] }, FR: { top: [], bot: [] }, RL: { top: [], bot: [] }, RR: { top: [], bot: [] } }
  private readonly KDEF: Record<Side, string> = { L: '', R: '' }
  private readonly KUB = {} as Record<Side, Vec>
  private readonly KLB = {} as Record<Side, Vec>
  private WDEF = ''
  private MCADi: THREE.Matrix4
  private readonly tmp = { M: new THREE.Matrix4(), KB: new THREE.Matrix4(), LM: new THREE.Matrix4(), R: new THREE.Matrix4(), v: new THREE.Vector3(), MQ: new THREE.Matrix4(), MIR: new THREE.Matrix4().makeScale(1, -1, 1), PM: new THREE.Matrix4(), T1: new THREE.Matrix4(), T2: new THREE.Matrix4(), pA: new THREE.Vector3(), pB: new THREE.Vector3(), dir: new THREE.Vector3() }

  constructor(readonly stage: HTMLElement, readonly lab: Lab) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1.5), 2))
    stage.prepend(this.renderer.domElement)
    this.renderer.domElement.setAttribute('aria-label', '3D view of the chassis')
    this.cam.up.set(0, 0, 1)
    this.controls = new OrbitControls(this.cam, this.renderer.domElement)
    this.controls.target.set(5, 0, 10)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.9 * Math.PI))
    const sun = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI)
    sun.position.set(80, 120, 200)
    this.scene.add(sun)
    this.grid = new THREE.GridHelper(400, 40)
    this.grid.rotation.x = Math.PI / 2
    this.grid.position.z = GROUND
    this.scene.add(this.grid)
    this.themeMats()
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.themeMats())
    new MutationObserver(() => this.themeMats()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    this.scene.add(this.sprung, this.links, this.uns)
    this.sprung.matrixAutoUpdate = this.links.matrixAutoUpdate = this.uns.matrixAutoUpdate = false
    lab.TIRE.forEach(p => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }))
      d.position.set(p[0], p[1], GROUND + 0.05)
      this.scene.add(d)
      this.discs.push(d)
      const t = document.createElement('div')
      t.className = 'tag'
      stage.appendChild(t)
      this.tags.push(t)
    })
    this.axisLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xd9480f }))
    this.scene.add(this.axisLine)
    this.cgDot = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 16), new THREE.MeshBasicMaterial({ color: 0xd9480f }))
    this.sprung.add(this.cgDot)
    for (const k of ['L', 'R'] as Side[]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 16), this.mats.link)
      m.matrixAutoUpdate = false
      this.sprung.add(m)
      this.tieRod[k] = m
      this.icLines[k] = this.dashed(3, 0xd9480f, 1.2, 0.8, this.sprung)
      this.svLines[k] = this.dashed(2, 0x2b8a3e, 1.6, 1, this.sprung)
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xd9480f, depthTest: false }))
      l.renderOrder = 10
      l.visible = false
      this.sprung.add(l)
      this.kpLines[k] = l
      const r = this.dashed(2, 0x5b6670, 0.8, 0.6, this.sprung, false)
      r.renderOrder = 10
      this.kpRef[k] = r
      this.kpDots[k] = [0, 1].map(() => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd9480f, depthTest: false }))
        dot.renderOrder = 11
        dot.visible = false
        this.sprung.add(dot)
        return dot
      })
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 10, 0x2b8a3e, 3, 2)
      a.visible = false
      this.sprung.add(a)
      this.fjArrows[k] = a
    }
    this.rcDot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 16), new THREE.MeshBasicMaterial({ color: 0xd9480f }))
    this.rcDot.visible = false
    this.sprung.add(this.rcDot)
    this.rrcDot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 16), new THREE.MeshBasicMaterial({ color: 0xd9480f }))
    this.rrcDot.visible = false
    this.sprung.add(this.rrcDot)
    this.tbLine = this.dashed(2, 0xd9480f, 1.2, 0.8, this.scene)
    this.jackArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 10, 0x2b8a3e, 3, 2)
    this.jackArrow.visible = false
    this.scene.add(this.jackArrow)
    this.MCADi = this.axleM(lab.RG0.qc, new THREE.Matrix4()).invert()
    new ResizeObserver(() => this.resize()).observe(stage)
    this.resize()
    this.view([200, -175, 115])
  }

  private dashed(n: number, color: number, dash: number, gap: number, parent: THREE.Object3D, depth = true): THREE.Line {
    const g = new THREE.BufferGeometry().setFromPoints(Array.from({ length: n }, () => new THREE.Vector3()))
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, depthTest: depth }))
    l.visible = false
    parent.add(l)
    return l
  }

  themeMats() {
    this.scene.background = new THREE.Color(css('--panel') || '#f8f9fa')
    this.mats.sprung.color.set(css('--steel') || '#7d8b99')
    this.mats.link.color.set(css('--link') || '#e8590c')
    this.mats.uns.color.set(css('--unsprung') || '#343a40')
    ;(this.grid.material as THREE.Material & { color: THREE.Color }).color = new THREE.Color(css('--line') || '#cfd5db')
  }

  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
  }

  view(p: number[], t?: number[]) {
    this.cam.position.set(p[0], p[1], p[2])
    if (t) this.controls.target.set(t[0], t[1], t[2])
    this.controls.update()
  }

  async load(onDone: () => void, onFail: () => void) {
    let root
    try { root = await loadChassisModel() } catch { onFail(); return }
    for (const { mesh: o, name: n, center: c, cls, side } of bakeChassis(root)) {
      if (cls === 'sprung') { o.material = this.mats.sprung; this.sprung.add(o) } else if (cls === 'shock') {
        const [k, e] = side as [string, string], S = this.SHK[k], fr = k[0] === 'F'
        o.material = this.mats.link
        if (e === 'U' || e === 'L') { S[e] = [c.x, c.y, c.z]; S[e === 'U' ? 'top' : 'bot'].push(o) } else (S[e as 'top' | 'bot']).push(o)
        ;(fr ? this.sprung : this.scene).add(o)
      } else if (cls === 'endlink') {
        o.material = this.mats.link
        this.sprung.add(o)
        const E = this.ENDL[side as Side]
        E.parts.push(o)
        if (/^balljoint3/.test(nk(n))) E[c.z > 9 ? 'up' : 'lo'] = [c.x, c.y, c.z]
      } else if (cls === 'uns') { o.material = this.mats.uns; this.uns.add(o); if (side) this.HOUS[side as string].push(o) } else if (this.RLM[cls]) { o.material = this.mats.link; this.scene.add(o); this.RLM[cls].push(o) } else {
        o.material = cls === 'knuckle' ? this.mats.uns : (cls === 'bar' || cls === 'barArm' ? this.mats.sprung : this.mats.link)
        this.sprung.add(o)
        this.corner[side as Side][cls as keyof CornerParts].push(o)
        if (cls === 'knuckle') o.userData.wheel = /fronthub|wheels/.test(nk(n))
      }
    }
    for (const k of ['L', 'R'] as Side[]) {
      if (!this.ENDL[k].up) this.ENDL[k].up = END_LINKS[k].up
      if (!this.ENDL[k].lo) this.ENDL[k].lo = END_LINKS[k].lo
    }
    this.loaded = true
    onDone()
  }

  private rod(a0: Vec, b0: Vec, a1: Vec, b1: Vec, out: THREE.Matrix4): THREE.Matrix4 {
    return rodMatrix(a0, b0, a1, b1, out)
  }

  private poseShock(S: Shock, U1: Vec, L1: Vec) {
    if (!S.U || !S.L) return
    this.rod(S.U, S.L, U1, L1, this.tmp.M); S.top.forEach(o => o.matrix.copy(this.tmp.M))
    this.rod(S.L, S.U, L1, U1, this.tmp.M); S.bot.forEach(o => o.matrix.copy(this.tmp.M))
  }

  private affine(a: Vec, b: Vec, c: Vec, A: Vec, B: Vec, C: Vec, out: THREE.Matrix4): THREE.Matrix4 {
    return affineMatrix(a, b, c, A, B, C, out)
  }

  deformWheels(num: (id: string) => number) {
    if (!this.loaded) return
    const key = ['wwlf', 'wwrf', 'wwlr', 'wwrr', 'bslf', 'bsrf', 'bslr', 'bsrr', 'hulr', 'hurr'].map(num).join('/')
    if (key === this.WDEF) return
    this.WDEF = key
    const cl = (x: number) => Math.max(0, Math.min(1, x)), w = (c: string) => num('ww' + c) / 2 - num('bs' + c), hu = { L: num('hulr'), R: num('hurr') }
    const fit = (o: THREE.Mesh, f: (y: number) => number) => {
      const g = o.geometry, P = g.attributes.position as THREE.BufferAttribute
      if (!o.userData.p0) o.userData.p0 = (P.array as Float32Array).slice()
      const p0 = o.userData.p0 as Float32Array
      for (let i = 0; i < p0.length; i += 3) (P.array as Float32Array)[i + 1] = f(p0[i + 1])
      P.needsUpdate = true
      g.computeBoundingSphere()
      g.computeBoundingBox()
    }
    const wheel = (o: THREE.Mesh, c: string, y0: number, out: number, s: number) => fit(o, y => y0 + s * out + (y - y0) * num('ww' + c) / 10)
    for (const k of ['L', 'R'] as Side[]) {
      const s = SIDES[k], c = k === 'L' ? 'lf' : 'rf'
      this.corner[k].knuckle.forEach(o => { if (/wheels/i.test(o.name)) wheel(o, c, CAD[k].WC[1], w(c), s) })
    }
    this.uns.children.forEach(child => {
      const o = child as THREE.Mesh
      if (!o.isMesh) return
      if (!o.userData.p0) { const b = o.geometry.boundingBox as THREE.Box3; o.userData.cy = (b.min.y + b.max.y) / 2 }
      const k: Side = o.userData.cy > 0 ? 'L' : 'R', s = k === 'L' ? 1 : -1, c = k === 'L' ? 'lr' : 'rr'
      if (/wheels/i.test(o.name)) wheel(o, c, o.userData.cy, w(c) + hu[k], s)
      else if (/drive_?hub/i.test(o.name)) fit(o, y => y + s * hu[k])
      else if (/housing/i.test(o.name)) fit(o, y => y + (y > 0 ? hu.L : -hu.R) * cl((Math.abs(y) - 22) / 2))
    })
  }

  private deformKnuckle(k: Side, a: FrontAdj) {
    const key = a.umh + '/' + a.lmh
    if (this.KDEF[k] === key) return
    this.KDEF[k] = key
    const V = K.V, h = CAD[k], up = V.norm(V.sub(h.UBJ, h.LBJ)), zs = h.WC[2], xb = h.LBJ[0]
    const cl = (x: number) => Math.max(0, Math.min(1, x))
    this.KUB[k] = V.add(h.UBJ, V.mul(up, a.umh))
    this.KLB[k] = V.add(h.LBJ, V.mul(up, a.lmh))
    this.corner[k].knuckle.forEach(o => {
      if (o.userData.wheel) return
      const g = o.geometry, P = g.attributes.position as THREE.BufferAttribute
      if (!o.userData.p0) { o.userData.p0 = (P.array as Float32Array).slice(); const b = g.boundingBox as THREE.Box3; o.userData.cz = (b.min.z + b.max.z) / 2; o.userData.cx = (b.min.x + b.max.x) / 2 }
      const p0 = o.userData.p0 as Float32Array, body = /knuckle/i.test(o.name), near = Math.abs(o.userData.cx - xb) < 3
      const part = !body && near ? (o.userData.cz > zs + 1 ? 1 : o.userData.cz < zs - 1 ? -1 : 0) : 0
      if (!body && !part) return
      const arr = P.array as Float32Array
      for (let i = 0; i < p0.length; i += 3) {
        const x = p0[i], y = p0[i + 1], z = p0[i + 2]
        let d: number
        if (body) { const wx = cl((3.5 - Math.abs(x - xb)) / 1); d = a.umh * cl((z - zs - 1.4) / 0.7) + a.lmh * cl((zs - 1.4 - z) / 0.7) * wx } else d = part > 0 ? a.umh : a.lmh
        arr[i] = x + up[0] * d; arr[i + 1] = y + up[1] * d; arr[i + 2] = z + up[2] * d
      }
      P.needsUpdate = true
      g.computeBoundingSphere()
      if (body) g.computeVertexNormals()
    })
  }

  applyCorner(k: Side, c: Corner, p: Pose, a: FrontAdj) {
    const h = CAD[k], t = this.tmp
    this.affine(h.LIF, h.LIR, h.LBJ, c.LIF, c.LIR, p.LBJ, t.LM)
    this.corner[k].lower.forEach(o => o.matrix.copy(t.LM))
    const onArm = (q: Vec): Vec => { t.v.set(q[0], q[1], q[2]).applyMatrix4(t.LM); return [t.v.x, t.v.y, t.v.z] }
    const S = this.SHK['F' + k]
    if (S.L && S.U) this.poseShock(S, S.U, onArm(S.L))
    const E = this.ENDL[k], BARAX = CAD.barAxis
    if (E.up && E.lo) {
      const up = E.up, lo = onArm(E.lo), dx = up[0] - BARAX[0], dz = up[2] - BARAX[1], Ll = K.V.dist(up, E.lo)
      const tip = (tt: number): Vec => [BARAX[0] + dx * Math.cos(tt) + dz * Math.sin(tt), up[1], BARAX[1] - dx * Math.sin(tt) + dz * Math.cos(tt)]
      const tt = K.solve(x => K.V.dist(tip(x), lo) - Ll, E.t || 0)
      if (Number.isFinite(tt) && Math.abs(tt) < 1) E.t = tt
      t.M.makeTranslation(BARAX[0], 0, BARAX[1]).multiply(t.R.makeRotationY(E.t || 0)).multiply(t.R.makeTranslation(-BARAX[0], 0, -BARAX[1]))
      this.corner[k].barArm.forEach(o => o.matrix.copy(t.M))
      this.rod(E.lo, up, lo, tip(E.t || 0), t.M)
      E.parts.forEach(o => o.matrix.copy(t.M))
    }
    const toW = (l: Vec) => kinToWorld(l, p)
    const kr = c.kref.map(toW)
    this.affine(h.LBJ, h.UBJ, h.TRO, kr[0], kr[1], kr[2], t.M)
    this.deformKnuckle(k, a)
    const kb = c.kbody.map(toW)
    this.affine(this.KLB[k], this.KUB[k], h.TRO, kb[0], kb[1], kb[2], t.KB)
    this.corner[k].knuckle.forEach(o => o.matrix.copy(o.userData.wheel ? t.M : t.KB))
    this.affine(h.UIF, h.UIR, h.UBJ, c.UIF, c.UIR, p.UBJ, t.M)
    this.corner[k].upper.forEach(o => o.matrix.copy(t.M))
    const s = SIDES[k], off = (q: Vec): Vec => [q[0], q[1] - s * 4, q[2] + 1]
    this.affine(h.UIF, h.UIR, off(h.UIF), c.UIF, c.UIR, off(c.UIF), t.M)
    this.corner[k].bar.forEach(o => o.matrix.copy(t.M))
    const A = new THREE.Vector3(c.TRI[0], c.TRI[1], c.TRI[2]), B = new THREE.Vector3(p.TRO[0], p.TRO[1], p.TRO[2]), d = B.clone().sub(A), L = d.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
    this.tieRod[k].matrix.compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, L, 1))
  }

  axleM(q: number[], out: THREE.Matrix4): THREE.Matrix4 {
    const R = K.Rq(q)
    return out.set(R[0][0], R[0][1], R[0][2], q[0], R[1][0], R[1][1], R[1][2], q[1], R[2][0], R[2][1], R[2][2], q[2], 0, 0, 0, 1)
  }

  private toW(p: Vec): Vec {
    const v = this.tmp.v.set(p[0], p[1], p[2]).applyMatrix4(this.sprung.matrix)
    return [v.x, v.y, v.z]
  }

  placeRear(rollAng: number, heave: number, model: Model | null, tbType: number, tbFlip: number): { rp: RearPose; Aw: Vec; Cw: Vec } {
    const lab = this.lab, RG = lab.RG, t = this.tmp
    if (this.rearGuessFor !== RG) { this.rearGuess = null; this.rearGuessFor = RG }
    const rp = K.rearPoseNear(RG, -heave, -(rollAng + (model ? model.pose0.dphR : 0)), this.rearGuess)
    this.rearGuess = K.rearResidual(RG, rp.q) < 1e-6 ? rp.q : null
    this.uns.matrix.copy(this.sprung.matrix).multiply(this.axleM(rp.q, t.MQ)).multiply(this.MCADi)
    this.uns.matrixWorldNeedsUpdate = true
    const rear = CAD.rear as unknown as Record<string, Vec[]>
    for (const k of K.LINKS) {
      if (k === 'TB') continue
      const c = rear[k]
      this.rod(c[1], c[0], this.toW(RG.C[k]), this.toW(rp.P[k]), t.M)
      this.RLM[k].forEach(o => o.matrix.copy(t.M))
    }
    const jb = !!(tbType && this.RLM.JB.length && CAD.rear.JB), f = tbFlip ? -1 : 1, m = (p: Vec): Vec => [p[0], f * p[1], p[2]]
    const c = jb ? [CAD.rear.JBm as Vec, (CAD.rear.JB as Vec[])[1]] : CAD.rear.TB
    this.rod(m(c[1]), m(c[0]), this.toW(RG.C.TB), this.toW(rp.P.TB), t.M)
    if (f < 0) t.M.multiply(t.MIR)
    this.RLM.TB.forEach(o => { o.visible = !jb; o.matrix.copy(t.M) })
    this.RLM.JB.forEach(o => { o.visible = jb; o.matrix.copy(t.M) })
    this.HOUS.TB.forEach(o => o.visible = !jb)
    this.HOUS.JB.forEach(o => o.visible = jb)
    for (const k of ['RL', 'RR']) {
      const S = this.SHK[k]
      if (S.U && S.L) {
        t.v.set(S.L[0], S.L[1], S.L[2]).applyMatrix4(this.uns.matrix)
        const L1: Vec = [t.v.x, t.v.y, t.v.z]
        this.poseShock(S, this.toW(S.U), L1)
      }
    }
    return { rp, Aw: this.toW(rp.P.TB), Cw: this.toW(RG.C.TB) }
  }

  rollMatrix(out: THREE.Matrix4, ang: number, heave: number, model: Model | null) {
    const t = this.tmp, TIRE = this.lab.TIRE
    t.pA.set(TIRE[0][0], 0, GROUND + (model ? model.hf : 2))
    t.pB.set(TIRE[2][0], 0, GROUND + (model ? model.hr : 10))
    t.dir.subVectors(t.pA, t.pB).normalize()
    t.T1.makeTranslation(-t.pB.x, -t.pB.y, -t.pB.z)
    t.R.makeRotationAxis(t.dir, ang)
    t.T2.makeTranslation(t.pB.x, t.pB.y, t.pB.z + (heave || 0))
    out.copy(t.T2).multiply(t.R).multiply(t.T1)
  }

  bodyMatrix(out: THREE.Matrix4, ang: number, zF: number, zR: number, model: Model | null) {
    this.rollMatrix(out, ang, 0, model)
    const TIRE = this.lab.TIRE, xR = TIRE[2][0], th = Math.atan2(zF - zR, TIRE[0][0] - xR)
    this.tmp.PM.makeTranslation(xR, 0, zR).multiply(new THREE.Matrix4().makeRotationY(-th)).multiply(new THREE.Matrix4().makeTranslation(-xR, 0, 0))
    out.premultiply(this.tmp.PM)
  }

  setLine(line: THREE.Line, pts: Vec[]) {
    line.geometry.setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])))
    line.computeLineDistances()
  }

  setArrow(a: THREE.ArrowHelper, pos: Vec, up: boolean, len: number) {
    a.position.set(pos[0], pos[1], pos[2])
    a.setDirection(new THREE.Vector3(0, 0, up ? 1 : -1))
    a.setLength(len, Math.min(3, len * 0.4), 2)
  }

  project(p: number[], out: THREE.Vector3): THREE.Vector3 {
    return out.set(p[0], p[1], p[2]).applyMatrix4(this.scene.matrixWorld).project(this.cam)
  }

  render() {
    this.controls.update()
    this.renderer.render(this.scene, this.cam)
  }
}

function kinToWorld(l: Vec, p: Pose): Vec {
  const F = p.F
  return [p.LBJ[0] + F[0][0] * l[0] + F[1][0] * l[1] + F[2][0] * l[2], p.LBJ[1] + F[0][1] * l[0] + F[1][1] * l[1] + F[2][1] * l[2], p.LBJ[2] + F[0][2] * l[0] + F[1][2] * l[1] + F[2][2] * l[2]]
}
