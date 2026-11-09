/** Procedural furniture: one original model per catalog item, centred on its footprint with its front facing -z. */
import * as THREE from 'three/webgpu'
import type { ObjectDef } from '../../shared/Catalog'
import { box, cylinder, material, sphere } from './Kit'
import { models } from './Models'
import { surface } from './Surfaces'
import { buildTree } from './Street'
import { GLOW, STEEL, cloth, legs, wood, type Builder, type SeatSpot } from './FurnitureKit'
import { moreBuilders, moreSeats } from './FurnitureMore'

const builders: Record<string, Builder> = {
  'bed-twin': (def, g, w, d) => {
    g.add(box(w * 0.92, 0.28, d * 0.96, wood(def.color), 0, 0.18, 0))
    g.add(box(w * 0.88, 0.16, d * 0.9, cloth('#f4f1ea'), 0, 0.4, 0, { roughness: 0.95 }))
    g.add(box(w * 0.9, 0.06, d * 0.62, cloth(def.accent), 0, 0.5, -d * 0.15, { roughness: 0.95 }))
    g.add(box(w * 0.6, 0.1, 0.32, '#ffffff', 0, 0.52, d * 0.36, { roughness: 1 }))
    g.add(box(w * 0.94, 0.85, 0.08, wood(def.color), 0, 0.42, d * 0.48))
  },
  'bed-double': (def, g, w, d) => {
    g.add(box(w * 0.94, 0.3, d * 0.96, wood(def.color), 0, 0.18, 0))
    g.add(box(w * 0.9, 0.18, d * 0.9, cloth('#f4f1ea'), 0, 0.42, 0, { roughness: 0.95 }))
    g.add(box(w * 0.92, 0.07, d * 0.6, cloth(def.accent), 0, 0.53, -d * 0.16, { roughness: 0.95 }))
    for (const sx of [-0.24, 0.24]) g.add(box(w * 0.36, 0.11, 0.34, '#ffffff', sx * w, 0.56, d * 0.35, { roughness: 1 }))
    g.add(box(w * 0.98, 1.05, 0.1, wood(def.color), 0, 0.52, d * 0.48))
  },
  fridge: (def, g, w, d) => {
    g.add(box(w * 0.86, 1.86, d * 0.8, def.color, 0, 0.93, d * 0.05, { roughness: 0.35, metalness: 0.2 }))
    g.add(box(w * 0.82, 0.015, 0.01, def.accent, 0, 1.25, -d * 0.36))
    for (const y of [0.85, 1.55]) g.add(box(0.03, 0.4, 0.04, def.accent, w * 0.3, y, -d * 0.38, { metalness: 0.7, roughness: 0.3 }))
  },
  stove: (def, g, w, d) => {
    g.add(box(w * 0.92, 0.88, d * 0.82, def.color, 0, 0.44, d * 0.04, { roughness: 0.4 }))
    g.add(box(w * 0.92, 0.03, d * 0.82, def.accent, 0, 0.895, d * 0.04, { roughness: 0.2 }))
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.15, 0.2]) g.add(cylinder(0.09, 0.02, '#4a4a4a', sx * w, 0.92, sz * d))
    g.add(box(w * 0.7, 0.4, 0.02, '#1b1b1d', 0, 0.42, -d * 0.37, { roughness: 0.15 }))
    g.add(box(w * 0.92, 0.12, 0.06, def.color, 0, 1.0, d * 0.42))
  },
  counter: (def, g, w, d) => {
    g.add(box(w * 0.98, 0.86, d * 0.8, def.color, 0, 0.43, d * 0.06))
    g.add(box(w, 0.05, d * 0.86, wood(def.accent), 0, 0.885, d * 0.04))
    g.add(box(0.12, 0.02, 0.02, STEEL, 0, 0.72, -d * 0.35, { metalness: 0.7 }))
  },
  'kitchen-sink': (def, g, w, d) => {
    g.add(box(w * 0.98, 0.86, d * 0.8, def.color, 0, 0.43, d * 0.06))
    g.add(box(w, 0.05, d * 0.86, '#d9d6cf', 0, 0.885, d * 0.04, { roughness: 0.3 }))
    g.add(box(w * 0.55, 0.06, d * 0.45, '#9aa3ab', 0, 0.89, 0, { metalness: 0.6, roughness: 0.25 }))
    g.add(cylinder(0.015, 0.28, STEEL, 0, 1.03, d * 0.3, { metalness: 0.8, roughness: 0.2 }))
    g.add(box(0.025, 0.025, 0.16, STEEL, 0, 1.16, d * 0.23, { metalness: 0.8, roughness: 0.2 }))
  },
  'dining-table': (def, g, w, d) => {
    g.add(box(w * 0.92, 0.05, d * 0.86, wood(def.color), 0, 0.74, 0))
    legs(g, w * 0.86, d * 0.78, 0.72, wood(def.accent))
    g.add(cylinder(0.06, 0.12, '#f2efe7', 0, 0.82, 0))
    g.add(sphere(0.06, '#4f8f45', 0, 0.92, 0))
  },
  'dining-chair': (def, g, w, d) => {
    g.add(box(w * 0.46, 0.05, d * 0.46, wood(def.color), 0, 0.46, 0))
    legs(g, w * 0.44, d * 0.44, 0.44, wood(def.color), 0.03, 0.035)
    for (const sx of [-0.18, -0.06, 0.06, 0.18]) g.add(box(0.025, 0.42, 0.025, wood(def.color), sx * w, 0.7, d * 0.2))
    g.add(box(w * 0.46, 0.05, 0.04, wood(def.color), 0, 0.92, d * 0.2))
    g.add(box(w * 0.4, 0.03, d * 0.38, cloth(def.accent), 0, 0.5, -d * 0.02, { roughness: 1 }))
  },
  sofa: (def, g, w, d) => {
    g.add(box(w * 0.96, 0.24, d * 0.8, cloth(def.color), 0, 0.2, 0.02))
    g.add(box(w * 0.96, 0.55, d * 0.22, cloth(def.color), 0, 0.58, d * 0.3))
    for (const sx of [-1, 1]) g.add(box(0.16, 0.5, d * 0.8, cloth(def.color), sx * (w * 0.48 - 0.08), 0.37, 0.02, { roughness: 0.95 }))
    for (const sx of [-0.22, 0.22]) g.add(box(w * 0.4, 0.13, d * 0.56, cloth(def.accent), sx * w, 0.385, -d * 0.06, { roughness: 1 }))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylinder(0.03, 0.08, '#3a2a1f', sx * (w * 0.45), 0.04, sz * d * 0.32))
  },
  armchair: (def, g, w, d) => {
    g.add(box(w * 0.8, 0.26, d * 0.78, cloth(def.color), 0, 0.22, 0))
    g.add(box(w * 0.8, 0.75, d * 0.18, cloth(def.color), 0, 0.62, d * 0.32))
    for (const sx of [-1, 1]) g.add(box(0.12, 0.45, d * 0.78, cloth(def.color), sx * w * 0.36, 0.44, 0, { roughness: 0.95 }))
    g.add(box(w * 0.58, 0.12, d * 0.55, cloth(def.accent), 0, 0.4, -d * 0.06))
  },
  tv: (def, g, w, d) => {
    g.add(box(w * 0.92, 0.45, d * 0.5, wood('#6b4630'), 0, 0.225, d * 0.1))
    g.add(box(w * 0.94, 0.56, 0.05, def.color, 0, 0.82, d * 0.15, { roughness: 0.3 }))
    g.add(box(w * 0.88, 0.5, 0.01, def.accent, 0, 0.82, d * 0.12, { roughness: 0.1, emissive: '#3a6fa8', emissiveIntensity: 0.6 }))
  },
  bookshelf: (def, g, w, d) => {
    g.add(box(w * 0.9, 1.86, d * 0.4, wood(def.color), 0, 0.93, d * 0.28))
    const colors = ['#c44e3f', '#3a6fa8', '#d8a23c', '#4f8a3f', '#7a5aa8', '#e8e1d3']
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 0.22 + shelf * 0.44
      g.add(box(w * 0.86, 0.02, d * 0.36, '#6b462a', 0, y - 0.02, d * 0.24))
      let x = -w * 0.38
      let i = shelf
      while (x < w * 0.36) {
        const bw = 0.04 + ((i * 7) % 4) * 0.012
        const bh = 0.26 + ((i * 5) % 3) * 0.04
        g.add(box(bw, bh, d * 0.28, colors[i % colors.length], x + bw / 2, y + bh / 2, d * 0.22, { roughness: 0.8 }))
        x += bw + 0.008
        i++
      }
    }
  },
  toilet: (def, g, w, d) => {
    g.add(box(w * 0.3, 0.4, d * 0.4, def.color, 0, 0.2, -d * 0.02, { roughness: 0.2 }))
    g.add(box(w * 0.4, 0.06, d * 0.5, def.color, 0, 0.42, -d * 0.04, { roughness: 0.2 }))
    g.add(box(w * 0.44, 0.38, d * 0.18, def.accent, 0, 0.62, d * 0.32, { roughness: 0.2 }))
  },
  shower: (def, g, w, d) => {
    g.add(box(w * 0.96, 0.08, d * 0.96, '#f7f7f5', 0, 0.04, 0, { roughness: 0.3 }))
    g.add(box(w * 0.96, 2.0, 0.02, def.accent, 0, 1.08, -d * 0.47, { opacity: 0.35, roughness: 0.05 }))
    g.add(box(0.02, 2.0, d * 0.96, def.accent, -w * 0.47, 1.08, 0, { opacity: 0.35, roughness: 0.05 }))
    g.add(cylinder(0.015, 1.9, STEEL, w * 0.36, 1.0, d * 0.4, { metalness: 0.8, roughness: 0.2 }))
    g.add(cylinder(0.09, 0.03, STEEL, w * 0.36, 1.95, d * 0.3, { metalness: 0.8, roughness: 0.2 }))
  },
  'bath-sink': (def, g, w, d) => {
    g.add(cylinder(0.08, 0.75, def.color, 0, 0.375, d * 0.12, { roughness: 0.2 }))
    g.add(box(w * 0.5, 0.12, d * 0.42, def.color, 0, 0.8, d * 0.08, { roughness: 0.2 }))
    g.add(cylinder(0.012, 0.16, STEEL, 0, 0.92, d * 0.24, { metalness: 0.8, roughness: 0.2 }))
    g.add(box(w * 0.42, 0.55, 0.02, '#cfe3ef', 0, 1.42, d * 0.46, { roughness: 0.05, metalness: 0.3 }))
  },
  computer: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.04, d * 0.6, wood(def.color), 0, 0.74, d * 0.18))
    legs(g, w * 0.9, d * 0.56, 0.72, wood(def.color), 0.03, 0.04)
    g.add(box(0.5, 0.32, 0.03, def.accent, 0, 1.0, d * 0.34, { roughness: 0.3 }))
    g.add(box(0.46, 0.27, 0.005, '#2c5d8a', 0, 1.0, d * 0.32, { emissive: '#4f86c4', emissiveIntensity: 0.7 }))
    g.add(box(0.06, 0.18, 0.05, def.accent, 0, 0.83, d * 0.36))
    g.add(box(0.36, 0.015, 0.12, '#45484e', 0, 0.77, d * 0.08))
    g.add(box(0.44, 0.05, 0.42, '#30343a', 0, 0.46, -d * 0.75))
    g.add(box(0.44, 0.45, 0.05, '#30343a', 0, 0.72, -d * 0.97))
    g.add(cylinder(0.025, 0.44, STEEL, 0, 0.22, -d * 0.75, { metalness: 0.7 }))
  },
  stereo: (def, g, w, d) => {
    g.add(box(w * 0.7, 0.4, d * 0.45, wood('#6b4630'), 0, 0.2, d * 0.15))
    g.add(box(w * 0.36, 0.16, d * 0.32, def.color, 0, 0.48, d * 0.15))
    for (const sx of [-1, 1]) {
      g.add(box(0.16, 0.3, 0.16, def.color, sx * w * 0.28, 0.55, d * 0.15))
      g.add(cylinder(0.05, 0.01, def.accent, sx * w * 0.28, 0.55, d * 0.06, { emissive: def.accent, emissiveIntensity: 0.2 }).rotateX(Math.PI / 2))
    }
  },
  lamp: (def, g) => {
    g.add(cylinder(0.14, 0.03, def.color, 0, 0.015, 0, { metalness: 0.5 }))
    g.add(cylinder(0.015, 1.5, def.color, 0, 0.77, 0, { metalness: 0.5 }))
    g.add(cylinder(0.2, 0.26, def.accent, 0, 1.55, 0, { ...GLOW, opacity: 0.92 }))
  },
  plant: (def, g) => {
    g.add(cylinder(0.17, 0.3, def.color, 0, 0.15, 0))
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      g.add(sphere(0.16, def.accent, Math.cos(a) * 0.12, 0.5 + (i % 2) * 0.12, Math.sin(a) * 0.12, { roughness: 0.9 }, 0.8))
    }
    g.add(sphere(0.18, '#5aa04a', 0, 0.7, 0, { roughness: 0.9 }))
  },
  rug: (def, g, w, d) => {
    g.add(box(w * 0.92, 0.015, d * 0.92, cloth(def.color), 0, 0.012, 0))
    g.add(box(w * 0.7, 0.016, d * 0.7, cloth(def.accent), 0, 0.014, 0))
    g.add(box(w * 0.48, 0.017, d * 0.48, cloth(def.color), 0, 0.016, 0))
  },
  grill: (def, g) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      g.add(box(0.03, 0.75, 0.03, '#3a3a3a', Math.cos(a) * 0.18, 0.37, Math.sin(a) * 0.18))
    }
    g.add(sphere(0.27, def.color, 0, 0.8, 0, { roughness: 0.4, metalness: 0.4 }, 0.75))
    g.add(sphere(0.27, def.accent, 0, 0.92, 0.04, { roughness: 0.4, metalness: 0.3 }, 0.5))
    g.add(box(0.12, 0.03, 0.03, STEEL, 0, 1.06, 0.04, { metalness: 0.8 }))
  },
  bench: (def, g, w, d) => {
    for (const sz of [-0.12, 0, 0.12]) g.add(box(w * 0.92, 0.04, 0.1, wood(def.color), 0, 0.46, sz * d - 0.02))
    for (const y of [0.62, 0.76]) g.add(box(w * 0.92, 0.1, 0.03, wood(def.color), 0, y, d * 0.16))
    for (const sx of [-1, 1]) {
      g.add(box(0.05, 0.45, d * 0.5, def.accent, sx * w * 0.42, 0.24, 0, { metalness: 0.6, roughness: 0.4 }))
      g.add(box(0.05, 0.4, 0.05, def.accent, sx * w * 0.42, 0.68, d * 0.18, { metalness: 0.6, roughness: 0.4 }))
    }
  },
  picnic: (def, g, w, d) => {
    g.add(box(w * 0.9, 0.05, d * 0.42, wood(def.color), 0, 0.76, 0))
    for (const sz of [-1, 1]) g.add(box(w * 0.9, 0.04, d * 0.16, wood(def.color), 0, 0.45, sz * d * 0.36))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, 0.82, 0.06, def.accent, sx * w * 0.36, 0.4, sz * d * 0.18).rotateX(sz * 0.5))
  },
  garden: (def, g, w, d) => {
    g.add(box(w * 0.94, 0.32, d * 0.8, wood(def.color), 0, 0.16, 0))
    g.add(box(w * 0.88, 0.04, d * 0.72, '#4a3424', 0, 0.32, 0, { roughness: 1 }))
    for (let i = 0; i < 8; i++) g.add(sphere(0.09 + (i % 3) * 0.02, i % 3 === 0 ? '#d8a23c' : def.accent, (-0.42 + i * 0.12) * w, 0.42, ((i % 2) - 0.5) * d * 0.3, { roughness: 0.9 }))
  },
  hoop: (def, g, _w, d) => {
    g.add(cylinder(0.05, 3.0, '#4a4f55', 0, 1.5, d * 0.35, { metalness: 0.6 }))
    g.add(box(0.9, 0.6, 0.04, def.color, 0, 3.1, d * 0.25, { roughness: 0.4 }))
    g.add(box(0.36, 0.26, 0.045, def.accent, 0, 3.02, d * 0.245))
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.015, 8, 24), new THREE.MeshStandardMaterial({ color: def.accent }))
    rim.rotation.x = Math.PI / 2
    rim.position.set(0, 2.9, d * 0.02)
    g.userData.ownMaterial = rim.material
    g.add(rim)
    g.add(sphere(0.12, '#e8682c', 0.3, 0.12, -0.25))
  },
  tree: (_def, g) => {
    g.add(buildTree(5, 0.85))
  },
  flowers: (def, g, w, d) => {
    g.add(box(w * 0.86, 0.12, d * 0.86, '#5a3d27', 0, 0.06, 0, { roughness: 1 }))
    const colors = [def.accent, '#f2d24b', '#ffffff', '#c44e3f']
    for (let i = 0; i < 9; i++) g.add(sphere(0.07, colors[i % 4], ((i % 3) - 1) * 0.25, 0.2 + (i % 2) * 0.05, (Math.floor(i / 3) - 1) * 0.25, { roughness: 0.9 }))
  },
}

