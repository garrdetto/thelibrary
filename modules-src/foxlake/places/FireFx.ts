/**
 * A house fire and the hose that puts it out: flames (additive), smoke and
 * hose water (blended), pooled into two camera-facing quad meshes rewritten
 * each frame, on the soft round sprite shader Rack & Reel's lake spray uses.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EngineContext } from '../../rackreel/core/EngineSetup'
import { fxMaterial, quadMesh } from '../../rackreel/systems/FishingFx'

/** The roof of a burning house, in scene coordinates: centre, top, half sizes along its own axes and their yaw. */
export interface Blaze {
  x: number
  y: number
  z: number
  a: number
  b: number
  yaw: number
}

interface Puff {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  size: number
  grow: number
  kind: 0 | 1 | 2
  shade: number
}

const MAX_FLAMES = 260
const MAX_HAZE = 360
const WIND = { x: 1.1, z: 0.45 }

export class FireFx {
  private readonly flames: Puff[] = []
  private readonly haze: Puff[] = []
  private readonly spare: Puff[] = []
  private readonly flameMesh: Mesh
  private readonly flamePos: Float32Array
  private readonly flameCol: Float32Array
  private readonly hazeMesh: Mesh
  private readonly hazePos: Float32Array
  private readonly hazeCol: Float32Array
  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private blaze: Blaze | null = null
  private flameDue = 0
  private smokeDue = 0
  private waterDue = 0
  private live = false
  /** How hard the fire burns, 0 (out) to 1. */
  strength = 1
  /** The hose stream while the player sprays: nozzle and the spot it is aimed at (scene coordinates). */
  hose: { from: Vector3; to: Vector3 } | null = null

  constructor(ctx: EngineContext, scene: Scene) {
    const f = quadMesh('fl-fire-flames', MAX_FLAMES, scene)
    this.flameMesh = f.mesh
    this.flamePos = f.positions
    this.flameCol = f.colors
    this.flameMesh.material = fxMaterial('fl-fire-flame-mat', 'rrSpray', scene, true)
    const h = quadMesh('fl-fire-haze', MAX_HAZE, scene)
    this.hazeMesh = h.mesh
    this.hazePos = h.positions
    this.hazeCol = h.colors
    this.hazeMesh.material = fxMaterial('fl-fire-haze-mat', 'rrSpray', scene, false)
    this.hazeMesh.alphaIndex = this.flameMesh.alphaIndex - 1
    ctx.registerDynamic(this.flameMesh)
    ctx.registerDynamic(this.hazeMesh)
  }

  /** Starts a fire on a roof, or lets the one burning die down (null). */
  setBlaze(blaze: Blaze | null): void {
    this.blaze = blaze
    if (blaze) this.strength = 1
  }

  get burning(): boolean {
    return !!this.blaze
  }

  /** The roof that is burning, if any. */
  get current(): Blaze | null {
    return this.blaze
  }

