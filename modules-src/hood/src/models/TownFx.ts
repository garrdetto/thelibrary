/** Small moving props for the town: flames and smoke on a burning house, hose water, the riding mower and litter bags. */
import * as THREE from 'three/webgpu'
import { box, cylinder, material, sphere } from './Kit'

export interface FireFx {
  group: THREE.Group
  update(size: number, smoke: number, time: number): void
}

const flameGeo = new THREE.ConeGeometry(0.5, 1.6, 7)
flameGeo.translate(0, 0.8, 0)
flameGeo.userData.shared = true
const puffGeo = new THREE.SphereGeometry(0.5, 10, 8)
puffGeo.userData.shared = true

export function buildFire(): FireFx {
  const group = new THREE.Group()
  const hot = new THREE.MeshStandardMaterial({ color: '#ff8a1e', emissive: new THREE.Color('#ff6a10'), emissiveIntensity: 2.6, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1 })
  const core = new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: new THREE.Color('#ffc23a'), emissiveIntensity: 3, transparent: true, opacity: 0.9, depthWrite: false, roughness: 1 })
  const smokeMat = new THREE.MeshStandardMaterial({ color: '#3a3836', transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 })
  const holder = new THREE.Group(); holder.userData.ownMaterial = hot
  const holder2 = new THREE.Group(); holder2.userData.ownMaterial = core
  const holder3 = new THREE.Group(); holder3.userData.ownMaterial = smokeMat
  group.add(holder, holder2, holder3)
  const flames: { mesh: THREE.Mesh; x: number; z: number; s: number; p: number }[] = []
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39
    const r = 0.6 + (i % 4) * 0.9
    const mesh = new THREE.Mesh(flameGeo, i % 3 === 0 ? core : hot)
    mesh.castShadow = false
    group.add(mesh)
    flames.push({ mesh, x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8, s: 0.7 + (i % 5) * 0.25, p: i * 1.3 })
  }
  const puffs: { mesh: THREE.Mesh; p: number; x: number; z: number }[] = []
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(puffGeo, smokeMat)
    mesh.castShadow = false
    group.add(mesh)
    puffs.push({ mesh, p: i / 12, x: Math.cos(i * 2.1) * 0.8, z: Math.sin(i * 2.1) * 0.8 })
  }
  const light = new THREE.PointLight('#ff7a2a', 0, 18, 1.6)
  light.position.y = 3
  group.add(light)
  return {
    group,
    update(size, smoke, time) {
      group.visible = size > 0.01 || smoke > 0.01
      for (const f of flames) {
        const flicker = 0.75 + Math.sin(time * 9 + f.p) * 0.18 + Math.sin(time * 23 + f.p * 2) * 0.08
        const s = size * f.s * flicker
        f.mesh.visible = s > 0.05
        f.mesh.scale.set(s * 1.4, s * 1.8, s * 1.4)
        f.mesh.position.set(f.x * (0.4 + size * 0.6), 2.6, f.z * (0.4 + size * 0.6))
        f.mesh.rotation.y = time * 0.7 + f.p
      }
      for (const p of puffs) {
        const age = (time * 0.18 + p.p) % 1
        const s = (0.8 + age * 3.2) * Math.max(0.2, smoke)
        p.mesh.visible = smoke > 0.02
        p.mesh.scale.setScalar(s)
        p.mesh.position.set(p.x + age * 2.5, 3.5 + age * 12, p.z + age * 1.2)
      }
      smokeMat.opacity = 0.5 * Math.min(1, smoke * 1.4)
      light.intensity = size * (40 + Math.sin(time * 17) * 8)
    },
  }
}

export interface SprayFx {
  group: THREE.Group
  update(x: number, z: number, tx: number, tz: number, time: number): void
}

export function buildSpray(): SprayFx {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: '#d8ecf6', transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.2 })
  const holder = new THREE.Group(); holder.userData.ownMaterial = mat
  group.add(holder)
  const drops: THREE.Mesh[] = []
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(puffGeo, mat)
    m.castShadow = false
    group.add(m)
    drops.push(m)
  }
  return {
    group,
    update(x, z, tx, tz, time) {
      drops.forEach((m, i) => {
        const f = ((time * 1.6 + i / drops.length) % 1)
        const h = 1.3 + Math.sin(f * Math.PI) * 2.6 + f * 1.2
        m.position.set(x + (tx - x) * f, h, z + (tz - z) * f)
        m.scale.setScalar(0.12 + f * 0.35)
      })
    },
  }
}

export function buildMower(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.95, 0.32, 1.5, '#2e6b2a', 0, 0.42, 0))
  g.add(box(1.25, 0.16, 0.9, '#2e6b2a', 0, 0.22, 0.25))
  g.add(box(0.5, 0.12, 0.45, '#1c1c1e', 0, 0.62, -0.25))
  g.add(box(0.5, 0.42, 0.08, '#1c1c1e', 0, 0.82, -0.48))
  g.add(cylinder(0.02, 0.5, '#2a2a2a', 0, 0.8, 0.35))
  g.add(cylinder(0.14, 0.04, '#2a2a2a', 0, 1.05, 0.38))
  for (const [x, z, r] of [[-0.45, -0.45, 0.24], [0.45, -0.45, 0.24], [-0.4, 0.55, 0.14], [0.4, 0.55, 0.14]] as [number, number, number][]) {
    const w = cylinder(r, 0.14, material('#1c1c1e', { roughness: 0.9 }), x, r, z)
    w.rotation.z = Math.PI / 2
    g.add(w)
  }
  return g
}

export function buildBag(): THREE.Mesh {
  return sphere(0.28, material('#1c1d20', { roughness: 0.4 }), 0, 0.24, 0, undefined, 0.85)
}
