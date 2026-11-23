/**
 * Background traffic: cars, pickups, vans and semis driving the roads on their own, renderer-free and deterministic for a seed.
 *
 * Each agent keeps to the right-hand lane of one road polyline and follows the Intelligent Driver Model (IDM) for its speed:
 * it accelerates smoothly toward a desired speed, keeps a time gap to whoever is ahead in its lane (another agent or the
 * player's rig), and brakes comfortably, firmly at most (`FIRM_BRAKE`) unless the room left really needs a hard stop. The desired speed is the road's limit, capped ahead of
 * curves by the sideways grip a driver accepts (`LATERAL_COMFORT`) and before a turn by `TURN_SPEED`, each reached with
 * comfortable braking (`v² = vt² + 2·b·d`). At junctions an agent may turn onto the crossing road (it signals for the last
 * `SIGNAL_DISTANCE` metres), and at a dead end it must; a junction is held by one agent at a time so turning traffic takes
 * turns. Poses carry the realistic body motion: roll from the sideways acceleration in curves, nose dive under braking and
 * squat under power, pitch over hills, wheel spin and steering from the path's curvature.
 *
 * Agents spawn out of sight (`SPAWN_MIN`…`SPAWN_MAX` metres from the focus) and are removed past `DESPAWN`.
 */
import type { Road } from '../shared/WorldLayout'

export type TrafficKind = 'sedan' | 'pickup' | 'suv' | 'van' | 'semi'

/** IDM parameters and body size of one kind of vehicle. */
export interface KindSpec {
  length: number
  /** Comfortable acceleration and braking (m/s²), time gap (s) and standstill gap (m). */
  accel: number
  brake: number
  headway: number
  gap: number
  /** Share of the road's limit this kind likes to drive at. */
  pace: number
  /** Body roll (rad) per m/s² of sideways acceleration, and pitch (rad) per m/s² along. */
  roll: number
  pitch: number
  wheelRadius: number
  wheelbase: number
}

export const KINDS: Record<TrafficKind, KindSpec> = {
  sedan: { length: 4.7, accel: 2.0, brake: 2.8, headway: 1.4, gap: 2.5, pace: 1.02, roll: 0.011, pitch: 0.009, wheelRadius: 0.33, wheelbase: 2.8 },
  pickup: { length: 5.6, accel: 1.8, brake: 2.6, headway: 1.5, gap: 2.8, pace: 1.0, roll: 0.014, pitch: 0.01, wheelRadius: 0.39, wheelbase: 3.5 },
  suv: { length: 4.9, accel: 1.9, brake: 2.7, headway: 1.5, gap: 2.6, pace: 1.0, roll: 0.016, pitch: 0.01, wheelRadius: 0.37, wheelbase: 2.9 },
  van: { length: 5.4, accel: 1.5, brake: 2.4, headway: 1.7, gap: 3.0, pace: 0.95, roll: 0.018, pitch: 0.011, wheelRadius: 0.36, wheelbase: 3.4 },
  semi: { length: 21, accel: 0.6, brake: 1.6, headway: 2.4, gap: 4.5, pace: 0.9, roll: 0.008, pitch: 0.004, wheelRadius: 0.52, wheelbase: 5.2 },
}

/** Speed limits (m/s) by road kind: 55 mph highway, 45 mph road, 25 mph street, 20 mph gravel. */
export const SPEED_LIMIT: Record<Road['kind'], number> = { highway: 24.6, road: 20.1, street: 11.2, gravel: 8.9 }
export const LATERAL_COMFORT = 2.2
export const TURN_SPEED = 6.5
export const SIGNAL_DISTANCE = 70
export const SPAWN_MIN = 320
export const SPAWN_MAX = 750
export const DESPAWN = 950
const LANE_SHARE = 0.25
const LOOKAHEAD = 140
const JUNCTION_HOLD = 14
const IDM_DELTA = 4
/** Braking is held to this multiple of the comfortable rate unless the room left needs more (then up to 8 m/s²). */
const FIRM_BRAKE = 1.8

