/** The simple box-built town vehicles, used when the Blender models (`public/models/hood/vehicles.glb`) can't load or with `?cars=0`. */
import * as THREE from 'three/webgpu'
import type { VehicleKind } from '../../shared/TownSim'
import { box, cylinder, material } from './Kit'
import { mergeStatic } from './Merge'
import { sideLabel } from './Signs'

const GLASS = { roughness: 0.12, metalness: 0.4 }
const CHROME = { roughness: 0.25, metalness: 0.85 }
const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 20)
tireGeo.rotateZ(Math.PI / 2)
tireGeo.userData.shared = true

export interface Kit {
  group: THREE.Group
  wheels: THREE.Object3D[]
  bars: { mesh: THREE.Mesh; color: THREE.Color; phase: number }[]
  heads: THREE.MeshStandardMaterial
  tails: THREE.MeshStandardMaterial
  reverse: THREE.MeshStandardMaterial
  boom?: THREE.Object3D
  trailer?: THREE.Object3D
  trailerWheels: THREE.Object3D[]
}

function start(): Kit {
  const heads = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: new THREE.Color('#fff2c8'), emissiveIntensity: 0.15, roughness: 0.3 })
  const tails = new THREE.MeshStandardMaterial({ color: '#7a1010', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 0.25, roughness: 0.4 })
  const group = new THREE.Group()
  const holder = new THREE.Group()
  holder.userData.ownMaterial = heads
  const reverse = new THREE.MeshStandardMaterial({ color: '#d8d8d4', emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.3 })
  const holder2 = new THREE.Group()
  holder2.userData.ownMaterial = tails
  const holder3 = new THREE.Group()
  holder3.userData.ownMaterial = reverse
  group.add(holder, holder2, holder3)
  return { group, wheels: [], bars: [], heads, tails, reverse, trailerWheels: [] }
}

function wheels(k: Kit, positions: [number, number][], r: number, width: number, track: number): void {
  const tire = material('#1c1c1e', { roughness: 0.9 })
  const hub = material('#b8bcc2', CHROME)
  for (const [z, extraTrack] of positions) {
    for (const side of [-1, 1]) {
      const w = new THREE.Group()
      w.userData.keep = true
      w.position.set(side * (track / 2 + extraTrack), r, z)
      const t = new THREE.Mesh(tireGeo, tire)
      t.scale.set(width, r, r)
      t.castShadow = true
      const h = new THREE.Mesh(tireGeo, hub)
      h.scale.set(width + 0.02, r * 0.55, r * 0.55)
      w.add(t, h)
      k.group.add(w)
      k.wheels.push(w)
    }
  }
}

function lightBar(k: Kit, width: number, y: number, z: number, colors: string[] = ['#ff2a2a', '#2a5bff']): void {
  k.group.add(box(width, 0.06, 0.32, '#22252a', 0, y - 0.04, z))
  const n = colors.length * 2
  for (let i = 0; i < n; i++) {
    const c = new THREE.Color(colors[i % colors.length])
    const m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.5), emissive: c, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.92 })
    const mesh = box(width / n - 0.02, 0.12, 0.28, m, -width / 2 + (i + 0.5) * (width / n), y + 0.06, z)
    mesh.userData.keep = true
    mesh.userData.ownMaterial = m
    mesh.castShadow = false
    k.group.add(mesh)
    k.bars.push({ mesh, color: c, phase: i % 2 })
  }
}

function lamps(k: Kit, width: number, frontZ: number, rearZ: number, y: number): void {
  for (const side of [-1, 1]) {
    k.group.add(box(0.32, 0.16, 0.05, k.heads, side * (width / 2 - 0.3), y, frontZ + 0.01))
    k.group.add(box(0.26, 0.18, 0.05, k.tails, side * (width / 2 - 0.25), y, rearZ - 0.01))
    k.group.add(box(0.12, 0.1, 0.05, k.reverse, side * (width / 2 - 0.48), y, rearZ - 0.01))
  }
}

