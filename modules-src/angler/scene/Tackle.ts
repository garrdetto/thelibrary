/** Rod, line, bobber and water ripples: a bending rod mesh rebuilt each frame from the hand, a sagging line drawn to the lure, a bobbing float and expanding rings on the water. */
import * as pc from 'playcanvas'
import { GeoBuilder, vertexColorMaterial } from './Geo'
import type { Rgb } from './Geo'

const SEGMENTS = 10
const SIDES = 6

export class Rod {
  readonly entity: pc.Entity
  private readonly mesh: pc.Mesh
  private readonly positions: Float32Array
  private readonly normals: Float32Array
  readonly tip = new pc.Vec3()
  private readonly points: pc.Vec3[] = Array.from({ length: SEGMENTS + 1 }, () => new pc.Vec3())

  constructor(app: pc.AppBase, private length: number, color: Rgb) {
    const verts = (SEGMENTS + 1) * SIDES
    this.positions = new Float32Array(verts * 3)
    this.normals = new Float32Array(verts * 3)
    const colors = new Uint8Array(verts * 4)
    const idx: number[] = []
    for (let s = 0; s <= SEGMENTS; s++) for (let k = 0; k < SIDES; k++) {
      const i = s * SIDES + k
      const t = s / SEGMENTS
      const c: Rgb = t < 0.16 ? [0.62, 0.5, 0.34] : t < 0.19 ? [0.08, 0.08, 0.08] : color
      colors[i * 4] = Math.round(c[0] * 255); colors[i * 4 + 1] = Math.round(c[1] * 255); colors[i * 4 + 2] = Math.round(c[2] * 255); colors[i * 4 + 3] = 255
    }
    for (let s = 0; s < SEGMENTS; s++) for (let k = 0; k < SIDES; k++) {
      const a = s * SIDES + k, b = s * SIDES + ((k + 1) % SIDES), c = a + SIDES, d = b + SIDES
      idx.push(a, c, b, b, c, d)
    }
    this.mesh = new pc.Mesh(app.graphicsDevice)
    this.mesh.setPositions(this.positions)
    this.mesh.setNormals(this.normals)
    this.mesh.setColors32(colors)
    this.mesh.setIndices(idx)
    this.mesh.update()
    this.entity = new pc.Entity('rod')
    const mi = new pc.MeshInstance(this.mesh, vertexColorMaterial({ gloss: 0.6, cull: pc.CULLFACE_NONE }))
    mi.cull = false
    this.entity.addComponent('render', { meshInstances: [mi], castShadows: true })
    const reel = new GeoBuilder()
    reel.cylinder([0.12, 0.12, 0.13], 0.03, 0.03, 10, { pos: [0, 0, 0], rot: [0, 0, 90], scale: [1, 0.05, 1] })
    reel.box([0.2, 0.2, 0.22], { pos: [0, 0.03, 0], scale: [0.02, 0.05, 0.02] })
    this.reel = new pc.Entity('reel')
    this.reel.addComponent('render', { meshInstances: [new pc.MeshInstance(reel.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.7, metalness: 0.6 }))], castShadows: false })
    this.entity.addChild(this.reel)
  }

  private readonly reel: pc.Entity

  /** Builds the rod in world space from the grip along a direction, bent toward the pull. */
  update(grip: pc.Vec3, direction: pc.Vec3, pull: pc.Vec3, load: number): void {
    const dir = direction.clone().normalize()
    const bend = Math.min(1.2, load)
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS
      const along = this.length * t
      const sag = bend * this.length * 0.32 * t * t
      this.points[s].set(grip.x + dir.x * along + pull.x * sag, grip.y + dir.y * along + pull.y * sag - 0.02 * t * t, grip.z + dir.z * along + pull.z * sag)
    }
    const up = new pc.Vec3(0, 1, 0)
    for (let s = 0; s <= SEGMENTS; s++) {
      const p = this.points[s]
      const next = this.points[Math.min(SEGMENTS, s + 1)], prev = this.points[Math.max(0, s - 1)]
      const tan = next.clone().sub(prev).normalize()
      const side = new pc.Vec3().cross(tan, Math.abs(tan.y) > 0.95 ? new pc.Vec3(1, 0, 0) : up).normalize()
      const nrm = new pc.Vec3().cross(side, tan).normalize()
      const r = 0.009 * (1 - s / SEGMENTS) + 0.0016
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2
        const ox = side.x * Math.cos(a) + nrm.x * Math.sin(a), oy = side.y * Math.cos(a) + nrm.y * Math.sin(a), oz = side.z * Math.cos(a) + nrm.z * Math.sin(a)
        const i = (s * SIDES + k) * 3
        this.positions[i] = p.x + ox * r; this.positions[i + 1] = p.y + oy * r; this.positions[i + 2] = p.z + oz * r
        this.normals[i] = ox; this.normals[i + 1] = oy; this.normals[i + 2] = oz
      }
    }
    this.mesh.setPositions(this.positions)
    this.mesh.setNormals(this.normals)
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false)
    this.tip.copy(this.points[SEGMENTS])
    const reelPos = this.points[2]
    this.reel.setPosition(reelPos.x - up.x * 0.035, reelPos.y - 0.035, reelPos.z)
    this.reel.lookAt(this.points[3])
  }

  set visible(on: boolean) {
    this.entity.enabled = on
  }

  destroy(): void {
    this.entity.destroy()
    this.mesh.destroy()
  }
}