  update(dt: number, camera: Camera): void {
    const b = this.blaze
    if (b && this.strength > 0.02) {
      const c = Math.cos(b.yaw)
      const s = Math.sin(b.yaw)
      this.flameDue += dt * (40 + 140 * this.strength) * Math.min(1.6, Math.max(0.6, (b.a * b.b) / 30))
      while (this.flameDue >= 1) {
        this.flameDue -= 1
        const u = (Math.random() * 2 - 1) * b.a
        const v = (Math.random() * 2 - 1) * b.b
        const big = 0.6 + this.strength * 0.8
        this.spawn(this.flames, MAX_FLAMES, 0, b.x + u * c - v * s, b.y - 0.6 + Math.random() * 0.8, b.z + u * s + v * c, (Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 2.4 * big, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.7, (0.5 + Math.random() * 0.9) * big, -0.5, Math.random())
      }
    }
    if (b) {
      this.smokeDue += dt * (6 + 14 * this.strength)
      while (this.smokeDue >= 1) {
        this.smokeDue -= 1
        const u = (Math.random() * 2 - 1) * b.a * 0.7
        const v = (Math.random() * 2 - 1) * b.b * 0.7
        const steam = 1 - this.strength
        this.spawn(this.haze, MAX_HAZE, 1, b.x + u, b.y + 0.8, b.z + v, WIND.x * 0.4, 2.2 + Math.random() * 1.6, WIND.z * 0.4, 4 + Math.random() * 3.5, 1.4 + Math.random() * 1.2, 1.2 + Math.random() * 0.6, steam)
      }
    }
    if (this.hose) {
      const { from, to } = this.hose
      const t = 0.85
      this.waterDue += dt * 90
      while (this.waterDue >= 1) {
        this.waterDue -= 1
        const j = 0.35
        this.spawn(this.haze, MAX_HAZE, 2, from.x, from.y, from.z, (to.x - from.x) / t + (Math.random() - 0.5) * j * 3, (to.y - from.y) / t + 4.9 * t + (Math.random() - 0.5) * j * 3, (to.z - from.z) / t + (Math.random() - 0.5) * j * 3, t * (0.95 + Math.random() * 0.25), 0.1 + Math.random() * 0.14, 0.7, Math.random())
      }
    } else this.waterDue = 0
    this.step(this.flames, dt)
    this.step(this.haze, dt)
    const busy = this.flames.length > 0 || this.haze.length > 0
    if (!busy && !this.live) return
    this.live = busy
    const m = camera.getViewMatrix().m
    this.right.set(m[0], m[4], m[8])
    this.up.set(m[1], m[5], m[9])
    this.write(this.flames, this.flamePos, this.flameCol, MAX_FLAMES)
    this.write(this.haze, this.hazePos, this.hazeCol, MAX_HAZE)
    this.flameMesh.updateVerticesData(VertexBuffer.PositionKind, this.flamePos)
    this.flameMesh.updateVerticesData(VertexBuffer.ColorKind, this.flameCol)
    this.hazeMesh.updateVerticesData(VertexBuffer.PositionKind, this.hazePos)
    this.hazeMesh.updateVerticesData(VertexBuffer.ColorKind, this.hazeCol)
  }

  private spawn(list: Puff[], max: number, kind: 0 | 1 | 2, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, shade: number): void {
    if (list.length >= max) return
    const p = this.spare.pop() ?? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, grow: 0, kind: 0, shade: 0 }
    p.x = x
    p.y = y
    p.z = z
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.age = 0
    p.life = life
    p.size = size
    p.grow = grow
    p.kind = kind
    p.shade = shade
    list.push(p)
  }

  private step(list: Puff[], dt: number): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]
      p.age += dt
      if (p.age >= p.life) {
        list[i] = list[list.length - 1]
        list.pop()
        this.spare.push(p)
        continue
      }
      if (p.kind === 2) p.vy -= 9.8 * dt
      else if (p.kind === 1) {
        p.vx += (WIND.x - p.vx) * dt * 0.4
        p.vz += (WIND.z - p.vz) * dt * 0.4
        p.vy *= Math.max(0, 1 - dt * 0.25)
      } else p.vy += dt * 1.5
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
    }
  }

  private write(list: Puff[], pos: Float32Array, col: Float32Array, max: number): void {
    pos.fill(0)
    col.fill(0)
    const n = Math.min(list.length, max)
    for (let i = 0; i < n; i++) {
      const p = list[i]
      const t = p.age / p.life
      const s = Math.max(0.02, p.size + p.grow * t * p.size)
      const rx = this.right.x * s, ry = this.right.y * s, rz = this.right.z * s
      const ux = this.up.x * s, uy = this.up.y * s, uz = this.up.z * s
      const o = i * 12
      pos[o] = p.x - rx - ux; pos[o + 1] = p.y - ry - uy; pos[o + 2] = p.z - rz - uz
      pos[o + 3] = p.x + rx - ux; pos[o + 4] = p.y + ry - uy; pos[o + 5] = p.z + rz - uz
      pos[o + 6] = p.x + rx + ux; pos[o + 7] = p.y + ry + uy; pos[o + 8] = p.z + rz + uz
      pos[o + 9] = p.x - rx + ux; pos[o + 10] = p.y - ry + uy; pos[o + 11] = p.z - rz + uz
      let r: number, g: number, b: number, a: number
      if (p.kind === 0) {
        const hot = 1 - t
        r = 1
        g = 0.25 + 0.6 * hot * hot + p.shade * 0.08
        b = 0.05 + 0.3 * hot * hot * hot
        a = Math.min(1, t * 10) * (1 - t) * 0.7
      } else if (p.kind === 1) {
        const grey = 0.14 + 0.5 * p.shade + 0.12 * t
        r = grey
        g = grey
        b = grey * 1.04
        a = Math.min(1, t * 4) * (1 - t) * (0.55 - 0.2 * p.shade)
      } else {
        r = 0.82
        g = 0.9
        b = 0.97
        a = 0.75 * (1 - t * 0.6)
      }
      for (let k = 0; k < 4; k++) {
        const c = i * 16 + k * 4
        col[c] = r
        col[c + 1] = g
        col[c + 2] = b
        col[c + 3] = a
      }
    }
  }
}
