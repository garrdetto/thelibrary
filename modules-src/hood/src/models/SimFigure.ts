/**
 * A neighbor's figure. Normally the skinned resident built in Blender (tools/build-sim.py): one body with Feminine,
 * Slim and Broad morph targets, four hair meshes and material slots recoloured from the Sim's Look, posed every frame
 * by rotating its bones from the same joint angles the older figure used. When that model isn't loaded, the older
 * figure of rounded body parts on pivots is built instead (`createSimpleFigure`).
 */
import * as THREE from 'three/webgpu'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, type Look } from '../../shared/Look'
import { material } from './Kit'
import { models } from './Models'

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
  return models.sim ? createModelFigure(look, models.sim) : createSimpleFigure(look)
}

function selectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7cf2a8'), transparent: true, opacity: 0.85, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.visible = false
  ring.userData.ownMaterial = ring.material
  return ring
}

// ------------------------------------------------------------------ the Blender resident

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R'] as const
type BoneName = (typeof BONES)[number]

/** Each bone's rest rotation in the model's frame, and its parent's, so a rotation given in the body's own frame can be turned into the bone's local one. */
interface Rest {
  world: Record<string, THREE.Quaternion>
  parent: Record<string, THREE.Quaternion>
  local: Record<string, THREE.Quaternion>
  position: Record<string, THREE.Vector3>
  parentInverse: Record<string, THREE.Matrix3>
}

const rests = new WeakMap<THREE.Object3D, Rest>()

function restOf(template: THREE.Object3D): Rest {
  let rest = rests.get(template)
  if (rest) return rest
  template.updateMatrixWorld(true)
  const inv = template.matrixWorld.clone().invert()
  const quat = (node: THREE.Object3D) => {
    const q = new THREE.Quaternion()
    new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld).decompose(new THREE.Vector3(), q, new THREE.Vector3())
    return q
  }
  rest = { world: {}, parent: {}, local: {}, position: {}, parentInverse: {} }
  for (const name of BONES) {
    const bone = template.getObjectByName(name)
    if (!bone || !bone.parent) continue
    rest.world[name] = quat(bone)
    rest.parent[name] = quat(bone.parent)
    rest.local[name] = bone.quaternion.clone()
    rest.position[name] = bone.position.clone()
    rest.parentInverse[name] = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rest.parent[name].clone().invert()))
  }
  rests.set(template, rest)
  return rest
}

const looks = new Map<string, THREE.Material>()

function cached(key: string, make: () => THREE.Material): THREE.Material {
  let m = looks.get(key)
  if (!m) {
    m = make()
    looks.set(key, m)
  }
  return m
}

const IRIS = ['#5a3a22', '#7a5a2e', '#4d6f8c', '#5d7346']
const SHOES = [{ upper: '#ece9e2', sole: '#f6f4ef' }, { upper: '#2a2624', sole: '#e9e5dc' }, { upper: '#6b4a33', sole: '#3a2a1f' }]

