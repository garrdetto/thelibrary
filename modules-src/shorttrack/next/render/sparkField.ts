/**
 * Sparks from metal grinding on a wall or another car. Looks only: they are simulated on the page from the sim's
 * `sparks` and `impact` events, never touch a car and differ between peers. Each spark is a hot steel particle that
 * flies under gravity and air drag, bounces on the track surface under the contact, cools from white-yellow through
 * orange to dull red, and now and then bursts into a few short-lived branches the way carbon steel sparks fork.
 * Renderer-free: `next/render/sparks.ts` draws it on Babylon and the classic three.js renderer draws thin lines.
 */
export const SPARKS = {
  capacity: 1024,
  flashes: 16,
  gravity: 9.81,
  /** Air drag, 1/s, plus `dragSpeed` per m/s: light particles lose their speed quickly. */
  drag: 1.3,
  dragSpeed: 0.035,
  /** How long the eye or a camera smears a moving spark, seconds. */
  exposure: 1 / 52,
  maxStreak: 1,
  /** Linear HDR brightness of a fresh spark. */
  peak: 16,
  forkShare: 0.16,
  /** The sim's step, seconds: a scrape's sparks are spread back over the ground covered in one step. */
  tick: 1 / 120,
}

/** The track surface under a contact as a plane: unit normal and height at (x, z). */
export type SparkGround = { x: number; y: number; z: number; nx: number; ny: number; nz: number }

export type SparkKind = 'wall' | 'car'

type Flash = { x: number; y: number; z: number; life: number; span: number; radius: number; glow: number }

/** Linear RGB of steel at `heat` (1 fresh, 0 burnt out), times its brightness, into `out[at..at+2]`. */
export function sparkColor(heat: number, glow: number, out: Float32Array, at: number): void {
  const h = heat < 0 ? 0 : heat > 1 ? 1 : heat
  const k = SPARKS.peak * glow * Math.pow(h, 1.4)
  out[at] = k
  out[at + 1] = k * (0.1 + 0.8 * Math.pow(h, 1.1))
  out[at + 2] = k * (0.012 + 0.6 * Math.pow(h, 2.6))
}

export class SparkField {
  readonly capacity = SPARKS.capacity
  readonly pos = new Float32Array(SPARKS.capacity * 3)
  readonly vel = new Float32Array(SPARKS.capacity * 3)
  /** Seconds left; 0 or less is a free slot. */
  readonly life = new Float32Array(SPARKS.capacity)
  readonly span = new Float32Array(SPARKS.capacity)
  /** Half width in metres. */
  readonly size = new Float32Array(SPARKS.capacity)
  readonly glow = new Float32Array(SPARKS.capacity)
  readonly flashes: Flash[] = []
  /** Live sparks after the last `update`. */
  live = 0
  private readonly fork = new Float32Array(SPARKS.capacity)
  private readonly plane = new Float32Array(SPARKS.capacity * 4)
  private next = 0
  private flashNext = 0
  /** Seconds until a scrape may light the contact again, so a long grind flickers instead of piling up glow. */
  private glowWait = 0
  private seed = 20231

  constructor() {
    for (let i = 0; i < SPARKS.flashes; i++) this.flashes.push({ x: 0, y: 0, z: 0, life: 0, span: 1, radius: 0, glow: 0 })
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, glow: number, fork: number, g: SparkGround): number {
    const i = this.next
    this.next = (i + 1) % this.capacity
    const p = i * 3, q = i * 4
    this.pos[p] = x
    this.pos[p + 1] = y
    this.pos[p + 2] = z
    this.vel[p] = vx
    this.vel[p + 1] = vy
    this.vel[p + 2] = vz
    this.life[i] = this.span[i] = life
    this.size[i] = size
    this.glow[i] = glow
    this.fork[i] = fork
    this.plane[q] = g.nx
    this.plane[q + 1] = g.ny
    this.plane[q + 2] = g.nz
    this.plane[q + 3] = g.nx * g.x + g.ny * g.y + g.nz * g.z
    return i
  }

  private flash(x: number, y: number, z: number, radius: number, glow: number, life: number): void {
    const f = this.flashes[this.flashNext]
    this.flashNext = (this.flashNext + 1) % this.flashes.length
    f.x = x
    f.y = y
    f.z = z
    f.radius = radius
    f.glow = glow
    f.life = f.span = life
  }

