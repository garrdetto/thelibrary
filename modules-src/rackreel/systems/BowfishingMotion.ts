/** Night bowfishing, renderer-free: the carp school around the boat, the solid-glass arrow on its line, and the fight once a carp is stoned. Positions are real (not refracted); y is up with the lake surface at 0. */

export type Rand = () => number

export interface Water {
  depthAt(x: number, z: number): number
  heightAt(x: number, z: number): number
}

export interface Vec {
  x: number
  y: number
  z: number
}

export const CARP = {
  target: 78,
  /** Water magnifies what's under it by about a third, and they read 20% bigger again on top of that, so carp look (and take an arrow) this much longer than they are. */
  look: 1.6,
  spawnMin: 9,
  spawnMax: 56,
  despawn: 84,
  minDepth: 0.35,
  maxDepth: 3.4,
  cruise: 0.32,
  rootMin: 2,
  rootMax: 6,
  fleeMin: 2.6,
  fleeMax: 3.8,
  fleeTimeMin: 1,
  fleeTimeMax: 2,
  hullSpook: 2.4,
  splashSpook: 1.6,
  hitShare: 0.244,
  nearMiss: 0.45,
}

export const BOW = {
  fullDraw: 0.55,
  minDraw: 0.25,
  speed: 62,
  gravity: 9.81,
  waterDrag: 1.55,
  line: 26,
  holdSteady: 3.5,
  shakePerSecond: 0.012,
  /** Metres of line per second with a fish on, and with an empty arrow (both 30 % slower than the first cut). */
  reel: 2.54,
  emptyReel: 3.15,
  step: 1 / 240,
  deadSpeed: 2,
  renock: 1.2,
}

export function arrowSpeed(draw: number): number {
  return BOW.speed * (0.5 + 0.5 * Math.max(0, Math.min(1, draw)))
}

/** Extra aim shake (radians) from holding at full draw longer than the bow arm can stay steady. */
export function holdShake(heldAtFull: number): number {
  return Math.max(0, heldAtFull - BOW.holdSteady) * BOW.shakePerSecond
}

export type CarpMode = 'cruise' | 'root' | 'flee'

export interface Carp<T = unknown> {
  id: number
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  speed: number
  mode: CarpMode
  timer: number
  wander: number
  lengthM: number
  weightLb: number
  tail: number
  hooked: boolean
  data: T
}

export interface CarpSize<T> {
  weightLb: number
  lengthM: number
  data: T
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export function carpForward(c: { heading: number; pitch: number }): Vec {
  const cp = Math.cos(c.pitch)
  return { x: Math.sin(c.heading) * cp, y: Math.sin(c.pitch), z: Math.cos(c.heading) * cp }
}

/** Closest distance between segments p0–p1 and q0–q1, with the parameter along each. */
export function segmentGap(p0: Vec, p1: Vec, q0: Vec, q1: Vec): { distance: number; s: number; t: number } {
  const d1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
  const d2 = { x: q1.x - q0.x, y: q1.y - q0.y, z: q1.z - q0.z }
  const r = { x: p0.x - q0.x, y: p0.y - q0.y, z: p0.z - q0.z }
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z
  let s = 0
  let t = 0
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0
    t = 0
  } else if (a <= 1e-12) {
    t = clamp(f / e, 0, 1)
  } else {
    const c = d1.x * r.x + d1.y * r.y + d1.z * r.z
    if (e <= 1e-12) {
      s = clamp(-c / a, 0, 1)
    } else {
      const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z
      const denom = a * e - b * b
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a, 0, 1)
      } else if (t > 1) {
        t = 1
        s = clamp((b - c) / a, 0, 1)
      }
    }
  }
  const cx = p0.x + d1.x * s - (q0.x + d2.x * t)
  const cy = p0.y + d1.y * s - (q0.y + d2.y * t)
  const cz = p0.z + d1.z * s - (q0.z + d2.z * t)
  return { distance: Math.hypot(cx, cy, cz), s, t }
}