const BOOKS = ['#c44e3f', '#3a6fa8', '#d8a23c', '#4f8a3f', '#7a5aa8', '#e8e1d3']
const leaves = (c: string) => surface('leaves', 'tri', { size: 0.7, color: c, roughness: 0.9, side: THREE.DoubleSide })

/** The finish for one of the Blender model's material slots (see tools/build-furniture.py), in this item's colours. */
export function slotMaterial(slot: string, color: string, accent: string): THREE.Material {
  const book = /^book_(\d)$/.exec(slot)
  if (book) return material(BOOKS[Number(book[1]) % BOOKS.length], { roughness: 0.8 })
  switch (slot) {
    case 'wood_color': return wood(color)
    case 'wood_accent': return wood(accent)
    case 'wood_dark': return wood('#3a2a1f')
    case 'wood_walnut': return wood('#6b4630')
    case 'cloth_color': return cloth(color)
    case 'cloth_accent': return cloth(accent)
    case 'linen': return cloth('#f4f1ea')
    case 'pillow': return cloth('#fbfaf7')
    case 'paint_color': return material(color, { roughness: 0.6 })
    case 'paint_accent': return material(accent, { roughness: 0.6 })
    case 'gloss_color': return material(color, { roughness: 0.22 })
    case 'gloss_accent': return material(accent, { roughness: 0.22 })
    case 'metal_color': return material(color, { roughness: 0.38, metalness: 0.8 })
    case 'metal_accent': return material(accent, { roughness: 0.36, metalness: 0.8 })
    case 'leaf_accent': return leaves(accent)
    case 'leaf': return leaves('#4f8a3f')
    case 'bark': return surface('bark', 'tri', { size: 0.8, color: '#8a6a4c', roughness: 1 })
    case 'stone': return surface('stone', 'tri', { size: 0.6, color: '#d6d2c8', roughness: 0.85 })
    case 'soil': return material('#3e2a1c', { roughness: 1 })
    case 'mulch': return material('#5a3d27', { roughness: 1 })
    case 'steel': return material(STEEL, { metalness: 0.8, roughness: 0.3 })
    case 'chrome': return material('#e4e7ea', { metalness: 0.95, roughness: 0.12 })
    case 'blackmetal': return material('#202124', { metalness: 0.6, roughness: 0.45 })
    case 'glass': return material('#d8ecf5', { opacity: 0.28, roughness: 0.05 })
    case 'mirror': return material('#dfe9ee', { metalness: 0.9, roughness: 0.04 })
    case 'screen': return material('#0b0f16', { roughness: 0.12, emissive: '#4f86c4', emissiveIntensity: 0.45 })
    case 'display': return material('#7fd9f0', { emissive: '#7fd9f0', emissiveIntensity: 1.2 })
    case 'glow_accent': return material(accent, GLOW)
    case 'porcelain': return material('#f7f7f5', { roughness: 0.15 })
    case 'cooktop': return material('#111214', { roughness: 0.08 })
    case 'oven_glass': return material('#141518', { roughness: 0.05 })
    case 'keys': return material('#2b2d32', { roughness: 0.7 })
    case 'charcoal': return material('#2a2a2c', { roughness: 0.85 })
    case 'rubber': return material('#151515', { roughness: 0.9 })
    case 'tomato': return material('#c8321f', { roughness: 0.35 })
    case 'ball': return material('#e8682c', { roughness: 0.7 })
    case 'net': return material('#f4f4f4', { roughness: 0.9 })
    case 'paper': return material('#ede5d1', { roughness: 0.9 })
    case 'flower_yellow': return material('#f2d24b', { roughness: 0.7 })
    case 'flower_white': return material('#fbf8f2', { roughness: 0.7 })
    case 'flower_red': return material('#c44e3f', { roughness: 0.7 })
    default: return material(color)
  }
}

