/** A CPU particle pool drawn as soft, camera-facing instanced sprites (one draw call per pool): tire dust, engine smoke, radiator steam, fire and impact sparks. Each particle grows, turns and fades over its life; sparks are additive and bright enough to bloom. */
import * as THREE from 'three/webgpu'

const { float, hash, instanceIndex, instancedDynamicBufferAttribute, mix, texture, uniform, uv, vec3, vec4 } = THREE.TSL

export interface ParticleSpec {
  count: number
  life: number
  size: number
  color: string
}

export interface ParticleOptions {
  opacity: number
  /** Upward speed added at birth (m/s). */
  rise: number
  /** Downward acceleration (m/s², 0 for smoke). */
  gravity?: number
  /** Size multiplier reached at the end of life. */
  grow?: number
  /** Horizontal velocity damping per second. */
  drag?: number
  additive?: boolean
  /** Colour multiplier (above 1 glows through the bloom). */
  brightness?: number
  /** Colour at the end of life (fire turns to smoke). */
  endColor?: string
  /** Stretch along the velocity is not available on sprites, so sparks use a hard, small dot. */
  hard?: boolean
}

export interface ParticleSystem {
  object: THREE.Mesh
  emit(position: THREE.Vector3, velocity: THREE.Vector3, spread: number): void
  burst(position: THREE.Vector3, velocity: THREE.Vector3, count: number, spread: number, speed: number): void
  update(dt: number): void
  dispose(): void
}

const puffs = new Map<string, THREE.CanvasTexture>()

function puffTexture(hard: boolean): THREE.CanvasTexture {
  const key = hard ? 'hard' : 'soft'
  const cached = puffs.get(key)
  if (cached) return cached
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  if (hard) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  } else {
    let state = 77
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
    for (let i = 0; i < 26; i++) {
      const angle = random() * Math.PI * 2
      const reach = random() * 26
      const x = 64 + Math.cos(angle) * reach
      const y = 64 + Math.sin(angle) * reach
      const radius = 18 + random() * 22
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
      const shade = Math.round(200 + random() * 55)
      gradient.addColorStop(0, `rgba(${shade},${shade},${shade},0.32)`)
      gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
    }
  }
  const result = new THREE.CanvasTexture(canvas)
  result.colorSpace = THREE.SRGBColorSpace
  puffs.set(key, result)
  return result
}

export function createParticles(spec: ParticleSpec, options: ParticleOptions): ParticleSystem {
  const count = spec.count
  const positions = new Float32Array(count * 3)
  const shape = new Float32Array(count * 2)
  const velocities = new Float32Array(count * 3)
  const ages = new Float32Array(count).fill(Number.POSITIVE_INFINITY)
  const lives = new Float32Array(count).fill(spec.life)
  const positionAttribute = new THREE.InstancedInterleavedBuffer(positions, 3)
  positionAttribute.setUsage(THREE.DynamicDrawUsage)
  const shapeAttribute = new THREE.InstancedInterleavedBuffer(shape, 2)
  shapeAttribute.setUsage(THREE.DynamicDrawUsage)
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending })
  type Vec3Node = ReturnType<typeof vec3>
  const size = instancedDynamicBufferAttribute<'float'>(shapeAttribute, 'float', 2, 0)
  const life = instancedDynamicBufferAttribute<'float'>(shapeAttribute, 'float', 2, 1)
  material.positionNode = instancedDynamicBufferAttribute<'vec3'>(positionAttribute, 'vec3', 3, 0)
  material.scaleNode = size
  material.rotationNode = hash(instanceIndex).mul(6.283)
  const puff = texture(puffTexture(!!options.hard), uv())
  const start = uniform(new THREE.Color(spec.color)) as unknown as Vec3Node
  const end = uniform(new THREE.Color(options.endColor ?? spec.color)) as unknown as Vec3Node
  const tint = hash(instanceIndex.add(17)).mul(0.3).add(0.85)
  const colour = (mix(start, end, float(1).sub(life).clamp(0, 1)) as Vec3Node).mul(tint).mul(options.brightness ?? 1)
  material.colorNode = vec4(colour.mul(puff.rgb), puff.a.mul(life.mul(1.6).min(1)).mul(options.opacity))
  const quad = new THREE.PlaneGeometry(1, 1)
  const object = new THREE.Mesh(quad, material)
  object.count = count
  object.frustumCulled = false
  object.renderOrder = 5
  object.name = 'particles'
  let cursor = 0
  const gravity = options.gravity ?? 0
  const grow = options.grow ?? 1.8
  const drag = options.drag ?? 1.6

  const spawn = (position: THREE.Vector3, vx: number, vy: number, vz: number, spread: number): void => {
    const i = cursor
    cursor = (cursor + 1) % count
    positions[i * 3] = position.x + (Math.random() - 0.5) * spread
    positions[i * 3 + 1] = position.y + Math.random() * spread * 0.4
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread
    velocities[i * 3] = vx
    velocities[i * 3 + 1] = vy
    velocities[i * 3 + 2] = vz
    ages[i] = 0
    lives[i] = spec.life * (0.7 + Math.random() * 0.6)
  }

  const emit = (position: THREE.Vector3, velocity: THREE.Vector3, spread: number): void => {
    spawn(position, velocity.x + (Math.random() - 0.5) * 1.2, velocity.y + options.rise + Math.random() * 0.6, velocity.z + (Math.random() - 0.5) * 1.2, spread)
  }

  const burst = (position: THREE.Vector3, velocity: THREE.Vector3, amount: number, spread: number, speed: number): void => {
    for (let n = 0; n < amount; n++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(1 - Math.random() * 1.6)
      const s = speed * (0.35 + Math.random() * 0.65)
      spawn(position, velocity.x + Math.sin(phi) * Math.cos(theta) * s, velocity.y + Math.cos(phi) * s + options.rise, velocity.z + Math.sin(phi) * Math.sin(theta) * s, spread)
    }
  }

  const update = (dt: number): void => {
    const damping = Math.max(0, 1 - dt * drag)
    for (let i = 0; i < count; i++) {
      const age = ages[i]
      if (age >= lives[i]) {
        shape[i * 2] = 0
        continue
      }
      ages[i] = age + dt
      velocities[i * 3] *= damping
      velocities[i * 3 + 2] *= damping
      velocities[i * 3 + 1] = velocities[i * 3 + 1] * (gravity > 0 ? 1 : damping) - gravity * dt
      positions[i * 3] += velocities[i * 3] * dt
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt
      if (gravity > 0 && positions[i * 3 + 1] < 0.03) {
        positions[i * 3 + 1] = 0.03
        velocities[i * 3 + 1] *= -0.3
        velocities[i * 3] *= 0.6
        velocities[i * 3 + 2] *= 0.6
      }
      const t = ages[i] / lives[i]
      shape[i * 2] = spec.size * (1 + (grow - 1) * t) * (0.75 + 0.5 * ((i * 0.618) % 1))
      shape[i * 2 + 1] = 1 - t
    }
    positionAttribute.needsUpdate = true
    shapeAttribute.needsUpdate = true
  }

  const dispose = (): void => {
    object.removeFromParent()
    quad.dispose()
    material.dispose()
  }

  return { object, emit, burst, update, dispose }
}
