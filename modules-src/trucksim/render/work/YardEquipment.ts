/**
 * Yard equipment: the reefer dock door with rubber seal, bumpers, leveler and a dock light; the steel mill's overhead crane;
 * the parked forklift that drives in while a flatbed loads or unloads; the quarry's excavator or wheel loader (drawn from the
 * activity's machine pose, idling at the bay's mark otherwise) with its gravel stockpile; and the painted equipment pad.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { BodyPose, ExcavatorPose, LoaderPose } from '../../sim/types'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { at, boxAt, cylinder, sphere, tube } from '../models/truck/Geometry'
import { FallingMaterial } from '../models/CargoVisual'
import { buildExcavator, buildForklift, buildWheelLoader } from '../models/MachineVisual'
import { LAMP_LEVEL } from '../Materials'
import { MergeBatch, approach, clamp } from '../models/trailer/Merge'
import type { EquipmentEnv, ZoneEquipment } from './ZoneEquipment'
import { groundRig, isWorking, smoothstep, standPoint } from './ZoneEquipment'

/** The dock door on the building face at `zone.dock`. */
export function buildDockDoor(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const dock = zone.dock ?? { x: zone.x, z: zone.z }
  const rig = groundRig(env, 'dock', dock.x, dock.z, zone.heading)
  const floor = 1.3
  const b = new MergeBatch()
  b.add('concrete', boxAt(-1.85, -1.5, 0, 4.5, 0, 0.1))
  b.add('concrete', boxAt(1.5, 1.85, 0, 4.5, 0, 0.1))
  b.add('concrete', boxAt(-1.85, 1.85, 4.3, 4.6, 0, 0.1))
  b.add('rubber', boxAt(-1.72, -1.42, floor, 4.1, 0.1, 0.34))
  b.add('rubber', boxAt(1.42, 1.72, floor, 4.1, 0.1, 0.34))
  b.add('rubber', boxAt(-1.72, 1.72, 3.85, 4.15, 0.1, 0.34))
  for (const x of [-2.15, 2.15]) {
    b.add('rubber', boxAt(x - 0.15, x + 0.15, 0.95, 1.5, 0.0, 0.3))
    b.add('safety', boxAt(x - 0.16, x + 0.16, 1.5, 1.56, 0.0, 0.31))
  }
  b.add('steel', boxAt(-1.2, 1.2, floor - 0.05, floor, 0.1, 1.0))
  b.add('safety', boxAt(-1.2, 1.2, floor - 0.05, floor - 0.02, 1.0, 1.08))
  b.add('machineGrey', boxAt(-1.9, 1.9, 4.6, 5.0, 0, 0.5))
  b.add('darkSteel', tube([[2.1, 3.2, 0.1], [2.1, 4.0, 0.25], [1.4, 4.1, 0.9]], 0.03, 6))
  b.add('machineGrey', boxAt(2.0, 2.2, 3.1, 3.3, 0.0, 0.2))
  b.add('safety', boxAt(-2.4, -2.2, 2.0, 3.1, 0.0, 0.05))
  rig.batchOn(rig.root, 'dock', b)
  const lampMaterial = rig.palette.lamp('white', 'dock-light')
  const head = new MergeBatch().add('lampWhite', at(cylinder(0.26, 0.2, 0.18, 12), 1.4, 4.05, 1.0).transform(tilt()))
  const headMeshes = head.build(env.scene, 'dock-light', rig.root, rig.palette, rig.meshes) as Mesh[]
  for (const mesh of headMeshes) mesh.material = lampMaterial
  const door = rig.node('dock-door', rig.root)
  door.position.set(0, 4.2, 0.02)
  const slats = new MergeBatch()
  for (let i = 0; i < 8; i++) slats.add(i % 2 === 0 ? 'binSteel' : 'wrap', boxAt(-1.4, 1.4, -0.36 * (i + 1) + 0.01, -0.36 * i - 0.01, 0, 0.05))
  slats.add('darkSteel', boxAt(-0.15, 0.15, -2.2, -2.05, 0.05, 0.09))
  slats.add('glass', boxAt(-1.0, 1.0, -1.1, -0.9, -0.002, 0.052))
  rig.batchOn(door, 'dock-door', slats)
  let open = 0
  let light = 0
  return {
    update(dt, activity) {
      open = approach(open, activity && (activity.phase === 'loading' || activity.phase === 'unloading') ? 1 : 0, dt * 0.5)
      door.scaling.y = 1 - 0.92 * smoothstep(open)
      const target = activity && activity.phase !== 'idle' && activity.phase !== 'done' ? 1 : 0
      light = approach(light, target, dt * 3)
      lampMaterial.emissiveIntensity = LAMP_LEVEL.off + (LAMP_LEVEL.on - LAMP_LEVEL.off) * light
    },
    dispose: () => rig.dispose(),
  }
}

