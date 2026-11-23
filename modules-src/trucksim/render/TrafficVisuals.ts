/**
 * Draws and solidifies the background `Traffic`: one visual per agent, built when the agent appears and disposed when it goes.
 * Cars come from `CarModel`; semis are a catalog tractor in a random factory design pulling a random trailer, the trailer
 * pivoting on the fifth wheel and following the path the tractor drove, so it cuts corners like a real one. Every vehicle has a
 * kinematic Rapier body that follows its pose (two for a semi), so the player's rig cannot drive through traffic.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { DESIGNS, TRAILERS, TRUCKS, designLook, defaultLook } from '../shared/Catalog'
import type { TrailerModel, TruckModel } from '../shared/Catalog'
import type { PhysicsHost } from '../sim/PhysicsHost'
import type { Traffic, TrafficAgent } from '../sim/Traffic'
import type { TrailerPose, TruckPose, WheelPose } from '../sim/types'
import type { MaterialLibrary } from './Materials'
import { buildCar, CAR_STYLES } from './models/CarModel'
import type { CarPose, CarVisual } from './models/CarModel'
import { buildTrailerVisual } from './models/TrailerVisual'
import type { TrailerVisual } from './models/TrailerVisual'
import { buildTruckVisual } from './models/TruckVisual'
import type { TruckVisual } from './models/TruckVisual'

const SEMI_TRUCKS: TruckModel[] = TRUCKS.filter((model) => model.fifthWheelZ !== undefined)
const SEMI_TRAILERS: TrailerModel[] = TRAILERS.filter((model) => !model.rgn)
const BLINK_SECONDS = 0.38

interface Entry {
  car: CarVisual | null
  truck: TruckVisual | null
  trailer: TrailerVisual | null
  truckModel: TruckModel | null
  trailerModel: TrailerModel | null
  bodies: RAPIER.RigidBody[]
  truckPose: TruckPose | null
  trailerPose: TrailerPose | null
}

function quat(heading: number, pitch: number, roll: number): { x: number; y: number; z: number; w: number } {
  const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2)
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2)
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2)
  return { x: cy * sp * cr + sy * cp * sr, y: sy * cp * cr - cy * sp * sr, z: cy * cp * sr - sy * sp * cr, w: cy * cp * cr + sy * sp * sr }
}

function wheelPoses(axles: { z: number; dual: boolean }[], track: number, radius: number): WheelPose[] {
  return axles.flatMap((axle) => [1, -1].map((side) => ({ x: (side * track) / 2, y: radius, z: axle.z, steer: 0, spin: 0, radius, dual: axle.dual, lifted: false })))
}

export class TrafficVisuals {
  private readonly entries = new Map<number, Entry>()
  private clock = 0
  private readonly trailerAt = { x: 0, z: 0 }

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode,
    private readonly mats: MaterialLibrary,
    private readonly physics: PhysicsHost | null,
    private readonly traffic: Traffic,
  ) {}

  get count(): number {
    return this.entries.size
  }

  /** Every mesh traffic draws right now (for shadow casters). */
  meshes(): AbstractMesh[] {
    const out: AbstractMesh[] = []
    for (const e of this.entries.values()) out.push(...(e.car?.meshes ?? []), ...(e.truck?.meshes ?? []), ...(e.trailer?.meshes ?? []))
    return out
  }

  /** Builds visuals for new agents, poses everyone, moves the kinematic bodies and removes what left. `night` turns lamps on. */
  sync(dt: number, night: boolean): void {
    this.clock += dt
    const blinkOn = Math.floor(this.clock / BLINK_SECONDS) % 2 === 0
    const alive = new Set<number>()
    for (const agent of this.traffic.agents) {
      alive.add(agent.id)
      let entry = this.entries.get(agent.id)
      if (!entry) {
        entry = this.create(agent)
        this.entries.set(agent.id, entry)
      }
      this.pose(agent, entry, blinkOn, night)
    }
    for (const [id, entry] of this.entries) {
      if (alive.has(id)) continue
      this.destroy(entry)
      this.entries.delete(id)
    }
  }

  private create(agent: TrafficAgent): Entry {
    const entry: Entry = { car: null, truck: null, trailer: null, truckModel: null, trailerModel: null, bodies: [], truckPose: null, trailerPose: null }
    if (agent.kind === 'semi' && SEMI_TRUCKS.length && SEMI_TRAILERS.length) {
      const model = SEMI_TRUCKS[agent.variant % SEMI_TRUCKS.length]
      const design = DESIGNS[(agent.id + agent.variant) % DESIGNS.length]
      const base = defaultLook(model)
      base.paint.primary = agent.color
      entry.truckModel = model
      entry.truck = buildTruckVisual(this.scene, this.parent, model, designLook(model, design.id, base), this.mats)
      const trailer = SEMI_TRAILERS[(agent.id * 7 + agent.variant) % SEMI_TRAILERS.length]
      entry.trailerModel = trailer
      entry.trailer = buildTrailerVisual(this.scene, this.parent, trailer, trailer.defaultColor, this.mats)
      entry.truckPose = {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheels: wheelPoses(model.axles, model.track, model.wheelRadius),
        dumpAngle: 0, tailgate: 0, brakeLights: false, reversing: false, headlights: false, load: 0,
      }
      entry.trailerPose = {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
        wheels: wheelPoses(trailer.axles.map((z) => ({ z, dual: true })), trailer.width - 0.4, trailer.wheelRadius),
        landingGear: 0, gooseneck: null, doors: 0, brakeLights: false,
      }
      this.addBody(entry, 1.3, 1.6, (model.frontZ - model.rearZ) / 2)
      this.addBody(entry, trailer.width / 2, trailer.height / 2, (trailer.frontZ - trailer.rearZ) / 2)
    } else {
      const style = CAR_STYLES[agent.variant % CAR_STYLES.length]
      entry.car = buildCar(this.scene, this.parent, this.mats, style, agent.color, `traffic-${agent.id}`)
      this.addBody(entry, 0.95, 0.75, agent.spec.length / 2)
    }
    return entry
  }

  private addBody(entry: Entry, hx: number, hy: number, hz: number): void {
    const host = this.physics
    if (!host) return
    const R = host.rapier
    const body = host.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
    host.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, hy, 0).setCollisionGroups(host.groups.chassis), body)
    entry.bodies.push(body)
  }

  private pose(agent: TrafficAgent, entry: Entry, blinkOn: boolean, night: boolean): void {
    const q = quat(agent.heading, agent.pitch, agent.roll)
    if (entry.car) {
      const pose: CarPose = { x: agent.x, y: agent.y, z: agent.z, heading: agent.heading, pitch: agent.pitch, roll: agent.roll, steer: agent.steer, spin: agent.spin, braking: agent.braking, signal: agent.signal, blinkOn }
      entry.car.update(pose)
      this.moveBody(entry.bodies[0], agent.x, agent.y, agent.z, q)
      return
    }
    const model = entry.truckModel, trailer = entry.trailerModel, tp = entry.truckPose, rp = entry.trailerPose
    if (!model || !trailer || !tp || !rp || !entry.truck || !entry.trailer) return
    const fx = Math.sin(agent.heading), fz = Math.cos(agent.heading)
    const mid = (model.axles[0].z + model.axles[model.axles.length - 1].z) / 2
    const ox = agent.x - fx * mid, oz = agent.z - fz * mid
    tp.position.x = ox
    tp.position.y = agent.y
    tp.position.z = oz
    tp.rotation = q
    for (const w of tp.wheels) {
      w.spin = agent.spin
      w.steer = w.z === model.axles[0].z ? agent.steer : 0
    }
    tp.brakeLights = agent.braking
    tp.headlights = night
    entry.truck.update(tp)
    const fifth = model.fifthWheelZ ?? model.rearZ
    const kx = ox + fx * fifth, kz = oz + fz * fifth
    const axleBack = -(trailer.axles[0] + trailer.axles[trailer.axles.length - 1]) / 2
    this.traffic.trailerPoint(agent, mid - fifth + axleBack, this.trailerAt)
    const theading = Math.atan2(kx - this.trailerAt.x, kz - this.trailerAt.z)
    rp.position.x = kx
    rp.position.y = this.heightBelow(agent, kx, kz)
    rp.position.z = kz
    rp.rotation = quat(theading, agent.pitch * 0.6, agent.roll * 0.8)
    for (const w of rp.wheels) w.spin = agent.spin * (model.wheelRadius / trailer.wheelRadius)
    rp.brakeLights = agent.braking
    entry.trailer.update(rp)
    this.moveBody(entry.bodies[0], ox + fx * ((model.frontZ + model.rearZ) / 2), agent.y, oz + fz * ((model.frontZ + model.rearZ) / 2), q)
    const tmid = (trailer.frontZ + trailer.rearZ) / 2
    this.moveBody(entry.bodies[1], kx + Math.sin(theading) * tmid, rp.position.y, kz + Math.cos(theading) * tmid, rp.rotation)
  }

  private heightBelow(agent: TrafficAgent, _x: number, _z: number): number {
    return agent.y
  }

  private moveBody(body: RAPIER.RigidBody | undefined, x: number, y: number, z: number, q: { x: number; y: number; z: number; w: number }): void {
    if (!body) return
    body.setNextKinematicTranslation({ x, y, z })
    body.setNextKinematicRotation(q)
  }

  private destroy(entry: Entry): void {
    entry.car?.dispose()
    entry.truck?.dispose()
    entry.trailer?.dispose()
    if (this.physics) for (const body of entry.bodies) this.physics.world.removeRigidBody(body)
    entry.bodies.length = 0
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.destroy(entry)
    this.entries.clear()
  }
}