function cab(k: Kit, paint: string, width: number, z0: number, length: number, height: number, roofY = 0.55): void {
  k.group.add(box(width, height - roofY, length, paint, 0, roofY + (height - roofY) / 2, z0 + length / 2))
  k.group.add(box(width - 0.06, height * 0.36, 0.05, material('#26323d', GLASS), 0, height - height * 0.22, z0 + length + 0.005))
  for (const side of [-1, 1]) k.group.add(box(0.04, height * 0.34, length * 0.6, material('#26323d', GLASS), side * (width / 2 + 0.005), height - height * 0.22, z0 + length * 0.55))
  k.group.add(box(width + 0.06, 0.22, 0.2, '#2c2f33', 0, roofY + 0.06, z0 + length + 0.08))
}

function sedan(k: Kit, lower: string, upper: string, roof: string): void {
  k.group.add(box(1.84, 0.62, 4.8, lower, 0, 0.62, 0))
  k.group.add(box(1.86, 0.28, 2.4, upper, 0, 0.78, 0.1))
  k.group.add(box(1.62, 0.5, 2.3, roof, 0, 1.18, -0.2))
  k.group.add(box(1.5, 0.42, 0.06, material('#1e2933', GLASS), 0, 1.16, 0.97).rotateX(-0.5))
  k.group.add(box(1.5, 0.4, 0.06, material('#1e2933', GLASS), 0, 1.16, -1.36).rotateX(0.5))
  for (const side of [-1, 1]) k.group.add(box(0.04, 0.36, 2.0, material('#1e2933', GLASS), side * 0.82, 1.18, -0.2))
  k.group.add(box(1.92, 0.18, 0.16, '#1a1c1f', 0, 0.42, 2.42))
  k.group.add(box(1.92, 0.18, 0.16, '#1a1c1f', 0, 0.42, -2.42))
  lamps(k, 1.84, 2.4, -2.4, 0.74)
  wheels(k, [[1.45, 0], [-1.45, 0]], 0.36, 0.26, 1.6)
}

