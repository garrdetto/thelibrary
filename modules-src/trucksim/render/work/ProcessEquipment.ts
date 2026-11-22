/**
 * Process equipment at the refinery, stations and grain sites: the tanker loading rack gantry with its swing arm, the station
 * fill post with a hose reel, the round corrugated steel grain bin with a spout over the zone centre (pouring bits while it
 * fills), and the elevator's receiving pit with a grate and dump shed roof (grain falls into it while the hopper drains).
 */

import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { at, boxAt, cylinder, sphere, tube } from '../models/truck/Geometry'
import type { P3 } from '../models/truck/Geometry'
import { FallingMaterial } from '../models/CargoVisual'
import { MergeBatch, approach, clamp } from '../models/trailer/Merge'
import type { EquipmentEnv, ZoneEquipment } from './ZoneEquipment'
import { groundRig, lateralToZone, standPoint } from './ZoneEquipment'

const ARM_STOWED = -1.25

/** The loading rack: a stair gantry beside the lane with a counterweighted swing arm that lowers onto the tanker's hatch. */
export function buildTankRack(env: EquipmentEnv): ZoneEquipment {
  const stand = standPoint(env.zone)
  const { yaw, distance } = lateralToZone(env.zone)
  const rig = groundRig(env, 'tank-rack', stand.x, stand.z, yaw)
  const length = clamp(distance, 2.5, 9) + 0.2
  const pivotY = 4.5
  const b = new MergeBatch()
  b.add('concrete', boxAt(-1.6, 1.6, 0, 0.25, -1.6, 1.6))
  for (const x of [-1.2, 1.2]) for (const z of [-1.0, 1.0]) b.add('machineGrey', boxAt(x - 0.1, x + 0.1, 0.25, 3.9, z - 0.1, z + 0.1))
  b.add('darkSteel', boxAt(-1.4, 1.4, 3.9, 4.0, -1.2, 1.2))
  for (const x of [-1.2, 1.2]) b.add('machineGrey', boxAt(x - 0.04, x + 0.04, 4.0, 4.9, -1.15, -1.1))
  b.add('machineGrey', boxAt(-1.25, 1.25, 4.85, 4.9, -1.15, -1.1))
  b.add('machineGrey', boxAt(-1.25, 1.25, 4.4, 4.43, -1.15, -1.1))
  for (const z of [-1.2, 1.2]) b.add('machineGrey', boxAt(-1.4, 1.4, 4.4, 4.43, z - 0.02, z + 0.02))
  for (let i = 0; i < 12; i++) {
    const t = i / 11
    b.add('darkSteel', boxAt(-1.55, -1.25, 0.25 + t * 3.65 - 0.03, 0.25 + t * 3.65 + 0.03, -2.4 + t * 1.3 - 0.15, -2.4 + t * 1.3 + 0.15))
  }
  b.add('machineGrey', boxAt(-1.62, -1.57, 0.25, 3.95, -2.6, -1.0))
  b.add('machineGrey', boxAt(-1.27, -1.22, 0.25, 3.95, -2.6, -1.0))
  b.add('aluminum', tube([[0.9, 0.7, -1.2], [0.9, 0.7, -6.5]], 0.1, 10))
  b.add('aluminum', tube([[0.9, 0.7, -1.2], [0.9, 3.8, -1.2]], 0.1, 10))
  b.add('safety', boxAt(-1.2, 1.2, 3.1, 3.4, 1.15, 1.2))
  b.add('chrome', at(cylinder(0.3, 0.3, 0.2, 14), 0, pivotY - 0.2, 0))
  b.add('steel', boxAt(-0.2, 0.2, pivotY - 0.5, pivotY - 0.2, -0.2, 0.2))
  rig.batchOn(rig.root, 'tank-rack', b)
  const arm = rig.node('tank-rack-arm', rig.root)
  arm.position.set(0, pivotY, 0)
  const a = new MergeBatch()
  a.add('aluminum', tube([[0, 0, -1.2], [0, 0, length]], 0.09, 10))
  a.add('machineGrey', boxAt(-0.25, 0.25, -0.25, 0.25, -1.9, -1.2))
  a.add('chrome', at(cylinder(0.2, 0.2, 0.3, 12), 0, 0, length))
  a.add('hoseBlue', at(cylinder(0.3, 0.3, 0.12, 14), 0, -0.15, length - 0.05))
  const hose: P3[] = []
  for (let i = 0; i <= 6; i++) hose.push([0.08, -0.3 * Math.sin((Math.PI * i) / 6) - 0.1, length * (0.4 + 0.5 * (i / 6))])
  a.add('hoseRed', tube(hose, 0.04, 8))
  rig.batchOn(arm, 'tank-rack-arm', a)
  const connected = Math.atan2(pivotY - 3.35, length)
  arm.rotation.x = ARM_STOWED
  let value = 0
  return {
    update(dt, activity) {
      const target = activity?.arm !== undefined ? clamp(activity.arm, 0, 1) : activity && (activity.phase === 'filling' || activity.phase === 'draining') ? 1 : 0
      value = approach(value, target, dt * 0.6)
      arm.rotation.x = ARM_STOWED + (connected - ARM_STOWED) * value
    },
    dispose: () => rig.dispose(),
  }
}