export function spine(c: Carp): [Vec, Vec] {
  const f = carpForward(c)
  const h = c.lengthM * 0.5 * CARP.look
  return [
    { x: c.x + f.x * h, y: c.y + f.y * h, z: c.z + f.z * h },
    { x: c.x - f.x * h, y: c.y - f.y * h, z: c.z - f.z * h },
  ]
}

export interface BoatPose {
  x: number
  z: number
  heading: number
  length: number
}

/** Carp feeding on the flats near the boat: cruising, rooting nose-down on the bottom, and bolting from splashes and the hull. */
export class CarpSchool<T = unknown> {
  readonly carp: Carp<T>[] = []
  private nextId = 1
  private spawnTimer = 0

  constructor(private readonly water: Water, private readonly rand: Rand, private readonly size: () => CarpSize<T>) {}

  private swimDepth(x: number, z: number, root: boolean): number {
    const d = this.water.depthAt(x, z)
    return root ? -clamp(d - 0.12, 0.12, d) : -clamp(d - 0.28, 0.14, Math.max(0.14, d * 0.75))
  }

  private inBand(x: number, z: number): boolean {
    const d = this.water.depthAt(x, z)
    return d >= CARP.minDepth && d <= CARP.maxDepth
  }

  /** Adds a group of 2–5 carp somewhere 9–40 m from the boat in carp water. Returns how many were added. */
  spawnGroup(boat: BoatPose): number {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = this.rand() * Math.PI * 2
      const r = CARP.spawnMin + this.rand() * (CARP.spawnMax - CARP.spawnMin)
      const x = boat.x + Math.sin(a) * r
      const z = boat.z + Math.cos(a) * r
      if (!this.inBand(x, z)) continue
      const count = 2 + Math.floor(this.rand() * 4)
      const heading = this.rand() * Math.PI * 2
      let added = 0
      for (let i = 0; i < count; i++) {
        const px = x + (this.rand() - 0.5) * 3
        const pz = z + (this.rand() - 0.5) * 3
        if (!this.inBand(px, pz)) continue
        const s = this.size()
        this.carp.push({
          id: this.nextId++, x: px, y: this.swimDepth(px, pz, false), z: pz, heading: heading + (this.rand() - 0.5) * 0.6, pitch: 0,
          speed: CARP.cruise, mode: 'cruise', timer: 3 + this.rand() * 8, wander: 0, lengthM: s.lengthM, weightLb: s.weightLb, tail: this.rand() * 6, hooked: false, data: s.data,
        })
        added++
      }
      if (added) return added
    }
    return 0
  }

  /** Every carp within `radius` of (x, z) bolts away for 1–2 s. */
  spook(x: number, z: number, radius: number): number {
    let n = 0
    for (const c of this.carp) {
      if (c.hooked) continue
      const d = Math.hypot(c.x - x, c.z - z)
      if (d > radius) continue
      this.flee(c, Math.atan2(c.x - x, c.z - z))
      n++
    }
    return n
  }

  private flee(c: Carp<T>, away: number): void {
    c.mode = 'flee'
    c.heading = away + (this.rand() - 0.5) * 0.5
    c.speed = CARP.fleeMin + this.rand() * (CARP.fleeMax - CARP.fleeMin)
    c.timer = CARP.fleeTimeMin + this.rand() * (CARP.fleeTimeMax - CARP.fleeTimeMin)
    c.pitch = 0
  }

  remove(c: Carp<T>): void {
    const i = this.carp.indexOf(c)
    if (i >= 0) this.carp.splice(i, 1)
  }

  clear(): void {
    this.carp.length = 0
  }

  private hullDistance(c: Carp<T>, boat: BoatPose): number {
    const fx = Math.sin(boat.heading)
    const fz = Math.cos(boat.heading)
    const h = boat.length / 2
    const a = { x: boat.x + fx * h, y: 0, z: boat.z + fz * h }
    const b = { x: boat.x - fx * h, y: 0, z: boat.z - fz * h }
    return segmentGap({ x: c.x, y: 0, z: c.z }, { x: c.x, y: 0, z: c.z }, a, b).distance
  }

  update(dt: number, boat: BoatPose, spawning: boolean): void {
    for (let i = this.carp.length - 1; i >= 0; i--) {
      const c = this.carp[i]
      if (c.hooked) continue
      if (Math.hypot(c.x - boat.x, c.z - boat.z) > CARP.despawn) {
        this.carp.splice(i, 1)
        continue
      }
      if (c.mode !== 'flee' && this.hullDistance(c, boat) < CARP.hullSpook) this.flee(c, Math.atan2(c.x - boat.x, c.z - boat.z))
      c.timer -= dt
      if (c.mode === 'flee') {
        if (c.timer <= 0) {
          c.mode = 'cruise'
          c.speed = CARP.cruise
          c.timer = 3 + this.rand() * 8
        }
      } else if (c.mode === 'root') {
        c.speed = 0.03
        if (c.timer <= 0) {
          c.mode = 'cruise'
          c.speed = CARP.cruise
          c.timer = 3 + this.rand() * 9
        }
      } else {
        c.speed = CARP.cruise
        c.wander = clamp(c.wander + (this.rand() - 0.5) * dt * 2.4, -0.7, 0.7)
        c.heading = wrap(c.heading + c.wander * dt)
        if (c.timer <= 0) {
          if (this.rand() < 0.45) {
            c.mode = 'root'
            c.timer = CARP.rootMin + this.rand() * (CARP.rootMax - CARP.rootMin)
          } else c.timer = 3 + this.rand() * 8
        }
      }
      const look = c.mode === 'flee' ? 2.5 : 1.4
      const ax = c.x + Math.sin(c.heading) * look
      const az = c.z + Math.cos(c.heading) * look
      if (!this.inBand(ax, az)) {
        const left = this.inBand(c.x + Math.sin(c.heading - 0.9) * look, c.z + Math.cos(c.heading - 0.9) * look)
        const right = this.inBand(c.x + Math.sin(c.heading + 0.9) * look, c.z + Math.cos(c.heading + 0.9) * look)
        const turn = left && !right ? -1 : right && !left ? 1 : c.wander >= 0 ? 1 : -1
        c.heading = wrap(c.heading + turn * (c.mode === 'flee' ? 4 : 1.8) * dt)
        if (c.mode === 'root') c.mode = 'cruise'
      }
      const nx = c.x + Math.sin(c.heading) * c.speed * dt
      const nz = c.z + Math.cos(c.heading) * c.speed * dt
      if (this.inBand(nx, nz) || !this.inBand(c.x, c.z)) {
        c.x = nx
        c.z = nz
      } else {
        c.heading = wrap(c.heading + Math.PI * 0.5 * dt * 4)
      }
      const wantY = this.swimDepth(c.x, c.z, c.mode === 'root')
      c.y += (wantY - c.y) * Math.min(1, dt * 1.5)
      const wantPitch = c.mode === 'root' ? -0.55 : 0
      c.pitch += (wantPitch - c.pitch) * Math.min(1, dt * 2)
      c.tail += dt * (c.mode === 'flee' ? 16 : c.mode === 'root' ? 3 : 6)
    }
    if (!spawning) return
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0 && this.carp.filter((c) => !c.hooked).length < CARP.target) {
      this.spawnTimer = 0.4
      this.spawnGroup(boat)
    }
  }

  /** The carp an arrow segment passes through, if any: within 13 % of its length of the spine. */
  hit(p0: Vec, p1: Vec): { carp: Carp<T>; at: number } | null {
    let best: { carp: Carp<T>; at: number } | null = null
    for (const c of this.carp) {
      if (c.hooked) continue
      const [a, b] = spine(c)
      const g = segmentGap(p0, p1, a, b)
      if (g.distance <= c.lengthM * CARP.hitShare && (!best || g.s < best.at)) best = { carp: c, at: g.s }
    }
    return best
  }

  /** The nearest carp an arrow segment passed within 0.45 m of without hitting, and whether it went over or under its back. */
  nearMiss(p0: Vec, p1: Vec): { carp: Carp<T>; over: boolean; gap: number } | null {
    let best: { carp: Carp<T>; over: boolean; gap: number } | null = null
    for (const c of this.carp) {
      if (c.hooked) continue
      const [a, b] = spine(c)
      const g = segmentGap(p0, p1, a, b)
      if (g.distance > CARP.nearMiss || g.distance <= c.lengthM * CARP.hitShare) continue
      const ay = p0.y + (p1.y - p0.y) * g.s
      const cy = a.y + (b.y - a.y) * g.t
      if (!best || g.distance < best.gap) best = { carp: c, over: ay > cy, gap: g.distance }
    }
    return best
  }
}

