import type { BuildingData, LotData, RoadData } from '../../../modules-src/tello/data/MapData'
import { curveOf, offsetCurve, densify, lineLength, simplify } from '../../../modules-src/tello/edits/Geom'
import { rectRing } from '../../../modules-src/tello/edits/Apply'
import { newOpId, type EditOp, type Shape } from '../../../modules-src/tello/edits/WorldEdits'
import { fromLake, toLake, type EditorModel } from './model'
import { LINE_TOOLS, SHAPED_TOOLS, type ToolId } from './settings'
import type { HitIndex } from './hit'
import { WALL_COLOR, drawCursorRing, drawHandles, drawShape, highlightBuilding, highlightRing, highlightRoad, toSX, toSY, tracePath, type View } from './draw'

export interface Pointer { x: number; z: number; px: number; py: number; button: number; shift: boolean; alt: boolean; ctrl: boolean }

export interface ToolHost {
  model: EditorModel
  view(): View
  hits(): HitIndex | null
  redraw(): void
  notify(text: string): void
}

const PICK_PX = 7

/** How the view the pointer is in maps the ground to the screen: the 2D map or the 3D view. */
export interface ScreenSpace {
  project(x: number, z: number): [number, number] | null
  mPerPx(x: number, z: number): number
}

/** A point being plotted, with the ground height there when it was placed (grade lines read it). */
interface LinePoint { x: number; z: number; h: number }

/**
 * Turns pointer gestures into edits for whichever tool is picked: brush strokes, outlined areas, dragged rectangles,
 * plotted lines with movable points, and single clicks. The current gesture is drawn as a live preview.
 */
export class ToolRunner {
  stroke: number[] | null = null
  line: LinePoint[] = []
  rect: { x0: number; z0: number; x1: number; z1: number } | null = null
  hover: { x: number; z: number } | null = null
  /** The road a redraw replaces. */
  replacing: RoadData | null = null
  /** The lot being reshaped and its corners. */
  lotEdit: { lot: LotData; ring: number[] } | null = null
  /** The 3D view sets this while the pointer is in it; null means the 2D map. */
  space: ScreenSpace | null = null
  private dragPoint = -1
  private dragRing = -1
  private moving: { b: BuildingData; x: number; z: number; dx: number; dz: number } | null = null
  private down = false

  /** Called whenever the gesture or its preview changes (the 3D view listens). */
  readonly watchers = new Set<() => void>()

  constructor(private readonly host: ToolHost) {}

  changed(): void {
    this.host.redraw()
    for (const fn of this.watchers) fn()
  }

  /** The line being plotted, flat x, z pairs. */
  get linePoints(): number[] {
    return this.line.flatMap((p) => [p.x, p.z])
  }

  /** The point being dragged (-1 when none). */
  get dragging(): number {
    return this.dragPoint
  }

  get pressed(): boolean {
    return this.down
  }

  /** The building being dragged and how far it has moved. */
  get movingBuilding(): { b: BuildingData; dx: number; dz: number } | null {
    return this.moving
  }

  get model(): EditorModel {
    return this.host.model
  }

  get tool(): ToolId {
    return this.model.tool
  }

  /** True while a line or area is being plotted (Enter, Escape and Backspace act on it). */
  get drafting(): boolean {
    return this.line.length > 0 || !!this.lotEdit || !!this.stroke || !!this.rect
  }

  reset(): void {
    this.stroke = null
    this.line = []
    this.rect = null
    this.replacing = null
    this.lotEdit = null
    this.dragPoint = -1
    this.dragRing = -1
    this.moving = null
    this.down = false
    this.model.emit()
    this.changed()
  }

  private commit(op: EditOp | EditOp[]): void {
    this.model.add(op)
    if (this.model.lastProblem) this.host.notify(this.model.lastProblem)
  }

  private base(): { id: string; ts: number } {
    const ts = Date.now()
    return { id: newOpId(ts), ts }
  }

  private sp(): ScreenSpace {
    if (this.space) return this.space
    const v = this.host.view()
    return { project: (x, z) => [toSX(v, x), toSY(v, z)], mPerPx: () => 1 / v.s }
  }

  private pickTol(at?: { x: number; z: number }): number {
    const h = at ?? this.hover ?? { x: 0, z: 0 }
    return PICK_PX * this.sp().mPerPx(h.x, h.z)
  }

  private near(x: number, z: number, px: number, py: number, reach: number): boolean {
    const q = this.sp().project(x, z)
    return !!q && Math.hypot(q[0] - px, q[1] - py) <= reach
  }

