/** Models for the bigger Buy catalog (`shared/CatalogMore.ts`): one original procedural model per item, front facing -z. */
import * as THREE from 'three/webgpu'
import type { ObjectDef } from '../../shared/Catalog'
import { box, cylinder, sphere } from './Kit'
import { GLOW, STEEL, cloth, cone, legs, ring, wood, type Builder, type SeatRule } from './FurnitureKit'
import { buildTree } from './Street'

const WHITE = '#f7f7f5'
const DARK = '#2a2b2f'
const WATER = { roughness: 0.05, metalness: 0.1, opacity: 0.75 }

function sofa(def: ObjectDef, g: THREE.Group, w: number, d: number, arm = 0.16, back = 0.55): void {
  g.add(box(w * 0.96, 0.24, d * 0.8, cloth(def.color), 0, 0.2, 0.02))
  g.add(box(w * 0.96, back, d * 0.22, cloth(def.color), 0, 0.32 + back / 2, d * 0.3))
  for (const sx of [-1, 1]) g.add(box(arm, 0.5, d * 0.8, cloth(def.color), sx * (w * 0.48 - arm / 2), 0.37, 0.02))
  const seats = Math.max(1, Math.round(w))
  for (let i = 0; i < seats; i++) g.add(box((w * 0.9 - arm * 2) / seats - 0.02, 0.13, d * 0.56, cloth(def.accent), (i + 0.5 - seats / 2) * ((w * 0.9 - arm * 2) / seats), 0.385, -d * 0.06))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(0.03, 0.08, '#3a2a1f', sx * (w * 0.45), 0.04, sz * d * 0.32))
}

function bedBase(def: ObjectDef, g: THREE.Group, w: number, d: number, frame: number, headboard: number): void {
  g.add(box(w * 0.96, frame, d * 0.96, wood(def.color), 0, frame / 2 + 0.04, 0))
  g.add(box(w * 0.9, 0.18, d * 0.9, cloth('#f4f1ea'), 0, frame + 0.13, 0))
  g.add(box(w * 0.92, 0.07, d * 0.6, cloth(def.accent), 0, frame + 0.24, -d * 0.16))
  const pillows = w > 1.5 ? [-0.24, 0.24] : [0]
  for (const sx of pillows) g.add(box(w > 1.5 ? w * 0.36 : w * 0.6, 0.11, 0.34, '#ffffff', sx * w, frame + 0.27, d * 0.35, { roughness: 1 }))
  if (headboard) g.add(box(w * 0.98, headboard, 0.1, wood(def.color), 0, headboard / 2, d * 0.48))
}

/** Four legs under a seat or table centred at (x, z). */
function legsAt(g: THREE.Group, x: number, z: number, w: number, d: number, h: number, color: string | THREE.Material, size = 0.035): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(size, h, size, color, x + sx * (w / 2 - size), h / 2, z + sz * (d / 2 - size)))
}

/** A pitched roof of two slabs over a `w` by `d` box whose walls top out at `y`, ridge running along z. */
function gable(g: THREE.Group, color: string | THREE.Material, w: number, d: number, y: number, rise: number, z = 0): void {
  const half = w / 2 + 0.08
  const slope = Math.atan2(rise, half)
  const len = Math.hypot(half, rise)
  for (const sx of [-1, 1]) {
    const slab = box(len, 0.06, d + 0.16, color, sx * half / 2, y + rise / 2, z)
    slab.rotation.z = -sx * slope
    g.add(slab)
  }
  for (const sz of [-1, 1]) {
    const tri = cone(half, rise, typeof color === 'string' ? color : '#888', 0, y + rise / 2, z + sz * d / 2)
    tri.scale.set(half * 2, rise, 0.04)
    g.add(tri)
  }
}

function lampShade(g: THREE.Group, def: ObjectDef, y: number, r: number, h: number): void {
  g.add(cylinder(r, h, def.accent, 0, y, 0, { ...GLOW, opacity: 0.92 }))
}

function cabinetDoors(g: THREE.Group, w: number, y: number, h: number, z: number, n: number, color: string): void {
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5 - n / 2) * (w / n)
    g.add(box(w / n - 0.04, h, 0.02, color, x, y, z))
    g.add(box(0.02, 0.1, 0.03, STEEL, x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.08), y, z - 0.02, { metalness: 0.7 }))
  }
}

function leafy(g: THREE.Group, color: string, x: number, y: number, z: number, r: number, n = 6): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    g.add(sphere(r * 0.7, color, x + Math.cos(a) * r * 0.6, y + (i % 2) * r * 0.4, z + Math.sin(a) * r * 0.6, { roughness: 0.9 }, 0.8))
  }
  g.add(sphere(r * 0.8, color, x, y + r * 0.5, z, { roughness: 0.9 }))
}

