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

export interface SimFigure {
  root: THREE.Group
  body: THREE.Group
  setPose(pose: 'stand' | 'sit' | 'lie', walking: number, time: number, busy: boolean): void
  setSelected(on: boolean): void
}

export function createSimFigure(look: Look): SimFigure {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const skin = SKIN_TONES[look.skin]
  const hair = HAIR_COLORS[look.hair]
  const top = OUTFIT_COLORS[look.top]
  const bottom = OUTFIT_COLORS[look.bottom]
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
  if (look.hairStyle !== 'bald') {
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

  return {
    root,
    body,
    setSelected(on) {
      ring.visible = on
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
