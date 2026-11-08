/** Signature dressing for the first two parks. The Outhouse: a giant port-a-potty scoreboard whose door flies open and flushes on home runs, and green fog drifting over the outfield. Sandlot Classic: a cornfield beyond center, a water tower, and fireflies once the sun is down. */
import * as THREE from 'three/webgpu'
import { color, mix, positionLocal, sin, time, uv, vec3 } from 'three/tsl'
import { Rng, fenceDistance, polar, type Park, type Team } from '../sim'
import type { TimeOfDay } from '../looks'
import { toWorld } from './space'

export interface Signature {
  replacesScoreboard: boolean
  setTimeOfDay(time: TimeOfDay): void
  celebrate(kind: 'homer' | 'final'): void
  update(dt: number): void
  dispose(): void
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function softDot(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (context) => {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  })
}

function outhouse(park: Park, root: THREE.Group, home: Team, away: Team): Signature {
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }
  const group = new THREE.Group()
  group.position.copy(toWorld(polar(fenceDistance(park, 0) + 18, 0)))
  root.add(group)
  const plastic = own(new THREE.MeshStandardMaterial({ color: '#3f8a3a', roughness: 0.45 }))
  const trim = own(new THREE.MeshStandardMaterial({ color: '#e9e4d6', roughness: 0.5 }))
  const body = new THREE.Mesh(own(new THREE.BoxGeometry(13, 20, 11)), plastic)
  body.position.y = 10
  const roof = new THREE.Mesh(own(new THREE.BoxGeometry(14.5, 1.4, 12.5)), trim)
  roof.position.y = 20.7
  const vent = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 0.5, 4, 12)), trim)
  vent.position.set(4.5, 23, -2)
  for (const mesh of [body, roof, vent]) mesh.castShadow = true
  group.add(body, roof, vent)

  const screen = own(canvasTexture(512, 256, (context) => {
    context.fillStyle = '#0d1a14'
    context.fillRect(0, 0, 512, 256)
    context.fillStyle = '#e8b23a'
    context.font = 'bold 40px Rajdhani, Inter, sans-serif'
    context.textAlign = 'center'
    context.fillText('THE OUTHOUSE', 256, 62)
    context.font = 'bold 30px Inter, sans-serif'
    context.fillStyle = '#f4f1e8'
    context.fillText(`${away.abbr}  at  ${home.abbr}`, 256, 130)
    context.font = '600 24px Inter, sans-serif'
    context.fillStyle = '#9fd18a'
    context.fillText('PLEASE JIGGLE THE HANDLE', 256, 200)
  }))
  const doorFace = own(canvasTexture(256, 512, (context) => {
    context.fillStyle = '#3a7f35'
    context.fillRect(0, 0, 256, 512)
    context.fillStyle = '#2c6328'
    for (let y = 20; y < 512; y += 46) context.fillRect(10, y, 236, 6)
    context.fillStyle = '#152a12'
    context.beginPath()
    context.arc(128, 90, 34, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#3a7f35'
    context.beginPath()
    context.arc(146, 80, 30, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#c23b2b'
    context.fillRect(150, 260, 70, 28)
    context.fillStyle = '#fff'
    context.font = 'bold 18px Inter, sans-serif'
    context.fillText('IN USE', 154, 281)
  }))
  const board = new THREE.Mesh(own(new THREE.PlaneGeometry(11, 5.5)), own(new THREE.MeshBasicMaterial({ map: screen })))
  board.position.set(0, 16.2, 5.53)
  group.add(board)
  const hinge = new THREE.Group()
  hinge.position.set(-3.5, 0, 5.6)
  const door = new THREE.Mesh(own(new THREE.BoxGeometry(7, 12.5, 0.3)), [plastic, plastic, plastic, plastic, own(new THREE.MeshStandardMaterial({ map: doorFace, roughness: 0.45 })), plastic])
  door.position.set(3.5, 6.4, 0)
  door.castShadow = true
  hinge.add(door)
  group.add(hinge)
  const gloom = new THREE.Mesh(own(new THREE.PlaneGeometry(6.6, 12)), own(new THREE.MeshBasicMaterial({ color: '#07100a' })))
  gloom.position.set(0, 6.4, 5.52)
  group.add(gloom)

  const swirlCount = 360
  const swirlPositions = new Float32Array(swirlCount * 3)
  const swirlGeometry = own(new THREE.BufferGeometry())
  swirlGeometry.setAttribute('position', new THREE.BufferAttribute(swirlPositions, 3))
  const dot = own(softDot())
  const swirl = new THREE.Points(swirlGeometry, own(new THREE.PointsMaterial({ color: '#6fe0c8', size: 0.9, map: dot, transparent: true, depthWrite: false, opacity: 0.9 })))
  swirl.visible = false
  swirl.frustumCulled = false
  swirl.position.set(0, 0, 7)
  group.add(swirl)

  const fogTexture = own(softDot())
  const fogMaterial = own(new THREE.SpriteMaterial({ map: fogTexture, color: '#6fae4c', transparent: true, opacity: 0.16, depthWrite: false }))
  const fogs: { sprite: THREE.Sprite; drift: number; phase: number; base: THREE.Vector3 }[] = []
  const rng = new Rng(404)
  for (let index = 0; index < 26; index++) {
    const spray = rng.range(-42, 42)
    const distance = rng.range(45, fenceDistance(park, spray) + 6)
    const base = toWorld({ ...polar(distance, spray), y: rng.range(0.6, 2.4) })
    const sprite = new THREE.Sprite(fogMaterial)
    sprite.scale.set(rng.range(14, 26), rng.range(5, 8), 1)
    sprite.position.copy(base)
    root.add(sprite)
    fogs.push({ sprite, drift: rng.range(0.2, 0.6), phase: rng.range(0, 6.28), base })
  }

  let flush = -1
  let clock = 0
  return {
    replacesScoreboard: true,
    setTimeOfDay(next) {
      fogMaterial.opacity = next === 'night' ? 0.22 : next === 'dusk' ? 0.18 : 0.13
    },
    celebrate(kind) {
      if (kind === 'homer' || kind === 'final') flush = 0
    },
    update(dt) {
      clock += dt
      for (const fog of fogs) {
        fog.sprite.position.x = fog.base.x + Math.sin(clock * 0.05 * fog.drift + fog.phase) * 6
        fog.sprite.position.z = fog.base.z + Math.cos(clock * 0.04 * fog.drift + fog.phase) * 4
      }
      if (flush < 0) return
      flush += dt
      const open = flush < 0.5 ? flush / 0.5 : flush < 3.2 ? 1 : Math.max(0, 1 - (flush - 3.2) / 0.6)
      hinge.rotation.y = -open * 1.9
      swirl.visible = flush > 0.3 && flush < 3.6
      if (swirl.visible) {
        const t = flush - 0.3
        for (let index = 0; index < swirlCount; index++) {
          const f = index / swirlCount
          const angle = f * 40 + t * (6 + f * 4)
          const radius = (1 - f) * 2.6 + 0.3
          swirlPositions[index * 3] = Math.cos(angle) * radius
          swirlPositions[index * 3 + 1] = 4 + ((f * 18 + t * 9) % 18)
          swirlPositions[index * 3 + 2] = Math.sin(angle) * radius
        }
        swirlGeometry.getAttribute('position').needsUpdate = true
      }
      if (flush > 4) flush = -1
    },
    dispose() {
      group.removeFromParent()
      for (const fog of fogs) fog.sprite.removeFromParent()
      for (const item of disposables) item.dispose()
    },
  }
}

function sandlot(park: Park, root: THREE.Group): Signature {
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }
  const stalk = own(new THREE.ConeGeometry(0.28, 2.6, 5, 3))
  stalk.translate(0, 1.3, 0)
  const cornMaterial = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }))
  const sway = sin(time.mul(1.3).add(positionLocal.y.mul(0.4))).mul(uv().y).mul(uv().y).mul(0.12)
  cornMaterial.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)))
  cornMaterial.colorNode = mix(color('#3f6a22'), color('#b9b04a'), uv().y.mul(uv().y))
  const count = 2600
  const corn = new THREE.InstancedMesh(stalk, cornMaterial, count)
  corn.name = 'cornfield'
  const rng = new Rng(1999)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  for (let index = 0; index < count; index++) {
    const spray = rng.range(-44, 44)
    const distance = fenceDistance(park, spray) + rng.range(3, 40)
    rotation.setFromAxisAngle(up, rng.next() * Math.PI * 2)
    const s = rng.range(0.8, 1.25)
    scale.set(s, s * rng.range(0.85, 1.2), s)
    matrix.compose(toWorld(polar(distance, spray)), rotation, scale)
    corn.setMatrixAt(index, matrix)
  }
  corn.castShadow = true
  corn.userData.shadowAnimated = true
  corn.receiveShadow = true
  root.add(corn)

  const tower = new THREE.Group()
  const steel = own(new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.4, metalness: 0.6 }))
  const band = own(new THREE.MeshStandardMaterial({ color: '#b3362a', roughness: 0.5 }))
  const tank = new THREE.Mesh(own(new THREE.CylinderGeometry(5, 5, 6, 24)), steel)
  tank.position.y = 22
  const cap = new THREE.Mesh(own(new THREE.ConeGeometry(5.4, 2.6, 24)), steel)
  cap.position.y = 26.3
  const stripe = new THREE.Mesh(own(new THREE.CylinderGeometry(5.05, 5.05, 1, 24)), band)
  stripe.position.y = 22
  tower.add(tank, cap, stripe)
  for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
    const leg = new THREE.Mesh(own(new THREE.CylinderGeometry(0.25, 0.3, 19, 8)), steel)
    leg.position.set(x, 9.5, z)
    tower.add(leg)
  }
  tower.traverse((child) => (child.castShadow = true))
  tower.position.copy(toWorld(polar(fenceDistance(park, -30) + 48, -30)))
  root.add(tower)

  const flyCount = 420
  const groups: THREE.Points[] = []
  const dot = own(softDot())
  for (let group = 0; group < 3; group++) {
    const positions: number[] = []
    for (let index = 0; index < flyCount / 3; index++) {
      const spray = rng.range(-50, 50)
      const distance = fenceDistance(park, Math.max(-45, Math.min(45, spray))) + rng.range(-12, 30)
      const at = toWorld({ ...polar(distance, spray), y: rng.range(0.6, 3.5) })
      positions.push(at.x, at.y, at.z)
    }
    const geometry = own(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const points = new THREE.Points(geometry, own(new THREE.PointsMaterial({ color: '#d8ff6a', size: 0.45, map: dot, transparent: true, depthWrite: false, opacity: 0 })))
    points.visible = false
    root.add(points)
    groups.push(points)
  }

  let night = false
  let clock = 0
  return {
    replacesScoreboard: false,
    setTimeOfDay(next) {
      night = next !== 'day'
      for (const points of groups) points.visible = night
    },
    celebrate() {},
    update(dt) {
      clock += dt
      if (!night) return
      groups.forEach((points, index) => {
        const material = points.material as THREE.PointsMaterial
        material.opacity = Math.max(0, Math.sin(clock * (1.1 + index * 0.37) + index * 2.1)) * 0.95
        points.position.y = Math.sin(clock * 0.4 + index) * 0.4
      })
    },
    dispose() {
      corn.removeFromParent()
      tower.removeFromParent()
      for (const points of groups) points.removeFromParent()
      for (const item of disposables) item.dispose()
    },
  }
}

export function createSignature(kind: 'outhouse' | 'sandlot', park: Park, root: THREE.Group, home: Team, away: Team): Signature {
  return kind === 'outhouse' ? outhouse(park, root, home, away) : sandlot(park, root)
}
