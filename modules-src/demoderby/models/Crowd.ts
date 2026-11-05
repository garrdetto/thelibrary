/** Bleacher crowd: seated fans built from a torso with arms, a head, legs and a cap as four instanced meshes with per-fan colours; some of them bob and cheer through a TSL position node. */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const { float, fract, instanceIndex, max, positionLocal, sin, step, time, vec3 } = THREE.TSL

export interface Seat {
  x: number
  y: number
  z: number
  yaw: number
}

export interface CrowdModel {
  root: THREE.Group
  count: number
  dispose(): void
}

export interface CrowdPalette {
  shirts: readonly string[]
  skins: readonly string[]
  pants: readonly string[]
  caps: readonly string[]
}

function fanMaterial(bobs: boolean): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 })
  if (bobs) {
    const id = instanceIndex.toFloat()
    const phase = fract(id.mul(0.6180339)).mul(6.2831)
    const cheering = step(float(0.62), fract(id.mul(0.3737)))
    const bob = max(float(0), sin(time.mul(float(2.4).add(fract(id.mul(0.271)).mul(2.2))).add(phase)))
    const sway = sin(time.mul(1.3).add(phase)).mul(0.012)
    material.positionNode = positionLocal.add(vec3(sway, cheering.mul(bob).mul(0.16), float(0)))
  }
  return material
}

export function createCrowd(seats: readonly Seat[], palette: CrowdPalette, seed: number): CrowdModel {
  const root = new THREE.Group()
  root.name = 'crowd'
  const upper = mergeGeometries([
    new THREE.CylinderGeometry(0.17, 0.2, 0.5, 10).translate(0, 0.62, 0),
    new THREE.CapsuleGeometry(0.045, 0.34, 2, 6).translate(0.235, 0.6, 0.05),
    new THREE.CapsuleGeometry(0.045, 0.34, 2, 6).translate(-0.235, 0.6, 0.05),
  ])
  const head = mergeGeometries([new THREE.SphereGeometry(0.115, 12, 10).translate(0, 1.0, 0), new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8).translate(0, 0.89, 0)])
  const legs = mergeGeometries([
    new THREE.BoxGeometry(0.14, 0.14, 0.42).translate(0.085, 0.36, 0.17),
    new THREE.BoxGeometry(0.14, 0.14, 0.42).translate(-0.085, 0.36, 0.17),
    new THREE.BoxGeometry(0.12, 0.36, 0.12).translate(0.085, 0.15, 0.36),
    new THREE.BoxGeometry(0.12, 0.36, 0.12).translate(-0.085, 0.15, 0.36),
  ])
  const cap = mergeGeometries([new THREE.SphereGeometry(0.123, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.02, 0), new THREE.CylinderGeometry(0.1, 0.1, 0.015, 10).scale(1, 1, 1.35).translate(0, 1.02, 0.1)])
  if (!upper || !head || !legs || !cap) throw new Error('Could not build the crowd')
  const count = seats.length
  const parts = [
    new THREE.InstancedMesh(upper, fanMaterial(true), count),
    new THREE.InstancedMesh(head, fanMaterial(true), count),
    new THREE.InstancedMesh(legs, fanMaterial(false), count),
    new THREE.InstancedMesh(cap, fanMaterial(true), count),
  ]
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)]
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const none = new THREE.Vector3(0.001, 0.001, 0.001)
  seats.forEach((seat, i) => {
    const size = 0.9 + random() * 0.2
    position.set(seat.x, seat.y, seat.z)
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw + (random() - 0.5) * 0.4)
    scale.setScalar(size)
    matrix.compose(position, quaternion, scale)
    for (const part of parts) part.setMatrixAt(i, matrix)
    parts[0].setColorAt(i, color.set(pick(palette.shirts)))
    parts[1].setColorAt(i, color.set(pick(palette.skins)))
    parts[2].setColorAt(i, color.set(pick(palette.pants)))
    if (random() < 0.45) parts[3].setColorAt(i, color.set(pick(palette.caps)))
    else {
      parts[3].setColorAt(i, color.set(pick(palette.shirts)))
      matrix.compose(position, quaternion, none)
      parts[3].setMatrixAt(i, matrix)
    }
  })
  for (const part of parts) {
    part.instanceMatrix.needsUpdate = true
    if (part.instanceColor) part.instanceColor.needsUpdate = true
    part.castShadow = true
    part.frustumCulled = false
    root.add(part)
  }
  return {
    root,
    count,
    dispose() {
      root.removeFromParent()
      for (const part of parts) {
        part.geometry.dispose()
        ;(part.material as THREE.Material).dispose()
        part.dispose()
      }
    },
  }
}