  /** A fresh particle's life: most die within a third of a second, a few arc and bounce for over a second. */
  private lifetime(): number {
    const r = this.random()
    return 0.16 + r * r * r * 1.25
  }

  private forkPoint(life: number): number {
    return life > 0.4 && this.random() < SPARKS.forkShare ? life * (0.3 + this.random() * 0.4) : 0
  }

  /**
   * Metal sliding along a wall (or another car) at (x, y, z) with velocity (vx, vz): a shower torn off the body,
   * thrown back along the slide and away from the surface: a chip leaves at anything from most of the body's speed
   * down to nearly stopped by the wall. (nx, nz) points off the surface; `amount` is the sim's count for the contact
   * (1 a light rub, 2 a hard one).
   */
  scrape(x: number, y: number, z: number, vx: number, vz: number, nx: number, nz: number, kind: SparkKind, amount: number, ground: SparkGround): void {
    const speed = Math.hypot(vx, vz)
    if (speed < 1) return
    const tx = vx / speed, tz = vz / speed
    const count = Math.floor(amount * (1.2 + Math.min(2.3, speed / 20)) + this.random())
    for (let k = 0; k < count; k++) {
      const r = this.random(), keep = 0.95 - 0.72 * r * r, back = this.random() * SPARKS.tick
      const side = kind === 'car' ? (this.random() - 0.5) * 2 : 0.25 + this.random() * 0.75
      const out = (0.6 + this.random() * 3.4 + (this.random() < 0.12 ? 3 : 0)) * side
      const along = (this.random() - 0.5) * 3.2
      const up = -1.2 + this.random() * 4.6 + (this.random() < 0.1 ? 2.5 : 0)
      const life = this.lifetime()
      this.emit(
        x - vx * back + (this.random() - 0.5) * 0.14, y + (this.random() - 0.5) * 0.3, z - vz * back + (this.random() - 0.5) * 0.14,
        vx * keep + tx * along + nx * out, up, vz * keep + tz * along + nz * out,
        life, 0.005 + this.random() * 0.006, 0.75 + this.random() * 0.5, this.forkPoint(life), ground,
      )
    }
    if (this.glowWait <= 0) {
      this.glowWait = 0.045
      this.flash(x, y, z, 0.16 + Math.min(0.2, speed * 0.004), 0.5 + this.random() * 0.4, 0.07)
    }
  }

  /**
   * A hit closing at `v` m/s at (x, y, z): a burst off the struck surface, carried along with the car moving at
   * (vx, vz). (nx, nz) points off the surface. `share` scales the count (a car-to-car hit reports once per car).
   */
  burst(x: number, y: number, z: number, vx: number, vz: number, nx: number, nz: number, v: number, share: number, ground: SparkGround): void {
    const speed = Math.hypot(vx, vz)
    const tx = speed > 0.5 ? vx / speed : -nz, tz = speed > 0.5 ? vz / speed : nx
    const count = Math.round(Math.min(150, 10 + v * 11) * share)
    const carry = 0.5
    for (let k = 0; k < count; k++) {
      const a = 0.15 + this.random() * 0.85, b = (this.random() - 0.5) * 2, c = -0.25 + this.random() * 1.15
      const l = Math.hypot(a, b, c) || 1
      const r = this.random(), throwSpeed = (1.5 + v * (0.35 + 1.5 * r * r)) / l
      const keep = carry + (this.random() - 0.5) * 0.5
      const life = this.lifetime() * (1 + Math.min(0.6, v * 0.03))
      this.emit(
        x + (this.random() - 0.5) * 0.2, y + (this.random() - 0.5) * 0.35, z + (this.random() - 0.5) * 0.2,
        vx * keep + (nx * a + tx * b) * throwSpeed, c * throwSpeed, vz * keep + (nz * a + tz * b) * throwSpeed,
        life, 0.005 + this.random() * 0.008, 0.8 + this.random() * 0.6, this.forkPoint(life), ground,
      )
    }
    this.flash(x, y, z, Math.min(1.1, 0.3 + v * 0.06) * Math.sqrt(share), Math.min(1.6, 0.6 + v * 0.07), 0.11)
  }

