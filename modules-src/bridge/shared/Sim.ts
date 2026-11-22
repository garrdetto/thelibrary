import { CELL, MATERIALS } from './Materials'
import type { Material } from './Materials'
import { key } from './Design'
import type { Design, Level } from './Design'
import { VEHICLES } from './Vehicles'
import type { VehicleSpec } from './Vehicles'

export const FRAME = 1 / 60
export const SUBSTEPS = 32
const GRAVITY = 9.81
const BRIDGE_DAMPING = 0.6
const BEAM_DAMPING = 30
const START_DELAY = 1.4
const GRAVITY_RAMP = 0.8
const JOINT_BASE_MASS = 8

export type Particle = {
  x: number; y: number
  px: number; py: number
  vx: number; vy: number
  w: number
  joint: boolean
}

export type SimBeam = {
  i: number; j: number
  rest: number
  material: Material
  compliance: number
  lambda: number
  forceSum: number
  force: number
  stress: number
  peak: number
  broken: boolean
  road: boolean
}

export type Link = { i: number; j: number; rest: number }

export type SimVehicle = {
  spec: VehicleSpec
  wheels: number[]
  body: number[]
  links: Link[]
  spin: number[]
  contact: boolean[]
  started: boolean
  done: boolean
  fell: boolean
}

export type Debris = { x1: number; y1: number; x2: number; y2: number; vx: number; vy: number; spin: number; angle: number; life: number; material: Material }

type Segment = { a: number; b: number; static: boolean; ax: number; ay: number; bx: number; by: number }

export type SimStatus = 'running' | 'passed' | 'failed'

export class Sim {
  readonly level: Level
  readonly particles: Particle[] = []
  readonly beams: SimBeam[] = []
  readonly vehicles: SimVehicle[] = []
  readonly debris: Debris[] = []
  readonly jointIndex = new Map<string, number>()
  readonly terrain: { ax: number; ay: number; bx: number; by: number }[] = []
  time = 0
  status: SimStatus = 'running'
  reason = ''
  breaks = 0
  maxStress = 0
  readonly goalX: number
  readonly timeLimit: number
  private gravityScale = 0
  private convoySpeed = 0

