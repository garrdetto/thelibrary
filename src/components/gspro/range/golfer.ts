import * as THREE from 'three'
import { SWING_LEAD } from './timing'

export { SWING_LEAD }

const ease = (value: number) => value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
  const length = from.distanceTo(to)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, length, 10), material)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  mesh.castShadow = true
  return mesh
}

/**
 * A stylised golfer addressing a ball at the origin, target toward −Z, in yards. The arms and club swing as one piece
 * about an axis normal to the swing plane, a = d × v (d from the shoulders to the ball, v the target direction), so a
 * positive angle moves the club toward the target and zero is impact. The torso turns about the tilted spine.
 */
export function createGolfer(handed: 'RH' | 'LH') {
  const root = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.7 })
  const shirt = new THREE.MeshStandardMaterial({ color: 0x1f3b63, roughness: 0.8 })
  const trousers = new THREE.MeshStandardMaterial({ color: 0xc8b48d, roughness: 0.9 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 })
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.3 })
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.6 })

  const stance = new THREE.Vector3(-0.82, 0, 0)
  for (const side of [-1, 1]) {
    const foot = new THREE.Vector3(stance.x, 0.06, side * 0.2)
    const knee = new THREE.Vector3(stance.x + 0.09, 0.5, side * 0.17)
    const hip = new THREE.Vector3(stance.x - 0.05, 0.93, side * 0.1)
    root.add(limb(foot, knee, 0.068, trousers))
    root.add(limb(knee, hip, 0.085, trousers))
    const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), trousers)
    kneeJoint.position.copy(knee)
    root.add(kneeJoint)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.13), white)
    shoe.position.set(stance.x + 0.06, 0.045, side * 0.2)
    shoe.castShadow = true
    root.add(shoe)
  }
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.18, 6, 12), trousers)
  pelvis.rotation.x = Math.PI / 2
  pelvis.position.set(stance.x - 0.05, 0.95, 0)
  pelvis.castShadow = true
  root.add(pelvis)

  const spineTilt = 0.6
  const hips = new THREE.Vector3(stance.x - 0.05, 0.95, 0)
  const spine = new THREE.Group()
  spine.position.copy(hips)
  spine.rotation.z = -spineTilt
  const turn = new THREE.Group()
  spine.add(turn)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.36, 6, 14), shirt)
  torso.position.y = 0.34
  torso.scale.set(0.9, 1, 1.45)
  torso.castShadow = true
  turn.add(torso)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10), skin)
  neck.position.y = 0.66
  turn.add(neck)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), skin)
  head.position.y = 0.78
  head.castShadow = true
  turn.add(head)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), white)
  cap.position.y = 0.8
  turn.add(cap)
  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.16), white)
  bill.position.set(0.15, 0.8, 0)
  turn.add(bill)
  root.add(spine)

  const shoulders = hips.clone().add(new THREE.Vector3(Math.sin(spineTilt) * 0.62, Math.cos(spineTilt) * 0.62, 0))
  const ball = new THREE.Vector3(0, 0.025, 0)
  const toBall = ball.clone().sub(shoulders)
  const down = toBall.clone().normalize()
  const axis = down.clone().cross(new THREE.Vector3(0, 0, -1)).normalize()
  const arms = new THREE.Group()
  arms.position.copy(shoulders)
  const hands = down.clone().multiplyScalar(0.62)
  for (const side of [-1, 1]) arms.add(limb(new THREE.Vector3(0, -0.02, side * 0.19), hands, 0.045, shirt))
  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), white)
  glove.position.copy(hands)
  arms.add(glove)
  const clubhead = toBall.clone().add(new THREE.Vector3(0, 0.01, 0.045))
  const gripEnd = hands.clone().add(down.clone().multiplyScalar(0.18))
  arms.add(limb(hands.clone().sub(down.clone().multiplyScalar(0.04)), gripEnd, 0.016, black))
  arms.add(limb(gripEnd, clubhead, 0.009, steel))
  const head3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.035), black)
  head3.position.copy(clubhead).add(new THREE.Vector3(0.03, 0, 0))
  head3.castShadow = true
  arms.add(head3)
  root.add(arms)

  if (handed === 'LH') root.scale.x = -1

  let amplitude = 1
  const quaternion = new THREE.Quaternion()

  /** Pose for a replay clock (seconds, impact at 0): address, backswing, downswing, impact, then a held finish. */
  function pose(clock: number) {
    const start = -SWING_LEAD
    const top = -0.25
    let angle: number
    let rotation: number
    if (clock <= start + 0.3) { angle = 0; rotation = 0 }
    else if (clock <= top) {
      const share = ease(clamp01((clock - start - 0.3) / (top - start - 0.3)))
      angle = -2.35 * share
      rotation = -1.25 * share
    } else if (clock <= 0) {
      const share = clamp01((clock - top) / -top) ** 2.2
      angle = -2.35 * (1 - share)
      rotation = -1.25 + 1.6 * share
    } else {
      const share = 1 - (1 - clamp01(clock / 0.5)) ** 3
      angle = 2.7 * share
      rotation = 0.35 + 0.75 * share
    }
    quaternion.setFromAxisAngle(axis, angle * amplitude)
    arms.quaternion.copy(quaternion)
    turn.rotation.y = rotation * amplitude
  }

  return {
    root,
    pose,
    setAmplitude(value: number) { amplitude = value },
    dispose() {
      root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
      for (const material of [skin, shirt, trousers, white, steel, black]) material.dispose()
    },
  }
}
