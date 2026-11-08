/**
 * The town's working vehicles: police cruisers, fire engines, ambulances, lawn trucks, city trucks, a fuel tanker, the resort shuttle
 * and the prison bus. Bodies come from the Blender set (`public/models/hood/vehicles.glb`, built by `tools/build-vehicles.py`) or,
 * if that can't load, from the box-built fallback. Either way the body sits on springs over its wheels: it pitches when the vehicle
 * accelerates or brakes, leans out of corners and rocks to a stop, while the front wheels steer, every wheel rolls with the road
 * speed, brake lights come on when slowing or holding, reverse lights while backing up, and a trailer swings on its hitch.
 */
import * as THREE from 'three/webgpu'
import { RIGS } from '../../shared/Drive'
import type { VehicleKind } from '../../shared/TownSim'
import { mergeStatic } from './Merge'
import { models } from './Models'
import { sideLabel } from './Signs'
import { buildBoxKit, buildBoxWreck } from './VehicleBoxes'

export interface VehicleDrive {
  speed: number
  accel: number
  lat: number
  steer: number
  trailer: number
  moving: boolean
  lights: boolean
  bucket: number
}

export interface VehicleModel {
  group: THREE.Group
  update(drive: VehicleDrive, dt: number, time: number, night: number): void
}

interface Bar { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; color: THREE.Color; phase: number }

interface Parts {
  group: THREE.Group
  body: THREE.Object3D[]
  wheels: THREE.Object3D[]
  bars: Bar[]
  heads: THREE.MeshStandardMaterial[]
  tails: THREE.MeshStandardMaterial[]
  reverse: THREE.MeshStandardMaterial[]
  boom?: THREE.Object3D
  arm?: THREE.Object3D
  trailer?: THREE.Object3D
  trailerWheels: THREE.Object3D[]
}

const LABELS: Partial<Record<VehicleKind, [string, string, number, number, number, number, number][]>> = {
  cruiser: [['HOOD POLICE', '#13284d', 1.9, 0.3, 0.935, 0.7, 0.05]],
  delivery: [['SUNNY SIDE', '#b5341f', 1.6, 0.28, 0.86, 0.68, 0.1]],
  pickup: [['CITY WORKS', '#c4571d', 1.5, 0.3, 1.0, 1.15, 1.2]],
  lawntruck: [['GREENLINE', '#f2f2e8', 1.5, 0.3, 1.0, 1.15, 1.2]],
  engine: [['FIRE STATION 7', '#f4e6b0', 2.8, 0.38, 1.26, 2.62, -1.0]],
  ambulance: [['MEDIC', '#c62828', 1.6, 0.42, 1.16, 1.75, -0.9]],
  garbage: [['CITY WORKS', '#f2f2ee', 3.4, 0.48, 1.26, 2.4, -1.4]],
  utility: [['CITY WORKS', '#ffffff', 2.4, 0.32, 1.16, 1.2, -1.0]],
  shuttle: [['HOOD SPRINGS RESORT', '#ffffff', 4.2, 0.36, 1.16, 0.8, -0.2]],
  bus: [['KETTLE RIDGE CORRECTIONS', '#2c4a8a', 5.8, 0.38, 1.26, 1.58, -0.4]],
  tanker: [['FUEL', '#c62f2f', 2.6, 0.62, 1.12, 2.0, -1.1]],
}

const LAMP_NAMES = { headlamp: 'heads', taillamp: 'tails', reverse_lamp: 'reverse' } as const
const BAR_COLORS: Record<string, string> = { red: '#ff2a2a', blue: '#2a5bff', white: '#ffffff', amber: '#ffb21a' }