export const moreBuilders: Record<string, Builder> = {
  // ---- Seating ----
  loveseat: (def, g, w, d) => sofa(def, g, w, d, 0.18, 0.5),
  'sofa-long': (def, g, w, d) => sofa(def, g, w, d),
  'sofa-leather': (def, g, w, d) => {
    sofa(def, g, w, d, 0.2, 0.5)
    for (const sx of [-1, 1]) g.add(cylinder(0.12, d * 0.8, def.color, sx * (w * 0.48 - 0.1), 0.62, 0.02).rotateX(Math.PI / 2))
  },
  recliner: (def, g, w, d) => {
    g.add(box(w * 0.82, 0.3, d * 0.8, cloth(def.color), 0, 0.22, 0.02))
    g.add(box(w * 0.82, 0.8, d * 0.22, cloth(def.color), 0, 0.62, d * 0.32).rotateX(-0.18))
    for (const sx of [-1, 1]) g.add(box(0.16, 0.5, d * 0.8, cloth(def.accent), sx * w * 0.36, 0.42, 0.02))
    g.add(box(w * 0.5, 0.14, d * 0.56, cloth(def.accent), 0, 0.44, -d * 0.05))
    g.add(box(w * 0.5, 0.12, d * 0.24, cloth(def.color), 0, 0.2, -d * 0.48))
  },
  'bean-bag': (def, g) => {
    g.add(sphere(0.42, cloth(def.color), 0, 0.26, 0.04, {}, 0.6))
    g.add(sphere(0.3, cloth(def.accent), 0, 0.42, 0.18, {}, 0.8))
  },
  'rocking-chair': (def, g, w, d) => {
    for (const sx of [-1, 1]) {
      const rocker = ring(0.5, wood(def.color), sx * w * 0.22, 0.5, 0, {}, 0.15)
      rocker.rotation.set(0, Math.PI / 2, 0)
      rocker.scale.set(1, 0.36, 0.06)
      g.add(rocker)
      g.add(box(0.04, 0.42, 0.04, wood(def.color), sx * w * 0.22, 0.3, -d * 0.18))
      g.add(box(0.04, 1.0, 0.04, wood(def.color), sx * w * 0.22, 0.58, d * 0.2))
    }
    g.add(box(w * 0.48, 0.05, d * 0.46, wood(def.color), 0, 0.48, 0))
    for (const sx of [-0.15, -0.05, 0.05, 0.15]) g.add(box(0.03, 0.5, 0.025, wood(def.color), sx * w, 0.8, d * 0.2))
    g.add(box(w * 0.48, 0.06, 0.04, wood(def.color), 0, 1.05, d * 0.2))
    g.add(box(w * 0.42, 0.04, d * 0.4, cloth(def.accent), 0, 0.52, -0.02))
  },
  'bar-stool': (def, g) => {
    g.add(cylinder(0.2, 0.06, cloth(def.accent), 0, 0.76, 0))
    g.add(cylinder(0.03, 0.72, def.color, 0, 0.38, 0, { metalness: 0.6, roughness: 0.3 }))
    g.add(ring(0.17, def.color, 0, 0.3, 0, { metalness: 0.6 }, 0.25))
    g.add(cylinder(0.2, 0.03, def.color, 0, 0.015, 0, { metalness: 0.6 }))
  },
  'armchair-velvet': (def, g, w, d) => {
    g.add(box(w * 0.8, 0.28, d * 0.76, cloth(def.color), 0, 0.24, 0))
    g.add(box(w * 0.78, 0.5, d * 0.16, cloth(def.color), 0, 0.62, d * 0.3))
    g.add(cylinder(0.09, w * 0.8, cloth(def.color), 0, 0.88, d * 0.3).rotateZ(Math.PI / 2))
    for (const sx of [-1, 1]) {
      g.add(box(0.14, 0.32, d * 0.72, cloth(def.color), sx * w * 0.35, 0.48, 0))
      g.add(cylinder(0.08, d * 0.72, cloth(def.color), sx * w * 0.35, 0.64, 0).rotateX(Math.PI / 2))
    }
    g.add(box(w * 0.54, 0.12, d * 0.52, cloth(def.color), 0, 0.42, -d * 0.06))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(0.02, 0.1, def.accent, sx * w * 0.34, 0.05, sz * d * 0.3, { metalness: 0.8, roughness: 0.25 }))
  },
  chaise: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.28, d * 0.7, cloth(def.color), 0, 0.24, -0.02))
    g.add(box(w * 0.3, 0.42, d * 0.7, cloth(def.color), w * 0.34, 0.5, -0.02).rotateZ(-0.35))
    g.add(box(w * 0.94, 0.3, 0.08, wood(def.accent), 0, 0.5, d * 0.32))
    legs(g, w * 0.9, d * 0.62, 0.12, wood(def.accent), 0.04, 0.05)
    g.add(cylinder(0.09, 0.3, cloth('#f2ead8'), -w * 0.2, 0.44, -0.04).rotateZ(Math.PI / 2))
  },
  futon: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.08, d * 0.74, wood(def.accent), 0, 0.2, 0))
    legs(g, w * 0.9, d * 0.7, 0.18, wood(def.accent), 0.04, 0.05)
    g.add(box(w * 0.92, 0.18, d * 0.72, cloth(def.color), 0, 0.33, -0.02))
    g.add(box(w * 0.92, 0.5, 0.14, cloth(def.color), 0, 0.62, d * 0.32).rotateX(-0.25))
    for (const sx of [-1, 1]) g.add(box(0.06, 0.5, d * 0.74, wood(def.accent), sx * w * 0.47, 0.42, 0))
  },
  papasan: (def, g) => {
    g.add(cylinder(0.26, 0.24, wood(def.color), 0, 0.12, 0))
    const tilt = (mesh: THREE.Mesh) => { mesh.rotation.x = -0.4; return mesh }
    g.add(tilt(cylinder(0.44, 0.14, cloth(def.accent), 0, 0.46, 0.02)))
    const rim = ring(0.47, wood(def.color), 0, 0.5, 0.04, { roughness: 0.8 }, 0.9)
    rim.rotation.x = Math.PI / 2 - 0.4
    g.add(rim)
    g.add(tilt(sphere(0.16, cloth(def.accent), 0, 0.62, 0.22, {}, 0.6)))
  },

  // ---- Beds ----
  'bed-queen': (def, g, w, d) => {
    bedBase(def, g, w, d, 0.22, 0.75)
    g.add(box(w * 1.02, 0.04, d * 1.0, wood(def.color), 0, 0.03, 0))
  },
  'bed-canopy': (def, g, w, d) => {
    bedBase(def, g, w, d, 0.34, 1.2)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(0.05, 2.15, wood(def.color), sx * w * 0.46, 1.075, sz * d * 0.46))
    for (const sz of [-1, 1]) g.add(box(w * 0.96, 0.08, 0.08, wood(def.color), 0, 2.14, sz * d * 0.46))
    for (const sx of [-1, 1]) g.add(box(0.08, 0.08, d * 0.96, wood(def.color), sx * w * 0.46, 2.14, 0))
    g.add(box(w * 0.96, 0.02, d * 0.96, def.accent, 0, 2.18, 0, { opacity: 0.55, roughness: 1 }))
    for (const sx of [-1, 1]) g.add(box(0.03, 1.6, d * 0.3, def.accent, sx * w * 0.47, 1.35, d * 0.3, { opacity: 0.6, roughness: 1 }))
  },
  'bunk-bed': (def, g, w, d) => {
    for (const y of [0.18, 1.12]) {
      g.add(box(w * 0.94, 0.14, d * 0.94, wood(def.color), 0, y, 0))
      g.add(box(w * 0.88, 0.14, d * 0.88, cloth('#f4f1ea'), 0, y + 0.14, 0))
      g.add(box(w * 0.9, 0.05, d * 0.56, cloth(def.accent), 0, y + 0.23, -d * 0.16))
      g.add(box(w * 0.56, 0.09, 0.3, '#ffffff', 0, y + 0.26, d * 0.36))
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, 1.7, 0.07, wood(def.color), sx * w * 0.45, 0.85, sz * d * 0.46))
    g.add(box(w * 0.94, 0.16, 0.04, wood(def.color), 0, 1.45, -d * 0.46))
    for (let i = 0; i < 4; i++) g.add(box(0.3, 0.03, 0.03, wood(def.color), 0, 0.45 + i * 0.25, d * 0.49))
  },
  'bed-cottage': (def, g, w, d) => {
    bedBase(def, g, w, d, 0.28, 0.95)
    for (let i = 0; i < 4; i++) g.add(box(0.03, 0.5, 0.04, WHITE, (i - 1.5) * 0.18, 0.6, d * 0.42))
    g.add(box(w * 0.98, 0.45, 0.08, wood(def.color), 0, 0.3, -d * 0.48))
  },

  // ---- Tables and storage ----
  'coffee-table': (def, g, w, d) => {
    g.add(box(w * 0.86, 0.05, d * 0.6, wood(def.color), 0, 0.42, 0))
    g.add(box(w * 0.8, 0.03, d * 0.52, wood(def.color), 0, 0.12, 0))
    legs(g, w * 0.84, d * 0.58, 0.42, wood(def.color), 0.04, 0.05)
    g.add(box(0.26, 0.04, 0.2, def.accent, -w * 0.18, 0.465, 0))
    g.add(cylinder(0.05, 0.1, '#e8e1d3', w * 0.2, 0.5, 0))
  },
  'end-table': (def, g) => {
    g.add(cylinder(0.26, 0.04, wood(def.color), 0, 0.58, 0))
    g.add(cylinder(0.04, 0.56, wood(def.accent), 0, 0.28, 0))
    g.add(cylinder(0.18, 0.03, wood(def.accent), 0, 0.015, 0))
  },
  desk: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.04, d * 0.56, wood(def.color), 0, 0.74, d * 0.2))
    g.add(box(w * 0.3, 0.68, d * 0.5, wood(def.color), w * 0.3, 0.36, d * 0.2))
    for (const y of [0.2, 0.42, 0.62]) g.add(box(0.1, 0.02, 0.02, '#d8c38a', w * 0.3, y, -d * 0.06, { metalness: 0.7 }))
    g.add(box(0.04, 0.72, d * 0.5, wood(def.color), -w * 0.44, 0.36, d * 0.2))
    g.add(box(0.26, 0.02, 0.2, '#f4f2ea', -w * 0.1, 0.77, d * 0.14))
    g.add(cylinder(0.04, 0.12, def.accent, w * 0.28, 0.82, d * 0.36))
    g.add(box(w * 0.42, 0.05, 0.4, wood(def.color), 0, 0.46, -d * 0.62))
    legs(g, w * 0.4, 0.36, 0.44, wood(def.color), 0.02, 0.035)
    g.add(box(w * 0.42, 0.42, 0.04, wood(def.color), 0, 0.7, -d * 0.82))
  },
  'dining-round': (def, g) => {
    g.add(cylinder(0.85, 0.05, wood(def.color), 0, 0.74, 0))
    g.add(cylinder(0.08, 0.7, wood(def.accent), 0, 0.37, 0))
    g.add(cylinder(0.4, 0.04, wood(def.accent), 0, 0.02, 0))
    g.add(cylinder(0.12, 0.2, '#f2efe7', 0, 0.86, 0))
    for (let i = 0; i < 5; i++) g.add(sphere(0.05, i % 2 ? '#e86f9a' : '#f2d24b', Math.cos(i) * 0.07, 1.0, Math.sin(i) * 0.07))
  },
  'console-table': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.04, d * 0.4, wood(def.color), 0, 0.78, d * 0.2))
    g.add(box(w * 0.9, 0.03, d * 0.36, wood(def.color), 0, 0.2, d * 0.2))
    legs(g, w * 0.92, d * 0.38, 0.78, def.accent, 0.03, 0.035)
    g.add(box(0.2, 0.3, 0.12, def.accent, w * 0.3, 0.95, d * 0.25, { metalness: 0.6 }))
    g.add(sphere(0.1, '#4f8f45', -w * 0.3, 0.9, d * 0.22))
  },
  dresser: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.88, d * 0.5, wood(def.color), 0, 0.5, d * 0.2))
    for (let row = 0; row < 3; row++) for (const sx of [-1, 1]) {
      g.add(box(w * 0.44, 0.24, 0.02, wood(def.color), sx * w * 0.235, 0.24 + row * 0.27, -d * 0.06))
      g.add(sphere(0.025, def.accent, sx * w * 0.235, 0.24 + row * 0.27, -d * 0.08, { metalness: 0.8 }))
    }
    legs(g, w * 0.9, d * 0.46, 0.08, wood(def.color), 0.03, 0.05)
    g.add(box(0.4, 0.5, 0.03, '#cfe3ef', 0, 1.25, d * 0.4, { roughness: 0.05, metalness: 0.3 }))
  },
  wardrobe: (def, g, w, d) => {
    g.add(box(w * 0.92, 1.92, d * 0.6, wood(def.color), 0, 0.98, d * 0.16))
    g.add(box(w * 0.96, 0.06, d * 0.64, wood(def.color), 0, 1.97, d * 0.16))
    for (const sx of [-1, 1]) {
      g.add(box(w * 0.42, 1.6, 0.02, wood(def.color), sx * w * 0.225, 1.02, -d * 0.15))
      g.add(box(0.02, 0.2, 0.03, def.accent, sx * 0.05, 1.05, -d * 0.17, { metalness: 0.8 }))
    }
  },
  'display-cabinet': (def, g, w, d) => {
    g.add(box(w * 0.86, 1.76, d * 0.46, wood(def.color), 0, 0.88, d * 0.2))
    g.add(box(w * 0.78, 1.5, 0.02, def.accent, 0, 1.0, -d * 0.04, { opacity: 0.3, roughness: 0.05 }))
    const colors = ['#e8e1d3', '#3a6fa8', '#c9a75c', '#c44e3f']
    for (let s = 0; s < 3; s++) {
      g.add(box(w * 0.78, 0.02, d * 0.4, '#e8e1d3', 0, 0.5 + s * 0.42, d * 0.2))
      for (let i = 0; i < 3; i++) g.add(cylinder(0.05, 0.14 + (i % 2) * 0.06, colors[(s + i) % 4], (i - 1) * 0.22, 0.58 + s * 0.42 + (i % 2) * 0.03, d * 0.2, { roughness: 0.3 }))
    }
  },

  // ---- Kitchen ----
  'fridge-steel': (def, g, w, d) => {
    g.add(box(w * 0.9, 1.92, d * 0.8, def.color, 0, 0.96, d * 0.05, { roughness: 0.25, metalness: 0.55 }))
    g.add(box(0.008, 1.2, 0.01, def.accent, 0, 1.3, -d * 0.36))
    g.add(box(w * 0.86, 0.01, 0.01, def.accent, 0, 0.68, -d * 0.36))
    for (const sx of [-1, 1]) g.add(box(0.025, 0.6, 0.04, def.accent, sx * 0.06, 1.3, -d * 0.38, { metalness: 0.8, roughness: 0.2 }))
    g.add(box(0.5, 0.025, 0.04, def.accent, 0, 0.62, -d * 0.38, { metalness: 0.8 }))
    g.add(box(0.16, 0.22, 0.01, '#1b1b1d', w * 0.22, 1.25, -d * 0.36, { emissive: '#4f86c4', emissiveIntensity: 0.3 }))
  },
  'range-pro': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.88, d * 0.82, def.color, 0, 0.44, d * 0.04, { roughness: 0.3, metalness: 0.5 }))
    g.add(box(w * 0.94, 0.03, d * 0.82, def.accent, 0, 0.895, d * 0.04, { roughness: 0.3 }))
    for (let i = 0; i < 3; i++) for (const sz of [-0.15, 0.2]) {
      g.add(ring(0.08, '#3a3a3a', (i - 1) * w * 0.3, 0.92, sz * d, { metalness: 0.5 }, 0.3))
      g.add(cylinder(0.03, 0.02, '#1b1b1d', (i - 1) * w * 0.3, 0.92, sz * d))
    }
    for (const sx of [-1, 1]) g.add(box(w * 0.4, 0.42, 0.02, '#1b1b1d', sx * w * 0.23, 0.42, -d * 0.37, { roughness: 0.15 }))
    g.add(box(w * 0.86, 0.03, 0.04, STEEL, 0, 0.7, -d * 0.4, { metalness: 0.8 }))
    for (let i = 0; i < 6; i++) g.add(cylinder(0.025, 0.04, '#1b1b1d', (i - 2.5) * w * 0.14, 0.8, -d * 0.4).rotateX(Math.PI / 2))
    g.add(box(w * 0.9, 0.14, 0.06, def.color, 0, 1.0, d * 0.42, { metalness: 0.5 }))
  },
  microwave: (def, g, w, d) => {
    g.add(box(w * 0.72, 0.8, d * 0.6, wood('#b98a55'), 0, 0.4, d * 0.1))
    g.add(box(w * 0.68, 0.03, d * 0.58, '#d9d6cf', 0, 0.815, d * 0.1))
    g.add(box(0.5, 0.3, 0.36, def.color, 0, 0.98, d * 0.12, { roughness: 0.4 }))
    g.add(box(0.32, 0.2, 0.01, def.accent, -0.05, 0.98, d * 0.12 - 0.18, { roughness: 0.1 }))
    g.add(box(0.08, 0.2, 0.01, '#3a3d42', 0.17, 0.98, d * 0.12 - 0.18, { emissive: '#5bd77d', emissiveIntensity: 0.2 }))
  },
  'coffee-bar': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.86, d * 0.7, def.color, 0, 0.43, d * 0.1))
    g.add(box(w * 0.96, 0.05, d * 0.74, wood(def.accent), 0, 0.885, d * 0.1))
    g.add(box(0.3, 0.38, 0.3, '#c9ced3', 0, 1.1, d * 0.2, { metalness: 0.7, roughness: 0.25 }))
    g.add(box(0.08, 0.06, 0.1, DARK, 0, 1.0, d * 0.02))
    for (const sx of [-0.3, 0.3]) g.add(cylinder(0.04, 0.09, '#f2efe7', sx * w, 0.95, -d * 0.05))
    cabinetDoors(g, w * 0.9, 0.42, 0.7, -d * 0.26, 2, def.color)
  },
  dishwasher: (def, g, w, d) => {
    g.add(box(w * 0.96, 0.86, d * 0.8, def.color, 0, 0.43, d * 0.06))
    g.add(box(w, 0.05, d * 0.86, '#d9d6cf', 0, 0.885, d * 0.04))
    g.add(box(w * 0.86, 0.72, 0.02, def.accent, 0, 0.44, -d * 0.35, { metalness: 0.6, roughness: 0.25 }))
    g.add(box(w * 0.6, 0.03, 0.04, STEEL, 0, 0.74, -d * 0.38, { metalness: 0.8 }))
  },
  island: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.86, d * 0.7, def.color, 0, 0.43, 0))
    g.add(box(w, 0.05, d * 0.9, wood(def.accent), 0, 0.885, 0))
    cabinetDoors(g, w * 0.9, 0.44, 0.7, -d * 0.36, 4, def.color)
    g.add(box(0.36, 0.03, 0.26, wood('#c79a64'), -w * 0.18, 0.925, 0))
    for (let i = 0; i < 3; i++) g.add(sphere(0.05, ['#c44e3f', '#5aa04a', '#f2d24b'][i], w * 0.2 + i * 0.08, 0.96, 0))
  },
  pantry: (def, g, w, d) => {
    g.add(box(w * 0.9, 1.96, d * 0.62, def.color, 0, 0.98, d * 0.16))
    cabinetDoors(g, w * 0.86, 1.0, 1.84, -d * 0.16, 2, def.color)
    g.add(box(w * 0.92, 0.04, d * 0.66, wood(def.accent), 0, 1.98, d * 0.16))
  },
  cabinet: (def, g, w, d) => {
    g.add(box(w * 0.98, 0.86, d * 0.8, def.color, 0, 0.43, d * 0.06))
    g.add(box(w, 0.05, d * 0.86, wood(def.accent), 0, 0.885, d * 0.04))
    cabinetDoors(g, w * 0.92, 0.44, 0.7, -d * 0.35, 2, def.color)
    g.add(box(w * 0.98, 0.7, d * 0.4, def.color, 0, 1.75, d * 0.26))
    cabinetDoors(g, w * 0.92, 1.75, 0.64, d * 0.05, 2, def.color)
  },

  // ---- Bathroom ----
  bathtub: (def, g, w, d) => {
    g.add(box(w * 0.96, 0.56, d * 0.8, def.color, 0, 0.28, 0.02, { roughness: 0.2 }))
    g.add(box(w * 0.84, 0.04, d * 0.6, def.accent, 0, 0.54, 0.02, WATER))
    g.add(cylinder(0.02, 0.2, STEEL, w * 0.42, 0.66, 0.02, { metalness: 0.8 }))
  },
  clawfoot: (def, g, w, d) => {
    const tub = sphere(0.5, def.color, 0, 0.42, 0, { roughness: 0.15 }, 0.55)
    tub.scale.set(w * 0.92, 0.6, d * 0.72)
    g.add(tub)
    g.add(box(w * 0.78, 0.03, d * 0.54, '#e6f2f8', 0, 0.6, 0, WATER))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(sphere(0.05, def.accent, sx * w * 0.36, 0.06, sz * d * 0.22, { metalness: 0.8, roughness: 0.25 }))
    g.add(cylinder(0.015, 0.4, def.accent, w * 0.44, 0.8, 0, { metalness: 0.8 }))
    for (let i = 0; i < 6; i++) g.add(sphere(0.06, '#ffffff', (i - 2.5) * 0.14, 0.64, (i % 2 - 0.5) * 0.12, { roughness: 1 }))
  },
  'vanity-double': (def, g, w, d) => {
    g.add(box(w * 0.96, 0.8, d * 0.56, wood(def.accent), 0, 0.4, d * 0.18))
    g.add(box(w, 0.05, d * 0.6, def.color, 0, 0.83, d * 0.18, { roughness: 0.2 }))
    for (const sx of [-1, 1]) {
      g.add(cylinder(0.16, 0.04, '#dfe3e6', sx * w * 0.25, 0.85, d * 0.12, { roughness: 0.15 }))
      g.add(cylinder(0.012, 0.18, STEEL, sx * w * 0.25, 0.94, d * 0.34, { metalness: 0.8 }))
      g.add(box(w * 0.36, 0.6, 0.02, '#cfe3ef', sx * w * 0.25, 1.4, d * 0.46, { roughness: 0.05, metalness: 0.3 }))
    }
    cabinetDoors(g, w * 0.9, 0.42, 0.62, -d * 0.11, 4, def.accent)
  },
  'shower-rain': (def, g, w, d) => {
    g.add(box(w * 0.96, 0.06, d * 0.96, '#e9e7e2', 0, 0.03, 0, { roughness: 0.3 }))
    g.add(box(w * 0.96, 2.1, 0.02, def.accent, 0, 1.11, -d * 0.47, { opacity: 0.28, roughness: 0.05 }))
    g.add(box(0.02, 2.1, d * 0.96, def.accent, -w * 0.47, 1.11, 0, { opacity: 0.28, roughness: 0.05 }))
    g.add(box(0.02, 2.1, d * 0.96, def.color, w * 0.47, 1.11, 0, { roughness: 0.4 }))
    g.add(box(0.03, 0.03, 0.4, STEEL, 0, 2.1, d * 0.25, { metalness: 0.8 }))
    g.add(cylinder(0.18, 0.02, STEEL, 0, 2.08, 0.02, { metalness: 0.8, roughness: 0.2 }))
  },
  'towel-warmer': (def, g, _w, d) => {
    for (const sx of [-1, 1]) g.add(cylinder(0.02, 1.05, def.color, sx * 0.25, 0.53, d * 0.35, { metalness: 0.8, roughness: 0.25 }))
    for (let i = 0; i < 6; i++) g.add(cylinder(0.012, 0.5, def.color, 0, 0.3 + i * 0.13, d * 0.35, { metalness: 0.8 }).rotateZ(Math.PI / 2))
    g.add(box(0.44, 0.5, 0.05, cloth(def.accent), 0, 0.75, d * 0.32))
  },

  // ---- Electronics ----
  'tv-big': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.42, d * 0.45, wood('#3e3a36'), 0, 0.21, d * 0.18))
    g.add(box(w * 0.96, 0.82, 0.05, def.color, 0, 1.0, d * 0.25, { roughness: 0.3 }))
    g.add(box(w * 0.9, 0.76, 0.01, def.accent, 0, 1.0, d * 0.22, { roughness: 0.1, emissive: def.accent, emissiveIntensity: 0.5 }))
    for (const sx of [-1, 1]) g.add(box(0.16, 0.5, 0.16, DARK, sx * w * 0.42, 0.67, d * 0.18))
  },
  'game-console': (def, g, w, d) => {
    g.add(box(w * 0.8, 0.4, d * 0.4, wood('#5a3a26'), 0, 0.2, d * 0.24))
    g.add(box(w * 0.8, 0.5, 0.04, def.color, 0, 0.72, d * 0.3, { roughness: 0.3 }))
    g.add(box(w * 0.74, 0.44, 0.01, def.accent, 0, 0.72, d * 0.27, { emissive: def.accent, emissiveIntensity: 0.6 }))
    g.add(box(0.3, 0.06, 0.2, DARK, 0, 0.43, d * 0.22, { emissive: def.accent, emissiveIntensity: 0.15 }))
    g.add(box(0.14, 0.03, 0.08, DARK, 0.1, 0.02, -d * 0.2))
    g.add(sphere(0.2, cloth('#c44e3f'), 0, 0.12, -d * 0.35, {}, 0.5))
  },
  'gaming-pc': (def, g, w, d) => {
    g.add(box(w * 0.96, 0.04, d * 0.6, DARK, 0, 0.74, d * 0.18))
    legs(g, w * 0.92, d * 0.56, 0.72, DARK, 0.03, 0.04)
    g.add(box(0.62, 0.36, 0.03, DARK, 0, 1.02, d * 0.36))
    g.add(box(0.58, 0.32, 0.005, '#1a1030', 0, 1.02, d * 0.345, { emissive: def.accent, emissiveIntensity: 0.6 }))
    g.add(box(0.2, 0.44, 0.4, def.color, w * 0.36, 0.98, d * 0.24, { roughness: 0.3 }))
    g.add(box(0.005, 0.38, 0.32, def.accent, w * 0.26, 0.98, d * 0.24, { emissive: def.accent, emissiveIntensity: 1.2 }))
    g.add(box(0.4, 0.015, 0.13, DARK, 0, 0.77, d * 0.06, { emissive: '#7fc4ff', emissiveIntensity: 0.3 }))
    g.add(box(0.5, 0.06, 0.48, def.color, 0, 0.48, -d * 0.75))
    g.add(box(0.5, 0.6, 0.06, def.accent, 0, 0.82, -d * 0.98))
    g.add(cylinder(0.025, 0.46, STEEL, 0, 0.23, -d * 0.75, { metalness: 0.7 }))
  },
  jukebox: (def, g, w, d) => {
    g.add(box(w * 0.7, 1.1, d * 0.5, wood('#5a3a26'), 0, 0.55, d * 0.1))
    const top = cylinder(w * 0.35, d * 0.5, def.color, 0, 1.1, d * 0.1, { emissive: def.color, emissiveIntensity: 0.4 })
    top.rotation.x = Math.PI / 2
    g.add(top)
    g.add(box(w * 0.5, 0.36, 0.02, def.accent, 0, 0.95, -d * 0.16, { emissive: def.accent, emissiveIntensity: 0.9 }))
    for (let i = 0; i < 5; i++) g.add(box(w * 0.5, 0.025, 0.02, '#c9ced3', 0, 0.3 + i * 0.07, -d * 0.16, { metalness: 0.8 }))
  },
  arcade: (def, g, w, d) => {
    g.add(box(w * 0.7, 1.76, d * 0.66, def.color, 0, 0.88, d * 0.12))
    g.add(box(w * 0.56, 0.42, 0.02, '#0d0d14', 0, 1.3, -d * 0.18, { emissive: '#4fd8ff', emissiveIntensity: 0.55 }).rotateX(-0.25))
    g.add(box(w * 0.72, 0.06, 0.26, DARK, 0, 0.95, -d * 0.25))
    g.add(cylinder(0.015, 0.08, DARK, -0.1, 1.02, -d * 0.28))
    g.add(sphere(0.03, '#c44e3f', -0.1, 1.07, -d * 0.28))
    for (let i = 0; i < 3; i++) g.add(cylinder(0.025, 0.02, ['#ffd166', '#5bd77d', def.accent][i], 0.04 + i * 0.07, 0.99, -d * 0.27))
    g.add(box(w * 0.66, 0.16, 0.04, def.accent, 0, 1.68, -d * 0.2, { emissive: def.accent, emissiveIntensity: 0.9 }))
  },
  'record-player': (def, g, w, d) => {
    g.add(box(w * 0.92, 0.5, d * 0.5, wood(def.color), 0, 0.33, d * 0.12))
    legs(g, w * 0.86, d * 0.44, 0.1, wood(def.color), 0.04, 0.04)
    g.add(cylinder(0.16, 0.02, def.accent, -w * 0.2, 0.6, d * 0.12))
    g.add(cylinder(0.04, 0.025, '#c44e3f', -w * 0.2, 0.61, d * 0.12))
    g.add(box(0.02, 0.02, 0.2, STEEL, -w * 0.08, 0.62, d * 0.1, { metalness: 0.8 }))
    for (let i = 0; i < 8; i++) g.add(box(0.015, 0.28, 0.28, ['#3a6fa8', '#c44e3f', '#d8a23c', '#2f3136'][i % 4], w * 0.12 + i * 0.03, 0.74, d * 0.12))
    g.add(box(w * 0.36, 0.3, 0.02, '#3a3328', -w * 0.2, 0.32, -d * 0.14, { roughness: 1 }))
  },

  // ---- Hobbies ----
  piano: (def, g, w, d) => {
    g.add(box(w * 0.82, 1.26, d * 0.36, def.color, 0, 0.63, d * 0.3, { roughness: 0.2 }))
    g.add(box(w * 0.82, 0.05, d * 0.26, def.color, 0, 0.74, d * 0.02, { roughness: 0.2 }))
    g.add(box(w * 0.74, 0.03, d * 0.14, def.accent, 0, 0.77, -d * 0.02))
    for (let i = 0; i < 18; i++) g.add(box(0.025, 0.025, d * 0.08, '#111', -w * 0.34 + i * w * 0.04, 0.795, d * 0.03))
    g.add(box(w * 0.5, 0.05, 0.36, def.color, 0, 0.48, -d * 0.5, { roughness: 0.2 }))
    legsAt(g, 0, -d * 0.5, w * 0.48, 0.32, 0.46, def.color, 0.04)
  },
  guitar: (def, g, _w, _d) => {
    for (const sx of [-1, 1]) g.add(box(0.03, 0.4, 0.03, DARK, sx * 0.1, 0.2, 0).rotateZ(sx * 0.3))
    const body = sphere(0.18, wood(def.color), 0, 0.42, 0, { roughness: 0.4 }, 1.25)
    body.scale.z = 0.12
    g.add(body)
    const lower = sphere(0.22, wood(def.color), 0, 0.3, 0, { roughness: 0.4 })
    lower.scale.set(0.46, 0.4, 0.12)
    g.add(lower)
    g.add(cylinder(0.05, 0.02, DARK, 0, 0.42, -0.06).rotateX(Math.PI / 2))
    g.add(box(0.05, 0.5, 0.03, wood('#3e2a1e'), 0, 0.8, 0))
    g.add(box(0.07, 0.12, 0.03, wood('#3e2a1e'), 0, 1.08, 0))
  },
  drums: (def, g, w, d) => {
    const bass = cylinder(0.28, 0.36, def.color, 0, 0.3, d * 0.1, { roughness: 0.3, metalness: 0.2 })
    bass.rotation.x = Math.PI / 2
    g.add(bass)
    for (const [x, y, r] of [[-0.35, 0.62, 0.15], [0.35, 0.62, 0.15], [-0.15, 0.78, 0.12], [0.15, 0.78, 0.12]] as const) {
      g.add(cylinder(r, 0.14, def.color, x * w, y, d * 0.1, { roughness: 0.3 }))
      g.add(cylinder(0.015, y, def.accent, x * w, y / 2, d * 0.1, { metalness: 0.8 }))
    }
    for (const sx of [-1, 1]) {
      g.add(cylinder(0.2, 0.01, '#c9a75c', sx * w * 0.44, 1.05, d * 0.2, { metalness: 0.9, roughness: 0.2 }))
      g.add(cylinder(0.012, 1.05, def.accent, sx * w * 0.44, 0.52, d * 0.2, { metalness: 0.8 }))
    }
    g.add(cylinder(0.16, 0.06, cloth(DARK), 0, 0.46, -d * 0.4))
    g.add(cylinder(0.02, 0.44, def.accent, 0, 0.22, -d * 0.4, { metalness: 0.8 }))
  },
  easel: (def, g, _w, d) => {
    g.add(box(0.04, 1.65, 0.04, wood(def.color), -0.22, 0.82, 0).rotateZ(-0.1))
    g.add(box(0.04, 1.65, 0.04, wood(def.color), 0.22, 0.82, 0).rotateZ(0.1))
    g.add(box(0.04, 1.6, 0.04, wood(def.color), 0, 0.8, d * 0.28).rotateX(-0.25))
    g.add(box(0.56, 0.04, 0.08, wood(def.color), 0, 0.72, -0.03))
    g.add(box(0.6, 0.48, 0.03, '#f8f6ef', 0, 1.0, -0.02, { roughness: 1 }))
    g.add(box(0.3, 0.2, 0.005, def.accent, -0.08, 1.05, -0.04))
    g.add(sphere(0.07, '#d8a23c', 0.14, 0.94, -0.04, {}, 0.1))
  },
  chess: (def, g, w, _d) => {
    g.add(box(0.8, 0.05, 0.8, wood(def.color), 0, 0.72, 0))
    g.add(cylinder(0.06, 0.7, wood(def.color), 0, 0.35, 0))
    g.add(cylinder(0.3, 0.03, wood(def.color), 0, 0.015, 0))
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.add(box(0.12, 0.005, 0.12, def.accent, (i - 1.5) * 0.12 + 0.06, 0.75, (j - 1.5) * 0.12 + 0.06))
    for (let i = 0; i < 6; i++) g.add(cylinder(0.02, 0.06, i < 3 ? def.accent : DARK, (i % 3 - 1) * 0.12, 0.78, i < 3 ? -0.24 : 0.24))
    for (const sx of [-1, 1]) {
      g.add(box(0.4, 0.05, 0.4, wood(def.color), sx * w * 0.38, 0.46, 0))
      legsAt(g, sx * w * 0.38, 0, 0.36, 0.36, 0.44, wood(def.color))
      g.add(box(0.04, 0.42, 0.4, wood(def.color), sx * (w * 0.38 + 0.18), 0.7, 0))
    }
  },
  'pool-table': (def, g, w, d) => {
    g.add(box(w * 0.92, 0.14, d * 0.62, wood(def.accent), 0, 0.74, 0))
    g.add(box(w * 0.84, 0.02, d * 0.52, cloth(def.color), 0, 0.82, 0))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.12, 0.68, 0.12, wood(def.accent), sx * w * 0.4, 0.34, sz * d * 0.25))
    const colors = ['#f2f2f0', '#d8a23c', '#3a6fa8', '#c44e3f', '#7a5aa8', '#e8682c', '#2f3136']
    for (let i = 0; i < colors.length; i++) g.add(sphere(0.03, colors[i], -0.3 + (i % 4) * 0.07, 0.86, -0.05 + Math.floor(i / 4) * 0.07, { roughness: 0.2 }))
    g.add(cylinder(0.012, 1.4, wood('#d8b07a'), 0.2, 0.86, 0.1).rotateZ(Math.PI / 2 - 0.05))
  },
  foosball: (def, g, w, d) => {
    g.add(box(w * 0.7, 0.22, d * 0.5, wood(def.color), 0, 0.78, 0))
    g.add(box(w * 0.66, 0.01, d * 0.46, '#2e6b3e', 0, 0.85, 0))
    legs(g, w * 0.66, d * 0.46, 0.68, wood(def.color), 0.04, 0.07)
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * w * 0.1
      g.add(cylinder(0.01, d * 0.9, STEEL, x, 0.86, 0, { metalness: 0.8 }).rotateX(Math.PI / 2))
      g.add(box(0.04, 0.1, 0.04, i % 2 ? def.accent : '#c44e3f', x, 0.86, 0))
    }
  },
  'ping-pong': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.04, d * 0.56, def.color, 0, 0.74, 0, { roughness: 0.4 }))
    g.add(box(0.01, 0.005, d * 0.56, '#ffffff', 0, 0.762, 0))
    g.add(box(w * 0.94, 0.005, 0.01, '#ffffff', 0, 0.762, 0))
    g.add(box(0.02, 0.15, d * 0.6, '#f2f2f0', 0, 0.83, 0, { opacity: 0.7 }))
    legs(g, w * 0.86, d * 0.48, 0.72, DARK, 0.04, 0.05)
    g.add(sphere(0.02, '#ffffff', 0.3, 0.8, 0.1))
  },
  treadmill: (def, g, w, d) => {
    g.add(box(w * 0.64, 0.14, d * 0.86, def.color, 0, 0.1, 0.05))
    g.add(box(w * 0.52, 0.02, d * 0.78, '#1b1b1d', 0, 0.18, 0.05))
    for (const sx of [-1, 1]) g.add(box(0.05, 1.2, 0.05, def.color, sx * w * 0.3, 0.66, -d * 0.38).rotateX(0.15))
    g.add(box(w * 0.66, 0.2, 0.12, def.color, 0, 1.24, -d * 0.46))
    g.add(box(0.24, 0.12, 0.01, def.accent, 0, 1.28, -d * 0.4, { emissive: def.accent, emissiveIntensity: 0.6 }))
  },
  weights: (def, g, w, d) => {
    g.add(box(w * 0.36, 0.08, d * 0.7, cloth(def.accent), 0, 0.46, 0.1))
    for (const sz of [-1, 1]) g.add(box(0.06, 0.42, 0.06, def.color, 0, 0.21, sz * d * 0.25 + 0.1))
    for (const sx of [-1, 1]) g.add(box(0.05, 1.15, 0.05, def.color, sx * w * 0.38, 0.58, d * 0.36))
    g.add(cylinder(0.015, w * 1.0, STEEL, 0, 1.1, d * 0.36, { metalness: 0.8 }).rotateZ(Math.PI / 2))
    for (const sx of [-1, 1]) g.add(cylinder(0.16, 0.05, def.color, sx * w * 0.44, 1.1, d * 0.36).rotateZ(Math.PI / 2))
    for (const sx of [-0.16, 0.16]) g.add(cylinder(0.05, 0.22, DARK, sx, 0.05, -d * 0.36).rotateZ(Math.PI / 2))
  },
  'yoga-mat': (def, g, w, d) => {
    g.add(box(w * 0.6, 0.012, d * 0.86, def.color, 0, 0.008, 0, { roughness: 1 }))
    g.add(cylinder(0.07, w * 0.6, def.accent, 0, 0.07, d * 0.44).rotateZ(Math.PI / 2))
    g.add(sphere(0.25, def.accent, w * 0.32, 0.25, -d * 0.36, { roughness: 0.6 }))
  },
  telescope: (def, g) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      g.add(box(0.03, 1.0, 0.03, DARK, Math.cos(a) * 0.18, 0.48, Math.sin(a) * 0.18).rotateX(Math.sin(a) * 0.3).rotateZ(-Math.cos(a) * 0.3))
    }
    const tube = cylinder(0.08, 0.9, def.color, 0, 1.15, 0, { metalness: 0.8, roughness: 0.25 })
    tube.rotation.x = -0.9
    g.add(tube)
    const eye = cylinder(0.03, 0.15, DARK, 0, 0.88, 0.4)
    eye.rotation.x = -0.9
    g.add(eye)
  },
  aquarium: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.7, d * 0.5, wood('#3e3a36'), 0, 0.35, d * 0.1))
    g.add(box(w * 0.94, 0.56, d * 0.5, def.accent, 0, 0.98, d * 0.1, { roughness: 0.05, opacity: 0.5, emissive: def.accent, emissiveIntensity: 0.25 }))
    g.add(box(w * 0.94, 0.04, d * 0.5, DARK, 0, 1.28, d * 0.1))
    g.add(box(w * 0.9, 0.06, d * 0.46, '#e9d6a4', 0, 0.73, d * 0.1))
    for (let i = 0; i < 5; i++) g.add(sphere(0.035, ['#ff8a3c', '#ffd166', '#4fd8ff', '#ff4fa3', '#ffffff'][i], (i - 2) * w * 0.16, 0.9 + (i % 3) * 0.1, d * 0.1, { emissive: '#ffffff', emissiveIntensity: 0.15 }, 0.7))
    for (let i = 0; i < 4; i++) g.add(cone(0.05, 0.3, '#3f9a5a', (i - 1.5) * w * 0.2, 0.9, d * 0.2))
  },
  'bookshelf-wide': (def, g, w, d) => {
    g.add(box(w * 0.94, 1.96, d * 0.4, wood(def.color), 0, 0.98, d * 0.28))
    const colors = ['#c44e3f', '#3a6fa8', '#d8a23c', '#4f8a3f', '#7a5aa8', '#e8e1d3', '#2f3136']
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 0.24 + shelf * 0.45
      g.add(box(w * 0.9, 0.02, d * 0.36, '#4a2f1e', 0, y - 0.02, d * 0.24))
      let x = -w * 0.42
      let i = shelf * 3
      while (x < w * 0.4) {
        const bw = 0.04 + ((i * 7) % 4) * 0.012
        const bh = 0.26 + ((i * 5) % 3) * 0.05
        g.add(box(bw, bh, d * 0.28, colors[i % colors.length], x + bw / 2, y + bh / 2, d * 0.22, { roughness: 0.8 }))
        x += bw + 0.008
        i++
      }
    }
  },

  // ---- Babies and kids ----
  crib: (def, g, w, d) => {
    g.add(box(w * 0.86, 0.12, d * 0.62, cloth('#ffffff'), 0, 0.42, 0))
    g.add(box(w * 0.86, 0.04, d * 0.62, wood(def.color), 0, 0.35, 0))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, 1.0, 0.05, wood(def.color), sx * w * 0.43, 0.5, sz * d * 0.31))
    for (const sz of [-1, 1]) {
      g.add(box(w * 0.86, 0.04, 0.04, wood(def.color), 0, 0.96, sz * d * 0.31))
      for (let i = 0; i < 9; i++) g.add(box(0.02, 0.5, 0.02, wood(def.color), (i - 4) * w * 0.09, 0.7, sz * d * 0.31))
    }
    g.add(box(w * 0.5, 0.05, d * 0.4, cloth(def.accent), 0, 0.5, -d * 0.04))
    g.add(cylinder(0.01, 0.5, STEEL, w * 0.36, 1.2, 0))
    for (let i = 0; i < 4; i++) g.add(sphere(0.04, ['#ffd166', '#e86f9a', '#7fc4ff', '#5bd77d'][i], w * 0.36 + Math.cos(i * 1.6) * 0.12, 1.25, Math.sin(i * 1.6) * 0.12))
  },
  'high-chair': (def, g, _w, d) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, 0.9, 0.04, wood(def.color), sx * 0.18, 0.45, sz * 0.18).rotateZ(-sx * 0.08).rotateX(sz * 0.08))
    g.add(box(0.34, 0.04, 0.32, wood(def.color), 0, 0.6, 0))
    g.add(box(0.34, 0.4, 0.04, wood(def.color), 0, 0.82, d * 0.16))
    g.add(box(0.44, 0.03, 0.24, def.accent, 0, 0.78, -d * 0.2))
    g.add(cylinder(0.05, 0.03, '#7fc4ff', 0.05, 0.81, -d * 0.2))
  },
  potty: (def, g) => {
    g.add(cylinder(0.16, 0.22, def.accent, 0, 0.11, 0, { roughness: 0.3 }))
    g.add(ring(0.13, def.color, 0, 0.23, 0, { roughness: 0.3 }, 0.35))
    g.add(box(0.28, 0.2, 0.06, def.color, 0, 0.3, 0.14, { roughness: 0.3 }))
  },
  'play-mat': (def, g, w, d) => {
    g.add(box(w * 0.86, 0.02, d * 0.86, cloth(def.color), 0, 0.012, 0))
    for (let i = 0; i < 4; i++) g.add(box(w * 0.2, 0.022, d * 0.2, cloth(['#ffd166', '#e86f9a', '#5bd77d', '#ffffff'][i]), (i % 2 - 0.5) * w * 0.4, 0.014, (Math.floor(i / 2) - 0.5) * d * 0.4))
    g.add(box(0.03, 0.03, d * 0.86, def.accent, 0, 0.68, 0))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(0.015, 0.7, def.accent, sx * w * 0.4, 0.35, sz * d * 0.4).rotateZ(-sx * 0.25))
    for (let i = 0; i < 3; i++) g.add(sphere(0.06, ['#c44e3f', '#3a6fa8', '#d8a23c'][i], (i - 1) * 0.3, 0.38, 0))
  },
  'toy-box': (def, g, w, d) => {
    g.add(box(w * 0.8, 0.44, d * 0.56, wood(def.color), 0, 0.22, d * 0.1))
    g.add(box(w * 0.84, 0.06, d * 0.6, def.accent, 0, 0.47, d * 0.1))
    g.add(sphere(0.09, '#3a6fa8', -0.2, 0.08, -d * 0.3))
    g.add(box(0.12, 0.12, 0.12, '#5bd77d', 0.18, 0.06, -d * 0.32))
    g.add(sphere(0.08, '#ffd166', 0.1, 0.58, d * 0.1))
  },
  blocks: (def, g) => {
    const colors = [def.color, def.accent, '#c44e3f', '#5bd77d']
    for (let i = 0; i < 6; i++) g.add(box(0.12, 0.12, 0.12, colors[i % 4], (i % 3 - 1) * 0.14, 0.06 + Math.floor(i / 3) * 0.12, 0).rotateY(i * 0.3))
    g.add(box(0.12, 0.12, 0.12, colors[2], 0, 0.3, 0))
    g.add(cone(0.08, 0.12, colors[3], 0.25, 0.06, 0.2))
  },
  'rocking-horse': (def, g, _w, _d) => {
    for (const sx of [-1, 1]) {
      const rocker = ring(0.45, wood('#7a5034'), sx * 0.12, 0.42, 0, {}, 0.12)
      rocker.rotation.set(0, Math.PI / 2, 0)
      rocker.scale.set(1, 0.32, 0.06)
      g.add(rocker)
      for (const sz of [-1, 1]) g.add(box(0.04, 0.3, 0.04, wood(def.color), sx * 0.08, 0.25, sz * 0.18))
    }
    const body = sphere(0.18, wood(def.color), 0, 0.5, 0)
    body.scale.set(0.24, 0.22, 0.5)
    g.add(body)
    g.add(box(0.12, 0.26, 0.12, wood(def.color), 0, 0.65, -0.2).rotateX(0.4))
    g.add(box(0.12, 0.12, 0.22, wood(def.color), 0, 0.78, -0.3))
    g.add(box(0.03, 0.2, 0.18, def.accent, 0, 0.72, -0.16).rotateX(0.4))
    g.add(box(0.22, 0.04, 0.2, def.accent, 0, 0.55, 0.02))
  },
  teddy: (def, g) => {
    g.add(sphere(0.26, cloth(def.color), 0, 0.28, 0.05))
    g.add(sphere(0.18, cloth(def.color), 0, 0.64, 0.05))
    for (const sx of [-1, 1]) {
      g.add(sphere(0.07, cloth(def.color), sx * 0.13, 0.8, 0.05))
      g.add(sphere(0.09, cloth(def.color), sx * 0.24, 0.36, -0.05))
      g.add(sphere(0.1, cloth(def.color), sx * 0.15, 0.1, -0.15))
      g.add(sphere(0.02, '#1b1b1d', sx * 0.06, 0.68, -0.11))
    }
    g.add(sphere(0.07, cloth('#e8cba8'), 0, 0.6, -0.1))
    g.add(sphere(0.025, def.accent, 0, 0.62, -0.17))
    g.add(box(0.2, 0.05, 0.04, '#c44e3f', 0, 0.5, -0.1))
  },
  dollhouse: (def, g, w, d) => {
    g.add(box(w * 0.7, 0.04, d * 0.5, wood(def.accent), 0, 0.02, d * 0.1))
    g.add(box(w * 0.66, 0.7, d * 0.4, def.color, 0, 0.39, d * 0.15))
    g.add(cone(w * 0.5, 0.3, '#c44e3f', 0, 0.89, d * 0.15).rotateY(Math.PI / 4))
    for (const y of [0.25, 0.55]) for (const sx of [-1, 1]) g.add(box(0.12, 0.12, 0.01, '#9fc6dc', sx * w * 0.16, y, -d * 0.05, { emissive: '#ffe2a8', emissiveIntensity: 0.25 }))
    g.add(box(0.1, 0.16, 0.01, wood(def.accent), 0, 0.12, -d * 0.05))
  },
  'kids-table': (def, g, w, _d) => {
    g.add(cylinder(0.32, 0.04, def.color, 0, 0.44, 0))
    g.add(cylinder(0.04, 0.42, def.color, 0, 0.21, 0))
    g.add(cylinder(0.04, 0.06, def.accent, 0, 0.49, 0))
    for (let i = 0; i < 2; i++) g.add(cylinder(0.035, 0.04, '#ffffff', (i - 0.5) * 0.24, 0.48, 0.05))
    for (const sx of [-1, 1]) {
      g.add(box(0.28, 0.04, 0.28, def.accent, sx * w * 0.36, 0.27, 0))
      legsAt(g, sx * w * 0.36, 0, 0.24, 0.24, 0.26, def.accent, 0.03)
      g.add(box(0.03, 0.28, 0.28, def.accent, sx * (w * 0.36 + 0.13), 0.42, 0))
    }
  },
  chalkboard: (def, g, _w, _d) => {
    for (const sz of [-1, 1]) {
      g.add(box(0.04, 1.05, 0.04, wood(def.color), -0.26, 0.52, sz * 0.12).rotateX(sz * 0.12))
      g.add(box(0.04, 1.05, 0.04, wood(def.color), 0.26, 0.52, sz * 0.12).rotateX(sz * 0.12))
    }
    g.add(box(0.5, 0.6, 0.02, def.accent, 0, 0.7, -0.1).rotateX(0.12))
    g.add(box(0.2, 0.15, 0.005, '#f2f2f0', -0.08, 0.76, -0.115, { opacity: 0.6 }).rotateX(0.12))
    g.add(box(0.5, 0.03, 0.06, wood(def.color), 0, 0.38, -0.14))
  },
  'bed-racecar': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.42, d * 0.96, def.color, 0, 0.27, 0, { roughness: 0.3, metalness: 0.2 }))
    g.add(box(w * 0.82, 0.12, d * 0.72, cloth('#f4f1ea'), 0, 0.52, d * 0.08))
    g.add(box(w * 0.84, 0.05, d * 0.46, cloth('#2f3136'), 0, 0.6, -d * 0.04))
    g.add(box(w * 0.56, 0.09, 0.3, '#ffffff', 0, 0.62, d * 0.32))
    g.add(box(w * 0.94, 0.3, d * 0.18, def.color, 0, 0.62, -d * 0.4, { roughness: 0.3, metalness: 0.2 }))
    g.add(box(w * 0.94, 0.06, 0.2, def.accent, 0, 0.82, d * 0.44))
    for (const sx of [-1, 1]) for (const sz of [-0.32, 0.32]) g.add(cylinder(0.16, 0.08, def.accent, sx * w * 0.48, 0.16, sz * d).rotateZ(Math.PI / 2))
    g.add(box(0.12, 0.12, 0.01, '#ffffff', 0, 0.62, -d * 0.495, { emissive: '#ffffff', emissiveIntensity: 0.3 }))
  },

  // ---- Lighting ----
  'table-lamp': (def, g) => {
    g.add(box(0.36, 0.42, 0.36, wood('#b98a55'), 0, 0.21, 0))
    g.add(sphere(0.1, def.color, 0, 0.52, 0, { roughness: 0.3 }, 1.2))
    lampShade(g, def, 0.72, 0.15, 0.18)
  },
  'tripod-lamp': (def, g) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      g.add(box(0.03, 1.3, 0.03, wood(def.color), Math.cos(a) * 0.14, 0.64, Math.sin(a) * 0.14).rotateX(Math.sin(a) * 0.2).rotateZ(-Math.cos(a) * 0.2))
    }
    lampShade(g, def, 1.42, 0.24, 0.3)
  },
  'paper-lantern': (def, g) => {
    g.add(cylinder(0.14, 0.03, def.color, 0, 0.015, 0))
    g.add(cylinder(0.012, 0.9, def.color, 0, 0.45, 0))
    g.add(sphere(0.26, def.accent, 0, 1.06, 0, { ...GLOW, emissiveIntensity: 1.1, opacity: 0.95 }))
  },
  torchiere: (def, g) => {
    g.add(cylinder(0.15, 0.03, def.color, 0, 0.015, 0, { metalness: 0.8, roughness: 0.25 }))
    g.add(cylinder(0.015, 1.65, def.color, 0, 0.83, 0, { metalness: 0.8, roughness: 0.25 }))
    const bowl = cone(0.22, 0.18, def.color, 0, 1.72, 0, { metalness: 0.8, roughness: 0.25 })
    bowl.rotation.x = Math.PI
    g.add(bowl)
    g.add(cylinder(0.18, 0.02, def.accent, 0, 1.8, 0, GLOW))
  },
  candles: (def, g) => {
    g.add(cylinder(0.2, 0.02, '#b08a3c', 0, 0.01, 0, { metalness: 0.7 }))
    for (const [x, z, h] of [[0, 0, 0.3], [0.1, 0.06, 0.2], [-0.09, 0.07, 0.24], [0.02, -0.11, 0.16]] as const) {
      g.add(cylinder(0.035, h, def.color, x, h / 2 + 0.02, z))
      g.add(sphere(0.018, def.accent, x, h + 0.05, z, { emissive: def.accent, emissiveIntensity: 2 }, 1.6))
    }
  },
  'lamp-post': (def, g) => {
    g.add(cylinder(0.12, 0.15, def.color, 0, 0.075, 0, { metalness: 0.5 }))
    g.add(cylinder(0.04, 2.3, def.color, 0, 1.2, 0, { metalness: 0.5 }))
    g.add(box(0.26, 0.32, 0.26, def.accent, 0, 2.45, 0, { ...GLOW, opacity: 0.9 }))
    g.add(cone(0.22, 0.18, def.color, 0, 2.7, 0, { metalness: 0.5 }))
  },
  'path-lantern': (def, g) => {
    g.add(box(0.06, 0.4, 0.06, def.color, 0, 0.2, 0))
    g.add(box(0.16, 0.18, 0.16, def.accent, 0, 0.48, 0, { ...GLOW, opacity: 0.9 }))
    g.add(cone(0.14, 0.08, def.color, 0, 0.61, 0).rotateY(Math.PI / 4))
  },
  'tiki-torch': (def, g) => {
    g.add(cylinder(0.03, 1.4, wood(def.color), 0, 0.7, 0))
    g.add(cylinder(0.07, 0.2, wood('#c9a36b'), 0, 1.5, 0))
    g.add(cone(0.06, 0.2, def.accent, 0, 1.7, 0, { emissive: def.accent, emissiveIntensity: 2.2 }))
  },

  // ---- Decor ----
  'grandfather-clock': (def, g, _w, d) => {
    g.add(box(0.46, 2.0, 0.32, wood(def.color), 0, 1.0, d * 0.25))
    g.add(cone(0.3, 0.14, wood(def.color), 0, 2.07, d * 0.25).rotateY(Math.PI / 4))
    g.add(cylinder(0.16, 0.02, def.accent, 0, 1.62, d * 0.25 - 0.165).rotateX(Math.PI / 2))
    g.add(box(0.005, 0.12, 0.01, DARK, 0, 1.66, d * 0.25 - 0.18))
    g.add(box(0.3, 0.8, 0.01, '#cfe3ef', 0, 0.95, d * 0.25 - 0.165, { opacity: 0.4, roughness: 0.05 }))
    g.add(cylinder(0.08, 0.02, def.accent, 0, 0.75, d * 0.25 - 0.1, { metalness: 0.9, roughness: 0.2 }).rotateX(Math.PI / 2))
    g.add(box(0.015, 0.5, 0.015, def.accent, 0, 1.0, d * 0.25 - 0.1, { metalness: 0.9 }))
  },
  'floor-mirror': (def, g, _w, d) => {
    const frame = box(0.62, 1.7, 0.05, def.color, 0, 0.85, d * 0.32, { metalness: 0.6, roughness: 0.3 })
    frame.rotation.x = -0.1
    g.add(frame)
    const glass = box(0.54, 1.6, 0.01, def.accent, 0, 0.85, d * 0.3, { roughness: 0.02, metalness: 0.9 })
    glass.rotation.x = -0.1
    g.add(glass)
  },
  sculpture: (def, g) => {
    g.add(box(0.4, 0.7, 0.4, def.color, 0, 0.35, 0, { roughness: 0.4 }))
    g.add(ring(0.22, def.accent, 0, 1.0, 0, { metalness: 0.7, roughness: 0.3 }, 0.6).rotateY(0.6))
    g.add(sphere(0.12, def.color, 0.05, 0.85, 0, { roughness: 0.2 }))
    g.add(cone(0.08, 0.5, def.accent, -0.1, 1.15, 0, { metalness: 0.7 }))
  },
  'floor-vase': (def, g) => {
    g.add(sphere(0.22, def.color, 0, 0.32, 0, { roughness: 0.2 }, 1.4))
    g.add(cylinder(0.08, 0.3, def.color, 0, 0.72, 0, { roughness: 0.2 }))
    for (let i = 0; i < 5; i++) g.add(cylinder(0.008, 0.6, def.accent, Math.cos(i) * 0.05, 1.05, Math.sin(i) * 0.05).rotateZ((i - 2) * 0.12))
  },
  globe: (def, g) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      g.add(box(0.03, 0.55, 0.03, wood(def.color), Math.cos(a) * 0.14, 0.27, Math.sin(a) * 0.14))
    }
    g.add(ring(0.26, def.color, 0, 0.55, 0, {}, 0.3))
    g.add(sphere(0.22, def.accent, 0, 0.78, 0, { roughness: 0.6 }))
    g.add(ring(0.25, '#b08a3c', 0, 0.78, 0, { metalness: 0.8 }, 0.25).rotateY(Math.PI / 2).rotateZ(0.4))
  },
  palm: (def, g) => {
    g.add(cylinder(0.2, 0.36, def.color, 0, 0.18, 0))
    g.add(cylinder(0.04, 1.3, wood('#7a5a3e'), 0, 1.0, 0))
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const frond = box(0.12, 0.02, 0.6, def.accent, Math.cos(a) * 0.25, 1.62, Math.sin(a) * 0.25, { roughness: 0.9 })
      frond.rotation.set(0.5 * Math.sin(a), -a + Math.PI / 2, 0.5 * Math.cos(a))
      g.add(frond)
    }
  },
  cactus: (def, g) => {
    g.add(cylinder(0.18, 0.2, def.color, 0, 0.1, 0))
    g.add(sphere(0.18, def.accent, 0, 0.36, 0, { roughness: 0.8 }, 1.3))
    g.add(sphere(0.04, '#e86f9a', 0, 0.6, 0))
  },
  fig: (def, g) => {
    g.add(cylinder(0.18, 0.4, def.color, 0, 0.2, 0, { roughness: 0.4 }))
    g.add(cylinder(0.025, 1.0, wood('#6b4a2f'), 0, 0.9, 0))
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4
      g.add(sphere(0.12, def.accent, Math.cos(a) * 0.18, 1.0 + (i / 10) * 0.6, Math.sin(a) * 0.18, { roughness: 0.6 }, 0.4).rotateX(0.5))
    }
  },
  'rug-round': (def, g) => {
    g.add(cylinder(0.92, 0.015, cloth(def.color), 0, 0.01, 0))
    g.add(ring(0.7, def.accent, 0, 0.018, 0, {}, 0.05))
    g.add(ring(0.45, def.accent, 0, 0.018, 0, {}, 0.05))
  },
  'rug-runner': (def, g, w, d) => {
    g.add(box(w * 0.7, 0.015, d * 0.92, cloth(def.color), 0, 0.01, 0))
    g.add(box(w * 0.5, 0.016, d * 0.8, cloth(def.accent), 0, 0.012, 0))
    for (let i = 0; i < 5; i++) g.add(box(w * 0.3, 0.017, 0.08, cloth(def.color), 0, 0.014, (i - 2) * d * 0.16))
  },
  'rug-shag': (def, g, w, d) => {
    g.add(box(w * 0.9, 0.025, d * 0.9, cloth(def.color), 0, 0.014, 0))
    g.add(box(w * 0.86, 0.03, d * 0.86, cloth(def.accent), 0, 0.016, 0, { roughness: 1 }))
  },
  'folding-screen': (def, g, w, d) => {
    for (let i = 0; i < 4; i++) {
      const panel = box(w * 0.23, 1.65, 0.03, wood(def.color), (i - 1.5) * w * 0.23, 0.85, d * 0.1 + (i % 2 ? 0.08 : 0))
      panel.rotation.y = i % 2 ? 0.3 : -0.3
      g.add(panel)
      const inset = box(w * 0.18, 1.3, 0.035, cloth(def.accent), (i - 1.5) * w * 0.23, 0.9, d * 0.1 + (i % 2 ? 0.08 : 0))
      inset.rotation.y = panel.rotation.y
      g.add(inset)
    }
  },
  fireplace: (def, g, w, d) => {
    g.add(box(w * 0.92, 1.3, d * 0.5, def.color, 0, 0.65, d * 0.22, { roughness: 0.95 }))
    g.add(box(w * 1.0, 0.08, d * 0.56, wood('#5a3a26'), 0, 1.32, d * 0.22))
    g.add(box(w * 0.5, 0.6, 0.1, '#1b1b1d', 0, 0.38, -d * 0.02))
    for (let i = 0; i < 3; i++) g.add(cylinder(0.04, 0.4, wood('#4a2f1e'), (i - 1) * 0.12, 0.13, 0).rotateZ(Math.PI / 2).rotateY(i * 0.4))
    g.add(cone(0.12, 0.3, def.accent, 0, 0.32, 0, { emissive: def.accent, emissiveIntensity: 2 }))
    g.add(cone(0.08, 0.22, '#ffd166', 0.1, 0.28, 0, { emissive: '#ffd166', emissiveIntensity: 2 }))
    g.add(box(w * 0.98, 0.08, d * 0.7, def.color, 0, 0.04, 0, { roughness: 0.95 }))
    g.add(cylinder(0.06, 0.2, '#e8e1d3', -w * 0.3, 1.46, d * 0.22))
    g.add(cylinder(0.04, 0.26, '#c44e3f', w * 0.3, 1.49, d * 0.22))
  },
  'coat-tree': (def, g) => {
    g.add(cylinder(0.18, 0.04, wood(def.color), 0, 0.02, 0))
    g.add(cylinder(0.025, 1.75, wood(def.color), 0, 0.88, 0))
    for (let i = 0; i < 4; i++) g.add(box(0.02, 0.02, 0.18, wood(def.color), Math.cos(i * 1.57) * 0.08, 1.65, Math.sin(i * 1.57) * 0.08).rotateY(i * 1.57).rotateX(-0.5))
    g.add(box(0.3, 0.5, 0.12, cloth(def.accent), 0.06, 1.35, 0))
  },

  // ---- Yard and play ----
  'swing-set': (def, g, w, d) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, 2.2, 0.07, def.color, sx * w * 0.46, 1.05, sz * d * 0.3).rotateX(-sz * 0.22))
    g.add(cylinder(0.05, w * 0.96, def.color, 0, 2.1, 0, { metalness: 0.4 }).rotateZ(Math.PI / 2))
    for (const sx of [-1, 1]) {
      for (const r of [-1, 1]) g.add(cylinder(0.008, 1.55, '#c9ced3', sx * w * 0.22 + r * 0.17, 1.3, 0, { metalness: 0.8 }))
      g.add(box(0.4, 0.04, 0.18, def.accent, sx * w * 0.22, 0.5, 0))
    }
  },
  slide: (def, g, _w, d) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.07, 1.6, 0.07, '#f2f2f0', sx * 0.4, 0.8, d * 0.2 + sz * 0.4))
    g.add(box(0.9, 0.06, 0.9, wood('#b98a55'), 0, 1.2, d * 0.2))
    g.add(cone(0.68, 0.5, def.color, 0, 1.85, d * 0.2).rotateY(Math.PI / 4))
    const chute = box(0.5, 0.04, 1.6, def.accent, 0, 0.66, -d * 0.18, { roughness: 0.3 })
    chute.rotation.x = -0.7
    g.add(chute)
    for (const sx of [-1, 1]) {
      const rail = box(0.04, 0.12, 1.6, def.accent, sx * 0.25, 0.72, -d * 0.18)
      rail.rotation.x = -0.7
      g.add(rail)
    }
    for (let i = 0; i < 5; i++) g.add(box(0.5, 0.04, 0.05, '#f2f2f0', 0, 0.2 + i * 0.22, d * 0.48))
  },
  trampoline: (def, g, w, _d) => {
    g.add(cylinder(w * 0.46, 0.04, def.color, 0, 0.78, 0))
    g.add(ring(w * 0.47, def.accent, 0, 0.8, 0, {}, 0.12))
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      g.add(cylinder(0.025, 0.8, '#c9ced3', Math.cos(a) * w * 0.44, 0.4, Math.sin(a) * w * 0.44, { metalness: 0.7 }))
    }
  },
  sandbox: (def, g, w, d) => {
    for (const sx of [-1, 1]) g.add(box(0.12, 0.3, d * 0.94, wood(def.color), sx * w * 0.44, 0.15, 0))
    for (const sz of [-1, 1]) g.add(box(w * 0.94, 0.3, 0.12, wood(def.color), 0, 0.15, sz * d * 0.44))
    g.add(box(w * 0.82, 0.2, d * 0.82, def.accent, 0, 0.1, 0, { roughness: 1 }))
    g.add(cone(0.18, 0.26, def.accent, -0.3, 0.32, 0.2, { roughness: 1 }))
    g.add(cylinder(0.1, 0.14, '#e86f9a', 0.3, 0.27, -0.2))
    g.add(box(0.04, 0.3, 0.04, '#3a6fa8', 0.4, 0.3, 0.3).rotateZ(0.5))
  },
  playhouse: (def, g, w, d) => {
    g.add(box(w * 0.8, 1.2, d * 0.7, def.color, 0, 0.6, d * 0.08))
    gable(g, def.accent, w * 0.8, d * 0.7, 1.2, 0.6, d * 0.08)
    g.add(box(0.4, 0.8, 0.02, def.accent, 0, 0.4, -d * 0.28))
    for (const sx of [-1, 1]) g.add(box(0.26, 0.26, 0.02, '#9fc6dc', sx * w * 0.24, 0.8, -d * 0.28))
    for (const sx of [-1, 1]) g.add(box(0.3, 0.1, 0.12, '#8a5d38', sx * w * 0.24, 0.62, -d * 0.32))
    for (let i = 0; i < 4; i++) g.add(sphere(0.05, i % 2 ? '#e86f9a' : '#ffd166', (i - 1.5) * 0.12 + (i < 2 ? -w * 0.24 : w * 0.24) * 0.3, 0.7, -d * 0.33))
  },
  'soccer-goal': (def, g, w, d) => {
    for (const sx of [-1, 1]) g.add(cylinder(0.035, 1.2, def.color, sx * w * 0.46, 0.6, -d * 0.3))
    g.add(cylinder(0.035, w * 0.92, def.color, 0, 1.2, -d * 0.3).rotateZ(Math.PI / 2))
    for (const sx of [-1, 1]) g.add(box(0.03, 0.03, d * 0.7, def.color, sx * w * 0.46, 0.02, 0.05))
    g.add(box(w * 0.92, 1.2, 0.01, def.accent, 0, 0.6, d * 0.38, { opacity: 0.35, roughness: 1 }).rotateX(-0.45))
    g.add(sphere(0.11, '#ffffff', 0.3, 0.11, -d * 0.48))
  },
  'hot-tub': (def, g, w, d) => {
    for (const sx of [-1, 1]) g.add(box(0.12, 0.85, d * 0.96, wood(def.color), sx * (w * 0.48 - 0.06), 0.43, 0))
    for (const sz of [-1, 1]) g.add(box(w * 0.96, 0.85, 0.12, wood(def.color), 0, 0.43, sz * (d * 0.48 - 0.06)))
    g.add(box(w * 0.84, 0.3, d * 0.84, '#e8eef2', 0, 0.15, 0))
    g.add(box(w * 0.84, 0.04, d * 0.84, def.accent, 0, 0.72, 0, { ...WATER, emissive: def.accent, emissiveIntensity: 0.25 }))
    for (const sx of [-1, 1]) g.add(box(w * 0.84, 0.32, 0.2, '#e8eef2', 0, 0.42, sx * d * 0.32))
    for (let i = 0; i < 6; i++) g.add(sphere(0.04, '#ffffff', (i % 3 - 1) * 0.3, 0.8, (Math.floor(i / 3) - 0.5) * 0.4, { opacity: 0.8 }, 0.4))
  },
  pool: (def, g, w, d) => {
    g.add(box(w * 0.98, 0.1, d * 0.98, def.color, 0, 0.05, 0, { roughness: 0.9 }))
    g.add(box(w * 0.82, 0.06, d * 0.86, def.accent, 0, 0.09, 0, { ...WATER, emissive: def.accent, emissiveIntensity: 0.3 }))
    for (const sx of [-1, 1]) g.add(cylinder(0.02, 0.6, STEEL, sx * 0.25, 0.3, d * 0.44, { metalness: 0.9 }))
    g.add(ring(0.25, '#e8533c', w * 0.3, 0.13, -d * 0.3, {}, 0.6))
    g.add(box(0.6, 0.04, 0.4, wood('#b98a55'), 0, 0.14, -d * 0.48))
  },
  'fire-pit': (def, g, w, d) => {
    g.add(cylinder(0.42, 0.34, def.color, 0, 0.17, 0, { roughness: 1 }))
    g.add(cylinder(0.32, 0.02, '#1b1b1d', 0, 0.345, 0))
    for (let i = 0; i < 3; i++) g.add(cylinder(0.04, 0.4, wood('#4a2f1e'), 0, 0.38, 0).rotateZ(Math.PI / 2).rotateY(i * 1.05))
    g.add(cone(0.16, 0.36, def.accent, 0, 0.55, 0, { emissive: def.accent, emissiveIntensity: 2.2 }))
    g.add(cone(0.1, 0.26, '#ffd166', 0.05, 0.5, 0.04, { emissive: '#ffd166', emissiveIntensity: 2.2 }))
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const log = cylinder(0.14, 0.6, wood('#8a6440'), Math.cos(a) * w * 0.4, 0.18, Math.sin(a) * d * 0.4)
      log.rotation.set(Math.PI / 2, 0, a + Math.PI / 2)
      g.add(log)
    }
  },
  hammock: (def, g, w, d) => {
    for (const sx of [-1, 1]) g.add(cylinder(0.06, 1.4, wood(def.color), sx * w * 0.46, 0.7, 0))
    const bed = sphere(0.5, cloth(def.accent), 0, 0.62, 0, { roughness: 1 })
    bed.scale.set(w * 0.8, 0.14, d * 0.7)
    g.add(bed)
    for (const sx of [-1, 1]) g.add(cylinder(0.01, 0.4, '#c9b28d', sx * w * 0.42, 0.95, 0).rotateZ(sx * 1.0))
    g.add(box(0.36, 0.08, 0.24, '#ffffff', -w * 0.25, 0.72, 0))
  },
  adirondack: (def, g, _w, d) => {
    for (let i = 0; i < 5; i++) g.add(box(0.1, 0.03, d * 0.5, wood(def.color), (i - 2) * 0.11, 0.38, -0.02).rotateX(0.12))
    for (let i = 0; i < 5; i++) g.add(box(0.09, 0.8, 0.03, wood(def.color), (i - 2) * 0.11, 0.72, d * 0.26).rotateX(-0.35))
    for (const sx of [-1, 1]) {
      g.add(box(0.14, 0.03, d * 0.7, wood(def.color), sx * 0.34, 0.62, 0))
      g.add(box(0.05, 0.62, 0.05, wood(def.color), sx * 0.34, 0.31, -d * 0.28))
      g.add(box(0.05, 0.4, 0.05, wood(def.color), sx * 0.3, 0.2, d * 0.18))
    }
  },
  'patio-set': (def, g, w, d) => {
    g.add(cylinder(0.5, 0.04, def.color, 0, 0.74, 0, { metalness: 0.4, roughness: 0.4 }))
    g.add(cylinder(0.03, 2.2, STEEL, 0, 1.1, 0, { metalness: 0.7 }))
    g.add(cone(1.0, 0.4, cloth(def.accent), 0, 2.15, 0))
    g.add(cylinder(0.25, 0.03, def.color, 0, 0.015, 0))
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      const x = Math.cos(a) * w * 0.36, z = Math.sin(a) * d * 0.36
      g.add(box(0.4, 0.04, 0.4, def.color, x, 0.44, z, { metalness: 0.4 }))
      legsAt(g, x, z, 0.36, 0.36, 0.44, def.color, 0.03)
      g.add(box(0.36, 0.04, 0.36, cloth(def.accent), x, 0.48, z))
    }
  },
  lounger: (def, g, w, d) => {
    g.add(box(w * 0.6, 0.06, d * 0.7, def.color, 0, 0.3, -d * 0.1))
    const back = box(w * 0.6, 0.06, d * 0.3, def.color, 0, 0.5, d * 0.3)
    back.rotation.x = 0.7
    g.add(back)
    g.add(box(w * 0.54, 0.06, d * 0.66, cloth(def.accent), 0, 0.35, -d * 0.1))
    legs(g, w * 0.58, d * 0.86, 0.28, def.color, 0.03, 0.04)
    g.add(box(0.5, 0.02, 0.3, cloth('#ffd166'), 0, 0.39, -d * 0.2))
  },
  fountain: (def, g) => {
    g.add(cylinder(0.9, 0.35, def.color, 0, 0.18, 0, { roughness: 0.9 }))
    g.add(cylinder(0.8, 0.04, def.accent, 0, 0.32, 0, WATER))
    g.add(cylinder(0.12, 0.9, def.color, 0, 0.75, 0, { roughness: 0.9 }))
    g.add(cylinder(0.42, 0.12, def.color, 0, 1.0, 0, { roughness: 0.9 }))
    g.add(cylinder(0.36, 0.03, def.accent, 0, 1.06, 0, WATER))
    g.add(cylinder(0.08, 0.35, def.color, 0, 1.25, 0))
    g.add(sphere(0.1, def.color, 0, 1.45, 0))
    g.add(cone(0.18, 0.3, def.accent, 0, 1.25, 0, { opacity: 0.4, roughness: 0.05 }))
  },
  'bird-bath': (def, g) => {
    g.add(cylinder(0.16, 0.06, def.color, 0, 0.03, 0, { roughness: 0.9 }))
    g.add(cylinder(0.07, 0.7, def.color, 0, 0.4, 0, { roughness: 0.9 }))
    g.add(cylinder(0.3, 0.08, def.color, 0, 0.78, 0, { roughness: 0.9 }))
    g.add(cylinder(0.26, 0.02, def.accent, 0, 0.82, 0, WATER))
    g.add(sphere(0.05, '#c44e3f', 0.2, 0.88, 0))
  },
  'outdoor-kitchen': (def, g, w, d) => {
    g.add(box(w * 0.96, 0.86, d * 0.72, def.color, 0, 0.43, d * 0.12, { roughness: 0.95 }))
    g.add(box(w, 0.06, d * 0.78, '#cfccc4', 0, 0.89, d * 0.12, { roughness: 0.4 }))
    g.add(box(w * 0.46, 0.06, d * 0.5, def.accent, -w * 0.2, 0.95, d * 0.14, { metalness: 0.6 }))
    const lid = box(w * 0.46, 0.04, d * 0.4, '#c9ced3', -w * 0.2, 1.2, d * 0.38, { metalness: 0.8, roughness: 0.25 })
    lid.rotation.x = -1.2
    g.add(lid)
    g.add(cylinder(0.2, 0.06, '#c9ced3', w * 0.25, 0.93, d * 0.12, { metalness: 0.8 }))
    for (let i = 0; i < 3; i++) g.add(cylinder(0.03, 0.03, DARK, -w * 0.2 + (i - 1) * 0.12, 0.6, -d * 0.25).rotateX(Math.PI / 2))
  },
  'veggie-patch': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.12, d * 0.94, def.color, 0, 0.06, 0, { roughness: 1 }))
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) {
      const x = (i - 2) * w * 0.18, z = (row - 1) * d * 0.3
      if (row === 0) g.add(sphere(0.07, '#c44e3f', x, 0.2, z))
      else if (row === 1) g.add(cone(0.05, 0.25, '#e8682c', x, 0.12, z).rotateX(Math.PI))
      g.add(sphere(row === 2 ? 0.12 : 0.08, def.accent, x, row === 2 ? 0.2 : 0.26, z + (row === 1 ? 0 : 0.05), { roughness: 0.9 }, 0.8))
    }
  },
  'apple-tree': (_def, g) => {
    g.add(buildTree(11, 0.7))
    for (let i = 0; i < 9; i++) {
      const a = i * 2.3
      g.add(sphere(0.07, '#c4322b', Math.cos(a) * 0.9, 2.4 + (i % 3) * 0.4, Math.sin(a) * 0.9, { roughness: 0.4 }))
    }
  },
  spruce: (def, g) => {
    g.add(cylinder(0.12, 1.0, wood(def.color), 0, 0.5, 0))
    for (let i = 0; i < 4; i++) g.add(cone(1.1 - i * 0.22, 1.5, def.accent, 0, 1.3 + i * 0.85, 0, { roughness: 0.95 }))
  },
  birch: (def, g) => {
    g.add(cylinder(0.11, 3.6, def.color, 0, 1.8, 0, { roughness: 0.9 }))
    for (let i = 0; i < 7; i++) g.add(box(0.12, 0.03, 0.12, DARK, 0, 0.4 + i * 0.45, 0).rotateY(i))
    leafy(g, def.accent, 0, 3.8, 0, 1.1, 7)
  },
  hedge: (def, g, w, d) => {
    g.add(box(w * 0.92, 0.8, d * 0.92, def.color, 0, 0.42, 0, { roughness: 1 }))
    for (let i = 0; i < 5; i++) g.add(sphere(0.25, def.accent, (i % 3 - 1) * 0.28, 0.75, (Math.floor(i / 3) - 0.5) * 0.3, { roughness: 1 }, 0.6))
  },
  'garden-gnome': (def, g) => {
    g.add(cylinder(0.12, 0.2, def.accent, 0, 0.1, 0))
    g.add(sphere(0.09, '#e9c8a8', 0, 0.26, 0))
    g.add(cone(0.1, 0.22, def.color, 0, 0.42, 0))
    g.add(cone(0.08, 0.14, '#ffffff', 0, 0.18, -0.06).rotateX(Math.PI))
  },
  shed: (def, g, w, d) => {
    g.add(box(w * 0.9, 1.9, d * 0.86, wood(def.color), 0, 0.95, 0.02))
    gable(g, def.accent, w * 0.9, d * 0.86, 1.9, 0.5, 0.02)
    for (const sx of [-1, 1]) g.add(box(w * 0.22, 1.5, 0.03, wood('#6b4a2f'), sx * w * 0.115, 0.75, -d * 0.42))
    g.add(box(0.03, 0.12, 0.04, STEEL, 0.03, 0.85, -d * 0.44, { metalness: 0.8 }))
    g.add(box(0.36, 0.3, 0.02, '#9fc6dc', w * 0.45, 1.3, 0.1).rotateY(Math.PI / 2))
  },
  mailbox: (def, g) => {
    g.add(box(0.08, 1.0, 0.08, wood('#6b4a2f'), 0, 0.5, 0))
    const body = cylinder(0.14, 0.45, def.color, 0, 1.1, 0, { metalness: 0.5, roughness: 0.4 })
    body.rotation.x = Math.PI / 2
    g.add(body)
    g.add(box(0.28, 0.14, 0.45, def.color, 0, 1.03, 0, { metalness: 0.5, roughness: 0.4 }))
    g.add(box(0.02, 0.18, 0.06, def.accent, 0.16, 1.2, 0.1))
  },
}

