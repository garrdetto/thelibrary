/** Tire marks that build up on the dirt pad during a heat: every rolling or sliding wheel drags a darker, packed rut into a canvas laid over the pad (uploaded a few times a second), with wider, darker scars where cars spin and slide. */
import * as THREE from 'three/webgpu'

export interface TrackMarks {
  mesh: THREE.Mesh
  /** Draws a rut from the wheel's last point to (x, z): width in metres, strength 0–1. */
  stroke(key: number, x: number, z: number, width: number, strength: number): void
  /** Forgets a wheel's last point (wheel lifted, car reset). */
  lift(key: number): void
  update(dt: number): void
  clear(): void
  dispose(): void
}

export function createTrackMarks(length: number, width: number, pixels: number): TrackMarks {
  const canvas = document.createElement('canvas')
  canvas.width = pixels
  canvas.height = Math.round((pixels * width) / length)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  const scale = canvas.width / length
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.82, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const geometry = new THREE.PlaneGeometry(length, width)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.012
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  mesh.name = 'tire-marks'
  const last = new Map<number, [number, number]>()
  let dirty = false
  let clock = 0
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const toCanvas = (x: number, z: number): [number, number] => [(x + length / 2) * scale, (z + width / 2) * scale]

  const stroke = (key: number, x: number, z: number, wheelWidth: number, strength: number): void => {
    const [px, py] = toCanvas(x, z)
    const previous = last.get(key)
    last.set(key, [px, py])
    if (!previous) return
    const dx = px - previous[0]
    const dy = py - previous[1]
    if (dx * dx + dy * dy < 1) {
      last.set(key, previous)
      return
    }
    if (dx * dx + dy * dy > 400 * scale * scale) return
    const alpha = Math.min(0.5, 0.06 + strength * 0.3)
    ctx.strokeStyle = `rgba(52,36,22,${alpha})`
    ctx.lineWidth = Math.max(2, wheelWidth * scale * (1 + strength * 0.6))
    ctx.beginPath()
    ctx.moveTo(previous[0], previous[1])
    ctx.lineTo(px, py)
    ctx.stroke()
    if (strength > 0.35) {
      ctx.strokeStyle = `rgba(150,118,84,${alpha * 0.5})`
      ctx.lineWidth = Math.max(1, wheelWidth * scale * 0.18)
      for (const side of [-0.55, 0.55]) {
        const nx = (-dy / Math.hypot(dx, dy)) * wheelWidth * scale * side
        const ny = (dx / Math.hypot(dx, dy)) * wheelWidth * scale * side
        ctx.beginPath()
        ctx.moveTo(previous[0] + nx, previous[1] + ny)
        ctx.lineTo(px + nx, py + ny)
        ctx.stroke()
      }
    }
    dirty = true
  }

  const update = (dt: number): void => {
    clock += dt
    if (!dirty || clock < 0.2) return
    clock = 0
    dirty = false
    texture.needsUpdate = true
  }

  const clear = (): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    last.clear()
    texture.needsUpdate = true
  }

  return {
    mesh,
    stroke,
    lift: (key) => last.delete(key),
    update,
    clear,
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