export type ArrowState = 'flying' | 'sinking' | 'stuck' | 'reeling' | 'fish' | 'home'

export interface ArrowEvents {
  entered?: Vec
  stuck?: boolean
  lineEnd?: boolean
  died?: boolean
  path: [Vec, Vec][]
}

/** One solid fiberglass arrow on 26 m of line: gravity in the air, quadratic drag in the water, sticks in the bottom or the bank. */
export class ArrowShot {
  readonly pos: Vec
  readonly vel: Vec
  state: ArrowState = 'flying'
  wet = false
  waterRun = 0
  slack = 1

  constructor(origin: Vec, dir: Vec, speed: number, private readonly water: Water) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1
    this.pos = { ...origin }
    this.vel = { x: (dir.x / len) * speed, y: (dir.y / len) * speed, z: (dir.z / len) * speed }
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z)
  }

  /** Advances in 1/240 s substeps; `reel` is where the line comes from. Returns what happened and every substep segment for hit tests. */
  step(dt: number, reel: Vec): ArrowEvents {
    const events: ArrowEvents = { path: [] }
    if (this.state !== 'flying' && this.state !== 'sinking') return events
    let left = dt
    while (left > 1e-9) {
      const h = Math.min(BOW.step, left)
      left -= h
      const from = { ...this.pos }
      if (this.pos.y > 0) {
        this.vel.y -= BOW.gravity * h
      } else if (this.state === 'flying') {
        const k = 1 / (1 + BOW.waterDrag * this.speed * h)
        this.vel.x *= k
        this.vel.y = this.vel.y * k - BOW.gravity * 0.12 * h
        this.vel.z *= k
        if (this.speed < BOW.deadSpeed) {
          this.state = 'sinking'
          events.died = true
        }
      }
      if (this.state === 'sinking' && this.pos.y <= 0) {
        this.vel.x *= 0.9
        this.vel.z *= 0.9
        this.vel.y = -0.45
      }
      this.pos.x += this.vel.x * h
      this.pos.y += this.vel.y * h
      this.pos.z += this.vel.z * h
      if (from.y >= 0 && this.pos.y < 0 && this.water.depthAt(this.pos.x, this.pos.z) > 0) {
        this.wet = true
        const f = from.y / Math.max(1e-6, from.y - this.pos.y)
        events.entered = { x: from.x + (this.pos.x - from.x) * f, y: 0, z: from.z + (this.pos.z - from.z) * f }
      }
      if (this.pos.y < 0) this.waterRun += Math.hypot(this.pos.x - from.x, this.pos.y - from.y, this.pos.z - from.z)
      const dx = this.pos.x - reel.x
      const dy = this.pos.y - reel.y
      const dz = this.pos.z - reel.z
      const out = Math.hypot(dx, dy, dz)
      if (out >= BOW.line) {
        const k = BOW.line / out
        this.pos.x = reel.x + dx * k
        this.pos.y = reel.y + dy * k
        this.pos.z = reel.z + dz * k
        this.vel.x = 0
        this.vel.y = 0
        this.vel.z = 0
        if (this.state === 'flying') {
          this.state = 'sinking'
          events.lineEnd = true
        }
      }
      events.path.push([from, { ...this.pos }])
      const ground = this.water.heightAt(this.pos.x, this.pos.z)
      if (this.pos.y <= ground) {
        this.pos.y = ground + 0.02
        this.state = 'stuck'
        events.stuck = true
        break
      }
    }
    return events
  }

  /** An empty arrow pulls free and skates back across the surface toward the reel; true once it is close enough to re-nock. */
  reelIn(dt: number, reel: Vec, speed = BOW.emptyReel): boolean {
    if (this.state === 'fish' || this.state === 'home') return this.state === 'home'
    this.state = 'reeling'
    this.vel.x = 0
    this.vel.y = 0
    this.vel.z = 0
    const water = this.water.depthAt(this.pos.x, this.pos.z) > 0.02
    const targetY = water ? -0.02 : this.water.heightAt(this.pos.x, this.pos.z) + 0.04
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 6)
    const dx = reel.x - this.pos.x
    const dz = reel.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d <= BOW.renock) {
      this.state = 'home'
      return true
    }
    const step = Math.min(d, speed * dt)
    this.pos.x += (dx / d) * step
    this.pos.z += (dz / d) * step
    return false
  }
}