  private segPx(px: number, py: number, ax: number, az: number, bx: number, bz: number): number {
    const a = this.sp().project(ax, az), b = this.sp().project(bx, bz)
    if (!a || !b) return Infinity
    return segDist(px, py, a[0], a[1], b[0], b[1])
  }

  private ground(x: number, z: number): number {
    return this.model.land?.groundAt(x, z) ?? 0
  }

  /** Where a plotted road point lands: on an existing road's end, corner or centre line when one is close. */
  private snapped(p: Pointer): { x: number; z: number } {
    if (!this.model.settings.road.snap || (this.tool !== 'road' && this.tool !== 'redraw') || p.alt) return { x: p.x, z: p.z }
    const hit = this.host.hits()?.snap(p.x, p.z, (PICK_PX + 4) * this.sp().mPerPx(p.x, p.z), (r) => r !== this.replacing && r.k <= 3)
    return hit ? { x: hit.x, z: hit.z } : { x: p.x, z: p.z }
  }

  // ------------------------------------------------------------ pointer

  /** Returns true when the tool took the press (the view pans otherwise). */
  pointerDown(p: Pointer): boolean {
    if (p.button !== 0) return false
    const t = this.tool
    const s = this.model.settings
    if (this.stroke && this.stroke.length >= 2) {
      const pts = this.stroke
      this.stroke = null
      this.commitShape({ k: 'path', pts: pts.map(round), r: this.model.settings.radius })
    }
    this.down = true
    if (t === 'select') return this.selectDown(p)
    if (p.alt && (t === 'flatten' || t === 'grade')) {
      this.model.patchSettings({ height: Math.round(toLake(this.ground(p.x, p.z)) * 100) / 100 })
      this.host.notify(`Height picked: ${toLake(this.ground(p.x, p.z)).toFixed(2)} m`)
      return true
    }
    if (p.alt && (t === 'fill' || t === 'level' || t === 'paint')) {
      const w = this.model.land?.waterAt(p.x, p.z)
      const v = w ?? this.ground(p.x, p.z)
      this.model.patchSettings({ level: Math.round(toLake(v) * 100) / 100 })
      this.host.notify(`${w !== null && w !== undefined ? 'Water' : 'Ground'} level picked: ${toLake(v).toFixed(2)} m`)
      return true
    }
    if (SHAPED_TOOLS.has(t)) {
      if (s.shape === 'brush') {
        this.stroke = [p.x, p.z]
        this.changed()
        return true
      }
      if (s.shape === 'rect') {
        this.rect = { x0: p.x, z0: p.z, x1: p.x, z1: p.z }
        return true
      }
      return this.lineDown(p)
    }
    if (t === 'building') {
      this.rect = { x0: p.x, z0: p.z, x1: p.x, z1: p.z }
      return true
    }
    if (t === 'lotEdit') return this.lotEditDown(p)
    if (t === 'redraw' && !this.replacing) {
      const road = this.host.hits()?.roadAt(p.x, p.z, this.pickTol(p))
      if (!road) { this.host.notify('Click a road to redraw it'); return true }
      this.startRedraw(road)
      return true
    }
    if (LINE_TOOLS.has(t)) return this.lineDown(p)
    this.click(p)
    return true
  }

  pointerMove(p: Pointer): void {
    this.hover = { x: p.x, z: p.z }
    if (this.moving) {
      this.moving.dx = p.x - this.moving.x
      this.moving.dz = p.z - this.moving.z
    } else if (this.stroke && this.down) {
      const n = this.stroke.length
      const step = Math.max(0.8, this.model.settings.radius * 0.25)
      if (Math.hypot(p.x - this.stroke[n - 2], p.z - this.stroke[n - 1]) >= step) this.stroke.push(p.x, p.z)
    } else if (this.rect && this.down) {
      this.rect.x1 = p.x
      this.rect.z1 = p.z
    } else if (this.dragPoint >= 0 && this.down) {
      const at = this.snapped(p)
      const pt = this.line[this.dragPoint]
      pt.x = at.x
      pt.z = at.z
      pt.h = this.ground(at.x, at.z)
      this.model.emit()
    } else if (this.dragRing >= 0 && this.down && this.lotEdit) {
      this.lotEdit.ring[this.dragRing * 2] = p.x
      this.lotEdit.ring[this.dragRing * 2 + 1] = p.z
    }
    this.changed()
  }

