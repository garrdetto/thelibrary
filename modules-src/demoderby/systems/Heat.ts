/** Heat rules: turns contact-force events into hits and dents at the real contact point (car on car, and car on barrier at a reduced scale), credits points, enforces the no-contact clock, hands out placings and decides when the heat is over. */
import * as THREE from 'three/webgpu'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { DamageSpec, ScoringSpec } from '../config'
import { Vehicle, type HitZone } from './Vehicle'

export type HeatPhase = 'countdown' | 'running' | 'finished'

export interface HeatEvent {
  kind: 'hit' | 'knockout' | 'idle-out' | 'burned' | 'wall' | 'finished'
  car: Vehicle
  other?: Vehicle
  strength?: number
  /** World-space contact point of a hit or a barrier strike. */
  point?: THREE.Vector3
}

interface PendingContact {
  c1: number
  c2: number
  force: number
  vertical: number
}

export interface HeatState {
  phase: HeatPhase
  clock: number
  countdown: number
  alive: number
  placed: number
  winner: Vehicle | null
}

const direction = new THREE.Vector3()
const WALL_ID = -1

export class Heat {
  readonly state: HeatState
  readonly events: HeatEvent[] = []
  /** When set, every car-to-car contact force (N) is appended here; used by the tests to calibrate damage. */
  forceLog: number[] | null = null
  private readonly byCollider = new Map<number, Vehicle>()
  private readonly pending: PendingContact[] = []
  private finishHold = 0

  constructor(
    readonly cars: readonly Vehicle[],
    private readonly damage: DamageSpec,
    private readonly scoring: ScoringSpec,
    countdown: number,
    private readonly finishHoldSeconds: number,
  ) {
    for (const car of cars) {
      this.byCollider.set(car.collider.handle, car)
      car.rules = damage
    }
    this.state = { phase: 'countdown', clock: 0, countdown, alive: cars.length, placed: 0, winner: null }
  }

  get player(): Vehicle | undefined {
    return this.cars.find((car) => car.isPlayer)
  }

  get running(): boolean {
    return this.state.phase === 'running'
  }

  tick(dt: number): void {
    const state = this.state
    if (state.phase === 'countdown') {
      state.countdown -= dt
      if (state.countdown <= 0) state.phase = 'running'
      return
    }
    if (state.phase === 'finished') return
    state.clock += dt
    for (const car of this.cars) {
      if (!car.alive) {
        if (car.place === 0 && car.outReason === 'wrecked') {
          this.retire(car)
          this.events.push({ kind: 'burned', car })
        }
        continue
      }
      if (car.idle >= this.damage.idleOutSeconds) {
        car.knockOut('idle')
        this.retire(car)
        this.events.push({ kind: 'idle-out', car })
      }
    }
    const alive = this.cars.filter((car) => car.alive)
    state.alive = alive.length
    if (alive.length <= 1) {
      this.finishHold += dt
      if (this.finishHold >= this.finishHoldSeconds || alive.length === 0) this.finish(alive[0] ?? null)
    }
  }

  /** Reads this step's contact-force events and applies hits: car on car to both cars, car on barrier to the car alone. With `world`, hits land at the solver's contact point. */
  resolveContacts(events: RAPIER.EventQueue, world?: RAPIER.World): void {
    if (!this.running) {
      events.drainContactForceEvents(() => {})
      return
    }
    const now = this.state.clock
    const pending = this.pending
    pending.length = 0
    events.drainContactForceEvents((event) => {
      const vertical = Math.abs(event.maxForceDirection().y)
      pending.push({ c1: event.collider1(), c2: event.collider2(), force: event.totalForceMagnitude(), vertical })
    })
    for (const contact of pending) {
      const a = this.byCollider.get(contact.c1)
      const b = this.byCollider.get(contact.c2)
      const force = contact.force
      if (a && b) {
        if (a === b) continue
        this.forceLog?.push(force)
        if (force >= this.damage.contactThreshold) {
          if (a.alive) a.idle = 0
          if (b.alive) b.idle = 0
        }
        if (force < this.damage.hitThreshold) continue
        const strength = Math.min(1, (force - this.damage.hitThreshold) / (this.damage.hitFull - this.damage.hitThreshold))
        this.applyHit(a, b, strength, now, this.contactPoint(world, contact.c1, contact.c2))
        continue
      }
      const car = a ?? b
      if (!car || contact.vertical > 0.6 || force < this.damage.wallHitThreshold) continue
      const point = this.contactPoint(world, contact.c1, contact.c2)
      if (!point) continue
      const strength = Math.min(1, (force - this.damage.wallHitThreshold) / (this.damage.hitFull - this.damage.wallHitThreshold))
      const loss = car.takeHit({ zone: car.zoneOf(point), strength, point, wall: true }, WALL_ID, now, this.damage)
      if (loss > 0) this.events.push({ kind: 'wall', car, strength, point })
      if (!car.alive && car.outReason === 'wrecked') this.retire(car)
    }
  }