export type FightOutcome = 'fighting' | 'landed' | 'torn'

/** A stoned carp on the line: runs every 1–3.5 s, harder the heavier it is. Reeling through a hard run builds strain until the barbs tear out; easing off lets it take line while the strain drains. Slack never loses a fish. */
export class CarpFight {
  distance: number
  readonly start: number
  strain = 0
  run = 0
  outcome: FightOutcome = 'fighting'
  /** Direction the fish is pulling, radians around the boat. */
  bearing: number
  private runLeft = 0
  private nextRun: number
  private strength = 0

  constructor(readonly weightLb: number, readonly fight: number, distance: number, bearing: number, private readonly rand: Rand) {
    this.distance = Math.min(BOW.line, Math.max(2, distance))
    this.start = this.distance
    this.bearing = bearing
    this.nextRun = 0.4 + rand() * 1.2
  }

  get power(): number {
    return clamp(0.32 + (this.weightLb / 15) * 0.68, 0.2, 1.05) * this.fight
  }

  get running(): boolean {
    return this.run > 0
  }

  get tension(): number {
    return clamp((this.run * 0.6 + this.strain * 0.9) * 100, 0, 100)
  }

  get lineHealth(): number {
    return (1 - this.strain) * 100
  }

  get progress(): number {
    return clamp((1 - (this.distance - 1.6) / Math.max(0.1, this.start - 1.6)) * 100, 0, 100)
  }