function tilt(): Matrix {
  return Matrix.RotationX(-0.5)
}

/** The steel mill's overhead crane: a portal bridge over the lane with a trolley, cable, hook block and chained spreader. */
export function buildBayCrane(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const rig = groundRig(env, 'crane', zone.x, zone.z, zone.heading)
  const b = new MergeBatch()
  const top = 9.5
  for (const side of [-1, 1]) {
    const x = side * 9.2
    for (const z of [-2.2, 2.2]) b.add('safety', boxAt(x - 0.25, x + 0.25, 0, top, z - 0.25, z + 0.25))
    b.add('machineGrey', boxAt(x - 0.4, x + 0.4, top, top + 0.7, -3.2, 3.2))
    b.add('darkSteel', boxAt(x - 0.15, x + 0.15, 4.0, 4.2, -2.2, 2.2))
    b.add('concrete', boxAt(x - 0.5, x + 0.5, 0, 0.2, -3, 3))
  }
  b.add('safety', boxAt(-9.6, 9.6, top + 0.1, top + 1.0, -0.4, 0.4))
  b.add('machineGrey', boxAt(-9.6, 9.6, top - 0.15, top + 0.1, -0.7, 0.7))
  b.add('darkSteel', boxAt(-9.6, 9.6, top + 1.0, top + 1.06, -0.5, 0.5))
  rig.batchOn(rig.root, 'crane', b)
  const trolley = rig.node('crane-trolley', rig.root)
  trolley.position.set(-6, top - 0.2, 0)
  const t = new MergeBatch()
  t.add('machineGrey', boxAt(-0.9, 0.9, -0.5, 0.3, -0.8, 0.8))
  t.add('safety', boxAt(-0.6, 0.6, 0.3, 0.55, -0.5, 0.5))
  t.add('darkSteel', at(cylinder(0.5, 0.5, 0.9, 12, 'z'), 0, -0.1, 0))
  rig.batchOn(trolley, 'crane-trolley', t)
  const cable = rig.node('crane-cable', trolley)
  cable.position.y = -0.5
  const c = new MergeBatch().add('darkSteel', boxAt(-0.015, 0.015, -1, 0, -0.015, 0.015))
  rig.batchOn(cable, 'crane-cable', c)
  const hook = rig.node('crane-hook', trolley)
  const h = new MergeBatch()
  h.add('safety', boxAt(-0.25, 0.25, -0.5, 0, -0.2, 0.2))
  h.add('chrome', at(cylinder(0.12, 0.12, 0.3, 8), 0, -0.65, 0))
  h.add('steel', boxAt(-2.2, 2.2, -1.25, -1.15, -0.1, 0.1))
  for (const x of [-2, 2]) h.add('darkSteel', tube([[0, -0.8, 0], [x, -1.2, 0]], 0.012, 5))
  rig.batchOn(hook, 'crane-hook', h)
  let x = -6
  let length = 1.2
  return {
    update(dt, activity) {
      let targetX = -6
      let targetLength = 1.2
      if (isWorking(activity) && activity) {
        const q = (activity.progress * 3) % 1
        const over = Math.sin(q * Math.PI)
        targetX = -6 * (1 - smoothstep(over * 1.4))
        targetLength = 1.2 + 6.2 * smoothstep((over - 0.55) / 0.45)
      }
      x = approach(x, targetX, dt * 6)
      length = approach(length, targetLength, dt * 3)
      trolley.position.x = x
      cable.scaling.y = length
      hook.position.y = -0.5 - length
    },
    dispose: () => rig.dispose(),
  }
}