/** The station fill post: a bollard-guarded fill pipe, a spill box and a hose reel that turns while the tank drains. */
export function buildFillPost(env: EquipmentEnv): ZoneEquipment {
  const stand = standPoint(env.zone)
  const { yaw } = lateralToZone(env.zone)
  const rig = groundRig(env, 'fill-post', stand.x, stand.z, yaw)
  const b = new MergeBatch()
  b.add('concrete', boxAt(-1.4, 1.4, 0, 0.1, -1.2, 1.2))
  b.add('darkSteel', at(cylinder(0.7, 0.7, 0.04, 20), 0, 0.12, 1.0))
  b.add('steel', at(cylinder(0.5, 0.5, 0.02, 20), 0, 0.14, 1.0))
  b.add('machineGrey', boxAt(-0.3, 0.3, 0.1, 0.8, -0.3, 0.3))
  b.add('hoseRed', at(cylinder(0.14, 0.14, 0.12, 12), 0, 0.86, 0))
  b.add('aluminum', at(cylinder(0.1, 0.1, 0.35, 10), 0.6, 0.28, 0.2))
  b.add('hoseRed', at(cylinder(0.16, 0.16, 0.05, 10), 0.6, 0.48, 0.2))
  for (const x of [-1.2, 1.2]) b.add('safety', at(cylinder(0.2, 0.2, 0.9, 10), x, 0.55, 0.8))
  b.add('machineGrey', boxAt(-1.0, -0.9, 0.1, 1.3, -0.6, -0.5))
  b.add('machineGrey', boxAt(-0.2, -0.1, 0.1, 1.3, -0.6, -0.5))
  rig.batchOn(rig.root, 'fill-post', b)
  const reel = rig.node('fill-reel', rig.root)
  reel.position.set(-0.55, 1.05, -0.55)
  const r = new MergeBatch()
  r.add('machineGrey', at(cylinder(0.75, 0.75, 0.05, 20, 'x'), 0.2, 0, 0))
  r.add('machineGrey', at(cylinder(0.75, 0.75, 0.05, 20, 'x'), -0.2, 0, 0))
  r.add('steel', at(cylinder(0.2, 0.2, 0.4, 10, 'x'), 0, 0, 0))
  const coil: P3[] = []
  for (let i = 0; i <= 40; i++) {
    const turn = i / 10
    const radius = 0.3 + 0.06 * Math.floor(turn)
    const angle = Math.PI * 2 * turn
    coil.push([-0.16 + ((i % 10) / 10) * 0.32, Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  r.add('hoseRed', tube(coil, 0.03, 6))
  rig.batchOn(reel, 'fill-reel', r)
  return {
    update(dt, activity) {
      if (activity?.phase === 'draining') reel.rotation.x += dt * 0.8
    },
    dispose: () => rig.dispose(),
  }
}

/** The grain bin: corrugated cylinder with a cone roof, ladder and a spout that reaches over the zone centre. */
export function buildGrainBin(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const leftX = Math.cos(zone.heading)
  const leftZ = -Math.sin(zone.heading)
  const radius = 4.5
  const offset = radius + 2.2
  const binX = zone.x + leftX * offset
  const binZ = zone.z + leftZ * offset
  const rig = groundRig(env, 'grain-bin', binX, binZ, Math.atan2(-leftX, -leftZ))
  const height = 9
  const b = new MergeBatch()
  b.add('concrete', at(cylinder(radius * 2 + 0.6, radius * 2 + 0.6, 0.4, 28), 0, 0.2, 0))
  b.add('binSteel', at(cylinder(radius * 2, radius * 2, height, 28), 0, 0.4 + height / 2, 0))
  for (let y = 0.8; y < height; y += 0.5) b.add('binSteel', at(cylinder(radius * 2 + 0.07, radius * 2 + 0.07, 0.12, 28), 0, y, 0))
  for (let k = 0; k < 24; k++) {
    const a = (Math.PI * 2 * k) / 24
    b.add('steel', boxAt(-0.05, 0.05, 0.4, height + 0.4, radius - 0.01, radius + 0.06).transform(Matrix.RotationY(a)))
  }
  b.add('binSteel', at(cylinder(0.5, radius * 2 + 0.5, 2.4, 28), 0, 0.4 + height + 1.2, 0))
  b.add('steel', at(cylinder(1.0, 1.0, 0.5, 14), 0, 0.4 + height + 2.6, 0))
  b.add('binSteel', at(sphere(1.0, 8, 1, 0.6, 1), 0, 0.4 + height + 2.9, 0))
  for (const side of [-0.45, 0.45]) b.add('steel', boxAt(radius + 0.05, radius + 0.09, 0.4, height + 0.2, side - 0.02, side + 0.02))
  for (let y = 0.8; y < height; y += 0.45) b.add('steel', boxAt(radius + 0.05, radius + 0.09, y, y + 0.03, -0.45, 0.45))
  b.add('darkSteel', boxAt(-radius - 0.04, -radius + 0.04, 0.5, 2.3, -0.5, 0.5))
  rig.batchOn(rig.root, 'grain-bin', b)
  const spoutY = 4.6
  const local = new MergeBatch()
  local.add('binSteel', tube([[0, 7.4, radius - 0.2], [0, spoutY + 0.5, offset]], 0.22, 10))
  local.add('steel', tube([[0, spoutY + 0.5, offset], [0, spoutY - 0.1, offset]], 0.3, 12))
  local.add('hoseBlue', tube([[0, spoutY - 0.1, offset], [0, spoutY - 0.5, offset]], 0.18, 10))
  rig.batchOn(rig.root, 'grain-spout', local)
  const fall = new FallingMaterial(env.scene, env.parent, env.mats, '#d3a93a', 56, 0.06)
  const ground = env.heightAt(zone.x, zone.z)
  return {
    update(dt, activity) {
      if (activity?.phase === 'filling') fall.pour(dt, zone.x, ground + spoutY - 0.5, zone.z, clamp(activity.flow ?? 1, 0, 1), 55, 0.2)
      fall.update(dt, ground + 2.6)
    },
    dispose() {
      fall.dispose()
      rig.dispose()
    },
  }
}

/** The grain pit: a recessed grate in a raised kerb under a dump shed roof; grain pours into it while the hopper drains. */
export function buildGrainPit(env: EquipmentEnv): ZoneEquipment {
  const { zone } = env
  const rig = groundRig(env, 'grain-pit', zone.x, zone.z, zone.heading)
  const b = new MergeBatch()
  b.add('concrete', boxAt(-2.4, 2.4, 0, 0.12, -3.0, 3.0))
  b.add('darkSteel', boxAt(-1.9, 1.9, 0.08, 0.14, -2.5, 2.5))
  for (let x = -1.8; x <= 1.8; x += 0.3) b.add('steel', boxAt(x - 0.02, x + 0.02, 0.12, 0.17, -2.5, 2.5))
  for (let z = -2.4; z <= 2.4; z += 0.5) b.add('steel', boxAt(-1.9, 1.9, 0.12, 0.17, z - 0.02, z + 0.02))
  for (const x of [-3.6, 3.6]) for (const z of [-4.5, 4.5]) b.add('machineGrey', boxAt(x - 0.14, x + 0.14, 0, 5.4, z - 0.14, z + 0.14))
  b.add('binSteel', boxAt(-4.2, 4.2, 5.4, 5.5, -5.2, 5.2))
  for (const z of [-4.5, 0, 4.5]) b.add('darkSteel', boxAt(-3.7, 3.7, 5.3, 5.4, z - 0.08, z + 0.08))
  b.add('binSteel', boxAt(-4.2, 4.2, 5.5, 5.9, -5.2, -5.1))
  b.add('binSteel', boxAt(-4.2, 4.2, 5.5, 5.9, 5.1, 5.2))
  b.add('lampWhite', boxAt(-0.3, 0.3, 5.28, 5.3, -0.3, 0.3))
  rig.batchOn(rig.root, 'grain-pit', b)
  const fall = new FallingMaterial(env.scene, env.parent, env.mats, '#d3a93a', 56, 0.06)
  const ground = env.heightAt(zone.x, zone.z)
  return {
    update(dt, activity) {
      if (activity?.phase === 'draining') fall.pour(dt, zone.x, ground + 1.0, zone.z, clamp(activity.flow ?? 1, 0, 1), 55, 0.5)
      fall.update(dt, ground + 0.14)
    },
    dispose() {
      fall.dispose()
      rig.dispose()
    },
  }
}