  update(dt: number, reeling: boolean, landAt = 1.6): FightOutcome {
    if (this.outcome !== 'fighting') return this.outcome
    if (this.runLeft > 0) {
      this.runLeft -= dt
      if (this.runLeft <= 0) {
        this.run = 0
        this.nextRun = 1 + this.rand() * 2.5
      }
    } else {
      this.nextRun -= dt
      if (this.nextRun <= 0) {
        this.strength = this.power * (0.75 + this.rand() * 0.35)
        this.run = this.strength
        this.runLeft = 0.6 + this.rand() * 0.9 + this.power * 0.5
        this.bearing += (this.rand() - 0.5) * 1.6
      }
    }
    if (reeling) {
      if (this.run > 0) {
        this.strain += Math.pow(this.run, 1.5) * 1.7 * dt
        this.distance -= BOW.reel * Math.max(0.12, 1 - this.run * 0.9) * dt
      } else {
        this.strain = Math.max(0, this.strain - 0.05 * dt)
        this.distance -= BOW.reel * dt
      }
    } else {
      this.strain = Math.max(0, this.strain - 0.6 * dt)
      if (this.run > 0) this.distance += (0.8 + this.run * 2.4) * dt
    }
    this.distance = Math.min(BOW.line, this.distance)
    if (this.strain >= 1) {
      this.strain = 1
      this.outcome = 'torn'
    } else if (this.distance <= landAt) {
      this.distance = landAt
      this.outcome = 'landed'
    }
    return this.outcome
  }
}