/** A parked forklift that drives to the trailer while the zone's loading or unloading step runs. */
export function buildYardForklift(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const stand = standPoint(zone)
  const pad = groundRig(env, 'forklift-pad', stand.x, stand.z, 0)
  const b = new MergeBatch()
  b.add('concrete', boxAt(-1.6, 1.6, 0, 0.05, -2.2, 2.2))
  b.add('safety', boxAt(-1.6, 1.6, 0.05, 0.06, -2.2, -2.15))
  b.add('safety', boxAt(-1.6, 1.6, 0.05, 0.06, 2.15, 2.2))
  for (let i = 0; i < 4; i++) b.add('wood', boxAt(-2.6, -1.8, 0.0 + i * 0.12, 0.1 + i * 0.12, 0.5, 1.7))
  pad.batchOn(pad.root, 'forklift-pad', b)
  const fork = buildForklift(env.scene, env.parent, env.mats)
  const dx = zone.x - stand.x
  const dz = zone.z - stand.z
  const distance = Math.hypot(dx, dz)
  const stopShort = Math.max(0, distance - 3.6)
  const yaw = Math.atan2(dx, dz)
  const ux = distance > 0.01 ? dx / distance : 0
  const uz = distance > 0.01 ? dz / distance : 1
  const pose: BodyPose = { position: { x: stand.x, y: 0, z: stand.z }, rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } }
  let move = 0
  let lift = 0.15
  const place = () => {
    const x = stand.x + ux * stopShort * move
    const z = stand.z + uz * stopShort * move
    pose.position.x = x
    pose.position.z = z
    pose.position.y = env.heightAt(x, z)
    fork.update(pose, 0.02, lift)
  }
  place()
  return {
    update(dt, activity) {
      let targetMove = 0
      let targetLift = 0.15
      if (isWorking(activity) && activity) {
        const q = (activity.progress * 3) % 1
        targetMove = smoothstep(Math.sin(q * Math.PI) * 1.6)
        targetLift = q > 0.2 && q < 0.5 ? 1.3 : 0.2
      }
      move = approach(move, targetMove, dt * 0.5)
      lift = approach(lift, targetLift, dt * 1.2)
      place()
    },
    dispose() {
      fork.dispose()
      pad.dispose()
    },
  }
}

const IDLE_EXCAVATOR = { boom: 0.35, stick: 1.1, bucket: 0.5 }