export class Bobber {
  readonly entity: pc.Entity

  constructor(app: pc.AppBase) {
    const g = new GeoBuilder()
    g.blob((n: [number, number, number]) => (n[1] > 0 ? [0.95, 0.95, 0.92] : [0.85, 0.08, 0.06]), { scale: [0.055, 0.055, 0.055] }, 6, 0)
    g.cylinder([0.9, 0.9, 0.88], 0.004, 0.003, 5, { pos: [0, 0.025, 0], scale: [1, 0.05, 1] }, false)
    this.entity = new pc.Entity('bobber')
    this.entity.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(app.graphicsDevice), vertexColorMaterial({ gloss: 0.7 }))], castShadows: false })
  }
}

interface Ripple { entity: pc.Entity; material: pc.StandardMaterial; age: number; life: number; size: number }

export class Ripples {
  private readonly pool: Ripple[] = []
  private readonly mesh: pc.Mesh
  readonly root = new pc.Entity('ripples')

  constructor(app: pc.AppBase) {
    const g = new GeoBuilder()
    const segs = 32
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2
      g.positions.push(Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86, Math.cos(a), 0, Math.sin(a))
      g.normals.push(0, 1, 0, 0, 1, 0)
      g.colors.push(1, 1, 1, 1, 1, 1)
      g.uvs.push(0, 0, 0, 0)
    }
    for (let s = 0; s < segs; s++) { const a = s * 2; g.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    this.mesh = g.toMesh(app.graphicsDevice)
  }

  spawn(x: number, z: number, size = 1, life = 1.6): void {
    let r = this.pool.find(p => p.age >= p.life)
    if (!r) {
      const material = new pc.StandardMaterial()
      material.diffuse = new pc.Color(0, 0, 0)
      material.emissive = new pc.Color(0.85, 0.9, 0.92)
      material.useLighting = false
      material.blendType = pc.BLEND_NORMAL
      material.depthWrite = false
      material.opacity = 0.5
      material.update()
      const entity = new pc.Entity('ripple')
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.mesh, material)], castShadows: false })
      this.root.addChild(entity)
      r = { entity, material, age: 0, life, size }
      this.pool.push(r)
    }
    r.age = 0
    r.life = life
    r.size = size
    r.entity.enabled = true
    r.entity.setPosition(x, 0.03, z)
  }

  update(dt: number): void {
    for (const r of this.pool) {
      if (r.age >= r.life) { r.entity.enabled = false; continue }
      r.age += dt
      const t = Math.min(1, r.age / r.life)
      const s = r.size * (0.15 + t * 1.2)
      r.entity.setLocalScale(s, 1, s)
      r.material.opacity = 0.45 * (1 - t) * (1 - t)
      r.material.update()
    }
  }
}

