/** Aim preview model factory: a faded trail of ghost balls along the perfectly struck flight and roll, a thin line through them, a ring of discs around the landing zone and a disc where the ball would stop. */
import * as THREE from 'three/webgpu'

export interface ShotPreviewSpec {
  color: string
  zoneColor: string
  restColor: string
  maxBalls: number
  ballRadius: number
  flightSpacing: number
  rollSpacing: number
  /** Ghost balls grow with distance from the player so the far end stays readable: scale = 1 + distance · growth. */
  growth: number
  opacity: number
  lineOpacity: number
  zoneDots: number
  zoneDotRadius: number
  restRadius: number
  lift: number
}

export interface ZoneShape {
  center: readonly [number, number, number]
  yaw: number
  halfLength: number
  halfWidth: number
}

export interface ShotPreviewModel {
  group: THREE.Group
  /** Shows the path from flattened xyz samples; samples past `landingIndex` are the roll. */
  show(samples: readonly number[], landingIndex: number, zone: ZoneShape | null, groundAt: (x: number, z: number) => number): void
  hide(): void
  dispose(): void
}

export function createShotPreview(spec: ShotPreviewSpec): ShotPreviewModel {
  const group = new THREE.Group()
  group.name = 'shot-preview'

  const ballGeometry = new THREE.SphereGeometry(spec.ballRadius, 10, 6)
  const ballMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.color), transparent: true, opacity: spec.opacity, depthWrite: false })
  const balls = new THREE.InstancedMesh(ballGeometry, ballMaterial, spec.maxBalls)
  balls.frustumCulled = false
  balls.count = 0

  const linePositions = new Float32Array(spec.maxBalls * 3)
  const lineAttribute = new THREE.BufferAttribute(linePositions, 3)
  lineAttribute.setUsage(THREE.DynamicDrawUsage)
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', lineAttribute)
  lineGeometry.setDrawRange(0, 0)
  const lineMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(spec.color), transparent: true, opacity: spec.lineOpacity, depthWrite: false })
  const line = new THREE.Line(lineGeometry, lineMaterial)
  line.frustumCulled = false

  const discGeometry = new THREE.CircleGeometry(1, 14)
  discGeometry.rotateX(-Math.PI / 2)
  const zoneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.zoneColor), transparent: true, opacity: 0.85, depthWrite: false })
  const zone = new THREE.InstancedMesh(discGeometry, zoneMaterial, spec.zoneDots)
  zone.frustumCulled = false
  zone.count = 0
  const restMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.restColor), transparent: true, opacity: 0.9, depthWrite: false })
  const rest = new THREE.Mesh(discGeometry, restMaterial)
  rest.scale.setScalar(spec.restRadius)

  group.add(line, balls, zone, rest)
  group.visible = false
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Quaternion()

  return {
    group,
    show(samples, landingIndex, shape, groundAt) {
      const count = samples.length / 3
      if (count < 2) {
        group.visible = false
        return
      }
      const ox = samples[0]
      const oy = samples[1]
      const oz = samples[2]
      let placed = 0
      let travelled = 0
      let nextAt = spec.flightSpacing
      let px = ox
      let py = oy
      let pz = oz
      for (let index = 1; index < count && placed < spec.maxBalls; index++) {
        const x = samples[index * 3]
        const y = samples[index * 3 + 1]
        const z = samples[index * 3 + 2]
        travelled += Math.hypot(x - px, y - py, z - pz)
        px = x
        py = y
        pz = z
        const last = index === count - 1
        if (travelled < nextAt && !last) continue
        const rolling = index > landingIndex
        nextAt = travelled + (rolling ? spec.rollSpacing : spec.flightSpacing)
        const distance = Math.hypot(x - ox, z - oz)
        const size = (1 + distance * spec.growth) * (rolling ? 0.7 : 1)
        position.set(x, y, z)
        scale.setScalar(size)
        matrix.compose(position, rotation.identity(), scale)
        balls.setMatrixAt(placed, matrix)
        linePositions[placed * 3] = x
        linePositions[placed * 3 + 1] = y
        linePositions[placed * 3 + 2] = z
        placed++
      }
      balls.count = placed
      balls.instanceMatrix.needsUpdate = true
      lineAttribute.needsUpdate = true
      lineGeometry.setDrawRange(0, placed)

      const endX = samples[(count - 1) * 3]
      const endZ = samples[(count - 1) * 3 + 2]
      rest.position.set(endX, groundAt(endX, endZ) + spec.lift, endZ)

      if (shape) {
        const forwardX = Math.sin(shape.yaw)
        const forwardZ = Math.cos(shape.yaw)
        for (let dot = 0; dot < spec.zoneDots; dot++) {
          const angle = (dot / spec.zoneDots) * Math.PI * 2
          const along = Math.cos(angle) * shape.halfLength
          const across = Math.sin(angle) * shape.halfWidth
          const x = shape.center[0] + forwardX * along - forwardZ * across
          const z = shape.center[2] + forwardZ * along + forwardX * across
          const distance = Math.hypot(x - ox, z - oz)
          position.set(x, groundAt(x, z) + spec.lift, z)
          scale.setScalar(spec.zoneDotRadius * (1 + distance * spec.growth))
          matrix.compose(position, rotation.identity(), scale)
          zone.setMatrixAt(dot, matrix)
        }
        zone.count = spec.zoneDots
        zone.instanceMatrix.needsUpdate = true
      } else {
        zone.count = 0
      }
      group.visible = true
    },
    hide() {
      group.visible = false
    },
    dispose() {
      group.removeFromParent()
      ballGeometry.dispose()
      ballMaterial.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      discGeometry.dispose()
      zoneMaterial.dispose()
      restMaterial.dispose()
    },
  }
}