export interface Junction {
  /** Arc length on this road, the road met and the arc length there, and a shared id for the crossing point. */
  s: number
  road: number
  otherS: number
  id: number
  x: number
  z: number
}

/** A road prepared for traffic: arc lengths, junctions and its limit. */
export interface Lane {
  road: Road
  xs: number[]
  zs: number[]
  arc: number[]
  length: number
  loop: boolean
  limit: number
  offset: number
  junctions: Junction[]
}

export interface Obstacle {
  x: number
  z: number
  /** Velocity (m/s) and half length (m). */
  vx: number
  vz: number
  half: number
}

export interface TrafficAgent {
  id: number
  kind: TrafficKind
  spec: KindSpec
  /** Colour and model variant chosen at spawn. */
  color: string
  variant: number
  lane: number
  s: number
  dir: 1 | -1
  v: number
  accel: number
  turn: Junction | null
  turnDir: 1 | -1
  signal: -1 | 0 | 1
  lateral: number
  /** Pose (centre of the body on the ground). */
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  roll: number
  steer: number
  spin: number
  braking: boolean
  /** Arc position of the trailer's axle group behind (semis), along the same history of points. */
  trail: { x: number; z: number }[]
}

const COLORS = ['#c9ccd1', '#1d1f23', '#f2f2ee', '#7a1f1f', '#203a63', '#5d6670', '#2e4a33', '#b08d57', '#8a8f96', '#a3271f', '#3a3f4a', '#d8d4c8']

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Prepares roads for traffic: arc lengths and every crossing or tee with another road. */
export function buildLanes(roads: readonly Road[]): Lane[] {
  const lanes: Lane[] = roads.map((road) => {
    const pts = road.loop ? [...road.points, road.points[0]] : road.points
    const xs = pts.map((p) => p[0])
    const zs = pts.map((p) => p[1])
    const arc = [0]
    for (let i = 1; i < xs.length; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]))
    return { road, xs, zs, arc, length: arc[arc.length - 1], loop: road.loop === true, limit: SPEED_LIMIT[road.kind], offset: road.width * LANE_SHARE, junctions: [] }
  })
  let nextId = 0
  for (let a = 0; a < lanes.length; a++) {
    for (let b = a + 1; b < lanes.length; b++) {
      const A = lanes[a], B = lanes[b]
      for (let i = 0; i + 1 < A.xs.length; i++) {
        for (let j = 0; j + 1 < B.xs.length; j++) {
          const hit = crossing(A, i, B, j)
          if (!hit) continue
          const id = nextId++
          A.junctions.push({ s: hit.sa, road: b, otherS: hit.sb, id, x: hit.x, z: hit.z })
          B.junctions.push({ s: hit.sb, road: a, otherS: hit.sa, id, x: hit.x, z: hit.z })
        }
      }
    }
  }
  for (const lane of lanes) {
    lane.junctions.sort((p, q) => p.s - q.s)
    lane.junctions = lane.junctions.filter((j, k, all) => k === 0 || Math.abs(j.s - all[k - 1].s) > 1 || j.road !== all[k - 1].road)
  }
  return lanes
}

/** Where segment i of A meets segment j of B (crossing, or an end within 2 m of the other segment: a tee). */
function crossing(A: Lane, i: number, B: Lane, j: number): { sa: number; sb: number; x: number; z: number } | null {
  const ax = A.xs[i], az = A.zs[i], bx = A.xs[i + 1], bz = A.zs[i + 1]
  const cx = B.xs[j], cz = B.zs[j], dx = B.xs[j + 1], dz = B.zs[j + 1]
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz
  const den = ux * vz - uz * vx
  if (Math.abs(den) > 1e-9) {
    const t = ((cx - ax) * vz - (cz - az) * vx) / den
    const u = ((cx - ax) * uz - (cz - az) * ux) / den
    const pad = 2 / Math.max(1, Math.hypot(ux, uz))
    const padB = 2 / Math.max(1, Math.hypot(vx, vz))
    if (t >= -pad && t <= 1 + pad && u >= -padB && u <= 1 + padB) {
      const tc = Math.max(0, Math.min(1, t))
      const uc = Math.max(0, Math.min(1, u))
      return { sa: A.arc[i] + tc * Math.hypot(ux, uz), sb: B.arc[j] + uc * Math.hypot(vx, vz), x: ax + ux * tc, z: az + uz * tc }
    }
  }
  return null
}