interface Drop { entity: pc.Entity; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; age: number; life: number }

const DROP_LIMIT = 140

/** Water droplets thrown up by casts, strikes, runs, jumps and landed fish: small bright beads on a ballistic arc that shrink as they fall back. */
export class Splashes {
  readonly root = new pc.Entity('splashes')
  private readonly pool: Drop[] = []
  private readonly mesh: pc.Mesh
  private readonly material: pc.StandardMaterial

  constructor(app: pc.AppBase) {
    const g = new GeoBuilder()
    g.blob(() => [1, 1, 1], { scale: [1, 1, 1] }, 4, 0)
    this.mesh = g.toMesh(app.graphicsDevice)
    const m = new pc.StandardMaterial()
    m.diffuse = new pc.Color(0.75, 0.86, 0.92)
    m.emissive = new pc.Color(0.55, 0.65, 0.7)
    m.specular = new pc.Color(1, 1, 1)
    m.gloss = 0.95
    m.blendType = pc.BLEND_NORMAL
    m.opacity = 0.85
    m.depthWrite = false
    m.update()
    this.material = m
  }

  /** Throws `count` droplets up from the water at x, z; `power` scales their height and spread. */
  spawn(x: number, z: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      let d = this.pool.find(p => p.age >= p.life)
      if (!d) {
        if (this.pool.length >= DROP_LIMIT) return
        const entity = new pc.Entity('drop')
        entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.mesh, this.material)], castShadows: false })
        this.root.addChild(entity)
        d = { entity, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: 1, life: 0 }
        this.pool.push(d)
      }
      const a = Math.random() * Math.PI * 2
      const out = (0.4 + Math.random() * 1.6) * power
      Object.assign(d, { x: x + Math.cos(a) * 0.1, y: 0.02, z: z + Math.sin(a) * 0.1, vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: (1.6 + Math.random() * 2.6) * Math.sqrt(power), size: (0.018 + Math.random() * 0.03) * Math.min(1.6, 0.7 + power * 0.3), age: 0, life: 2 })
      d.entity.enabled = true
    }
  }

  update(dt: number): void {
    for (const d of this.pool) {
      if (d.age >= d.life) { if (d.entity.enabled) d.entity.enabled = false; continue }
      d.age += dt
      d.vy -= 9.8 * dt
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt
      if (d.y < 0 && d.vy < 0) { d.age = d.life; continue }
      const s = d.size * (1 - Math.min(1, d.age / 1.4) * 0.5)
      d.entity.setPosition(d.x, d.y, d.z)
      d.entity.setLocalScale(s, s * 1.3, s)
    }
  }
}

/** Draws a sagging fishing line between two world points with immediate-mode lines. */
export function drawLine(app: pc.AppBase, from: pc.Vec3, to: pc.Vec3, tension: number, color = new pc.Color(0.85, 0.88, 0.85, 0.9)): void {
  const segments = 12
  const pts: pc.Vec3[] = []
  const dist = from.distance(to)
  const sag = (1 - Math.min(1, tension)) * dist * 0.08
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = new pc.Vec3().lerp(from, to, t)
    p.y -= Math.sin(t * Math.PI) * sag
    if (p.y < 0.01 && i < segments) p.y = Math.max(p.y, to.y)
    pts.push(p)
  }
  const positions: pc.Vec3[] = []
  for (let i = 0; i < segments; i++) positions.push(pts[i], pts[i + 1])
  app.drawLines(positions, positions.map(() => color), true)
}
