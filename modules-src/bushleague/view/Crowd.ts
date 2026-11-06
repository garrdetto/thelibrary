/** The crowd: one instanced mesh of low-poly fans seated on the bowl, dressed mostly in home colors. Reactions (sit, stand, bounce, the wave) run in the vertex stage from a few uniforms, so 45,000 fans cost one draw call. */
import * as THREE from 'three/webgpu'
import { abs, attribute, color, float, max, mix, positionLocal, sin, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Rng, type TeamColors } from '../sim'

export interface Bowl {
  inner: THREE.Vector3[]
  outer: THREE.Vector3[]
}

export interface Crowd {
  mesh: THREE.InstancedMesh
  /** 0 seated and quiet, 1 on their feet and roaring. */
  excite(level: number): void
  startWave(): void
  update(dt: number): void
  dispose(): void
}

const SKIN = ['#f1c7a5', '#d9a07a', '#a8714a', '#7a4b2c', '#4f3020', '#e8b896']

function fanGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.42, 0.55, 0.3).translate(0, 0.42, 0)
  const head = new THREE.BoxGeometry(0.2, 0.22, 0.2).translate(0, 0.83, 0)
  const legs = new THREE.BoxGeometry(0.36, 0.16, 0.42).translate(0, 0.12, 0.12)
  const part = (geometry: THREE.BufferGeometry, value: number) => {
    geometry.setAttribute('part', new THREE.Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(value), 1))
    geometry.deleteAttribute('uv')
    return geometry
  }
  const merged = mergeGeometries([part(body, 0), part(head, 1), part(legs, 2)])
  if (!merged) throw new Error('fan geometry')
  return merged
}

export function createCrowd(bowl: Bowl, count: number, home: TeamColors, away: TeamColors, seed: number): Crowd | null {
  if (count <= 0 || bowl.inner.length < 2) return null
  const seats: { at: THREE.Vector3; facing: number; angle: number }[] = []
  const rows = 26
  const center = new THREE.Vector3(0, 0, -40)
  for (let row = 0; row < rows; row++) {
    const t = (row + 0.5) / rows
    for (let index = 0; index < bowl.inner.length - 1; index++) {
      const a = bowl.inner[index].clone().lerp(bowl.outer[index], t)
      const b = bowl.inner[index + 1].clone().lerp(bowl.outer[index + 1], t)
      const length = a.distanceTo(b)
      const steps = Math.max(1, Math.floor(length / 0.62))
      for (let step = 0; step < steps; step++) {
        const at = a.clone().lerp(b, (step + 0.5) / steps)
        at.y += 0.05
        const facing = Math.atan2(center.x - at.x, center.z - at.z)
        seats.push({ at, facing, angle: Math.atan2(at.x - center.x, -(at.z - center.z)) })
      }
    }
  }
  const total = Math.min(count, seats.length)
  const stride = seats.length / total
  const geometry = fanGeometry()
  const shirts = new Float32Array(total * 4)
  const skins = new Float32Array(total * 4)
  const rng = new Rng(seed)
  const palette = [home.primary, home.primary, home.primary, home.secondary, home.accent, away.primary, '#e8e4da', '#2a2f3a', '#9b2d2d', '#2f5f9b']
  const tint = new THREE.Color()
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardNodeMaterial({ roughness: 0.9 }), total)
  mesh.name = 'crowd'
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const scale = new THREE.Vector3()
  for (let index = 0; index < total; index++) {
    const seat = seats[Math.min(seats.length - 1, Math.floor(index * stride + rng.next() * stride * 0.5))]
    rotation.setFromAxisAngle(up, seat.facing)
    const s = 0.9 + rng.next() * 0.25
    scale.set(s, s, s)
    matrix.compose(seat.at, rotation, scale)
    mesh.setMatrixAt(index, matrix)
    tint.set(rng.pick(palette)).offsetHSL(0, 0, (rng.next() - 0.5) * 0.08)
    shirts.set([tint.r, tint.g, tint.b, rng.next()], index * 4)
    tint.set(rng.pick(SKIN))
    skins.set([tint.r, tint.g, tint.b, seat.angle], index * 4)
  }
  geometry.setAttribute('fanShirt', new THREE.InstancedBufferAttribute(shirts, 4))
  geometry.setAttribute('fanSkin', new THREE.InstancedBufferAttribute(skins, 4))

  const excitement = uniform(0)
  const wavePhase = uniform(-10)
  const material = mesh.material as THREE.MeshStandardNodeMaterial
  const shirtData = attribute<'vec4'>('fanShirt', 'vec4')
  const skinData = attribute<'vec4'>('fanSkin', 'vec4')
  const fanSeed = shirtData.w
  const part = attribute<'float'>('part', 'float')
  const standing = smoothstep(fanSeed.mul(0.6), fanSeed.mul(0.6).add(0.3), excitement)
  const wave = smoothstep(0.45, 0.0, abs(skinData.w.sub(wavePhase)))
  const lift = max(standing, wave)
  const bounce = sin(time.mul(float(8).add(fanSeed.mul(4))).add(fanSeed.mul(40))).mul(0.07).mul(excitement)
  const isLegs = smoothstep(1.5, 2.0, part)
  const raise = lift.mul(0.32).add(bounce).mul(float(1).sub(isLegs))
  material.positionNode = positionLocal.add(vec3(0, raise, 0))
  const shirt = shirtData.xyz
  const skin = skinData.xyz
  material.colorNode = mix(mix(shirt, skin, smoothstep(0.5, 1.0, part).sub(isLegs)), color('#2a2d36'), isLegs)
  mesh.instanceMatrix.needsUpdate = true

  let target = 0.1
  let level = 0.1
  let waveClock = -1
  return {
    mesh,
    excite(next) {
      target = Math.max(target, Math.min(1, next))
    },
    startWave() {
      if (waveClock < 0) waveClock = 0
    },
    update(dt) {
      level += (target - level) * Math.min(1, dt * 3)
      target = Math.max(0.1, target - dt * 0.22)
      excitement.value = level
      if (waveClock >= 0) {
        waveClock += dt
        wavePhase.value = -Math.PI + waveClock * 0.9
        if (wavePhase.value > Math.PI + 0.5) waveClock = -1
      } else wavePhase.value = -10
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
