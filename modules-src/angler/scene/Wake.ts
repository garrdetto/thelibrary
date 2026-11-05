/** A boat's wake on the water: two foam arms spreading out in a V from the hull, prop wash down the middle and a bow wave that rises with speed, all fading with age. One dynamic mesh per boat, rebuilt each frame from a ring of samples dropped at the stern. */
import * as pc from 'playcanvas'
import type { BoatSpec } from '../shared/Boats'
import { clamp, hash2 } from '../shared/Random'

const SAMPLES = 56
const LIFE = 9
const EMIT = 0.12
const Y = 0.035
/** Arm spread in metres per second of age (Kelvin wake angle, about 19.5° each side). */
const SPREAD = 0.354

interface Sample { x: number; z: number; rx: number; rz: number; age: number; strength: number; seed: number; v: number }

let shared: pc.StandardMaterial | null = null

function material(): pc.StandardMaterial {
  if (shared) return shared
  const m = new pc.StandardMaterial()
  m.diffuse = new pc.Color(0, 0, 0)
  m.emissive = new pc.Color(0.95, 0.98, 1)
  m.emissiveVertexColor = true
  m.useLighting = false
  m.opacityVertexColor = true
  m.opacityVertexColorChannel = 'a'
  m.blendType = pc.BLEND_NORMAL
  m.depthWrite = false
  m.cull = pc.CULLFACE_NONE
  m.update()
  shared = m
  return m
}

export class Wake {
  readonly entity: pc.Entity
  private readonly mesh: pc.Mesh
  private readonly samples: Sample[] = []
  private readonly positions: Float32Array
  private readonly colors: Uint8Array
  private emitTimer = 0
  private seed = 0
  /** Strips: left arm, right arm, centre wash, each SAMPLES × 3 vertices (soft edge, crest, soft edge); then a bow wave of 2 × 6 vertices. */
  private static readonly VERTS = SAMPLES * 3 * 3 + 12

  constructor(app: pc.AppBase, private spec: BoatSpec) {
    const n = Wake.VERTS
    this.positions = new Float32Array(n * 3)
    this.colors = new Uint8Array(n * 4)
    const normals = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1
    const idx: number[] = []
    for (let strip = 0; strip < 3; strip++) {
      const b = strip * SAMPLES * 3
      for (let i = 0; i < SAMPLES - 1; i++) for (let k = 0; k < 2; k++) {
        const a = b + i * 3 + k, c = a + 3
        idx.push(a, c, a + 1, a + 1, c, c + 1)
      }
    }
    const bow = SAMPLES * 9
    for (let side = 0; side < 2; side++) for (let i = 0; i < 2; i++) {
      const a = bow + side * 6 + i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    this.mesh = new pc.Mesh(app.graphicsDevice)
    this.mesh.setPositions(this.positions)
    this.mesh.setNormals(normals)
    this.mesh.setColors32(this.colors)
    this.mesh.setIndices(new Uint16Array(idx))
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false)
    this.entity = new pc.Entity('wake')
    const mi = new pc.MeshInstance(this.mesh, material())
    mi.cull = false
    mi.castShadow = false
    this.entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false })
  }

  setSpec(spec: BoatSpec): void {
    this.spec = spec
  }

  clear(): void {
    this.samples.length = 0
  }

  /** x, z and heading of the boat; speed in m/s (negative when reversing). */
  update(dt: number, x: number, z: number, heading: number, speed: number, visible: boolean): void {
    for (const s of this.samples) s.age += dt
    while (this.samples.length && this.samples[this.samples.length - 1].age > LIFE) this.samples.pop()
    const fx = -Math.sin(heading), fz = -Math.cos(heading)
    const rx = Math.cos(heading), rz = -Math.sin(heading)
    const v = Math.abs(speed)
    const strength = clamp((v - 0.6) / 6, 0, 1)
    this.emitTimer += dt
    if (this.emitTimer >= EMIT) {
      this.emitTimer = 0
      if (strength > 0 || this.samples.length) {
        const stern = this.spec.halfLength * (speed >= 0 ? 0.92 : -0.9)
        this.samples.unshift({ x: x - fx * stern, z: z - fz * stern, rx, rz, age: 0, strength, seed: this.seed++, v })
        if (this.samples.length > SAMPLES) this.samples.length = SAMPLES
      }
    }
    this.entity.enabled = visible && this.samples.some(s => s.strength > 0)
    if (!this.entity.enabled) return
    this.build(x, z, fx, fz, rx, rz, strength)
  }

  private build(x: number, z: number, fx: number, fz: number, rx: number, rz: number, strength: number): void {
    const P = this.positions, C = this.colors
    const beam = this.spec.halfBeam
    const set = (i: number, px: number, pz: number, alpha: number) => {
      P[i * 3] = px; P[i * 3 + 1] = Y; P[i * 3 + 2] = pz
      C[i * 4] = 255; C[i * 4 + 1] = 255; C[i * 4 + 2] = 255; C[i * 4 + 3] = Math.round(clamp(alpha, 0, 1) * 255)
    }
    for (let i = 0; i < SAMPLES; i++) {
      const s = this.samples[Math.min(i, this.samples.length - 1)]
      const live = i < this.samples.length && s
      const t = live ? s.age / LIFE : 1
      const fade = live ? (1 - t) * (1 - t) * s.strength * Math.min(1, s.age * 4) : 0
      const noise = live ? 0.88 + 0.12 * hash2(s.seed, 7, 3) : 0
      const spread = live ? beam * 0.85 + s.age * SPREAD * Math.max(1.5, s.v) : 0
      const width = live ? 0.6 + s.age * 0.55 : 0
      const sx = live ? s.x : x, sz = live ? s.z : z
      const srx = live ? s.rx : rx, srz = live ? s.rz : rz
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1
        const base = (side * SAMPLES + i) * 3
        const at = (d: number) => [sx + srx * d * sign, sz + srz * d * sign] as const
        const [ax, az] = at(spread - width * 0.6), [bx, bz] = at(spread), [cx, cz] = at(spread + width * 0.4)
        set(base, ax, az, 0)
        set(base + 1, bx, bz, fade * 0.95 * noise)
        set(base + 2, cx, cz, 0)
      }
      const wash = live ? beam * (0.6 + s.age * 0.3) : 0
      const washFade = live ? Math.max(0, 1 - s.age / (LIFE * 0.5)) ** 2 * s.strength * 0.75 * noise : 0
      const cb = (2 * SAMPLES + i) * 3
      set(cb, sx - srx * wash, sz - srz * wash, 0)
      set(cb + 1, sx, sz, washFade)
      set(cb + 2, sx + srx * wash, sz + srz * wash, 0)
    }
    const bow = SAMPLES * 9
    const L = this.spec.halfLength
    const reach = 0.4 + strength * 1.6
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1
      for (let k = 0; k < 3; k++) {
        const along = L * (0.95 - k * 0.45)
        const out = beam * (0.35 + k * 0.32)
        const px = x + fx * along + rx * out * sign, pz = z + fz * along + rz * out * sign
        const i = bow + side * 6 + k * 2
        set(i, px, pz, strength * (0.5 - k * 0.12))
        set(i + 1, px + rx * reach * sign - fx * reach * 0.4, pz + rz * reach * sign - fz * reach * 0.4, 0)
      }
    }
    this.mesh.setPositions(P)
    this.mesh.setColors32(C)
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false)
  }

  destroy(): void {
    this.entity.destroy()
    this.mesh.destroy()
  }
}