  /** Steps every spark. One that lands keeps part of its drop, skids, and loses heat to the knock. */
  update(dt: number): void {
    const { pos, vel, life, plane } = this
    let live = 0
    for (let i = 0; i < this.capacity; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      if (life[i] <= 0) continue
      live++
      const p = i * 3, q = i * 4
      let vx = vel[p], vy = vel[p + 1] - SPARKS.gravity * dt, vz = vel[p + 2]
      const slow = 1 / (1 + (SPARKS.drag + SPARKS.dragSpeed * Math.hypot(vx, vy, vz)) * dt)
      vx *= slow
      vy *= slow
      vz *= slow
      pos[p] += vx * dt
      pos[p + 1] += vy * dt
      pos[p + 2] += vz * dt
      const nx = plane[q], ny = plane[q + 1], nz = plane[q + 2]
      const height = nx * pos[p] + ny * pos[p + 1] + nz * pos[p + 2] - plane[q + 3]
      if (height < 0.012) {
        const vn = vx * nx + vy * ny + vz * nz
        if (vn < 0) {
          const lift = 0.012 - height, rest = 0.22 + 0.3 * this.random()
          pos[p] += nx * lift
          pos[p + 1] += ny * lift
          pos[p + 2] += nz * lift
          vx = (vx - vn * nx) * 0.74 - vn * rest * nx
          vy = (vy - vn * ny) * 0.74 - vn * rest * ny
          vz = (vz - vn * nz) * 0.74 - vn * rest * nz
          life[i] *= vn < -1.2 ? 0.66 : 0.9
        }
      }
      vel[p] = vx
      vel[p + 1] = vy
      vel[p + 2] = vz
      if (this.fork[i] > 0 && life[i] < this.fork[i]) this.burstInto(i)
    }
    this.live = live
    this.glowWait -= dt
    for (const f of this.flashes) if (f.life > 0) f.life -= dt
  }

  /** Spark `i` flares and splits into two or three short branches. */
  private burstInto(i: number): void {
    this.fork[i] = 0
    const p = i * 3, q = i * 4
    const nx = this.plane[q], ny = this.plane[q + 1], nz = this.plane[q + 2], d = this.plane[q + 3]
    const ground: SparkGround = { x: nx * d, y: ny * d, z: nz * d, nx, ny, nz }
    const branches = 2 + (this.random() < 0.4 ? 1 : 0)
    for (let b = 0; b < branches; b++) {
      const kick = 1.2 + this.random() * 2.6
      const ax = this.random() - 0.5, ay = this.random() - 0.5, az = this.random() - 0.5, l = Math.hypot(ax, ay, az) || 1
      const child = this.emit(
        this.pos[p], this.pos[p + 1], this.pos[p + 2],
        this.vel[p] + (ax / l) * kick, this.vel[p + 1] + (ay / l) * kick, this.vel[p + 2] + (az / l) * kick,
        0.09 + this.random() * 0.2, this.size[i] * 0.75, this.glow[i] * 1.25, 0, ground,
      )
      if (child === i) return
    }
    if (this.random() < 0.5) this.life[i] = Math.min(this.life[i], 0.05)
  }

  /**
   * Where spark `i` is drawn from: its tail, the point it was at one exposure ago as seen from a viewer moving at
   * (cx, cy, cz) m/s, so streaks follow the motion on screen. Writes the tail into `out[at..at+2]`.
   */
  tail(i: number, cx: number, cy: number, cz: number, out: Float32Array, at: number): void {
    const p = i * 3
    let dx = (this.vel[p] - cx) * SPARKS.exposure, dy = (this.vel[p + 1] - cy) * SPARKS.exposure, dz = (this.vel[p + 2] - cz) * SPARKS.exposure
    const l = Math.hypot(dx, dy, dz)
    if (l > SPARKS.maxStreak) {
      const k = SPARKS.maxStreak / l
      dx *= k
      dy *= k
      dz *= k
    }
    out[at] = this.pos[p] - dx
    out[at + 1] = this.pos[p + 1] - dy
    out[at + 2] = this.pos[p + 2] - dz
  }

  clear(): void {
    this.life.fill(0)
    this.live = 0
    for (const f of this.flashes) f.life = 0
  }
}