  pointerUp(p: Pointer): void {
    this.down = false
    if (this.moving) {
      const m = this.moving
      this.moving = null
      if (Math.hypot(m.dx, m.dz) > 0.2 && m.b.id) this.commit({ ...this.base(), type: 'buildingSet', ref: m.b.id, dx: round(m.dx), dz: round(m.dz) })
      this.changed()
      return
    }
    if (this.stroke) {
      const pts = this.stroke
      this.stroke = null
      this.commitShape({ k: 'path', pts: pts.map(round), r: this.model.settings.radius })
      return
    }
    if (this.rect) {
      const r = this.rect
      this.rect = null
      if (this.tool === 'building') { this.commitBuilding(r); return }
      if (Math.abs(r.x1 - r.x0) < 1 || Math.abs(r.z1 - r.z0) < 1) { this.changed(); return }
      const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), z0 = Math.min(r.z0, r.z1), z1 = Math.max(r.z0, r.z1)
      this.commitShape({ k: 'area', ring: [x0, z0, x1, z0, x1, z1, x0, z1].map(round) })
      return
    }
    if (this.dragRing >= 0) this.dragRing = -1
    if (this.dragPoint >= 0) this.dragPoint = -1
    this.changed()
    void p
  }

  doubleClick(): void {
    if (this.line.length >= 2) this.finish()
  }

  // ------------------------------------------------------------ keys

  /** Enter builds what is plotted. */
  finish(): void {
    const t = this.tool
    if (this.lotEdit) { this.applyLotEdit(); return }
    const pts = this.line
    if (SHAPED_TOOLS.has(t) && this.model.settings.shape === 'area') {
      if (pts.length < 3) { this.host.notify('Outline at least three points'); return }
      const ring = pts.flatMap((p) => [round(p.x), round(p.z)])
      this.line = []
      this.commitShape({ k: 'area', ring })
      return
    }
    const s = this.model.settings
    const flat = pts.flatMap((p) => [round(p.x), round(p.z)])
    switch (t) {
      case 'road':
      case 'redraw': {
        if (pts.length < 2) { this.host.notify('Plot at least two points'); return }
        const r = s.road
        const op: EditOp = {
          ...this.base(), type: 'road', pts: flat, curve: r.curve, fit: r.fit, w: r.w, k: r.k, n: r.n.trim(),
          walk: r.walkLeft || r.walkRight ? { left: r.walkLeft, right: r.walkRight, w: r.walkW, gap: r.walkGap } : null,
          grade: r.grade ? { shoulder: r.shoulder, falloff: r.gradeFalloff, smooth: r.smooth } : null,
          replaces: this.replacing?.id ? [this.replacing.id] : undefined,
        }
        this.line = []
        this.replacing = null
        this.commit(op)
        break
      }
      case 'river': {
        if (pts.length < 2) { this.host.notify('Plot at least two points'); return }
        const rv = s.river
        const [start, end] = rv.auto ? this.riverLevels(pts) : [fromLake(rv.start), fromLake(rv.end)]
        this.line = []
        this.commit({ ...this.base(), type: 'river', pts: flat, curve: rv.curve, fit: rv.fit, w: rv.w, depth: rv.depth, bank: rv.bank, levels: [round(start), round(end)] })
        break
      }
      case 'grade': {
        if (pts.length < 2) { this.host.notify('Plot at least two points'); return }
        this.line = []
        this.commit({ ...this.base(), type: 'terrain', mode: 'grade', shape: { k: 'path', pts: flat, r: s.gradeHalf }, heights: pts.map((p) => round(p.h)), falloff: s.falloff, strength: s.strength, carry: s.carry })
        break
      }
      case 'rail': {
        if (pts.length < 2) { this.host.notify('Plot at least two points'); return }
        this.line = []
        this.commit({ ...this.base(), type: 'rail', pts: flat, side: s.rail.side })
        break
      }
      case 'wall': {
        if (pts.length < 2) { this.host.notify('Plot at least two points'); return }
        const w = s.wall
        this.line = []
        this.commit({ ...this.base(), type: 'wall', pts: flat, h: w.h, th: w.th, style: w.style, posts: w.posts, cap: w.cap, closed: w.closed && pts.length >= 3 })
        break
      }
      case 'lot': {
        if (pts.length < 3) { this.host.notify('Click at least three corners'); return }
        this.line = []
        this.commit({ ...this.base(), type: 'lot', ring: flat, stripes: s.lot.stripes })
        break
      }
      case 'lightRow': {
        if (pts.length < 2) { this.host.notify('Plot at least two points along the street'); return }
        const lights = this.lightRow(flat)
        this.line = []
        if (!lights.pts.length) { this.host.notify('The line is too short for that spacing'); return }
        this.commit({ ...this.base(), type: 'lights', style: s.light.style, pts: lights.pts, yaw: lights.yaw, h: s.light.h })
        break
      }
      default:
        return
    }
    this.changed()
  }

  cancel(): void {
    if (this.line.length || this.lotEdit || this.replacing || this.stroke || this.rect || this.moving) this.reset()
    else if (this.model.selection) this.model.select(null)
  }

  backspace(): boolean {
    if (this.line.length) {
      this.line.pop()
      if (!this.line.length && this.tool === 'redraw') this.replacing = null
      this.model.emit()
      this.changed()
      return true
    }
    return false
  }

  /** Turns the selected building (select tool) by `deg` degrees. */
  rotateSelected(deg: number): void {
    const sel = this.model.selection
    if (sel?.kind !== 'building') return
    this.commit({ ...this.base(), type: 'buildingSet', ref: sel.id, yaw: (deg * Math.PI) / 180 })
  }

  // ------------------------------------------------------------ gestures

  private selectDown(p: Pointer): boolean {
    const land = this.model.land
    const hits = this.host.hits()
    if (!land || !hits) return false
    const tol = this.pickTol(p)
    const sel = this.model.selection
    if (sel?.kind === 'building') {
      const b = land.doc.buildings.find((x) => x.id === sel.id && !x.x)
      if (b && hits.buildingAt(p.x, p.z) === b) {
        this.moving = { b, x: p.x, z: p.z, dx: 0, dz: 0 }
        return true
      }
    }
    const opHit = this.extraOpAt(p.x, p.z, tol)
    if (opHit) { this.model.select({ kind: 'op', id: opHit }); return true }
    const b = hits.buildingAt(p.x, p.z)
    if (b?.id) { this.model.select({ kind: 'building', id: b.id }); return true }
    const r = hits.roadAt(p.x, p.z, tol)
    if (r?.id) { this.model.select({ kind: 'road', id: r.id }); return true }
    const l = hits.lotAt(p.x, p.z)
    if (l?.id) { this.model.select({ kind: 'lot', id: l.id }); return true }
    if (sel) this.model.select(null)
    return false
  }

  /** The edit that put up the light, wall or rail under the cursor, if any. */
  private extraOpAt(x: number, z: number, tol: number): string | null {
    for (let i = this.model.ops.length - 1; i >= 0; i--) {
      const op = this.model.ops[i]
      if (op.on === false) continue
      if (op.type === 'lights') {
        for (let k = 0; k < op.pts.length; k += 2) if (Math.hypot(op.pts[k] - x, op.pts[k + 1] - z) < tol + 0.6) return op.id
      } else if (op.type === 'wall' || op.type === 'rail') {
        const line = op.type === 'wall' && op.closed ? [...op.pts, op.pts[0], op.pts[1]] : op.pts
        for (let k = 0; k + 3 < line.length; k += 2) if (segDist(x, z, line[k], line[k + 1], line[k + 2], line[k + 3]) < tol + 0.4) return op.id
      }
    }
    return null
  }

  private lineDown(p: Pointer): boolean {
    for (let i = 0; i < this.line.length; i++) {
      const q = this.line[i]
      if (this.near(q.x, q.z, p.px, p.py, PICK_PX + 2)) {
        if (p.alt) {
          this.line.splice(i, 1)
          this.model.emit()
        } else this.dragPoint = i
        this.changed()
        return true
      }
    }
    if (p.ctrl && this.line.length >= 2) {
      let best = -1, bd = PICK_PX + 2
      for (let i = 0; i + 1 < this.line.length; i++) {
        const a = this.line[i], b = this.line[i + 1]
        const d = this.segPx(p.px, p.py, a.x, a.z, b.x, b.z)
        if (d < bd) { bd = d; best = i }
      }
      if (best >= 0) {
        const at = this.snapped(p)
        this.line.splice(best + 1, 0, { x: at.x, z: at.z, h: this.ground(at.x, at.z) })
        this.dragPoint = best + 1
        this.model.emit()
        this.changed()
        return true
      }
    }
    const at = this.snapped(p)
    this.line.push({ x: at.x, z: at.z, h: this.ground(at.x, at.z) })
    this.dragPoint = this.line.length - 1
    this.model.emit()
    this.changed()
    return true
  }

  private lotEditDown(p: Pointer): boolean {
    if (this.lotEdit) {
      const ring = this.lotEdit.ring
      for (let i = 0; i < ring.length / 2; i++) {
        if (this.near(ring[i * 2], ring[i * 2 + 1], p.px, p.py, PICK_PX + 2)) {
          if (p.alt && ring.length > 6) ring.splice(i * 2, 2)
          else this.dragRing = i
          this.changed()
          return true
        }
      }
      if (p.ctrl) {
        const n = ring.length / 2
        let best = -1, bd = PICK_PX + 3
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n
          const d = this.segPx(p.px, p.py, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1])
          if (d < bd) { bd = d; best = i }
        }
        if (best >= 0) {
          ring.splice((best + 1) * 2, 0, p.x, p.z)
          this.dragRing = best + 1
          this.changed()
          return true
        }
      }
    }
    const lot = this.host.hits()?.lotAt(p.x, p.z)
    if (lot) {
      this.lotEdit = { lot, ring: [...lot.p] }
      this.model.emit()
      this.changed()
    } else if (!this.lotEdit) this.host.notify('Click a parking lot to reshape it')
    return true
  }

  applyLotEdit(): void {
    const e = this.lotEdit
    if (!e?.lot.id) return
    this.lotEdit = null
    this.commit({ ...this.base(), type: 'lotSet', ref: e.lot.id, ring: e.ring.map(round) })
    this.changed()
  }

  startRedraw(road: RoadData): void {
    this.model.setTool('redraw')
    this.replacing = road
    const pts = simplify(road.p, Math.max(0.6, road.w * 0.12))
    this.line = []
    for (let k = 0; k + 1 < pts.length; k += 2) this.line.push({ x: pts[k], z: pts[k + 1], h: this.ground(pts[k], pts[k + 1]) })
    this.model.patchGroup('road', { w: road.w, k: road.k, n: road.n, curve: pts.length > 4 ? Math.min(this.model.settings.road.curve, 20) : this.model.settings.road.curve, walkLeft: false, walkRight: false })
    this.host.notify('Drag the points to reshape the road, then press Enter to rebuild it')
    this.changed()
  }

  private click(p: Pointer): void {
    const t = this.tool
    const s = this.model.settings
    const hits = this.host.hits()
    const land = this.model.land
    if (!hits || !land) return
    const tol = this.pickTol(p)
    switch (t) {
      case 'fill': {
        this.commit({ ...this.base(), type: 'water', mode: 'fill', at: [round(p.x), round(p.z)], level: round(fromLake(s.level)) })
        return
      }
      case 'level': {
        if (land.waterAt(p.x, p.z) === null) { this.host.notify('Click on water to change its level'); return }
        this.commit({ ...this.base(), type: 'water', mode: 'level', at: [round(p.x), round(p.z)], level: round(fromLake(s.level)) })
        return
      }
      case 'roadRemove': {
        const r = hits.roadAt(p.x, p.z, tol)
        if (!r?.id) { this.host.notify('No road there'); return }
        this.commit({ ...this.base(), type: 'roadRemove', ids: [r.id] })
        return
      }
      case 'buildingRemove': {
        const b = hits.buildingAt(p.x, p.z)
        if (!b?.id) { this.host.notify('No building there'); return }
        this.commit({ ...this.base(), type: 'buildingRemove', ids: [b.id] })
        return
      }
      case 'lotRemove': {
        const l = hits.lotAt(p.x, p.z)
        if (!l?.id) { this.host.notify('No parking lot there'); return }
        this.commit({ ...this.base(), type: 'lotRemove', ids: [l.id] })
        return
      }
      case 'light': {
        const near = hits.snap(p.x, p.z, 40, (r) => r.k <= 2)
        const yaw = near ? Math.atan2(near.z - p.z, near.x - p.x) : 0
        this.commit({ ...this.base(), type: 'lights', style: s.light.style, pts: [round(p.x), round(p.z)], yaw: [Math.round(yaw * 1000) / 1000], h: s.light.h })
        return
      }
    }
  }

  private commitShape(shape: Shape): void {
    const t = this.tool
    const s = this.model.settings
    const b = this.base()
    switch (t) {
      case 'raise':
      case 'lower':
        this.commit({ ...b, type: 'terrain', mode: t, shape, falloff: s.falloff, amount: s.amount, carry: s.carry })
        break
      case 'flatten':
        this.commit({ ...b, type: 'terrain', mode: 'flatten', shape, falloff: s.falloff, height: round(fromLake(s.height)), strength: s.strength, carry: s.carry })
        break
      case 'smooth':
        this.commit({ ...b, type: 'terrain', mode: 'smooth', shape, falloff: s.falloff, strength: s.strength, size: s.smoothSize, carry: s.carry })
        break
      case 'noise':
        this.commit({ ...b, type: 'terrain', mode: 'noise', shape, falloff: s.falloff, amount: s.amount, strength: s.strength, size: s.noiseSize, carry: s.carry })
        break
      case 'paint':
        this.commit({ ...b, type: 'water', mode: 'paint', shape, level: round(fromLake(s.level)), dig: s.dig })
        break
      case 'drain':
        this.commit({ ...b, type: 'water', mode: 'drain', shape, fill: s.drainFill })
        break
      case 'plant': {
        const tr = s.trees
        this.commit({ ...b, type: 'trees', mode: 'add', shape, density: tr.density, mix: [tr.pine, tr.hardwood, tr.birch], height: [tr.hMin, Math.max(tr.hMin, tr.hMax)], seed: Math.floor(Math.random() * 1e6), floor: tr.floor })
        break
      }
      case 'clear':
        this.commit({ ...b, type: 'trees', mode: 'remove', shape })
        break
      case 'railCut':
        this.commit({ ...b, type: 'railCut', shape })
        break
      case 'lightCut':
        this.commit({ ...b, type: 'lightCut', shape })
        break
    }
    this.changed()
  }

  private commitBuilding(r: { x0: number; z0: number; x1: number; z1: number }): void {
    const s = this.model.settings.building
    const yaw = s.yaw * (Math.PI / 180)
    const c = Math.cos(-yaw), sn = Math.sin(-yaw)
    const ax = r.x0 * c - r.z0 * sn, az = r.x0 * sn + r.z0 * c
    const bx = r.x1 * c - r.z1 * sn, bz = r.x1 * sn + r.z1 * c
    const w = Math.abs(bx - ax), d = Math.abs(bz - az)
    if (w < 2 || d < 2) { this.host.notify('Drag a bigger footprint (at least 2 × 2 m)'); this.changed(); return }
    const lx = (ax + bx) / 2, lz = (az + bz) / 2
    const cx = lx * Math.cos(yaw) - lz * Math.sin(yaw), cz = lx * Math.sin(yaw) + lz * Math.cos(yaw)
    this.commit({ ...this.base(), type: 'building', x: round(cx), z: round(cz), w: round(w), d: round(d), yaw: Math.round(yaw * 1000) / 1000, k: s.k, h: s.h, ridge: s.ridge, roof: s.roof, rc: s.rc, n: s.n.trim() || undefined, level: s.level })
    this.changed()
  }

  private riverLevels(pts: LinePoint[]): [number, number] {
    const land = this.model.land!
    const at = (p: LinePoint) => land.waterAt(p.x, p.z) ?? p.h - 0.3
    const a = at(pts[0]), b = at(pts[pts.length - 1])
    return [a, Math.min(a, b)]
  }

  /** Light positions every `spacing` metres along a line, set off to the chosen side(s), arms facing the line. */
  lightRow(flat: number[]): { pts: number[]; yaw: number[] } {
    const s = this.model.settings.light
    const dense = densify(flat, 0.5)
    const total = lineLength(dense)
    const out = { pts: [] as number[], yaw: [] as number[] }
    if (total < 1) return out
    const sides = s.sides === 'both' ? [1, -1] : s.sides === 'left' ? [1] : [-1]
    const count = Math.max(1, Math.floor(total / Math.max(4, s.spacing)) + 1)
    const gap = count > 1 ? total / (count - 1) : 0
    for (let i = 0; i < count; i++) {
      const at = pointAlong(dense, Math.min(total, i * gap))
      for (const side of sides) {
        const nx = -at.tz * side, nz = at.tx * side
        out.pts.push(round(at.x + nx * s.offset), round(at.z + nz * s.offset))
        out.yaw.push(Math.round(Math.atan2(-nz, -nx) * 1000) / 1000)
      }
    }
    return out
  }

  // ------------------------------------------------------------ preview

  draw(g: CanvasRenderingContext2D, v: View): void {
    const land = this.model.land
    if (!land) return
    const t = this.tool
    const s = this.model.settings
    const color = toolColor(t)
    if (this.moving) {
      const m = this.moving
      const ring = m.b.p.map((val, k) => val + (k % 2 === 0 ? m.dx : m.dz))
      highlightRing(g, v, ring, '#ffcf3d')
    }
    if (this.stroke) drawShape(g, v, { k: 'path', pts: this.stroke, r: s.radius }, falloffFor(t, s.falloff), color)
    if (this.rect) {
      const r = this.rect
      if (t === 'building') {
        const yaw = s.building.yaw * (Math.PI / 180)
        const c = Math.cos(-yaw), sn = Math.sin(-yaw)
        const ax = r.x0 * c - r.z0 * sn, az = r.x0 * sn + r.z0 * c, bx = r.x1 * c - r.z1 * sn, bz = r.x1 * sn + r.z1 * c
        const lx = (ax + bx) / 2, lz = (az + bz) / 2
        const ring = rectRing(lx * Math.cos(yaw) - lz * Math.sin(yaw), lx * Math.sin(yaw) + lz * Math.cos(yaw), Math.abs(bx - ax) / 2, Math.abs(bz - az) / 2, yaw)
        highlightRing(g, v, ring, color)
      } else {
        const ring = [r.x0, r.z0, r.x1, r.z0, r.x1, r.z1, r.x0, r.z1]
        drawShape(g, v, { k: 'area', ring }, falloffFor(t, s.falloff), color)
      }
    }
    if (this.hover && !this.stroke && SHAPED_TOOLS.has(t) && s.shape === 'brush') drawCursorRing(g, v, this.hover.x, this.hover.z, s.radius, falloffFor(t, s.falloff), color)
    if (this.lotEdit) {
      highlightRing(g, v, this.lotEdit.ring, color)
      const pts: number[] = []
      for (let k = 0; k < this.lotEdit.ring.length; k++) pts.push(this.lotEdit.ring[k])
      drawHandles(g, v, pts, this.dragRing)
    }
    if (this.replacing) highlightRoad(g, v, this.replacing, '#ff6b4a')
    if (this.line.length) this.drawLine(g, v, color)
    else if (this.hover && LINE_TOOLS.has(t) && (t === 'road' || t === 'redraw') && s.road.snap) this.drawSnap(g, v, { x: this.hover.x, z: this.hover.z })
  }

  private drawSnap(g: CanvasRenderingContext2D, v: View, at: { x: number; z: number }): void {
    const hit = this.host.hits()?.snap(at.x, at.z, (PICK_PX + 4) / v.s, (r) => r !== this.replacing && r.k <= 3)
    if (!hit) return
    g.strokeStyle = hit.vertex ? '#ffcf3d' : '#22b8ff'
    g.lineWidth = 2
    g.beginPath()
    g.arc(toSX(v, hit.x), toSY(v, hit.z), 7, 0, Math.PI * 2)
    g.stroke()
  }

  private drawLine(g: CanvasRenderingContext2D, v: View, color: string): void {
    const t = this.tool
    const s = this.model.settings
    const flat = this.line.flatMap((p) => [p.x, p.z])
    const withHover = this.hover && this.dragPoint < 0 && !this.down ? [...flat, this.hover.x, this.hover.z] : flat
    g.lineCap = 'round'
    g.lineJoin = 'round'
    if (t === 'road' || t === 'redraw') {
      const r = s.road
      const centre = curveOf(withHover, r.curve, r.fit, 2)
      g.globalAlpha = 0.75
      g.strokeStyle = '#3b3b3f'
      g.lineWidth = Math.max(3, r.w * v.s)
      tracePath(g, v, centre)
      g.stroke()
      g.globalAlpha = 1
      g.strokeStyle = '#f5d76e'
      g.setLineDash([6, 6])
      g.lineWidth = 1.5
      g.stroke()
      g.setLineDash([])
      const d = r.w / 2 + r.walkGap + r.walkW / 2
      for (const [on, side] of [[r.walkLeft, 1], [r.walkRight, -1]] as const) {
        if (!on || withHover.length < 4) continue
        const walk = offsetCurve(withHover, d * side, r.curve, r.fit, 2)
        g.strokeStyle = 'rgba(232,228,214,.85)'
        g.lineWidth = Math.max(2, r.walkW * v.s)
        tracePath(g, v, walk)
        g.stroke()
      }
      if (r.grade) {
        g.strokeStyle = 'rgba(255,207,61,.25)'
        g.lineWidth = Math.max(2, (r.w + 2 * (r.shoulder + (r.walkLeft || r.walkRight ? r.walkGap + r.walkW : 0))) * v.s)
        tracePath(g, v, centre)
        g.stroke()
      }
    } else if (t === 'river') {
      const rv = s.river
      const centre = curveOf(withHover, rv.curve, rv.fit, 2)
      g.strokeStyle = 'rgba(120,170,120,.35)'
      g.lineWidth = Math.max(4, (rv.w + rv.bank * 2) * v.s)
      tracePath(g, v, centre)
      g.stroke()
      g.strokeStyle = 'rgba(64,124,180,.85)'
      g.lineWidth = Math.max(3, rv.w * v.s)
      g.stroke()
    } else if (t === 'grade') {
      drawShape(g, v, { k: 'path', pts: withHover, r: s.gradeHalf }, s.falloff, color)
    } else if (t === 'wall') {
      g.strokeStyle = WALL_COLOR[s.wall.style]
      g.lineWidth = Math.max(3, s.wall.th * v.s * 1.4)
      tracePath(g, v, withHover, s.wall.closed && withHover.length >= 6)
      g.stroke()
    } else if (t === 'rail') {
      g.strokeStyle = '#d9dde0'
      g.lineWidth = 3
      tracePath(g, v, withHover)
      g.stroke()
      this.drawSideTicks(g, v, withHover, s.rail.side)
    } else if (t === 'lot' || (SHAPED_TOOLS.has(t) && s.shape === 'area')) {
      tracePath(g, v, withHover, true)
      g.fillStyle = color + '33'
      g.fill()
      g.strokeStyle = color
      g.lineWidth = 2
      g.stroke()
    } else if (t === 'lightRow') {
      g.strokeStyle = color
      g.lineWidth = 2
      g.setLineDash([5, 5])
      tracePath(g, v, withHover)
      g.stroke()
      g.setLineDash([])
      const row = this.lightRow(withHover)
      g.fillStyle = '#ffd34d'
      for (let k = 0; k < row.pts.length; k += 2) {
        g.beginPath()
        g.arc(toSX(v, row.pts[k]), toSY(v, row.pts[k + 1]), 4, 0, Math.PI * 2)
        g.fill()
      }
    } else {
      g.strokeStyle = color
      g.lineWidth = 2
      tracePath(g, v, withHover)
      g.stroke()
    }
    drawHandles(g, v, flat, this.dragPoint)
    if (t === 'road' || t === 'redraw') {
      const last = this.hover && this.dragPoint < 0 ? this.hover : null
      if (last) this.drawSnap(g, v, last)
    }
  }

  private drawSideTicks(g: CanvasRenderingContext2D, v: View, p: number[], side: number): void {
    g.strokeStyle = '#ffcf3d'
    g.lineWidth = 1.5
    for (let k = 0; k + 3 < p.length; k += 2) {
      const mx = (p[k] + p[k + 2]) / 2, mz = (p[k + 1] + p[k + 3]) / 2
      const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1]
      const len = Math.hypot(dx, dz) || 1
      const nx = (dz / len) * side, nz = (-dx / len) * side
      g.beginPath()
      g.moveTo(toSX(v, mx), toSY(v, mz))
      g.lineTo(toSX(v, mx + nx * 12 / v.s), toSY(v, mz + nz * 12 / v.s))
      g.stroke()
    }
  }
}

