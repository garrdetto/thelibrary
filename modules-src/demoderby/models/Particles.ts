/** A small CPU particle pool rendered as one Points mesh: dust kicked up by sliding tires and smoke from hurt engines. */
import * as THREE from 'three/webgpu'

export interface ParticleSpec {
  count: number
  life: number
  size: number
  color: string
}

export interface ParticleSystem {
  points: THREE.Points
  emit(position: THREE.Vector3, velocity: THREE.Vector3, spread: number): void
  update(dt: number): void
  dispose(): void
}

export function createParticles(spec: ParticleSpec, opacity: number, rise: number): ParticleSystem {
  const positions = new Float32Array(spec.count * 3)
  const velocities = new Float32Array(spec.count * 3)
  const ages = new Float32Array(spec.count).fill(Number.POSITIVE_INFINITY)
  const geometry = new THREE.BufferGeometry()
  const positionAttribute = new THREE.BufferAttribute(positions, 3)
  positionAttribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positionAttribute)
  const material = new THREE.PointsMaterial({ color: new THREE.Color(spec.color), size: spec.size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.name = 'particles'
  for (let i = 0; i < spec.count; i++) positions[i * 3 + 1] = -100
  let cursor = 0

  const emit = (position: THREE.Vector3, velocity: THREE.Vector3, spread: number): void => {
    const i = cursor
    cursor = (cursor + 1) % spec.count
    positions[i * 3] = position.x + (Math.random() - 0.5) * spread
    positions[i * 3 + 1] = position.y + Math.random() * spread * 0.4
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread
    velocities[i * 3] = velocity.x + (Math.random() - 0.5) * 1.2
    velocities[i * 3 + 1] = velocity.y + rise + Math.random() * 0.6
    velocities[i * 3 + 2] = velocity.z + (Math.random() - 0.5) * 1.2
    ages[i] = 0
  }

  const update = (dt: number): void => {
    for (let i = 0; i < spec.count; i++) {
      if (ages[i] >= spec.life) {
        if (positions[i * 3 + 1] > -50) positions[i * 3 + 1] = -100
        continue
      }
      ages[i] += dt
      const damping = 1 - dt * 1.6
      velocities[i * 3] *= damping
      velocities[i * 3 + 2] *= damping
      positions[i * 3] += velocities[i * 3] * dt
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt
    }
    positionAttribute.needsUpdate = true
  }

  const dispose = (): void => {
    points.removeFromParent()
    geometry.dispose()
    material.dispose()
  }

  return { points, emit, update, dispose }
}
