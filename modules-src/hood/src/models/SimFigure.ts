/** A neighbor's figure: simple rounded body parts on pivots so walking, sitting and lying read at a glance. */
import * as THREE from 'three/webgpu'
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, type Look } from '../../shared/Look'
import { material } from './Kit'

const limb = new THREE.CapsuleGeometry(1, 1, 4, 10)
const head = new THREE.SphereGeometry(1, 20, 16)
const cap = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)
limb.userData.shared = true
head.userData.shared = true
cap.userData.shared = true

function part(geometry: THREE.BufferGeometry, color: string, sx: number, sy: number, sz: number, roughness = 0.75): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material(color, { roughness }))
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export type FigureTool = 'hose' | 'clipboard' | 'trimmer' | 'bag' | 'wrench' | 'tray' | 'cone' | 'shovel' | 'none'

export interface SimFigure {
  root: THREE.Group
  body: THREE.Group
  setPose(pose: 'stand' | 'sit' | 'lie', walking: number, time: number, busy: boolean): void
  setSelected(on: boolean): void
  setTool(tool: FigureTool): void
}

/** Work clothes that replace the outfit colors: a uniform shirt and trousers, a hat and a safety vest. */
export interface Dress {
  top: string
  bottom: string
  hat?: 'cap' | 'helmet' | 'hard' | 'visor' | 'none'
  hatColor?: string
  vest?: string
}

function buildTool(tool: FigureTool): THREE.Group {
  const g = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, color: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0) => {
    const m = part(geo, color, sx, sy, sz, 0.6)
    m.position.set(x, y, z)
    m.rotation.x = rx
    g.add(m)
  }
  switch (tool) {
    case 'hose': add(limb, '#b8862e', 0.04, 0.22, 0.04, 0, -0.02, 0.22, Math.PI / 2); add(limb, '#c9ccd1', 0.03, 0.06, 0.03, 0, -0.02, 0.48, Math.PI / 2); break
    case 'clipboard': add(limb, '#8a6440', 0.11, 0.008, 0.08, 0, 0, 0.08, Math.PI / 2 - 0.4); add(limb, '#f4f2ea', 0.09, 0.009, 0.065, 0, 0.004, 0.085, Math.PI / 2 - 0.4); break
    case 'trimmer': add(limb, '#e2762e', 0.022, 0.5, 0.022, 0, -0.25, 0.25, 2.3); add(limb, '#3a3d42', 0.06, 0.03, 0.06, 0, -0.52, 0.56); break
    case 'bag': add(head, '#1c1d20', 0.13, 0.17, 0.11, 0, -0.18, 0); break
    case 'wrench': add(limb, '#9aa0a8', 0.018, 0.12, 0.018, 0, -0.08, 0.04); break
    case 'tray': add(limb, '#c88a3c', 0.14, 0.05, 0.1, 0, 0.02, 0.14); break
    case 'cone': add(limb, '#f07c1e', 0.06, 0.12, 0.06, 0, -0.14, 0.06); break
    case 'shovel': add(limb, '#8a6440', 0.02, 0.5, 0.02, 0, -0.25, 0.18, 2.6); add(limb, '#6b7076', 0.09, 0.02, 0.07, 0, -0.62, 0.42, 2.6); break
    case 'none': break
  }
  return g
}