/** A box-built vehicle; its parts are still loose so the caller can split off the body, wheels and trailer. */
export function buildBoxKit(kind: VehicleKind): Kit {
  const k = start()
  const g = k.group
  switch (kind) {
    case 'cruiser': {
      sedan(k, '#16181c', '#f2f2f0', '#f2f2f0')
      for (const side of [-1, 1]) g.add(box(0.03, 0.4, 2.3, '#f2f2f0', side * 0.93, 0.66, 0.1))
      sideLabel(g, 'HOOD POLICE', '#13284d', 2.0, 0.32, 0.93, 0.68, 0.1)
      g.add(box(1.5, 0.5, 0.14, '#202226', 0, 0.62, 2.55))
      lightBar(k, 1.3, 1.46, -0.25)
      break
    }
    case 'delivery': {
      k.group.add(box(1.7, 0.6, 3.9, '#f2b632', 0, 0.6, 0))
      k.group.add(box(1.6, 0.62, 2.4, '#f2b632', 0, 1.18, -0.35))
      k.group.add(box(1.4, 0.4, 0.06, material('#1e2933', GLASS), 0, 1.2, 0.86).rotateX(-0.45))
      for (const side of [-1, 1]) k.group.add(box(0.04, 0.34, 1.9, material('#1e2933', GLASS), side * 0.81, 1.22, -0.3))
      lamps(k, 1.7, 1.96, -1.96, 0.72)
      wheels(k, [[1.25, 0], [-1.25, 0]], 0.32, 0.22, 1.48)
      sideLabel(g, 'SUNNY SIDE', '#b5341f', 1.8, 0.3, 0.86, 0.66, 0)
      g.add(box(0.9, 0.36, 0.12, '#d0452a', 0, 1.7, -0.2))
      g.add(cylinder(0.24, 0.1, '#f2d27a', 0, 1.72, -0.12).rotateX(Math.PI / 2))
      break
    }
    case 'pickup':
    case 'lawntruck': {
      const lawn = kind === 'lawntruck'
      const paint = lawn ? '#2f7a34' : '#f2f0ea'
      cab(k, paint, 2.0, 0.4, 2.6, 1.95)
      g.add(box(2.0, 0.55, 2.0, paint, 0, 0.82, 2.2 + 0.7))
      g.add(box(2.0, 0.55, 2.4, paint, 0, 0.82, -0.9))
      g.add(box(2.0, 0.08, 2.4, '#3a3d42', 0, 0.62, -0.9))
      for (const side of [-1, 1]) g.add(box(0.08, 0.36, 2.4, paint, side * 0.96, 1.26, -0.9))
      g.add(box(2.0, 0.36, 0.08, paint, 0, 1.26, -2.06))
      lamps(k, 2.0, 3.92, -2.1, 0.92)
      wheels(k, [[2.8, 0], [-1.1, 0]], 0.4, 0.3, 1.74)
      sideLabel(g, lawn ? 'GREENLINE' : 'CITY WORKS', lawn ? '#f2f2e8' : '#c4571d', 1.9, 0.34, 1.0, 1.15, 1.7)
      if (!lawn) lightBar(k, 1.2, 1.98, 1.6, ['#ffb21a', '#ffb21a'])
      else {
        const trailer = new THREE.Group()
        trailer.position.z = -4.4
        trailer.userData.keep = true
        k.trailer = trailer
        trailer.add(box(1.9, 0.12, 3.4, '#3a3d42', 0, 0.55, 0))
        for (const side of [-1, 1]) trailer.add(box(0.06, 0.5, 3.4, '#5a5e64', side * 0.95, 0.85, 0))
        trailer.add(box(0.1, 0.1, 1.4, '#3a3d42', 0, 0.52, 2.3))
        trailer.add(box(1.8, 0.7, 0.06, '#5a5e64', 0, 0.9, -1.7).rotateX(0.5))
        trailer.add(box(0.9, 0.28, 0.9, '#2e6b2a', -0.35, 0.82, 0.4))
        trailer.add(box(0.06, 0.6, 0.06, '#222', -0.35, 1.2, -0.1))
        trailer.add(box(0.5, 0.5, 0.5, '#c8c3b4', 0.5, 0.86, 0.9))
        g.add(trailer)
        const t = material('#1c1c1e', { roughness: 0.9 })
        for (const side of [-1, 1]) {
          const w = new THREE.Mesh(tireGeo, t)
          w.scale.set(0.2, 0.3, 0.3)
          w.position.set(side * 1.05, 0.3, 0)
          w.userData.keep = true
          trailer.add(w)
          k.trailerWheels.push(w)
        }
      }
      break
    }
    case 'engine': {
      cab(k, '#b8231c', 2.5, 2.4, 2.6, 2.9, 0.75)
      g.add(box(2.5, 2.2, 6.4, '#b8231c', 0, 1.85, -1.0))
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) g.add(box(0.04, 1.3, 1.6, material('#c9ccd1', CHROME), side * 1.26, 1.65, -3.2 + i * 1.9))
        g.add(box(0.05, 0.12, 6.4, '#f2f2ee', side * 1.26, 0.96, -1.0))
      }
      g.add(box(2.6, 0.32, 0.3, material('#c9ccd1', CHROME), 0, 0.6, 5.1))
      g.add(box(2.3, 0.12, 6.0, '#9a9da2', 0, 3.02, -1.2))
      for (const side of [-0.55, 0.55]) g.add(box(0.12, 0.16, 6.6, '#d9dcdf', side, 3.2, -1.2))
      for (let i = 0; i < 11; i++) g.add(box(1.1, 0.06, 0.06, '#d9dcdf', 0, 3.2, -4.3 + i * 0.6))
      g.add(cylinder(0.32, 0.6, '#d9dcdf', 0, 3.1, 1.9))
      lamps(k, 2.5, 5.02, -4.22, 1.0)
      wheels(k, [[3.8, 0], [-2.2, 0], [-3.4, 0]], 0.52, 0.36, 2.0)
      sideLabel(g, 'FIRE STATION 7', '#f4e6b0', 3.0, 0.42, 1.27, 2.62, -1.0)
      lightBar(k, 2.0, 2.98, 3.6, ['#ff2a2a', '#ffffff'])
      break
    }
    case 'ambulance': {
      cab(k, '#f2f2f0', 2.1, 1.6, 2.2, 2.2, 0.6)
      g.add(box(2.3, 2.3, 4.2, '#f4f4f2', 0, 1.65, -0.6))
      for (const side of [-1, 1]) {
        g.add(box(0.03, 0.26, 4.2, '#c62828', side * 1.16, 1.25, -0.6))
        g.add(box(0.03, 0.5, 0.7, material('#26323d', GLASS), side * 1.16, 2.2, 0.8))
      }
      g.add(box(2.3, 0.26, 0.03, '#c62828', 0, 1.25, -2.72))
      g.add(box(0.6, 1.4, 0.04, '#d9d9d9', -0.45, 1.6, -2.71))
      g.add(box(0.6, 1.4, 0.04, '#d9d9d9', 0.45, 1.6, -2.71))
      sideLabel(g, 'MEDIC', '#c62828', 1.8, 0.44, 1.165, 1.7, -0.9)
      lamps(k, 2.1, 3.82, -2.72, 0.9)
      wheels(k, [[2.8, 0], [-1.6, 0]], 0.42, 0.3, 1.8)
      lightBar(k, 1.8, 2.82, -0.6)
      lightBar(k, 1.6, 2.24, 2.6)
      break
    }
    case 'garbage': {
      cab(k, '#f2f2ee', 2.4, 2.6, 2.2, 2.7, 0.7)
      g.add(box(2.5, 2.6, 5.6, '#2f6b45', 0, 2.0, -1.4))
      g.add(box(2.4, 2.2, 1.4, '#3a3d42', 0, 1.7, -4.8))
      g.add(box(2.2, 0.6, 0.2, '#d9b433', 0, 0.9, -5.5))
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) g.add(box(0.03, 2.3, 0.08, '#285c3b', side * 1.26, 2.0, -3.8 + i * 1.2))
      sideLabel(g, 'CITY WORKS', '#f2f2ee', 3.6, 0.5, 1.26, 2.4, -1.4)
      lamps(k, 2.4, 4.82, -5.52, 1.0)
      wheels(k, [[3.6, 0], [-2.4, 0], [-3.6, 0]], 0.52, 0.38, 2.0)
      lightBar(k, 1.0, 2.72, 3.4, ['#ffb21a', '#ffb21a'])
      break
    }
    case 'utility': {
      cab(k, '#f2f2ee', 2.2, 1.6, 2.4, 2.3, 0.6)
      g.add(box(2.3, 0.9, 4.4, '#e2762e', 0, 1.0, -1.0))
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) g.add(box(0.03, 0.6, 1.2, '#c4611f', side * 1.16, 1.0, -2.6 + i * 1.5))
      sideLabel(g, 'CITY WORKS', '#ffffff', 2.6, 0.34, 1.165, 1.2, -1.0)
      lamps(k, 2.2, 4.02, -3.22, 0.9)
      wheels(k, [[2.9, 0], [-2.0, 0]], 0.44, 0.32, 1.84)
      lightBar(k, 1.2, 2.34, 2.8, ['#ffb21a', '#ffb21a'])
      const boom = new THREE.Group()
      boom.userData.keep = true
      boom.position.set(0, 1.7, -2.6)
      g.add(cylinder(0.3, 0.4, '#d9dcdf', 0, 1.65, -2.6))
      const arm = new THREE.Group()
      arm.add(box(0.28, 0.28, 4.6, '#f2f2ee', 0, 0.15, 2.2))
      const bucket = box(0.8, 0.9, 0.8, '#f2d22a', 0, 0.1, 4.6)
      arm.add(bucket)
      boom.add(arm)
      boom.userData.arm = arm
      g.add(boom)
      k.boom = boom
      break
    }
    case 'shuttle': {
      g.add(box(2.3, 2.5, 7.4, '#f2f0ea', 0, 1.65, 0))
      g.add(box(2.32, 0.7, 7.42, '#2f8a96', 0, 0.75, 0))
      for (const side of [-1, 1]) g.add(box(0.04, 0.7, 6.0, material('#26323d', GLASS), side * 1.16, 2.1, -0.3))
      g.add(box(2.1, 1.0, 0.05, material('#26323d', GLASS), 0, 2.0, 3.71))
      sideLabel(g, 'HOOD SPRINGS RESORT', '#ffffff', 4.4, 0.38, 1.17, 0.78, -0.2)
      g.add(box(2.3, 0.14, 7.0, '#d9d6cc', 0, 2.95, 0))
      lamps(k, 2.3, 3.71, -3.71, 0.9)
      wheels(k, [[2.5, 0], [-2.3, 0]], 0.44, 0.3, 1.9)
      break
    }
    case 'bus': {
      g.add(box(2.5, 2.6, 10.4, '#f2f2ee', 0, 1.85, 0))
      g.add(box(2.52, 0.3, 10.42, '#2c4a8a', 0, 1.2, 0))
      for (const side of [-1, 1]) {
        g.add(box(0.04, 0.72, 8.6, material('#26323d', GLASS), side * 1.26, 2.35, -0.5))
        for (let i = 0; i < 30; i++) g.add(box(0.03, 0.72, 0.04, '#8f949a', side * 1.29, 2.35, -4.7 + i * 0.29))
      }
      g.add(box(2.3, 1.0, 0.05, material('#26323d', GLASS), 0, 2.3, 5.21))
      sideLabel(g, 'KETTLE RIDGE CORRECTIONS', '#2c4a8a', 6.0, 0.4, 1.27, 1.58, -0.4)
      lamps(k, 2.5, 5.21, -5.21, 0.9)
      wheels(k, [[3.6, 0], [-3.4, 0]], 0.5, 0.36, 2.0)
      break
    }
    case 'tanker': {
      cab(k, '#3b5f8a', 2.5, 2.9, 2.4, 3.0, 0.8)
      for (const side of [-1, 1]) g.add(cylinder(0.12, 2.2, '#c9ccd1', side * 1.1, 2.6, 2.7, CHROME))
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 5.6, 6, 20), material('#d6d9dd', { roughness: 0.3, metalness: 0.75 }))
      tank.rotation.x = Math.PI / 2
      tank.position.set(0, 2.05, -1.1)
      tank.castShadow = true
      g.add(tank)
      g.add(box(2.2, 0.2, 10.4, '#2d2f33', 0, 0.85, 0.1))
      sideLabel(g, 'FUEL', '#c62f2f', 3.0, 0.7, 1.16, 2.0, -1.1)
      lamps(k, 2.5, 5.32, -5.2, 1.0)
      wheels(k, [[3.2, 0], [-2.2, 0], [-3.4, 0]], 0.5, 0.38, 2.0)
      break
    }
  }
  return k
}

/** A family car crumpled in a crash, with its hazard lights blinking. */
export function buildBoxWreck(color: number): THREE.Group {
  const paints = ['#8a2b2b', '#2b4f8a', '#d8d4cc', '#3c3f44', '#6b8a3a', '#c9a23a']
  const k = start()
  sedan(k, paints[color % paints.length], paints[color % paints.length], paints[color % paints.length])
  k.group.add(box(1.4, 0.35, 0.6, '#3a3a3a', 0.2, 0.9, 2.1).rotateZ(0.2))
  mergeStatic(k.group)
  k.group.rotation.z = 0.04
  return k.group
}