/** The quarry bay machine and its gravel stockpile. */
export function buildDumpBay(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const stand = standPoint(zone)
  const isExcavator = zone.label.toLowerCase().includes('excavator')
  const vx = stand.x - zone.x
  const vz = stand.z - zone.z
  const length = Math.hypot(vx, vz) || 1
  const pileX = stand.x + (vx / length) * 8
  const pileZ = stand.z + (vz / length) * 8
  const piles = groundRig(env, 'stockpile', pileX, pileZ, 0)
  const p = new MergeBatch()
  p.add('gravel', at(sphere(7.0, 10, 1, 0.52, 1), 0, 0, 0))
  p.add('gravel', at(sphere(4.2, 8, 1, 0.5, 1), 3.6, 0, 2.2))
  p.add('gravel', at(sphere(3.0, 8, 1, 0.5, 1), -3.2, 0, 1.6))
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9
    p.add('gravel', boxAt(-0.2, 0.2, 0, 0.3, -0.18, 0.18).transform(rockMatrix(a, 4.2 + (k % 3) * 0.7, k)))
  }
  piles.batchOn(piles.root, 'stockpile', p)
  const quaternion = { x: 0, y: Math.sin(stand.heading / 2), z: 0, w: Math.cos(stand.heading / 2) }
  const idleBase: BodyPose = { position: { x: stand.x, y: env.heightAt(stand.x, stand.z), z: stand.z }, rotation: quaternion }
  const idleExcavator: ExcavatorPose = { ...idleBase, swing: 0, ...IDLE_EXCAVATOR, trackL: 0, trackR: 0 }
  const idleLoader: LoaderPose = { ...idleBase, arm: 0.15, bucket: 0, spin: 0, steer: 0 }
  const excavator = isExcavator ? buildExcavator(env.scene, env.parent, env.mats) : null
  const loader = isExcavator ? null : buildWheelLoader(env.scene, env.parent, env.mats)
  const fall = new FallingMaterial(env.scene, env.parent, env.mats, '#8d877d', 40, 0.1)
  const ground = env.heightAt(zone.x, zone.z)
  const apply = (machine: ExcavatorPose | LoaderPose | undefined) => {
    if (excavator) excavator.update(machine && 'swing' in machine ? machine : idleExcavator)
    if (loader) loader.update(machine && 'arm' in machine ? machine : idleLoader)
  }
  apply(undefined)
  return {
    update(dt, activity) {
      apply(activity?.machine)
      if (activity?.phase === 'loading') fall.pour(dt, zone.x, ground + 3.4, zone.z, clamp(activity.flow ?? 0.6, 0, 1), 40, 0.8)
      fall.update(dt, ground + 1.0)
    },
    dispose() {
      excavator?.dispose()
      loader?.dispose()
      fall.dispose()
      piles.dispose()
    },
  }
}

function rockMatrix(angle: number, radius: number, k: number): Matrix {
  return Matrix.RotationY(k).multiply(Matrix.Translation(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
}

/** A painted equipment pad for machine pickup and drop: concrete slab, yellow border, chocks and an arrow. */
export function buildEquipmentPad(env: EquipmentEnv): ZoneEquipment {
  const stand = standPoint(env.zone)
  const rig = groundRig(env, 'pad', stand.x, stand.z, stand.heading)
  const b = new MergeBatch()
  b.add('concrete', boxAt(-2.6, 2.6, 0, 0.07, -3.6, 3.6))
  for (const z of [-3.5, 3.5]) b.add('safety', boxAt(-2.6, 2.6, 0.07, 0.075, z - 0.08, z + 0.08))
  for (const x of [-2.5, 2.5]) b.add('safety', boxAt(x - 0.08, x + 0.08, 0.07, 0.075, -3.6, 3.6))
  b.add('safety', boxAt(-0.08, 0.08, 0.07, 0.075, -1.6, 1.2))
  b.add('safety', boxAt(-0.08, 0.5, 0.07, 0.075, 0.9, 1.0).transform(Matrix.RotationY(0.7).multiply(Matrix.Translation(0, 0, 0.1))))
  b.add('safety', boxAt(-0.5, 0.08, 0.07, 0.075, 0.9, 1.0).transform(Matrix.RotationY(-0.7).multiply(Matrix.Translation(0, 0, 0.1))))
  for (const x of [-1.2, 1.2]) b.add('rubber', boxAt(x - 0.25, x + 0.25, 0.07, 0.3, -3.1, -2.9))
  for (const x of [-2.5, 2.5]) for (const z of [-3.5, 3.5]) b.add('safety', at(cylinder(0.16, 0.16, 0.9, 8), x, 0.45, z))
  rig.batchOn(rig.root, 'pad', b)
  return { update() {}, dispose: () => rig.dispose() }
}