function falloffFor(t: ToolId, falloff: number): number {
  return t === 'raise' || t === 'lower' || t === 'flatten' || t === 'smooth' || t === 'noise' ? falloff : 0
}

export function toolColor(t: ToolId): string {
  if (t === 'raise' || t === 'noise') return '#ff9f43'
  if (t === 'lower') return '#a66bff'
  if (t === 'flatten' || t === 'grade') return '#ffcf3d'
  if (t === 'smooth') return '#5fd3a6'
  if (t === 'fill' || t === 'level' || t === 'paint' || t === 'river') return '#3fa6ff'
  if (t === 'drain') return '#c99a5b'
  if (t === 'plant') return '#4cc35a'
  if (t === 'clear' || t === 'railCut' || t === 'lightCut' || t === 'roadRemove' || t === 'buildingRemove' || t === 'lotRemove') return '#ff5a5a'
  return '#22b8ff'
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

function pointAlong(p: number[], s: number): { x: number; z: number; tx: number; tz: number } {
  let acc = 0
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1]
    const len = Math.hypot(dx, dz)
    if (acc + len >= s || k + 4 >= p.length) {
      const t = len > 0 ? Math.min(1, (s - acc) / len) : 0
      return { x: p[k] + dx * t, z: p[k + 1] + dz * t, tx: dx / (len || 1), tz: dz / (len || 1) }
    }
    acc += len
  }
  return { x: p[0], z: p[1], tx: 1, tz: 0 }
}

export { highlightBuilding }