/** A clone of a Blender-built template with its slots filled in; geometry is shared with the template. */
export function dressModel(template: THREE.Object3D, color: string, accent: string, shadows = true): THREE.Group {
  const g = new THREE.Group()
  for (const child of template.children) {
    const copy = child.clone(true)
    copy.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const slot = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name
      mesh.material = slotMaterial(slot, color, accent)
      mesh.castShadow = shadows
      mesh.receiveShadow = true
    })
    g.add(copy)
  }
  return g
}

export function buildFurniture(def: ObjectDef): THREE.Group {
  const template = models.furniture?.getObjectByName(def.id)
  if (template) {
    const g = dressModel(template, def.color, def.accent, !def.flat)
    g.name = def.id
    return g
  }
  const g = new THREE.Group()
  g.name = def.id
  const builder = builders[def.id] ?? moreBuilders[def.id]
  if (builder) builder(def, g, def.w, def.d)
  else g.add(box(def.w * 0.9, def.height, def.d * 0.9, def.color))
  return g
}

/** Seats in front of the object (the desk chair) face into it; every other seat faces out from its front. */
/** Seats behind a desk or instrument, where the Sim sits facing the object rather than away from it. */
const FACES_OBJECT = new Set(['computer', 'gaming-pc', 'desk', 'piano', 'drums'])

export function seatFacesObject(def: ObjectDef): boolean {
  return FACES_OBJECT.has(def.id)
}

/** Where a seated or lying Sim goes on an object, in the object's own unrotated frame. */
export function seatOffset(def: ObjectDef, seat: number, lie: boolean): SeatSpot {
  const seats = def.seats ?? 1
  const rule = moreSeats[def.id]
  if (rule) return rule(def, seat, lie)
  if (def.id === 'computer') return { x: 0, y: 0.48, z: -def.d * 0.75 }
  if (def.id === 'picnic') {
    const side = seat < 2 ? -1 : 1
    return { x: ((seat % 2) - 0.5) * def.w * 0.45, y: 0.47, z: side * def.d * 0.36 }
  }
  const along = ((seat + 0.5) / seats - 0.5) * def.w
  if (lie) return { x: along, y: def.category === 'beds' ? 0.58 : 0.44, z: def.category === 'beds' ? -0.1 : 0 }
  const height = def.id === 'toilet' ? 0.44 : def.id === 'sofa' ? 0.42 : def.id === 'armchair' ? 0.45 : 0.48
  return { x: along, y: height, z: -0.02 }
}