export function createSimFigure(look: Look, dress?: Dress): SimFigure {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const skin = SKIN_TONES[look.skin]
  const hair = HAIR_COLORS[look.hair]
  const top = dress?.top ?? OUTFIT_COLORS[look.top]
  const bottom = dress?.bottom ?? OUTFIT_COLORS[look.bottom]
  const width = look.build === 'slim' ? 0.88 : look.build === 'broad' ? 1.16 : 1
  body.scale.setScalar(look.height)

  const hips = new THREE.Group()
  hips.position.y = 0.9
  body.add(hips)
  const legs: THREE.Group[] = []
  const knees: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.09 * width, 0, 0)
    const thigh = part(limb, bottom, 0.08 * width, 0.15, 0.08 * width)
    thigh.position.y = -0.2
    const knee = new THREE.Group()
    knee.position.y = -0.44
    const shin = part(limb, bottom, 0.068 * width, 0.15, 0.068 * width)
    shin.position.y = -0.2
    const shoe = part(limb, '#2a2624', 0.06, 0.05, 0.1)
    shoe.position.set(0, -0.42, 0.04)
    shoe.rotation.x = Math.PI / 2
    knee.add(shin, shoe)
    pivot.add(thigh, knee)
    hips.add(pivot)
    legs.push(pivot)
    knees.push(knee)
  }
  const torso = part(limb, top, 0.17 * width, 0.2, 0.12 * width)
  torso.position.y = 0.3
  hips.add(torso)
  const belt = part(limb, bottom, 0.165 * width, 0.03, 0.118 * width)
  belt.position.y = 0.06
  hips.add(belt)
  const arms: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.22 * width, 0.55, 0)
    const sleeve = part(limb, top, 0.055 * width, 0.12, 0.055 * width)
    sleeve.position.y = -0.1
    const arm = part(limb, skin, 0.045, 0.16, 0.045)
    arm.position.y = -0.36
    pivot.add(sleeve, arm)
    hips.add(pivot)
    arms.push(pivot)
  }
  const neck = part(limb, skin, 0.045, 0.04, 0.045)
  neck.position.y = 0.64
  hips.add(neck)
  const face = new THREE.Group()
  face.position.y = 0.8
  hips.add(face)
  face.add(part(head, skin, 0.12, 0.135, 0.12, 0.6))
  for (const side of [-1, 1]) {
    const eye = part(head, '#1d1a18', 0.016, 0.02, 0.01, 0.3)
    eye.position.set(side * 0.042, 0.015, 0.112)
    face.add(eye)
  }
  const hat = dress?.hat && dress.hat !== 'none' ? dress.hat : null
  if (hat) {
    const color = dress?.hatColor ?? '#2c2f33'
    if (hat === 'helmet' || hat === 'hard') {
      const dome = part(cap, color, 0.15, 0.13, 0.16, 0.4)
      dome.position.y = 0.03
      face.add(dome)
      const brim = part(limb, color, 0.17, 0.01, 0.19, 0.4)
      brim.position.set(0, 0.02, hat === 'helmet' ? -0.02 : 0)
      face.add(brim)
    } else {
      const crown = part(cap, color, 0.13, hat === 'visor' ? 0.04 : 0.1, 0.135, 0.7)
      crown.position.y = hat === 'visor' ? 0.06 : 0.04
      face.add(crown)
      const bill = part(limb, color, 0.08, 0.008, 0.08, 0.7)
      bill.position.set(0, 0.05, 0.13)
      face.add(bill)
    }
  }
  if (dress?.vest) {
    const vest = part(limb, dress.vest, 0.175 * width, 0.15, 0.125 * width, 0.5)
    vest.position.y = 0.34
    hips.add(vest)
  }
  if (look.hairStyle !== 'bald' && !(hat === 'helmet' || hat === 'hard')) {
    const crown = part(cap, hair, 0.128, 0.14, 0.13, 0.85)
    crown.position.y = 0.005
    crown.rotation.x = -0.25
    face.add(crown)
    if (look.hairStyle === 'long') {
      const back = part(limb, hair, 0.12, 0.12, 0.06, 0.85)
      back.position.set(0, -0.12, -0.06)
      face.add(back)
    } else if (look.hairStyle === 'bun') {
      const bun = part(head, hair, 0.06, 0.06, 0.06, 0.85)
      bun.position.set(0, 0.1, -0.1)
      face.add(bun)
    } else if (look.hairStyle === 'curly') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const curl = part(head, hair, 0.05, 0.05, 0.05, 0.9)
        curl.position.set(Math.cos(a) * 0.1, 0.07 + (i % 2) * 0.03, Math.sin(a) * 0.1 - 0.02)
        face.add(curl)
      }
    }
  }

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7cf2a8'), transparent: true, opacity: 0.85, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.visible = false
  ring.userData.ownMaterial = ring.material
  root.add(ring)

  const hand = new THREE.Group()
  hand.position.y = -0.52
  arms[1].add(hand)
  let toolName: FigureTool = 'none'

  return {
    root,
    body,
    setSelected(on) {
      ring.visible = on
    },
    setTool(tool) {
      if (tool === toolName) return
      toolName = tool
      hand.clear()
      if (tool !== 'none') hand.add(buildTool(tool))
    },
    setPose(pose, walking, time, busy) {
      const swing = Math.sin(time * 9) * 0.55 * walking
      hips.rotation.set(0, 0, 0)
      hips.position.set(0, 0.9, 0)
      body.rotation.set(0, 0, 0)
      body.position.set(0, 0, 0)
      knees[0].rotation.x = knees[1].rotation.x = 0
      if (pose === 'stand') {
        knees[0].rotation.x = Math.max(0, -swing) * 0.8
        knees[1].rotation.x = Math.max(0, swing) * 0.8
        legs[0].rotation.x = swing
        legs[1].rotation.x = -swing
        arms[0].rotation.x = -swing * 0.8
        arms[1].rotation.x = swing * 0.8
        const gesture = busy && !walking ? Math.sin(time * 4) * 0.25 : 0
        arms[0].rotation.z = 0.08
        arms[1].rotation.z = -0.08
        if (busy && !walking) {
          arms[0].rotation.x = -0.9 + gesture
          arms[1].rotation.x = -0.9 - gesture
        }
        hips.position.y = 0.9 + Math.abs(Math.sin(time * 9)) * 0.03 * walking
      } else if (pose === 'sit') {
        hips.position.y = 0.0
        hips.position.z = -0.12
        legs[0].rotation.x = legs[1].rotation.x = -Math.PI / 2
        knees[0].rotation.x = knees[1].rotation.x = Math.PI / 2
        arms[0].rotation.x = arms[1].rotation.x = -0.6
        arms[0].rotation.z = 0.12
        arms[1].rotation.z = -0.12
      } else {
        body.rotation.x = -Math.PI / 2
        body.position.set(0, 0.12, 0.85)
        legs[0].rotation.x = legs[1].rotation.x = 0
        arms[0].rotation.x = arms[1].rotation.x = 0.1
        arms[0].rotation.z = 0.1
        arms[1].rotation.z = -0.1
      }
    },
  }
}