  private contactPoint(world: RAPIER.World | undefined, c1: number, c2: number): THREE.Vector3 | null {
    if (!world) return null
    const first = world.getCollider(c1)
    const second = world.getCollider(c2)
    if (!first || !second) return null
    const sum = new THREE.Vector3()
    let count = 0
    world.contactPair(first, second, (manifold) => {
      const n = manifold.numSolverContacts()
      for (let i = 0; i < n; i++) {
        const p = manifold.solverContactPoint(i)
        sum.x += p.x
        sum.y += p.y
        sum.z += p.z
        count++
      }
    })
    return count ? sum.divideScalar(count) : null
  }

  private applyHit(a: Vehicle, b: Vehicle, strength: number, now: number, contact: THREE.Vector3 | null): void {
    const aWasAlive = a.alive
    const bWasAlive = b.alive
    const pointA = contact ? contact.clone() : direction.copy(b.pos).sub(a.pos).normalize().multiplyScalar(a.spec.length * 0.42).add(a.pos).clone()
    const pointB = contact ? contact.clone() : direction.copy(a.pos).sub(b.pos).normalize().multiplyScalar(b.spec.length * 0.42).add(b.pos).clone()
    const zoneA: HitZone = contact ? a.zoneOf(contact) : a.zoneOf(b.pos)
    const zoneB: HitZone = contact ? b.zoneOf(contact) : b.zoneOf(a.pos)
    const lossA = a.takeHit({ zone: zoneA, strength, point: pointA }, b.id, now, this.damage)
    const lossB = b.takeHit({ zone: zoneB, strength, point: pointB }, a.id, now, this.damage)
    if (lossA === 0 && lossB === 0) return
    if (aWasAlive) this.credit(a, b, strength, lossB, pointB)
    if (bWasAlive) this.credit(b, a, strength, lossA, pointA)
    for (const car of [a, b]) if (!car.alive && car.outReason === 'wrecked') this.retire(car)
  }

  private credit(hitter: Vehicle, struck: Vehicle, strength: number, lossOnStruck: number, point: THREE.Vector3): void {
    hitter.idle = 0
    hitter.hitsLanded++
    const points = Math.round(this.scoring.hitPoints * strength * (lossOnStruck > 0 ? 1 : 0.5))
    hitter.points += points
    this.events.push({ kind: 'hit', car: hitter, other: struck, strength, point })
    if (!struck.alive && struck.outReason === 'wrecked' && struck.place === 0) {
      hitter.knockouts++
      hitter.points += this.scoring.knockoutPoints
      this.retire(struck)
      this.events.push({ kind: 'knockout', car: hitter, other: struck })
    }
  }

  private retire(car: Vehicle): void {
    if (car.place !== 0) return
    this.state.placed++
    car.place = this.cars.length - this.state.placed + 1
  }

  private finish(lastAlive: Vehicle | null): void {
    const state = this.state
    state.phase = 'finished'
    const winner = lastAlive ?? this.cars.find((car) => car.place === 1) ?? null
    state.winner = winner
    if (winner) {
      winner.place = 1
      winner.points += this.scoring.winPoints
    }
    for (const car of this.cars) {
      if (car.place === 0) this.retire(car)
      car.points += Math.round(car.survived * this.scoring.survivalPerSecond)
    }
    this.events.push({ kind: 'finished', car: winner ?? this.cars[0] })
  }

  /** The player's score for the board: heat points, counted once the heat is over or the player is out. */
  playerScore(): number {
    const player = this.player
    if (!player) return 0
    return player.points + (this.state.phase === 'finished' ? 0 : Math.round(player.survived * this.scoring.survivalPerSecond))
  }

  drainEvents(): HeatEvent[] {
    return this.events.splice(0, this.events.length)
  }
}