/** A copy of a Blender vehicle with its own lamp and light-bar materials, so each one can brake and flash on its own. */
function fromModel(kind: VehicleKind | 'wreck'): Parts | null {
  const source = models.vehicles?.getObjectByName(kind)
  if (!source) return null
  const root = source.clone(true)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  const group = new THREE.Group()
  const parts: Parts = { group, body: [], wheels: [], bars: [], heads: [], tails: [], reverse: [], trailerWheels: [] }
  const own = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const material = mesh.material as THREE.MeshStandardMaterial
    const lamp = LAMP_NAMES[material.name as keyof typeof LAMP_NAMES]
    if (lamp) {
      let copy = own.get(material)
      if (!copy) {
        copy = material.clone()
        copy.emissive = new THREE.Color(lamp === 'heads' ? '#fff2c8' : lamp === 'tails' ? '#ff2a1a' : '#ffffff')
        copy.emissiveIntensity = 0
        own.set(material, copy)
        parts[lamp].push(copy)
        mesh.userData.ownMaterial = copy
      }
      mesh.material = copy
    }
  })
  for (const child of [...root.children]) {
    const name = child.name
    if (name.startsWith('wheel_')) parts.wheels.push(child)
    else if (name.startsWith('bar_')) {
      const color = new THREE.Color(BAR_COLORS[name.split('_')[2]] ?? '#ff2a2a')
      const index = Number(name.split('_')[1]) || 0
      child.traverse(node => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const material = (mesh.material as THREE.MeshStandardMaterial).clone()
        material.emissive = color
        material.emissiveIntensity = 0
        mesh.material = material
        mesh.userData.ownMaterial = material
        mesh.castShadow = false
        parts.bars.push({ mesh, material, color, phase: index % 2 })
      })
      parts.body.push(child)
    } else if (name === 'boom') {
      parts.boom = child
      parts.arm = child.getObjectByName('arm') ?? undefined
      parts.body.push(child)
    } else parts.body.push(child)
  }
  if (kind === 'lawntruck') {
    const trailerSource = models.vehicles?.getObjectByName('trailer')
    if (trailerSource) {
      const trailer = trailerSource.clone(true)
      trailer.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
      for (const child of trailer.children) if (child.name.startsWith('wheel_')) parts.trailerWheels.push(child)
      parts.trailer = trailer
    }
  }
  for (const [text, fg, length, height, x, y, z] of LABELS[kind as VehicleKind] ?? []) {
    const holder = new THREE.Group()
    sideLabel(holder, text, fg, length, height, x, y, z)
    parts.body.push(holder)
  }
  return parts
}

function fromBoxes(kind: VehicleKind): Parts {
  const k = buildBoxKit(kind)
  const group = new THREE.Group()
  const parts: Parts = { group, body: [], wheels: k.wheels, bars: [], heads: [k.heads], tails: [k.tails], reverse: [k.reverse], boom: k.boom, arm: k.boom?.userData.arm as THREE.Object3D | undefined, trailerWheels: k.trailerWheels }
  for (const bar of k.bars) parts.bars.push({ mesh: bar.mesh, material: bar.mesh.material as THREE.MeshStandardMaterial, color: bar.color, phase: bar.phase })
  if (k.trailer) {
    const offset = k.trailer.position.z - (RIGS.lawntruck.trailer?.hitch ?? -2.25)
    k.trailer.position.set(0, 0, 0)
    const holder = new THREE.Group()
    for (const child of [...k.trailer.children]) { child.position.z += offset; holder.add(child) }
    mergeStatic(holder)
    parts.trailer = holder
  }
  for (const child of [...k.group.children]) if (!k.wheels.includes(child) && child !== k.trailer) parts.body.push(child)
  return parts
}

