/** Loose wreckage on the pad, visual only: parts that came off a car (bumpers, wheels) tumble, bounce and settle, and impact shrapnel (glass, chrome and paint chips) sprays from hits as one instanced mesh. Simple ballistic motion against the ground and the barrier line, no rigid bodies, so it never changes the heat. */
import * as THREE from 'three/webgpu'

interface Piece {
  object: THREE.Object3D
  velocity: THREE.Vector3
  spin: THREE.Vector3
  floor: number
  age: number
  resting: boolean
}

export interface DebrisField {
  root: THREE.Group
  /** Throws a part that came off (already in world space). */
  throwPart(object: THREE.Object3D, velocity: THREE.Vector3): void
  /** Sprays shrapnel from a point: glass, chrome and paint chips in the struck car's colour. */
  spray(point: THREE.Vector3, velocity: THREE.Vector3, count: number, paint: THREE.Color): void
  update(dt: number): void
  clear(): void
  dispose(): void
}

const box = new THREE.Box3()
const quaternion = new THREE.Quaternion()
const euler = new THREE.Euler()
const matrix = new THREE.Matrix4()
const scale = new THREE.Vector3()

export function createDebris(bounds: { halfL: number; halfW: number }, shardCount: number, partLife: number): DebrisField {
  const root = new THREE.Group()
  root.name = 'debris'
  const pieces: Piece[] = []
  const shardGeometry = new THREE.TetrahedronGeometry(0.04, 0)
  shardGeometry.scale(1, 0.35, 1.4)
  const shardMaterial = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5, envMapIntensity: 1.2 })
  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, shardCount)
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  shards.castShadow = false
  shards.frustumCulled = false
  const colour = new THREE.Color()
  for (let i = 0; i < shardCount; i++) {
    shards.setMatrixAt(i, matrix.makeScale(0, 0, 0))
    shards.setColorAt(i, colour.set('#ffffff'))
  }
  root.add(shards)
  const shardPosition = new Float32Array(shardCount * 3)
  const shardVelocity = new Float32Array(shardCount * 3)
  const shardSpin = new Float32Array(shardCount * 3)
  const shardAngle = new Float32Array(shardCount * 3)
  const shardAge = new Float32Array(shardCount).fill(Infinity)
  const shardSize = new Float32Array(shardCount)
  let cursor = 0
  const shardLife = 14

  const keepInside = (position: THREE.Vector3 | Float32Array, velocity: THREE.Vector3 | Float32Array, offset = 0): void => {
    const limitX = bounds.halfL - 0.45
    const limitZ = bounds.halfW - 0.45
    const px = position instanceof Float32Array ? position[offset] : position.x
    const pz = position instanceof Float32Array ? position[offset + 2] : position.z
    let vx = velocity instanceof Float32Array ? velocity[offset] : velocity.x
    let vz = velocity instanceof Float32Array ? velocity[offset + 2] : velocity.z
    let x = px
    let z = pz
    if (Math.abs(x) > limitX) {
      x = Math.sign(x) * limitX
      vx = -vx * 0.35
    }
    if (Math.abs(z) > limitZ) {
      z = Math.sign(z) * limitZ
      vz = -vz * 0.35
    }
    if (position instanceof Float32Array && velocity instanceof Float32Array) {
      position[offset] = x
      position[offset + 2] = z
      velocity[offset] = vx
      velocity[offset + 2] = vz
    } else if (!(position instanceof Float32Array) && !(velocity instanceof Float32Array)) {
      position.x = x
      position.z = z
      velocity.x = vx
      velocity.z = vz
    }
  }

  const throwPart = (object: THREE.Object3D, velocity: THREE.Vector3): void => {
    object.traverse((child) => {
      child.castShadow = true
    })
    root.add(object)
    object.updateMatrixWorld(true)
    box.setFromObject(object)
    const floor = Math.max(0.03, object.position.y - box.min.y) * 0.7
    pieces.push({
      object,
      velocity: velocity.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2)),
      spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8),
      floor,
      age: 0,
      resting: false,
    })
    while (pieces.length > 24) {
      const old = pieces.shift()
      old?.object.removeFromParent()
    }
  }

  const spray = (point: THREE.Vector3, velocity: THREE.Vector3, count: number, paint: THREE.Color): void => {
    for (let n = 0; n < count; n++) {
      const i = cursor
      cursor = (cursor + 1) % shardCount
      shardPosition[i * 3] = point.x + (Math.random() - 0.5) * 0.3
      shardPosition[i * 3 + 1] = Math.max(0.2, point.y + (Math.random() - 0.5) * 0.3)
      shardPosition[i * 3 + 2] = point.z + (Math.random() - 0.5) * 0.3
      const speed = 2 + Math.random() * 5
      const theta = Math.random() * Math.PI * 2
      shardVelocity[i * 3] = velocity.x * 0.5 + Math.cos(theta) * speed
      shardVelocity[i * 3 + 1] = 1.5 + Math.random() * 4
      shardVelocity[i * 3 + 2] = velocity.z * 0.5 + Math.sin(theta) * speed
      shardSpin[i * 3] = (Math.random() - 0.5) * 30
      shardSpin[i * 3 + 1] = (Math.random() - 0.5) * 30
      shardSpin[i * 3 + 2] = (Math.random() - 0.5) * 30
      shardAge[i] = 0
      shardSize[i] = 0.4 + Math.random() * 0.9
      const kind = Math.random()
      if (kind < 0.4) colour.setRGB(0.32, 0.38, 0.42)
      else if (kind < 0.6) colour.setRGB(0.55, 0.56, 0.58)
      else colour.copy(paint)
      shards.setColorAt(i, colour)
    }
    if (shards.instanceColor) shards.instanceColor.needsUpdate = true
  }

  const update = (dt: number): void => {
    for (const piece of pieces) {
      piece.age += dt
      if (piece.resting) continue
      const { object, velocity, spin } = piece
      velocity.y -= 9.81 * dt
      object.position.addScaledVector(velocity, dt)
      euler.set(spin.x * dt, spin.y * dt, spin.z * dt)
      quaternion.setFromEuler(euler)
      object.quaternion.multiply(quaternion)
      if (object.position.y < piece.floor) {
        object.position.y = piece.floor
        velocity.y = Math.abs(velocity.y) * 0.3
        velocity.x *= 0.6
        velocity.z *= 0.6
        spin.multiplyScalar(0.5)
        if (velocity.lengthSq() < 0.3) piece.resting = true
      }
      keepInside(object.position, velocity)
    }
    for (let i = 0; i < shardCount; i++) {
      const age = shardAge[i]
      if (age > shardLife) continue
      shardAge[i] = age + dt
      const o = i * 3
      if (shardPosition[o + 1] > 0.02 || shardVelocity[o + 1] > 0) {
        shardVelocity[o + 1] -= 9.81 * dt
        shardPosition[o] += shardVelocity[o] * dt
        shardPosition[o + 1] += shardVelocity[o + 1] * dt
        shardPosition[o + 2] += shardVelocity[o + 2] * dt
        shardAngle[o] += shardSpin[o] * dt
        shardAngle[o + 1] += shardSpin[o + 1] * dt
        shardAngle[o + 2] += shardSpin[o + 2] * dt
        if (shardPosition[o + 1] < 0.02) {
          shardPosition[o + 1] = 0.02
          shardVelocity[o + 1] = Math.abs(shardVelocity[o + 1]) > 1.5 ? Math.abs(shardVelocity[o + 1]) * 0.25 : 0
          shardVelocity[o] *= 0.4
          shardVelocity[o + 2] *= 0.4
          shardAngle[o] = 0
          shardAngle[o + 2] = 0
        }
        keepInside(shardPosition, shardVelocity, o)
      }
      const fade = shardAge[i] > shardLife - 2 ? Math.max(0, (shardLife - shardAge[i]) / 2) : 1
      const size = shardSize[i] * fade
      euler.set(shardAngle[o], shardAngle[o + 1], shardAngle[o + 2])
      quaternion.setFromEuler(euler)
      matrix.compose(new THREE.Vector3(shardPosition[o], shardPosition[o + 1], shardPosition[o + 2]), quaternion, scale.set(size, size, size))
      shards.setMatrixAt(i, matrix)
    }
    shards.instanceMatrix.needsUpdate = true
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieces[i].age > partLife) {
        pieces[i].object.removeFromParent()
        pieces.splice(i, 1)
      }
    }
  }

  const clear = (): void => {
    for (const piece of pieces) piece.object.removeFromParent()
    pieces.length = 0
    shardAge.fill(Infinity)
    for (let i = 0; i < shardCount; i++) shards.setMatrixAt(i, matrix.makeScale(0, 0, 0))
    shards.instanceMatrix.needsUpdate = true
  }

  const dispose = (): void => {
    clear()
    root.removeFromParent()
    shards.dispose()
    shardGeometry.dispose()
    shardMaterial.dispose()
  }

  return { root, throwPart, spray, update, clear, dispose }
}