  constructor(level: Level, design: Design) {
    this.level = level
    const span = level.span * CELL
    this.goalX = span + 6
    this.terrain.push({ ax: -80, ay: 0, bx: 0, by: 0 }, { ax: span, ay: 0, bx: span + 80, by: 0 })
    for (const [ax, ay] of level.anchors) this.joint(ax, ay, true)
    for (const beam of design.beams) {
      const i = this.joint(beam.x1, beam.y1, false)
      const j = this.joint(beam.x2, beam.y2, false)
      const material = MATERIALS[beam.m]
      const rest = Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1) * CELL
      this.beams.push({ i, j, rest, material, compliance: rest / material.stiffness, lambda: 0, forceSum: 0, force: 0, stress: 0, peak: 0, broken: false, road: material.road })
    }
    const mass = new Array<number>(this.particles.length).fill(JOINT_BASE_MASS)
    for (const beam of this.beams) {
      const half = (beam.rest * beam.material.massPerMetre) / 2
      mass[beam.i] += half
      mass[beam.j] += half
    }
    this.particles.forEach((p, index) => { if (p.w !== 0) p.w = 1 / mass[index] })
    let front = -3
    let travel = 0
    for (const id of level.vehicles) {
      const spec = VEHICLES[id]
      this.addVehicle(spec, front - spec.length / 2)
      travel += spec.length + 5
      front -= spec.length + 5
    }
    const slowest = Math.min(...level.vehicles.map(id => VEHICLES[id].speed))
    this.convoySpeed = slowest
    this.timeLimit = START_DELAY + (this.goalX + travel + 6) / slowest * 1.6 + 8
  }

  private joint(x: number, y: number, fixed: boolean): number {
    const id = key(x, y)
    const existing = this.jointIndex.get(id)
    if (existing !== undefined) return existing
    const wx = x * CELL
    const wy = y * CELL
    this.particles.push({ x: wx, y: wy, px: wx, py: wy, vx: 0, vy: 0, w: fixed ? 0 : 1, joint: true })
    this.jointIndex.set(id, this.particles.length - 1)
    return this.particles.length - 1
  }

  private addVehicle(spec: VehicleSpec, centre: number) {
    const wheelShare = (spec.mass * 0.72) / spec.axles.length
    const bodyMass = (spec.mass * 0.28) / 2
    const wheels: number[] = []
    const body: number[] = []
    for (const axle of spec.axles) {
      const x = centre + axle
      const y = spec.wheelRadius + 0.002
      this.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, w: 1 / wheelShare, joint: false })
      wheels.push(this.particles.length - 1)
    }
    const top = spec.wheelRadius + spec.height * 0.62
    for (const side of [-1, 1]) {
      const x = centre + side * spec.length * 0.38
      this.particles.push({ x, y: top, px: x, py: top, vx: 0, vy: 0, w: 1 / bodyMass, joint: false })
      body.push(this.particles.length - 1)
    }
    const all = [...wheels, ...body]
    const links: Link[] = []
    for (let a = 0; a < all.length; a++) {
      for (let b = a + 1; b < all.length; b++) {
        const pa = this.particles[all[a]]
        const pb = this.particles[all[b]]
        links.push({ i: all[a], j: all[b], rest: Math.hypot(pa.x - pb.x, pa.y - pb.y) })
      }
    }
    this.vehicles.push({ spec, wheels, body, links, spin: wheels.map(() => 0), contact: wheels.map(() => false), started: false, done: false, fell: false })
  }

  vehicleFrame(vehicle: SimVehicle) {
    const rear = this.particles[vehicle.wheels[0]]
    const front = this.particles[vehicle.wheels[vehicle.wheels.length - 1]]
    const angle = Math.atan2(front.y - rear.y, front.x - rear.x)
    const spec = vehicle.spec
    const span = spec.axles[spec.axles.length - 1] - spec.axles[0]
    const t = -spec.axles[0] / span
    const cx = rear.x + (front.x - rear.x) * t
    const cy = rear.y + (front.y - rear.y) * t
    return { x: cx, y: cy, angle }
  }

  step() {
    if (this.status !== 'running') {
      this.stepDebris()
      return
    }
    const h = FRAME / SUBSTEPS
    for (const beam of this.beams) beam.forceSum = 0
    this.gravityScale = Math.min(1, this.time / GRAVITY_RAMP)
    for (const vehicle of this.vehicles) vehicle.started = this.time >= START_DELAY
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h)
    this.time += FRAME
    this.afterFrame()
    this.stepDebris()
  }

  private substep(h: number) {
    const g = GRAVITY * this.gravityScale
    const particles = this.particles
    for (const p of particles) {
      if (p.w === 0) continue
      p.vy -= g * h
      p.px = p.x
      p.py = p.y
      p.x += p.vx * h
      p.y += p.vy * h
    }
    const h2 = h * h
    for (const beam of this.beams) {
      if (beam.broken) continue
      const a = particles[beam.i]
      const b = particles[beam.j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-9) continue
      const c = d - beam.rest
      if (beam.material.tensionOnly && c < 0) continue
      const wsum = a.w + b.w
      if (wsum === 0) continue
      const alpha = beam.compliance / h2
      const dl = -c / (wsum + alpha)
      const nx = dx / d
      const ny = dy / d
      a.x += a.w * dl * nx
      a.y += a.w * dl * ny
      b.x -= b.w * dl * nx
      b.y -= b.w * dl * ny
      beam.forceSum += dl / h2
    }
    for (const vehicle of this.vehicles) {
      for (const link of vehicle.links) {
        const a = particles[link.i]
        const b = particles[link.j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d = Math.hypot(dx, dy)
        if (d < 1e-9) continue
        const wsum = a.w + b.w
        const dl = -(d - link.rest) / wsum
        a.x += a.w * dl * dx / d
        a.y += a.w * dl * dy / d
        b.x -= b.w * dl * dx / d
        b.y -= b.w * dl * dy / d
      }
    }
    const segments = this.segments()
    for (const vehicle of this.vehicles) {
      for (let k = 0; k < vehicle.wheels.length; k++) {
        vehicle.contact[k] = this.collideWheel(particles[vehicle.wheels[k]], vehicle.spec.wheelRadius, segments)
      }
    }
    const inv = 1 / h
    for (const p of particles) {
      if (p.w === 0) continue
      p.vx = (p.x - p.px) * inv
      p.vy = (p.y - p.py) * inv
      if (p.joint) {
        const damp = Math.exp(-BRIDGE_DAMPING * h)
        p.vx *= damp
        p.vy *= damp
      }
    }
    const beamDamp = Math.min(1, BEAM_DAMPING * h)
    for (const beam of this.beams) {
      if (beam.broken) continue
      const a = particles[beam.i]
      const b = particles[beam.j]
      const wsum = a.w + b.w
      if (wsum === 0) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-9) continue
      const nx = dx / d
      const ny = dy / d
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      const impulse = (-rel * beamDamp) / wsum
      a.vx += a.w * impulse * nx
      a.vy += a.w * impulse * ny
      b.vx -= b.w * impulse * nx
      b.vy -= b.w * impulse * ny
    }
    for (const vehicle of this.vehicles) this.drive(vehicle, h)
  }

  private segments(): Segment[] {
    const list: Segment[] = []
    for (const t of this.terrain) list.push({ a: -1, b: -1, static: true, ax: t.ax, ay: t.ay, bx: t.bx, by: t.by })
    for (const beam of this.beams) {
      if (!beam.road || beam.broken) continue
      const a = this.particles[beam.i]
      const b = this.particles[beam.j]
      list.push({ a: beam.i, b: beam.j, static: false, ax: a.x, ay: a.y, bx: b.x, by: b.y })
    }
    return list
  }

  private collideWheel(wheel: Particle, radius: number, segments: Segment[]): boolean {
    let touched = false
    for (const seg of segments) {
      const a = seg.static ? null : this.particles[seg.a]
      const b = seg.static ? null : this.particles[seg.b]
      const ax = a ? a.x : seg.ax
      const ay = a ? a.y : seg.ay
      const bx = b ? b.x : seg.bx
      const by = b ? b.y : seg.by
      const ex = bx - ax
      const ey = by - ay
      const len2 = ex * ex + ey * ey
      if (len2 < 1e-9) continue
      if (wheel.x + radius < Math.min(ax, bx) || wheel.x - radius > Math.max(ax, bx)) continue
      let t = ((wheel.x - ax) * ex + (wheel.y - ay) * ey) / len2
      t = Math.max(0, Math.min(1, t))
      const qx = ax + ex * t
      const qy = ay + ey * t
      let nx = wheel.x - qx
      let ny = wheel.y - qy
      const d = Math.hypot(nx, ny)
      if (d >= radius || d < 1e-9) continue
      nx /= d
      ny /= d
      if (ny < -0.2) continue
      const wa = a ? a.w * (1 - t) * (1 - t) : 0
      const wb = b ? b.w * t * t : 0
      const total = wheel.w + wa + wb
      const depth = (radius - d) / total
      wheel.x += wheel.w * depth * nx
      wheel.y += wheel.w * depth * ny
      if (a) { a.x -= a.w * (1 - t) * depth * nx; a.y -= a.w * (1 - t) * depth * ny }
      if (b) { b.x -= b.w * t * depth * nx; b.y -= b.w * t * depth * ny }
      touched = true
    }
    return touched
  }

  private drive(vehicle: SimVehicle, h: number) {
    const spec = vehicle.spec
    for (let k = 0; k < vehicle.wheels.length; k++) {
      const wheel = this.particles[vehicle.wheels[k]]
      if (vehicle.contact[k]) {
        const target = vehicle.started ? this.convoySpeed : 0
        const along = wheel.vx
        const change = Math.max(-spec.accel * 2.2 * h, Math.min(spec.accel * 2.2 * h, target - along))
        wheel.vx += change
      }
      vehicle.spin[k] -= (wheel.vx * h) / spec.wheelRadius
    }
  }

  private afterFrame() {
    let worst = 0
    for (const beam of this.beams) {
      if (beam.broken) continue
      const force = beam.forceSum / SUBSTEPS
      beam.force = force
      const pulling = force < 0
      beam.stress = beam.material.tensionOnly && !pulling ? 0 : Math.abs(force) / beam.material.strength
      beam.peak = Math.max(beam.peak, beam.stress)
      const a = this.particles[beam.i]
      const b = this.particles[beam.j]
      const strain = Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - beam.rest) / beam.rest
      if (beam.stress > 1 || strain > 0.25) this.breakBeam(beam)
      else worst = Math.max(worst, beam.stress)
    }
    this.maxStress = Math.max(this.maxStress, worst)
    let finished = 0
    for (const vehicle of this.vehicles) {
      const frame = this.vehicleFrame(vehicle)
      const rear = this.particles[vehicle.wheels[0]]
      if (!vehicle.done && rear.x - vehicle.spec.wheelRadius > this.goalX) vehicle.done = true
      if (frame.y < -CELL * 1.2) vehicle.fell = true
      if (Math.abs(frame.angle) > 1.25) vehicle.fell = true
      if (vehicle.done) finished++
    }
    if (this.vehicles.some(v => v.fell)) this.fail('A vehicle fell off the bridge.')
    else if (finished === this.vehicles.length) {
      this.status = 'passed'
      this.reason = 'Everyone made it across!'
    } else if (this.time > this.timeLimit) this.fail('The vehicles got stuck.')
  }

  private fail(reason: string) {
    this.status = 'failed'
    this.reason = reason
  }

  private breakBeam(beam: SimBeam) {
    beam.broken = true
    beam.stress = 0
    this.breaks++
    const a = this.particles[beam.i]
    const b = this.particles[beam.j]
    this.debris.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2, spin: (((beam.i * 7 + beam.j * 13) % 11) - 5) * 0.6, angle: 0, life: 4, material: beam.material })
  }

  private stepDebris() {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]
      d.vy -= GRAVITY * FRAME
      d.x1 += d.vx * FRAME
      d.x2 += d.vx * FRAME
      d.y1 += d.vy * FRAME
      d.y2 += d.vy * FRAME
      d.angle += d.spin * FRAME
      d.life -= FRAME
      if (d.life <= 0) this.debris.splice(i, 1)
    }
  }

  connected(index: number): boolean {
    return this.beams.some(beam => !beam.broken && (beam.i === index || beam.j === index))
  }

  run(maxSeconds = 120): SimStatus {
    const frames = Math.ceil(maxSeconds / FRAME)
    for (let f = 0; f < frames && this.status === 'running'; f++) this.step()
    return this.status
  }
}