/** Puts the parts on a chassis: a sprung body pivoting between the axles, steering pivots on the front wheels and a hitched trailer. */
function assemble(kind: VehicleKind, parts: Parts, merge: boolean): VehicleModel {
  const rig = RIGS[kind]
  const { group } = parts
  const spring = new THREE.Group()
  const mid = (rig.front + rig.rear) / 2
  const pivotY = 0.55
  spring.position.set(0, pivotY, mid)
  const body = new THREE.Group()
  body.position.set(0, -pivotY, -mid)
  spring.add(body)
  group.add(spring)
  for (const part of parts.body) body.add(part)
  if (merge) mergeStatic(body)

  const front = Math.max(...parts.wheels.map(w => w.position.z))
  const steered: THREE.Object3D[] = []
  const radius: number[] = []
  for (const wheel of parts.wheels) {
    const box = new THREE.Box3().setFromObject(wheel)
    radius.push(Math.max(0.2, (box.max.y - box.min.y) / 2 || wheel.position.y))
    if (wheel.position.z > front - 0.3) {
      const pivot = new THREE.Group()
      pivot.position.copy(wheel.position)
      wheel.position.set(0, 0, 0)
      pivot.add(wheel)
      group.add(pivot)
      steered.push(pivot)
    } else group.add(wheel)
  }
  const wheelRadius = radius.length ? radius.reduce((a, b) => a + b, 0) / radius.length : 0.4
  const hitch = new THREE.Group()
  if (parts.trailer) {
    hitch.position.set(0, 0, rig.trailer?.hitch ?? -2.25)
    hitch.add(parts.trailer)
    group.add(hitch)
  }

  const heavy = rig.front - rig.rear > 4.5
  const pitchGain = heavy ? 0.006 : 0.011
  const rollGain = heavy ? 0.012 : 0.016
  const state = { pitch: 0, pitchV: 0, roll: 0, rollV: 0, spin: 0, steer: 0, trailer: 0 }
  const stiffness = heavy ? 30 : 55
  const damping = heavy ? 6.5 : 8.5

  return {
    group,
    update(d, dt, time, night) {
      const step = Math.min(dt, 0.05)
      const targetPitch = Math.max(-0.05, Math.min(0.05, -d.accel * pitchGain))
      const targetRoll = Math.max(-0.07, Math.min(0.07, -d.lat * rollGain))
      state.pitchV += ((targetPitch - state.pitch) * stiffness - state.pitchV * damping) * step
      state.pitch += state.pitchV * step
      state.rollV += ((targetRoll - state.roll) * stiffness - state.rollV * damping) * step
      state.roll += state.rollV * step
      spring.rotation.set(state.pitch, 0, state.roll)
      spring.position.y = pivotY - Math.abs(state.roll) * 0.15

      state.spin += (d.speed * step) / wheelRadius
      state.steer += (d.steer - state.steer) * Math.min(1, step * 10)
      for (const wheel of parts.wheels) wheel.rotation.x = state.spin
      for (const pivot of steered) pivot.rotation.y = state.steer
      for (const wheel of parts.trailerWheels) wheel.rotation.x = state.spin * (wheelRadius / 0.3)
      state.trailer += (d.trailer - state.trailer) * Math.min(1, step * 8)
      hitch.rotation.y = state.trailer

      const braking = d.moving && (d.accel < -0.35 || Math.abs(d.speed) < 0.15)
      for (const m of parts.heads) m.emissiveIntensity = 0.1 + night * 2.4
      for (const m of parts.tails) m.emissiveIntensity = braking ? 2.6 : 0.15 + night * 1.1
      for (const m of parts.reverse) m.emissiveIntensity = d.speed < -0.05 ? 2.2 : 0
      for (const bar of parts.bars) {
        const beat = (time * 2.4 + bar.phase * 0.5) % 1
        const flash = d.lights ? ((beat < 0.12 || (beat > 0.2 && beat < 0.32)) ? 1 : 0.05) : 0
        bar.material.emissiveIntensity = flash * 3.4
      }
      if (parts.boom) {
        parts.boom.rotation.y = d.bucket * Math.PI * 0.5
        if (parts.arm) parts.arm.rotation.x = -d.bucket * 0.95
      }
    },
  }
}

export function buildVehicle(kind: VehicleKind): VehicleModel {
  const model = fromModel(kind)
  return model ? assemble(kind, model, false) : assemble(kind, fromBoxes(kind), true)
}

const WRECK_PAINTS = ['#8a2b2b', '#2b4f8a', '#d8d4cc', '#3c3f44', '#6b8a3a', '#c9a23a']

/** A family car crumpled in a crash. */
export function buildWreck(color: number): THREE.Group {
  const parts = fromModel('wreck')
  if (!parts) return buildBoxWreck(color)
  const group = new THREE.Group()
  const paint = new THREE.Color(WRECK_PAINTS[color % WRECK_PAINTS.length])
  for (const part of [...parts.body, ...parts.wheels]) {
    part.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (material.name === 'paint_wreck') {
        const copy = material.clone()
        copy.color = paint
        mesh.material = copy
        mesh.userData.ownMaterial = copy
      }
    })
    group.add(part)
  }
  return group
}