function slotFor(slot: string, look: Look): THREE.Material {
  const skin = SKIN_TONES[look.skin]
  const hair = HAIR_COLORS[look.hair]
  const top = OUTFIT_COLORS[look.top]
  const bottom = OUTFIT_COLORS[look.bottom]
  const shoes = SHOES[(look.top + look.bottom * 2) % SHOES.length]
  switch (slot) {
    case 'Skin':
      return cached(`skin|${skin}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(skin), roughness: 0.55, side: THREE.DoubleSide }))
    case 'Lips':
      return cached(`lips|${skin}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(skin).lerp(new THREE.Color('#a14a44'), 0.38), roughness: 0.38 }))
    case 'Top':
      return cached(`top|${top}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(top), roughness: 0.9 }))
    case 'Bottom':
      return cached(`bottom|${bottom}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(bottom), roughness: 0.82 }))
    case 'Belt':
      return material('#2b1d14', { roughness: 0.45 })
    case 'Buckle':
      return material('#c9c3b5', { roughness: 0.28, metalness: 0.9 })
    case 'Shoes':
      return material(shoes.upper, { roughness: 0.6 })
    case 'Sole':
      return material(shoes.sole, { roughness: 0.85 })
    case 'Eye':
      return material('#f1ede6', { roughness: 0.12 })
    case 'Iris':
      return material(look.skin >= 4 ? IRIS[0] : IRIS[(look.hair + look.skin) % IRIS.length], { roughness: 0.15 })
    case 'Pupil':
      return material('#050505', { roughness: 0.1 })
    case 'Brows':
      return material(new THREE.Color(hair).multiplyScalar(0.8).getStyle(), { roughness: 0.9 })
    case 'Hair':
      return cached(`hair|${hair}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(hair), roughness: 0.48, side: THREE.DoubleSide }))
    default:
      return material(skin)
  }
}

const HAIR_MESH: Record<string, string> = { short: 'Hair_short', long: 'Hair_long', bun: 'Hair_bun', curly: 'Hair_curly' }

function createModelFigure(look: Look, template: THREE.Object3D): SimFigure {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  body.scale.setScalar(look.height)
  const rest = restOf(template)
  const model = cloneSkinned(template)
  body.add(model)
  const wanted = HAIR_MESH[look.hairStyle]
  model.traverse(node => {
    const mesh = node as THREE.SkinnedMesh
    if (!mesh.isMesh) return
    if (mesh.name.startsWith('Hair_')) mesh.visible = mesh.name === wanted
    mesh.material = slotFor((mesh.material as THREE.Material).name, look)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const dict = mesh.morphTargetDictionary
    if (dict && mesh.morphTargetInfluences) {
      const set = (name: string, value: number) => { if (dict[name] !== undefined) mesh.morphTargetInfluences![dict[name]] = value }
      set('Feminine', look.body === 'feminine' ? 1 : 0)
      set('Slim', look.build === 'slim' ? 1 : 0)
      set('Broad', look.build === 'broad' ? 1 : 0)
    }
  })
  const bones = {} as Record<BoneName, THREE.Object3D>
  for (const name of BONES) {
    const bone = model.getObjectByName(name)
    if (bone) bones[name] = bone
  }
  const ring = selectionRing()
  root.add(ring)

  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v = new THREE.Vector3()
  /** Rotates a bone by (x, y, z) radians in the body's own frame (x right... +z forward), about its joint. */
  const turn = (name: BoneName, x: number, y = 0, z = 0) => {
    const bone = bones[name]
    if (!bone || !rest.world[name]) return
    q.setFromEuler(e.set(x, y, z))
    bone.quaternion.copy(rest.parent[name]).invert().multiply(q).multiply(rest.world[name])
  }
  const reset = () => {
    for (const name of BONES) if (bones[name] && rest.local[name]) bones[name].quaternion.copy(rest.local[name])
    if (bones.hips && rest.position.hips) bones.hips.position.copy(rest.position.hips)
  }
  /** Moves the hips by an offset in the body's frame (the old figure's hips sat at 0.9 m). */
  const shiftHips = (x: number, y: number, z: number) => {
    if (!bones.hips || !rest.position.hips) return
    v.set(x, y, z).applyMatrix3(rest.parentInverse.hips)
    bones.hips.position.copy(rest.position.hips).add(v)
  }
  const side = { L: 1, R: -1 } as const

  return {
    root,
    body,
    setSelected(on) {
      ring.visible = on
    },
    setPose(pose, walking, time, busy) {
      reset()
      body.rotation.set(0, 0, 0)
      body.position.set(0, 0, 0)
      const phase = time * 9
      const swing = Math.sin(phase) * 0.5 * walking
      const breathe = Math.sin(time * 1.7) * 0.012
      if (pose === 'stand') {
        const bob = Math.abs(Math.sin(phase)) * 0.025 * walking
        shiftHips(0, bob - 0.012 * walking, 0)
        turn('hips', 0.04 * walking, Math.sin(phase) * 0.08 * walking, 0)
        turn('spine', -0.03 * walking + breathe, -Math.sin(phase) * 0.06 * walking, 0)
        turn('chest', breathe, -Math.sin(phase) * 0.05 * walking, 0)
        turn('head', -0.04 * walking, Math.sin(time * 0.37) * 0.12 * (1 - walking), 0)
        for (const s of ['L', 'R'] as const) {
          const k = s === 'L' ? 1 : -1
          const leg = swing * k
          turn(`thigh_${s}`, -leg)
          turn(`shin_${s}`, Math.max(0, leg) * 0.9 + walking * 0.08)
          turn(`foot_${s}`, -Math.max(0, -leg) * 0.35)
          const gesture = busy && !walking ? Math.sin(time * 4 + k) * 0.22 : 0
          if (busy && !walking) {
            turn(`upperarm_${s}`, -0.55 + gesture, 0, side[s] * -0.12)
            turn(`forearm_${s}`, -1.1 - gesture * 0.6, 0, side[s] * -0.12)
          } else {
            turn(`upperarm_${s}`, leg * 0.75, 0, side[s] * -0.04)
            turn(`forearm_${s}`, -0.18 - Math.max(0, leg) * 0.5 - 0.15 * walking)
          }
        }
      } else if (pose === 'sit') {
        shiftHips(0, -0.9, -0.12)
        turn('spine', -0.06 + breathe)
        turn('chest', -0.04)
        turn('head', 0.06, Math.sin(time * 0.31) * 0.15, 0)
        for (const s of ['L', 'R'] as const) {
          turn(`thigh_${s}`, -Math.PI / 2, 0, side[s] * 0.06)
          turn(`shin_${s}`, Math.PI / 2 - 0.08)
          turn(`foot_${s}`, 0.05)
          turn(`upperarm_${s}`, -0.35, 0, side[s] * 0.02)
          turn(`forearm_${s}`, -0.95)
          turn(`hand_${s}`, 0.2)
        }
      } else {
        body.rotation.x = -Math.PI / 2
        body.position.set(0, 0.12, 0.85)
        turn('head', 0.1)
        for (const s of ['L', 'R'] as const) {
          turn(`thigh_${s}`, 0, 0, side[s] * 0.04)
          turn(`shin_${s}`, 0.06)
          turn(`upperarm_${s}`, 0.05, 0, side[s] * 0.05)
          turn(`forearm_${s}`, -0.25)
        }
      }
    },
  }
}

// ------------------------------------------------------------------ the simple fallback figure

function createSimpleFigure(look: Look): SimFigure {
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

  const ring = selectionRing()
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