/** Point, unit direction and curvature (1/m, + turning left) at arc `s` on a lane (wrapped on a loop, clamped otherwise). */
export function sampleLane(lane: Lane, s: number, out: { x: number; z: number; dx: number; dz: number; curve: number }): typeof out {
  const arc = lane.loop ? ((s % lane.length) + lane.length) % lane.length : Math.max(0, Math.min(lane.length, s))
  let k = 0
  let lo = 0, hi = lane.arc.length - 2
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lane.arc[mid] <= arc) { k = mid; lo = mid + 1 } else hi = mid - 1
  }
  k = Math.min(k, lane.arc.length - 2)
  const seg = lane.arc[k + 1] - lane.arc[k] || 1
  const t = (arc - lane.arc[k]) / seg
  const ex = lane.xs[k + 1] - lane.xs[k], ez = lane.zs[k + 1] - lane.zs[k]
  out.x = lane.xs[k] + ex * t
  out.z = lane.zs[k] + ez * t
  const len = Math.hypot(ex, ez) || 1
  out.dx = ex / len
  out.dz = ez / len
  const kn = lane.loop ? (k + 1) % (lane.arc.length - 1) : Math.min(k + 1, lane.arc.length - 2)
  const fx = lane.xs[kn + 1] - lane.xs[kn], fz = lane.zs[kn + 1] - lane.zs[kn]
  const turn = Math.atan2(out.dx * fz - out.dz * fx, out.dx * fx + out.dz * fz)
  out.curve = -turn / Math.max(4, seg)
  return out
}

/** The traffic on a set of lanes. `heightAt` gives ground height for poses; `update` advances everything one step. */
export class Traffic {
  readonly agents: TrafficAgent[] = []
  private readonly random: () => number
  private readonly held = new Map<number, { agent: number; until: number }>()
  private clock = 0
  private nextId = 1
  private readonly probe = { x: 0, z: 0, dx: 0, dz: 1, curve: 0 }
  private readonly probe2 = { x: 0, z: 0, dx: 0, dz: 1, curve: 0 }

  constructor(readonly lanes: Lane[], private readonly heightAt: (x: number, z: number) => number, seed = 1, public target = 18, public semiShare = 0.22) {
    this.random = rng(seed)
  }

