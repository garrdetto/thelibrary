import * as THREE from 'three'
import type { TelloLand } from '../../../../modules-src/tello/region'
import { curveOf, densify, offsetCurve } from '../../../../modules-src/tello/edits/Geom'
import { rectRing } from '../../../../modules-src/tello/edits/Apply'
import type { EditorModel } from '../model'
import { LINE_TOOLS, SHAPED_TOOLS } from '../settings'
import { toolColor, type ToolRunner } from '../tools'
import { WALL_COLOR } from '../draw'

/**
 * What is being drawn, shown in the 3D view on top of the world: the road being plotted at its real width with its
 * sidewalks, river channels, walls at their real height, light poles, brush rings and outlines draped on the ground,
 * the points you can drag, and the selection.
 */
export class Draft3D {
  readonly group = new THREE.Group()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly mats = new Map<string, THREE.Material>()

  constructor() {
    this.group.name = 'world-editor-draft'
    this.group.renderOrder = 10
  }

  private mat(color: string, opacity: number, solid = false): THREE.Material {
    const key = `${color}|${opacity}|${solid}`
    let m = this.mats.get(key)
    if (!m) {
      m = solid
        ? new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity })
        : new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
      this.mats.set(key, m)
    }
    return m
  }

  clear(): void {
    for (const g of this.geometries) g.dispose()
    this.geometries.length = 0
    this.group.clear()
  }

  dispose(): void {
    this.clear()
    for (const m of this.mats.values()) m.dispose()
    this.mats.clear()
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, order = 20): void {
    this.geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = order
    mesh.frustumCulled = false
    this.group.add(mesh)
  }

  /** A flat band `width` metres wide along a line, a little over the ground. */
  private band(land: TelloLand, pts: ArrayLike<number>, width: number, color: string, opacity: number, lift = 0.35, closed = false): void {
    const line = closed && pts.length >= 6 ? [...Array.from(pts), pts[0], pts[1]] : Array.from(pts)
    const dense = densify(line, 2)
    const n = dense.length / 2
    if (n < 2) return
    const pos: number[] = []
    const idx: number[] = []
    const half = width / 2
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      const dx = dense[b * 2] - dense[a * 2], dz = dense[b * 2 + 1] - dense[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      const nx = -dz / len, nz = dx / len
      for (const side of [1, -1]) {
        const x = dense[i * 2] + nx * half * side, z = dense[i * 2 + 1] + nz * half * side
        pos.push(x, height(land, x, z) + lift, -z)
      }
      if (i > 0) {
        const k = i * 2
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    this.add(g, this.mat(color, opacity))
  }

  private ring(land: TelloLand, x: number, z: number, r: number, color: string, width: number, opacity = 0.9): void {
    const pts: number[] = []
    const steps = Math.max(24, Math.min(160, Math.ceil(r)))
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2
      pts.push(x + Math.cos(a) * r, z + Math.sin(a) * r)
    }
    this.band(land, pts, width, color, opacity, 0.4, true)
  }

  private handle(land: TelloLand, x: number, z: number, size: number, color: string): void {
    const g = new THREE.CylinderGeometry(size * 0.55, size * 0.55, size * 2.2, 12)
    g.translate(x, height(land, x, z) + size * 1.1, -z)
    this.add(g, this.mat(color, 0.95), 30)
  }

  private posts(land: TelloLand, pts: number[], h: number): void {
    for (let k = 0; k + 1 < pts.length; k += 2) {
      const g = new THREE.CylinderGeometry(0.12, 0.16, h, 8)
      g.translate(pts[k], height(land, pts[k], pts[k + 1]) + h / 2, -pts[k + 1])
      this.add(g, this.mat('#2a2c30', 1, true), 0)
      const head = new THREE.SphereGeometry(0.35, 10, 8)
      head.translate(pts[k], height(land, pts[k], pts[k + 1]) + h, -pts[k + 1])
      this.add(head, this.mat('#ffd34d', 1, true), 0)
    }
  }

  private walls(land: TelloLand, pts: number[], h: number, th: number, color: string): void {
    const dense = densify(pts, 2)
    for (let k = 0; k + 3 < dense.length; k += 2) {
      const ax = dense[k], az = dense[k + 1], bx = dense[k + 2], bz = dense[k + 3]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.05) continue
      const y = Math.min(height(land, ax, az), height(land, bx, bz))
      const g = new THREE.BoxGeometry(len, h, th)
      g.rotateY(Math.atan2(bz - az, bx - ax))
      g.translate((ax + bx) / 2, y + h / 2, -(az + bz) / 2)
      this.add(g, this.mat(color, 0.85, true), 0)
    }
  }

  /** Rebuilds everything from the runner's gesture, the tool settings and the selection. `px` is metres a screen pixel near the target. */
  update(runner: ToolRunner, model: EditorModel, land: TelloLand, px: number): void {
    this.clear()
    const t = model.tool
    const s = model.settings
    const color = toolColor(t)
    const thin = Math.max(0.25, px * 2.5)
    const handle = Math.max(0.6, px * 5)
    const sel = model.selection
    if (sel?.kind === 'road') { const r = land.doc.roads.find((x) => x.id === sel.id); if (r) this.band(land, r.p, r.w + thin * 2, '#22b8ff', 0.45) }
    if (sel?.kind === 'building') { const b = land.doc.buildings.find((x) => x.id === sel.id); if (b) this.band(land, b.p, thin * 1.5, '#22b8ff', 0.95, 0.6, true) }
    if (sel?.kind === 'lot') { const l = land.doc.lots.find((x) => x.id === sel.id); if (l) this.band(land, l.p, thin * 1.5, '#22b8ff', 0.95, 0.5, true) }
    const moving = runner.movingBuilding
    if (moving) this.band(land, moving.b.p.map((v, k) => v + (k % 2 === 0 ? moving.dx : moving.dz)), thin * 1.6, '#ffcf3d', 0.95, 0.6, true)
    if (runner.replacing) this.band(land, runner.replacing.p, runner.replacing.w + thin * 2, '#ff6b4a', 0.4)
    const hover = runner.hover
    if (runner.stroke) this.band(land, runner.stroke, s.radius * 2, color, 0.28)
    if (runner.rect) {
      const r = runner.rect
      if (t === 'building') {
        const yaw = (s.building.yaw * Math.PI) / 180
        const c = Math.cos(-yaw), sn = Math.sin(-yaw)
        const ax = r.x0 * c - r.z0 * sn, az = r.x0 * sn + r.z0 * c, bx = r.x1 * c - r.z1 * sn, bz = r.x1 * sn + r.z1 * c
        const lx = (ax + bx) / 2, lz = (az + bz) / 2
        const ring = rectRing(lx * Math.cos(yaw) - lz * Math.sin(yaw), lx * Math.sin(yaw) + lz * Math.cos(yaw), Math.abs(bx - ax) / 2, Math.abs(bz - az) / 2, yaw)
        this.walls(land, [...ring, ring[0], ring[1]], s.building.h, 0.3, '#d8c7ae')
      } else this.band(land, [r.x0, r.z0, r.x1, r.z0, r.x1, r.z1, r.x0, r.z1], thin * 1.5, color, 0.95, 0.4, true)
    }
    if (hover && !runner.stroke && SHAPED_TOOLS.has(t) && s.shape === 'brush') {
      this.ring(land, hover.x, hover.z, s.radius, color, thin * 1.4)
      const fade = t === 'raise' || t === 'lower' || t === 'flatten' || t === 'smooth' || t === 'noise' ? s.falloff : 0
      if (fade > 0) this.ring(land, hover.x, hover.z, s.radius + fade, color, thin * 0.8, 0.45)
    }
    if (runner.lotEdit) {
      const ring = runner.lotEdit.ring
      this.band(land, ring, thin * 1.6, color, 0.95, 0.5, true)
      for (let k = 0; k + 1 < ring.length; k += 2) this.handle(land, ring[k], ring[k + 1], handle, '#ffffff')
    }
    const flat = runner.linePoints
    if (!flat.length) return
    const withHover = hover && runner.dragging < 0 && !runner.pressed ? [...flat, hover.x, hover.z] : flat
    if (t === 'road' || t === 'redraw') {
      const r = s.road
      const centre = curveOf(withHover, r.curve, r.fit, 2)
      if (r.grade) {
        const reach = r.w + 2 * (r.shoulder + (r.walkLeft || r.walkRight ? r.walkGap + r.walkW : 0))
        this.band(land, centre, reach, '#ffcf3d', 0.18, 0.2)
      }
      this.band(land, centre, r.w, '#3a3b40', 0.85, 0.3)
      this.band(land, centre, Math.max(0.15, thin * 0.6), '#f5d76e', 0.95, 0.36)
      const d = r.w / 2 + r.walkGap + r.walkW / 2
      for (const [on, side] of [[r.walkLeft, 1], [r.walkRight, -1]] as const) if (on && withHover.length >= 4) this.band(land, offsetCurve(withHover, d * side, r.curve, r.fit, 2), r.walkW, '#d9d5c8', 0.9, 0.42)
    } else if (t === 'river') {
      const rv = s.river
      const centre = curveOf(withHover, rv.curve, rv.fit, 2)
      this.band(land, centre, rv.w + rv.bank * 2, '#7fae6a', 0.3, 0.25)
      this.band(land, centre, rv.w, '#3f7fbf', 0.8, 0.3)
    } else if (t === 'wall') {
      const pts = s.wall.closed && withHover.length >= 6 ? [...withHover, withHover[0], withHover[1]] : withHover
      this.walls(land, pts, s.wall.h, Math.max(0.08, s.wall.th), WALL_COLOR[s.wall.style])
    } else if (t === 'rail') {
      this.walls(land, withHover, 0.8, 0.12, '#c9ced1')
    } else if (t === 'grade') {
      this.band(land, withHover, s.gradeHalf * 2, color, 0.3)
    } else if (t === 'lightRow') {
      this.band(land, withHover, thin, color, 0.9)
      this.posts(land, runner.lightRow(withHover).pts, s.light.h)
    } else if (t === 'lot' || (SHAPED_TOOLS.has(t) && s.shape === 'area')) {
      this.band(land, withHover, thin * 1.5, color, 0.95, 0.4, withHover.length >= 6)
    } else if (LINE_TOOLS.has(t)) {
      this.band(land, withHover, thin, color, 0.9)
    }
    for (let k = 0; k + 1 < flat.length; k += 2) this.handle(land, flat[k], flat[k + 1], handle, k / 2 === runner.dragging ? '#ffcf3d' : '#ffffff')
  }
}

function height(land: TelloLand, x: number, z: number): number {
  return land.inside(x, z) ? land.heightAt(x, z) : 0
}
