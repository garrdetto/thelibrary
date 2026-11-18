import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MeshoptDecoder } from 'meshoptimizer'
import { SWING_LEAD } from './timing'

export type ClubModel = 'driver' | 'wood' | 'iron'

type GolfAssets = { body: THREE.Group; clubs: Record<ClubModel, THREE.Group> }

const GOLFER_HEIGHT = 2
const CLUB_LENGTH: Record<ClubModel, number> = { driver: 45.5 / 36, wood: 43 / 36, iron: 37 / 36 }
const HEAD_SIZE: Record<ClubModel, number> = { driver: 0.135, wood: 0.11, iron: 0.085 }

let loading: Promise<GolfAssets> | null = null

/** Loads the Meshy golfer (rigged) and the three club heads once per page. */
export function loadGolfAssets() {
  if (!loading) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const load = (name: string) => loader.loadAsync(`/models/gspro/${name}.glb`).then(gltf => gltf.scene)
    loading = Promise.all([load('golfer'), load('club-driver'), load('club-wood'), load('club-iron')])
      .then(([body, driver, wood, iron]) => ({ body, clubs: { driver, wood, iron } }))
    loading.catch(() => { loading = null })
  }
  return loading
}

/** Which club model a shot is replayed with: the driver, the 3 wood for both woods, the 8 iron for every iron and wedge. */
export function clubModelFor(code: string | null): ClubModel {
  if (code === 'DR') return 'driver'
  if (code && /W$/.test(code)) return 'wood'
  return 'iron'
}

const ease = (value: number) => value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const UP = new THREE.Vector3(0, 1, 0)
const TARGET = new THREE.Vector3(0, 0, -1)
const KNEE_FLEX = 0.5
const ANKLE_AHEAD = 0.05
const STANCE_WIDEN = 0.03

const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchQ = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()
const worldQ = new THREE.Quaternion()

function worldPosition(object: THREE.Object3D, out = new THREE.Vector3()) {
  return object.getWorldPosition(out)
}

/** Turns a bone by a rotation given in world space, about its own head. */
function rotateWorld(bone: THREE.Object3D, rotation: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(parentQ)
  bone.getWorldQuaternion(worldQ)
  const next = scratchQ.copy(rotation).multiply(worldQ)
  bone.quaternion.copy(parentQ.invert().multiply(next))
  bone.updateMatrixWorld(true)
}

function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  const head = worldPosition(bone, scratchA)
  const from = worldPosition(child, scratchB).sub(head).normalize()
  const to = target.clone().sub(head).normalize()
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return
  rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(from, to))
}

/** Two-bone IK: places the wrist at `target` with the elbow bent toward `pole`. */
function reach(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const shoulder = worldPosition(upper)
  const elbow = worldPosition(lower)
  const wrist = worldPosition(hand)
  const upperLength = shoulder.distanceTo(elbow)
  const lowerLength = elbow.distanceTo(wrist)
  const toTarget = target.clone().sub(shoulder)
  const distance = Math.min(Math.max(toTarget.length(), Math.abs(upperLength - lowerLength) + 1e-3), upperLength + lowerLength - 1e-3)
  const direction = toTarget.normalize()
  const cos = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance)
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
  const bend = pole.clone().sub(direction.clone().multiplyScalar(pole.dot(direction)))
  if (bend.lengthSq() < 1e-6) bend.copy(UP)
  bend.normalize()
  const elbowTarget = shoulder.clone().addScaledVector(direction, Math.cos(angle) * upperLength).addScaledVector(bend, Math.sin(angle) * upperLength)
  aimBone(upper, lower, elbowTarget)
  aimBone(lower, hand, shoulder.clone().addScaledVector(direction, distance))
}

function bonesOf(root: THREE.Object3D) {
  const bones = new Map<string, THREE.Bone>()
  root.traverse(object => { if (object instanceof THREE.Bone) bones.set(object.name, object) })
  return bones
}

