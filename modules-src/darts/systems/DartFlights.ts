/** Plays darts through the air from their sampled flights, sticks them in the board with a damped quiver (or drops bounce-outs and floor darts), and pulls them all out when a turn ends. */
import * as THREE from 'three/webgpu'
import { BULL_HEIGHT } from '../shared/Board'
import type { FlightParams } from '../shared/interfaces'
import { FLOOR_Y, onBoardFace, simulate, type FlightSample, type Impact } from '../shared/Physics'
import { aimDart, type DartKit } from '../render/Dart'

interface Flying {
  mesh: THREE.Group
  samples: FlightSample[]
  impact: Impact
  t: number
  phase: 'air' | 'stuck' | 'falling' | 'floor'
  stuckAt: number
  fallVelocity: number
  rest: THREE.Quaternion
  done: (() => void) | null
}

const PENETRATION = 0.009
const QUIVER_SECONDS = 0.7
const tmp = new THREE.Vector3()
const tmpV = new THREE.Vector3()
const wobbleAxis = new THREE.Vector3()
const wobbleQ = new THREE.Quaternion()

function world(p: readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
  return out.set(p[0], p[1] + BULL_HEIGHT, p[2])
}

export class DartFlights {
  private readonly darts: Flying[] = []
  private clock = 0

  constructor(
    private readonly kit: DartKit,
    private readonly parent: THREE.Object3D,
  ) {}

  /** Starts a dart on its way; `onLand` fires when it hits the board, the wall or the floor. Returns the impact computed from the same flight. */
  throw(flight: FlightParams, color: string, onLand?: () => void): Impact {
    const samples: FlightSample[] = []
    const impact = simulate(flight, samples, 1 / 240)
    const mesh = this.kit.create(color)
    world(flight.origin, mesh.position)
    aimDart(mesh, flight.velocity)
    this.parent.add(mesh)
    this.darts.push({ mesh, samples, impact, t: 0, phase: 'air', stuckAt: 0, fallVelocity: 0, rest: new THREE.Quaternion(), done: onLand ?? null })
    return impact
  }

  get inFlight(): boolean {
    return this.darts.some((dart) => dart.phase === 'air' || dart.phase === 'falling')
  }

  get count(): number {
    return this.darts.length
  }

  update(dt: number): void {
    this.clock += dt
    for (const dart of this.darts) {
      if (dart.phase === 'air') this.fly(dart, dt)
      else if (dart.phase === 'stuck') this.quiver(dart)
      else if (dart.phase === 'falling') this.fall(dart, dt)
    }
  }

  private fly(dart: Flying, dt: number): void {
    dart.t += dt
    const samples = dart.samples
    const last = samples[samples.length - 1]
    if (dart.t >= last.t) {
      this.land(dart)
      return
    }
    let i = 0
    while (i < samples.length - 2 && samples[i + 1].t < dart.t) i++
    const a = samples[i]
    const b = samples[i + 1]
    const f = (dart.t - a.t) / Math.max(1e-6, b.t - a.t)
    tmp.set(a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f + BULL_HEIGHT, a.p[2] + (b.p[2] - a.p[2]) * f)
    dart.mesh.position.copy(tmp)
    tmpV.set(a.v[0] + (b.v[0] - a.v[0]) * f, a.v[1] + (b.v[1] - a.v[1]) * f, a.v[2] + (b.v[2] - a.v[2]) * f)
    aimDart(dart.mesh, tmpV)
  }

  private land(dart: Flying): void {
    const { impact } = dart
    const done = dart.done
    dart.done = null
    if (impact.reachedBoard && onBoardFace(impact.point[0], impact.point[1])) {
      tmpV.set(impact.velocity[0], impact.velocity[1], impact.velocity[2]).normalize()
      world(impact.point, dart.mesh.position).addScaledVector(tmpV, PENETRATION)
      tmpV.y += 0.05
      aimDart(dart.mesh, tmpV)
      dart.rest.copy(dart.mesh.quaternion)
      dart.phase = 'stuck'
      dart.stuckAt = this.clock
    } else if (impact.reachedBoard) {
      world(impact.point, dart.mesh.position)
      dart.mesh.position.z = 0.04
      dart.phase = 'falling'
      dart.fallVelocity = 0
    } else {
      this.toFloor(dart)
    }
    done?.()
  }

  private quiver(dart: Flying): void {
    const age = this.clock - dart.stuckAt
    if (age > QUIVER_SECONDS) {
      dart.mesh.quaternion.copy(dart.rest)
      return
    }
    const amount = Math.exp(-age * 7) * 0.05 * Math.sin(age * 55)
    wobbleAxis.set(1, 0.3, 0).normalize()
    wobbleQ.setFromAxisAngle(wobbleAxis, amount)
    dart.mesh.quaternion.copy(dart.rest).multiply(wobbleQ)
  }

  private fall(dart: Flying, dt: number): void {
    dart.fallVelocity += 9.81 * dt
    dart.mesh.position.y -= dart.fallVelocity * dt
    dart.mesh.rotateX(dt * 6)
    if (dart.mesh.position.y <= BULL_HEIGHT + FLOOR_Y + 0.01) this.toFloor(dart)
  }

  private toFloor(dart: Flying): void {
    dart.mesh.position.y = 0.006
    dart.mesh.position.z = Math.max(0.05, dart.mesh.position.z)
    tmpV.set(Math.sin(dart.mesh.position.x * 40), -0.05, Math.cos(dart.mesh.position.x * 40))
    aimDart(dart.mesh, tmpV)
    dart.phase = 'floor'
  }

  /** Pulls every dart (end of a turn). */
  clear(): void {
    for (const dart of this.darts) {
      dart.done?.()
      dart.mesh.removeFromParent()
    }
    this.darts.length = 0
  }

  dispose(): void {
    this.clear()
  }
}