  /** Advances every agent by `dt` seconds around `focus` (the camera or player), treating `obstacles` (the player's rig) as traffic. */
  update(dt: number, focus: { x: number; z: number }, obstacles: readonly Obstacle[] = []): void {
    if (dt <= 0) return
    this.clock += dt
    for (const [id, hold] of this.held) if (hold.until < this.clock) this.held.delete(id)
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i]
      if (Math.hypot(a.x - focus.x, a.z - focus.z) > DESPAWN) this.agents.splice(i, 1)
    }
    let tries = 0
    while (this.agents.length < this.target && tries++ < 6) this.spawn(focus)
    for (const agent of this.agents) this.drive(agent, dt, obstacles)
  }

  private spawn(focus: { x: number; z: number }): void {
    const r = this.random
    const distance = SPAWN_MIN + r() * (SPAWN_MAX - SPAWN_MIN)
    const angle = r() * Math.PI * 2
    const px = focus.x + Math.cos(angle) * distance
    const pz = focus.z + Math.sin(angle) * distance
    let best: { lane: number; s: number; d: number } | null = null
    this.lanes.forEach((lane, index) => {
      for (let k = 0; k + 1 < lane.xs.length; k++) {
        const ex = lane.xs[k + 1] - lane.xs[k], ez = lane.zs[k + 1] - lane.zs[k]
        const l2 = ex * ex + ez * ez || 1
        const t = Math.max(0, Math.min(1, ((px - lane.xs[k]) * ex + (pz - lane.zs[k]) * ez) / l2))
        const d = Math.hypot(lane.xs[k] + ex * t - px, lane.zs[k] + ez * t - pz)
        if (!best || d < best.d) best = { lane: index, s: lane.arc[k] + t * Math.sqrt(l2), d }
      }
    })
    const found = best as { lane: number; s: number; d: number } | null
    if (!found || found.d > 120) return
    const lane = this.lanes[found.lane]
    if (!lane.loop && lane.junctions.length < 2) return
    sampleLane(lane, found.s, this.probe)
    if (Math.hypot(this.probe.x - focus.x, this.probe.z - focus.z) < SPAWN_MIN * 0.8) return
    const semi = lane.road.kind !== 'street' && r() < this.semiShare
    const kinds: TrafficKind[] = ['sedan', 'sedan', 'suv', 'pickup', 'pickup', 'van']
    const kind: TrafficKind = semi ? 'semi' : kinds[Math.floor(r() * kinds.length)]
    const spec = KINDS[kind]
    let dir: 1 | -1 = r() < 0.5 ? 1 : -1
    if (!this.leadsOn(lane, found.s, dir)) dir = dir > 0 ? -1 : 1
    for (const other of this.agents) if (other.lane === found.lane && Math.abs(other.s - found.s) < 40) return
    const agent: TrafficAgent = {
      id: this.nextId++, kind, spec, color: COLORS[Math.floor(r() * COLORS.length)], variant: Math.floor(r() * 4),
      lane: found.lane, s: found.s, dir, v: lane.limit * spec.pace * 0.8, accel: 0, turn: null, turnDir: 1, signal: 0, lateral: 0,
      x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steer: 0, spin: 0, braking: false, trail: [],
    }
    this.place(agent, 0)
    this.agents.push(agent)
  }

  /** Distance along the agent's travel to arc `s` on its lane (Infinity if behind it on an open road). */
  private ahead(agent: TrafficAgent, s: number): number {
    const lane = this.lanes[agent.lane]
    let d = (s - agent.s) * agent.dir
    if (lane.loop) d = ((d % lane.length) + lane.length) % lane.length
    return d < 0 ? Infinity : d
  }

  private chooseTurn(agent: TrafficAgent): void {
    const lane = this.lanes[agent.lane]
    if (agent.turn) return
    const upcoming = lane.junctions.filter((j) => {
      const d = this.ahead(agent, j.s)
      return d > 6 && d < SIGNAL_DISTANCE + 30
    }).sort((p, q) => this.ahead(agent, p.s) - this.ahead(agent, q.s))
    const next = upcoming[0]
    if (!next) return
    const endAhead = lane.loop ? Infinity : agent.dir > 0 ? lane.length - agent.s : agent.s
    const mustTurn = endAhead - this.ahead(agent, next.s) < 30
    if (!mustTurn && this.random() > 0.35) {
      agent.turn = { ...next, road: -1 }
      return
    }
    const target = this.lanes[next.road]
    const options: (1 | -1)[] = []
    for (const way of [1, -1] as const) if (this.leadsOn(target, next.otherS, way)) options.push(way)
    if (!options.length) {
      agent.turn = { ...next, road: -1 }
      return
    }
    agent.turn = next
    agent.turnDir = options[Math.floor(this.random() * options.length)]
    sampleLane(lane, agent.s, this.probe)
    sampleLane(target, next.otherS, this.probe2)
    const fx = this.probe.dx * agent.dir, fz = this.probe.dz * agent.dir
    const tx = this.probe2.dx * agent.turnDir, tz = this.probe2.dz * agent.turnDir
    agent.signal = fx * tz - fz * tx > 0 ? -1 : 1
  }

  /** True when nobody in `lane`'s `way` direction is within a body length and a margin of arc `s` (room to pull in). */
  private clearAt(agent: TrafficAgent, lane: number, s: number, way: 1 | -1): boolean {
    const span = this.lanes[lane].length
    const loop = this.lanes[lane].loop
    for (const other of this.agents) {
      if (other === agent || other.lane !== lane || other.dir !== way) continue
      let d = Math.abs(other.s - s)
      if (loop) d = Math.min(d, span - d)
      if (d < (other.spec.length + agent.spec.length) / 2 + 8 + other.v * 1.2) return false
    }
    return true
  }

  /** True when driving `way` along `lane` from arc `s` reaches another junction (or the lane loops): not a dead-end spur. */
  private leadsOn(lane: Lane, s: number, way: 1 | -1): boolean {
    if (lane.loop) return true
    return lane.junctions.some((j) => (j.s - s) * way > 20)
  }

  private drive(agent: TrafficAgent, dt: number, obstacles: readonly Obstacle[]): void {
    const lane = this.lanes[agent.lane]
    const spec = agent.spec
    this.chooseTurn(agent)
    let desired = lane.limit * spec.pace
    for (let d = 10; d <= LOOKAHEAD; d += 15) {
      sampleLane(lane, agent.s + d * agent.dir, this.probe)
      const curve = Math.abs(this.probe.curve)
      if (curve > 1e-4) desired = Math.min(desired, Math.sqrt(Math.sqrt(LATERAL_COMFORT / curve) ** 2 + 2 * spec.brake * Math.max(0, d - 10)))
    }
    let gap = Infinity
    let leaderV = 0
    const turning = agent.turn && agent.turn.road >= 0 ? agent.turn : null
    if (turning) {
      const d = this.ahead(agent, turning.s)
      desired = Math.min(desired, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * spec.brake * Math.max(0, d - 4)))
      const hold = this.held.get(turning.id)
      if ((hold && hold.agent !== agent.id && d < 30) || (d < 30 && !this.clearAt(agent, turning.road, turning.otherS, agent.turnDir))) {
        gap = Math.max(0.1, d - 6)
        leaderV = 0
      } else if (d < JUNCTION_HOLD) this.held.set(turning.id, { agent: agent.id, until: this.clock + 4 })
    } else if (!lane.loop) {
      const end = agent.dir > 0 ? lane.length - agent.s : agent.s
      desired = Math.min(desired, Math.sqrt(2 * spec.brake * Math.max(0, end - 8)))
    }
    for (const other of this.agents) {
      if (other === agent || other.lane !== agent.lane || other.dir !== agent.dir) continue
      const d = this.ahead(agent, other.s)
      const room = d - (spec.length + other.spec.length) / 2
      if (d < LOOKAHEAD && room < gap) {
        gap = Math.max(0.1, room)
        leaderV = other.v
      }
    }
    sampleLane(lane, agent.s, this.probe)
    const fx = this.probe.dx * agent.dir, fz = this.probe.dz * agent.dir
    for (const o of obstacles) {
      const rx = o.x - agent.x, rz = o.z - agent.z
      const along = rx * fx + rz * fz
      const across = Math.abs(rx * -fz + rz * fx)
      if (along <= 0 || along > LOOKAHEAD || across > lane.offset + 2.6) continue
      const room = along - spec.length / 2 - o.half
      if (room < gap) {
        gap = Math.max(0.1, room)
        leaderV = Math.max(0, o.vx * fx + o.vz * fz)
      }
    }
    const v = agent.v
    let a = spec.accel * (1 - Math.pow(v / Math.max(0.5, desired), IDM_DELTA))
    if (gap < Infinity) {
      const sStar = spec.gap + v * spec.headway + (v * (v - leaderV)) / (2 * Math.sqrt(spec.accel * spec.brake))
      a -= spec.accel * (Math.max(0, sStar) / gap) ** 2
    }
    const firm = FIRM_BRAKE * spec.brake
    const room = gap - spec.gap
    const needed = room > 0 ? (v * v - leaderV * leaderV) / (2 * room) : Infinity
    a = Math.max(needed > firm ? -8 : -firm, Math.min(spec.accel, a))
    agent.accel += (a - agent.accel) * Math.min(1, dt * 4)
    agent.v = Math.max(0, v + agent.accel * dt)
    agent.braking = agent.accel < -0.6 || agent.v < 0.3
    const step = agent.v * dt
    if (turning && this.ahead(agent, turning.s) <= step) {
      agent.lane = turning.road
      agent.s = turning.otherS + agent.turnDir * (step - this.ahead(agent, turning.s))
      agent.dir = agent.turnDir
      agent.turn = null
      agent.signal = 0
    } else {
      agent.s += step * agent.dir
      if (lane.loop) agent.s = ((agent.s % lane.length) + lane.length) % lane.length
      else agent.s = Math.max(0, Math.min(lane.length, agent.s))
      const end = lane.loop ? Infinity : agent.dir > 0 ? lane.length - agent.s : agent.s
      if (end < 9 && agent.v < 0.8 && this.clearAt(agent, agent.lane, agent.s, agent.dir > 0 ? -1 : 1)) {
        agent.dir = agent.dir > 0 ? -1 : 1
        agent.turn = null
        agent.signal = 0
      }
      if (agent.turn && agent.turn.road < 0 && this.ahead(agent, agent.turn.s) === Infinity) agent.turn = null
    }
    this.place(agent, dt)
  }

  /** Writes the agent's pose from its lane position, with body roll, dive and squat from its accelerations. */
  private place(agent: TrafficAgent, dt: number): void {
    const lane = this.lanes[agent.lane]
    sampleLane(lane, agent.s, this.probe)
    const fx = this.probe.dx * agent.dir, fz = this.probe.dz * agent.dir
    const rightX = -fz, rightZ = fx
    agent.lateral = dt > 0 ? agent.lateral + (lane.offset - agent.lateral) * Math.min(1, dt * 1.5) : lane.offset
    const x = this.probe.x + rightX * agent.lateral
    const z = this.probe.z + rightZ * agent.lateral
    const heading = Math.atan2(fx, fz)
    const blend = dt > 0 ? Math.min(1, dt * 6) : 1
    let dh = heading - agent.heading
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    agent.heading += dh * blend
    agent.x = x
    agent.z = z
    agent.y = this.heightAt(x, z)
    const half = agent.spec.wheelbase / 2
    const front = this.heightAt(x + fx * half, z + fz * half)
    const back = this.heightAt(x - fx * half, z - fz * half)
    const curvature = this.probe.curve * agent.dir
    const lateralAccel = agent.v * agent.v * curvature
    agent.pitch += (Math.atan2(back - front, half * 2) + agent.accel * agent.spec.pitch - agent.pitch) * blend
    agent.roll += (lateralAccel * agent.spec.roll - agent.roll) * blend
    agent.steer = Math.atan(agent.spec.wheelbase * curvature)
    agent.spin += (agent.v * dt) / agent.spec.wheelRadius
    if (agent.kind === 'semi') {
      agent.trail.push({ x, z })
      const keep = 40
      if (agent.trail.length > keep) agent.trail.shift()
    }
  }

  /** Where a semi's trailer axle group is: `back` metres behind the fifth wheel along the path the rig drove. */
  trailerPoint(agent: TrafficAgent, back: number, out: { x: number; z: number }): { x: number; z: number } {
    sampleLane(this.lanes[agent.lane], agent.s - back * agent.dir, this.probe2)
    const fx = this.probe2.dx * agent.dir, fz = this.probe2.dz * agent.dir
    out.x = this.probe2.x - fz * agent.lateral
    out.z = this.probe2.z + fx * agent.lateral
    return out
  }
}