/**
 * The Meshy golfer, posed every frame on its own skeleton: knees flexed and bent at the waist over the ball, the chest
 * turning about the tilted spine, and both arms solved onto the grip of the Meshy club, which swings about the swing
 * plane (impact at clock 0) with the wrists hinging on the way back and releasing through the ball.
 */
export function createRiggedGolfer(assets: GolfAssets, handed: 'RH' | 'LH', clubKind: ClubModel) {
  const outer = new THREE.Group()
  const root = cloneSkinned(assets.body) as THREE.Group
  const skinned: THREE.SkinnedMesh[] = []
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) { skinned.push(object); object.castShadow = true; object.frustumCulled = false }
    else if (object instanceof THREE.Mesh) object.visible = false
  })
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const mesh of skinned) box.expandByObject(mesh, true)
  const measured = box.max.y - box.min.y
  const scale = GOLFER_HEIGHT / (measured > 1.2 && measured < 2.5 ? measured : 1.83)
  root.scale.setScalar(scale)
  root.rotation.y = Math.PI / 2
  outer.add(root)

  const club = new THREE.Group()
  const length = CLUB_LENGTH[clubKind]
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: clubKind === 'iron' ? 0xc4c9d0 : 0x22252b, metalness: clubKind === 'iron' ? 0.85 : 0.3, roughness: 0.35 })
  const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0055, length * 0.97, 10), shaftMaterial)
  shaft.position.y = -length * 0.485
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.011, 0.28, 12), gripMaterial)
  grip.position.y = -0.14
  shaft.castShadow = grip.castShadow = true
  club.add(shaft, grip)
  const head = assets.clubs[clubKind].clone(true)
  const headBox = new THREE.Box3().setFromObject(head)
  const headSize = headBox.getSize(new THREE.Vector3())
  const headScale = HEAD_SIZE[clubKind] / Math.max(1e-3, headSize.x, headSize.y, headSize.z)
  head.scale.setScalar(headScale)
  const headCentre = headBox.getCenter(new THREE.Vector3()).multiplyScalar(headScale)
  head.position.set(-headCentre.x + HEAD_SIZE[clubKind] * 0.35, -length - headCentre.y + HEAD_SIZE[clubKind] * 0.2, -headCentre.z)
  head.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true })
  club.add(head)
  outer.add(club)

  if (handed === 'LH') outer.scale.x = -1

  const bones = bonesOf(root)
  const bone = (name: string) => bones.get(name) ?? null
  const hips = bone('Hips'), spineLow = bone('Spine02'), spineMid = bone('Spine01'), chest = bone('Spine'), neck = bone('neck'), headBone = bone('Head')
  const leftArm = bone('LeftArm'), leftForeArm = bone('LeftForeArm'), leftHand = bone('LeftHand')
  const rightArm = bone('RightArm'), rightForeArm = bone('RightForeArm'), rightHand = bone('RightHand')
  const legs = (['Left', 'Right'] as const).map(side => ({ up: bone(`${side}UpLeg`), low: bone(`${side}Leg`), foot: bone(`${side}Foot`), toe: bone(`${side}ToeBase`) }))
  const rest = [...bones.values()].map(item => ({ bone: item, quaternion: item.quaternion.clone(), position: item.position.clone() }))
  const ready = Boolean(hips && spineLow && chest && leftArm && leftForeArm && leftHand && rightArm && rightForeArm && rightHand)
  const legsReady = legs.every(leg => leg.up && leg.low && leg.foot && leg.toe)

  const handedScale = outer.scale.x
  outer.scale.x = 1
  outer.updateMatrixWorld(true)
  const restFeet = legs.map(leg => legsReady
    ? { ankle: worldPosition(leg.foot!), flat: leg.foot!.getWorldQuaternion(new THREE.Quaternion()), thigh: worldPosition(leg.up!).distanceTo(worldPosition(leg.low!)), shin: worldPosition(leg.low!).distanceTo(worldPosition(leg.foot!)) }
    : null)
  outer.scale.x = handedScale
  outer.updateMatrixWorld(true)
  const plants = legs.map(() => new THREE.Vector3())

  const ball = new THREE.Vector3(0, 0.025, 0)
  let amplitude = 1
  const rotation = new THREE.Quaternion()

  /** Puts both feet flat on their planted spots with the knees flexed forward over them. */
  function plantLegs() {
    if (!legsReady) return
    for (const [index, leg] of legs.entries()) {
      const pole = new THREE.Vector3(1, 0, (index === 0 ? -1 : 1) * 0.15)
      reach(leg.up!, leg.low!, leg.foot!, plants[index], pole)
      leg.foot!.parent!.getWorldQuaternion(parentQ)
      leg.foot!.quaternion.copy(parentQ.invert().multiply(restFeet[index]!.flat))
      leg.foot!.updateMatrixWorld(true)
    }
    outer.updateMatrixWorld(true)
  }

  function address() {
    for (const item of rest) { item.bone.quaternion.copy(item.quaternion); item.bone.position.copy(item.position) }
    root.position.set(0, 0, 0)
    outer.updateMatrixWorld(true)
    const bendAxis = new THREE.Vector3(0, 0, 1)
    if (spineLow) rotateWorld(spineLow, rotation.setFromAxisAngle(bendAxis, -0.52))
    if (spineMid) rotateWorld(spineMid, rotation.setFromAxisAngle(bendAxis, -0.1))
    if (neck) rotateWorld(neck, rotation.setFromAxisAngle(bendAxis, 0.42))
    outer.updateMatrixWorld(true)
    const shoulders = worldPosition(leftArm!).add(worldPosition(rightArm!)).multiplyScalar(0.5)
    root.position.set(-0.6 - shoulders.x, 0, (clubKind === 'iron' ? 0.03 : 0.12) - shoulders.z)
    outer.updateMatrixWorld(true)
    if (!legsReady) return
    let drop = 0
    for (const [index, leg] of legs.entries()) {
      const feet = restFeet[index]!
      const hip = worldPosition(leg.up!)
      const ankle = plants[index].set(hip.x + ANKLE_AHEAD, feet.ankle.y, feet.ankle.z + root.position.z + (index === 0 ? -1 : 1) * STANCE_WIDEN)
      const span = Math.sqrt(feet.thigh ** 2 + feet.shin ** 2 + 2 * feet.thigh * feet.shin * Math.cos(KNEE_FLEX))
      const across = Math.hypot(ankle.x - hip.x, ankle.z - hip.z)
      drop += (ankle.y + Math.sqrt(Math.max(0, span ** 2 - across ** 2)) - hip.y) / legs.length
    }
    root.position.y = drop
    outer.updateMatrixWorld(true)
    plantLegs()
  }

  function pose(clock: number) {
    if (!ready) return
    const mirrored = outer.scale.x
    outer.scale.x = 1
    address()
    const start = -SWING_LEAD
    const top = -0.25
    let angle: number
    let turn: number
    let hipTurn: number
    let hinge: number
    if (clock <= start + 0.3) { angle = 0; turn = 0; hipTurn = 0; hinge = 0 }
    else if (clock <= top) {
      const share = ease(clamp01((clock - start - 0.3) / (top - start - 0.3)))
      angle = -1.75 * share
      turn = -1.5 * share
      hipTurn = -0.7 * share
      hinge = -1.35 * clamp01(share * 1.4 - 0.25)
    } else if (clock <= 0) {
      const progress = clamp01((clock - top) / -top)
      const share = progress ** 2.2
      angle = -1.75 * (1 - share)
      turn = -1.5 + 1.75 * share
      hipTurn = -0.7 + 1.25 * progress ** 1.3
      hinge = -1.35 * (1 - clamp01((share - 0.45) / 0.55) ** 1.5)
    } else {
      const share = 1 - (1 - clamp01(clock / 0.5)) ** 3
      angle = 2.1 * share
      turn = 0.25 + 1.45 * share
      hipTurn = 0.55 + 0.85 * share
      hinge = 1.25 * clamp01(share * 1.6 - 0.2)
    }
    angle *= amplitude
    turn *= amplitude
    hipTurn *= amplitude
    hinge *= amplitude

    if (hips) rotateWorld(hips, rotation.setFromAxisAngle(UP, hipTurn))
    outer.updateMatrixWorld(true)
    const spineAxis = chest ? worldPosition(chest).sub(worldPosition(spineLow!)).normalize() : UP.clone()
    const twist = turn - hipTurn
    if (spineLow) rotateWorld(spineLow, new THREE.Quaternion().setFromAxisAngle(spineAxis, twist * 0.3))
    if (spineMid) rotateWorld(spineMid, new THREE.Quaternion().setFromAxisAngle(spineAxis, twist * 0.4))
    if (chest) rotateWorld(chest, new THREE.Quaternion().setFromAxisAngle(spineAxis, twist * 0.3))
    if (neck && headBone) rotateWorld(neck, new THREE.Quaternion().setFromAxisAngle(spineAxis, -turn * 0.85 * (clock < 0.15 ? 1 : 0.4)))
    outer.updateMatrixWorld(true)
    plantLegs()

    const left = worldPosition(leftArm!)
    const right = worldPosition(rightArm!)
    const shoulders = left.clone().add(right).multiplyScalar(0.5)
    const down = ball.clone().sub(shoulders).normalize()
    const axis = down.clone().cross(TARGET).normalize()
    const armLength = worldPosition(leftArm!).distanceTo(worldPosition(leftForeArm!)) + worldPosition(leftForeArm!).distanceTo(worldPosition(leftHand!))
    const handsAtAddress = shoulders.clone().addScaledVector(down, armLength * 0.86).add(new THREE.Vector3(0, 0, -0.06))
    const swing = new THREE.Quaternion().setFromAxisAngle(axis, angle)
    const hands = handsAtAddress.clone().sub(shoulders).applyQuaternion(swing).add(shoulders)
    const toBall = ball.clone().add(new THREE.Vector3(0, 0, 0.04)).sub(handsAtAddress).normalize()
    const hingeAxis = axis.clone()
    const shaftDirection = toBall.applyQuaternion(swing).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(hingeAxis.applyQuaternion(swing), hinge))
    const gripTop = hands.clone().addScaledVector(shaftDirection, -0.07)
    club.position.copy(gripTop)
    club.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), shaftDirection)
    const toeAt = new THREE.Vector3(1, 0, 0).applyQuaternion(club.quaternion)
    const wantToe = TARGET.clone().negate().applyQuaternion(swing)
    wantToe.sub(shaftDirection.clone().multiplyScalar(wantToe.dot(shaftDirection))).normalize()
    if (wantToe.lengthSq() > 0.5) {
      const twist = Math.atan2(toeAt.clone().cross(wantToe).dot(shaftDirection), toeAt.dot(wantToe))
      club.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(shaftDirection, twist))
    }

    const elbowsOut = new THREE.Vector3(0, -0.6, 0).add(axis.clone().multiplyScalar(-0.2))
    reach(leftArm!, leftForeArm!, leftHand!, gripTop.clone().addScaledVector(shaftDirection, 0.015), elbowsOut.clone().add(TARGET.clone().multiplyScalar(0.5)))
    reach(rightArm!, rightForeArm!, rightHand!, gripTop.clone().addScaledVector(shaftDirection, 0.11), elbowsOut.clone().add(TARGET.clone().multiplyScalar(-0.6)))
    outer.scale.x = mirrored
    outer.updateMatrixWorld(true)
  }

  return {
    root: outer,
    pose,
    setAmplitude(value: number) { amplitude = value },
    dispose() {
      shaft.geometry.dispose()
      grip.geometry.dispose()
      shaftMaterial.dispose()
      gripMaterial.dispose()
    },
  }
}