const ROUND4 = (r: number, y: number): SeatRule => (_def, seat) => {
  const a = (seat / 4) * Math.PI * 2 + Math.PI / 4
  return { x: Math.sin(a) * r, y, z: -Math.cos(a) * r, yaw: Math.PI - a }
}

/** Seats that don't follow the default (a row across the front, facing -z). */
export const moreSeats: Record<string, SeatRule> = {
  'gaming-pc': def => ({ x: 0, y: 0.5, z: -def.d * 0.75 }),
  desk: def => ({ x: 0, y: 0.48, z: -def.d * 0.62 }),
  piano: def => ({ x: 0, y: 0.5, z: -def.d * 0.5 }),
  drums: def => ({ x: 0, y: 0.48, z: -def.d * 0.4 }),
  'bar-stool': () => ({ x: 0, y: 0.78, z: 0 }),
  'bean-bag': () => ({ x: 0, y: 0.3, z: 0.05 }),
  papasan: () => ({ x: 0, y: 0.52, z: 0 }),
  recliner: (_def, _seat, lie) => (lie ? { x: 0, y: 0.5, z: 0 } : { x: 0, y: 0.46, z: 0 }),
  chaise: (def, _seat, lie) => (lie ? { x: 0, y: 0.42, z: 0, yaw: Math.PI / 2 } : { x: -def.w * 0.15, y: 0.44, z: -0.02 }),
  hammock: (_def, _seat, lie) => (lie ? { x: 0, y: 0.7, z: 0, yaw: -Math.PI / 2 } : { x: 0, y: 0.66, z: 0 }),
  'bed-queen': (def, seat, lie) => ({ x: ((seat + 0.5) / 2 - 0.5) * def.w, y: lie ? 0.46 : 0.42, z: -0.1 }),
  'bunk-bed': (_def, seat) => ({ x: 0, y: seat === 0 ? 0.48 : 1.42, z: -0.1 }),
  'bed-racecar': () => ({ x: 0, y: 0.6, z: -0.05 }),
  crib: () => ({ x: 0, y: 0.5, z: -0.1 }),
  'high-chair': () => ({ x: 0, y: 0.62, z: 0 }),
  potty: () => ({ x: 0, y: 0.24, z: 0 }),
  'rocking-horse': () => ({ x: 0, y: 0.56, z: 0 }),
  'kids-table': (def, seat) => ({ x: (seat ? 1 : -1) * def.w * 0.36, y: 0.29, z: 0, yaw: (seat ? 1 : -1) * Math.PI / 2 }),
  chess: (def, seat) => ({ x: (seat ? 1 : -1) * def.w * 0.38, y: 0.48, z: 0, yaw: (seat ? 1 : -1) * Math.PI / 2 }),
  'play-mat': () => ({ x: 0, y: 0.03, z: 0 }),
  sandbox: () => ({ x: 0, y: 0.2, z: 0 }),
  'swing-set': (def, seat) => ({ x: (seat ? 1 : -1) * def.w * 0.22, y: 0.52, z: 0 }),
  bathtub: () => ({ x: 0, y: 0.32, z: 0, yaw: -Math.PI / 2 }),
  clawfoot: () => ({ x: 0, y: 0.36, z: 0, yaw: -Math.PI / 2 }),
  lounger: () => ({ x: 0, y: 0.38, z: 0 }),
  adirondack: () => ({ x: 0, y: 0.4, z: 0 }),
  'hot-tub': ROUND4(0.55, 0.42),
  'fire-pit': ROUND4(0.75, 0.32),
  'patio-set': ROUND4(0.72, 0.48),
  pool: (def, seat) => ({ x: ((seat % 2) - 0.5) * def.w * 0.4, y: 0.02, z: (Math.floor(seat / 2) - 0.5) * def.d * 0.5 - 0.4 }),
}
