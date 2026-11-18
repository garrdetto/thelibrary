import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { TracePoint } from '@/lib/gspro/flight'
import { createGolfer, SWING_LEAD } from './golfer'
import { clubModelFor, createRiggedGolfer, loadGolfAssets } from './riggedGolfer'
import { buildScenery } from './scenery'

export type CameraMode = 'broadcast' | 'tee' | 'chase'

export type RangeShot = { points: TracePoint[]; landingIndex: number; handed: 'RH' | 'LH'; ballSpeed: number; club: string | null }

export type FrameInfo = { landing: { x: number; y: number } | null; rest: { x: number; y: number } | null }

const BALL_RADIUS = 0.0233
const TEE_CAMERA = new THREE.Vector3(0.15, 1.75, 5.5)
const TEE_LOOK = new THREE.Vector3(0, 1.2, -40)
const flagColors = [0xe63b2e, 0xffffff, 0x2c6fd6, 0xf2c230, 0xe63b2e, 0xffffff, 0x2c6fd6]

/** A flight sample in scene space: x right, y up (yards, never below the turf), z toward the golfer (target is −z). */
const toScene = (point: TracePoint) => new THREE.Vector3(point.z, Math.max(0, point.y / 3) + BALL_RADIUS, -point.x)

function sampleAt(points: TracePoint[], t: number) {
  if (t <= points[0].t) return { position: toScene(points[0]), index: 0 }
  for (let index = 1; index < points.length; index++) {
    if (points[index].t >= t) {
      const before = points[index - 1]
      const share = (t - before.t) / Math.max(1e-6, points[index].t - before.t)
      return { position: toScene(before).lerp(toScene(points[index]), share), index }
    }
  }
  return { position: toScene(points[points.length - 1]), index: points.length - 1 }
}

function stripeTexture(renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')!
  context.fillStyle = '#4f8a3a'
  context.fillRect(0, 0, 128, 256)
  context.fillStyle = '#5c9a43'
  context.fillRect(128, 0, 128, 256)
  for (let index = 0; index < 2600; index++) {
    context.fillStyle = `rgba(${Math.random() < 0.5 ? '30,60,20' : '140,190,100'},${0.05 + Math.random() * 0.08})`
    context.fillRect(Math.random() * 256, Math.random() * 256, 2, 2 + Math.random() * 4)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(100, 60)
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

function textTexture(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const context = canvas.getContext('2d')!
  context.fillStyle = '#f7f5ee'
  context.fillRect(0, 0, 256, 128)
  context.strokeStyle = '#1f4d2b'
  context.lineWidth = 10
  context.strokeRect(5, 5, 246, 118)
  context.fillStyle = '#1f4d2b'
  context.font = 'bold 76px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 128, 70)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function skyDome() {
  const geometry = new THREE.SphereGeometry(1400, 32, 16)
  const colors: number[] = []
  const top = new THREE.Color(0x4f86c6)
  const horizon = new THREE.Color(0xd3e4f1)
  const position = geometry.getAttribute('position')
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index++) {
    const height = Math.max(0, position.getY(index) / 1400)
    color.copy(horizon).lerp(top, Math.pow(height, 0.55))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
}

/** A small burst of turf that flies up and fades over half a second. */
function createBurst(scene: THREE.Scene, colorHex: number) {
  const count = 36
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities: THREE.Vector3[] = []
  for (let index = 0; index < count; index++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1.5 + Math.random() * 3
    velocities.push(new THREE.Vector3(Math.cos(angle) * speed * 0.6, 2 + Math.random() * 3, Math.sin(angle) * speed * 0.6))
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color: colorHex, size: 0.09, transparent: true, depthWrite: false })
  const points = new THREE.Points(geometry, material)
  points.visible = false
  scene.add(points)
  return {
    update(origin: THREE.Vector3, age: number, scale: number) {
      const life = 0.6
      points.visible = age >= 0 && age < life
      if (!points.visible) return
      for (let index = 0; index < count; index++) {
        const velocity = velocities[index]
        positions[index * 3] = origin.x + velocity.x * age * scale
        positions[index * 3 + 1] = Math.max(0.02, origin.y + (velocity.y * age - 4.9 * age * age) * scale)
        positions[index * 3 + 2] = origin.z + velocity.z * age * scale
      }
      geometry.attributes.position.needsUpdate = true
      material.size = 0.09 * scale
      material.opacity = 1 - age / life
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}

/** A driving range in yards (target toward −z) that replays one shot: swing, strike, tracer, landing and roll. */
export function createRangeScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xd3e4f1, 180, 1000)
  scene.add(skyDome())
  scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x3d5a2a, 1.1))
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4)
  sun.position.set(-30, 60, 25)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 140 })
  sun.shadow.bias = -0.0005
  scene.add(sun, sun.target)

  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(item: T) => { disposables.push(item); return item }

  const turf = track(stripeTexture(renderer))
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(2000, 1200)), track(new THREE.MeshStandardMaterial({ map: turf, roughness: 1 })))
  ground.rotation.x = -Math.PI / 2
  ground.position.z = -400
  ground.receiveShadow = true
  scene.add(ground)

  const mat = new THREE.Mesh(track(new THREE.BoxGeometry(1.9, 0.03, 2.2)), track(new THREE.MeshStandardMaterial({ color: 0x2e6b35, roughness: 0.95 })))
  mat.position.set(-0.35, 0.015, 0.1)
  mat.receiveShadow = true
  scene.add(mat)
  const strip = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.032, 2.2)), track(new THREE.MeshStandardMaterial({ color: 0x3f8a46, roughness: 0.9 })))
  strip.position.set(0, 0.016, 0.1)
  strip.receiveShadow = true
  scene.add(strip)

  const ballGeometry = track(new THREE.SphereGeometry(BALL_RADIUS, 20, 14))
  const ballMaterial = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x222222 }))
  const bucket = new THREE.Mesh(track(new THREE.CylinderGeometry(0.17, 0.13, 0.28, 18, 1, true)), track(new THREE.MeshStandardMaterial({ color: 0x2b5fb3, roughness: 0.6, side: THREE.DoubleSide })))
  bucket.position.set(-1.55, 0.17, 0.95)
  bucket.castShadow = true
  scene.add(bucket)
  for (let index = 0; index < 26; index++) {
    const spare = new THREE.Mesh(ballGeometry, ballMaterial)
    const angle = index * 2.4
    const radius = 0.11 * Math.sqrt((index % 13) / 13)
    spare.position.set(-1.55 + Math.cos(angle) * radius, 0.27 + (index > 12 ? 0.045 : 0), 0.95 + Math.sin(angle) * radius)
    spare.scale.setScalar(1.9)
    scene.add(spare)
  }

  const flagGroup = new THREE.Group()
  scene.add(flagGroup)
  const scenery = track(buildScenery(scene, renderer))
  const treeTrunks = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.5, 0.7, 4, 6)), track(new THREE.MeshStandardMaterial({ color: 0x5a4330 })), 260)
  const treeTops = new THREE.InstancedMesh(track(new THREE.ConeGeometry(4.5, 12, 7)), track(new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 })), 260)
  scene.add(treeTrunks, treeTops)

  const ball = new THREE.Mesh(ballGeometry, ballMaterial)
  ball.castShadow = true
  scene.add(ball)
  const haloCanvas = document.createElement('canvas')
  haloCanvas.width = haloCanvas.height = 64
  const haloContext = haloCanvas.getContext('2d')!
  const gradient = haloContext.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,214,140,0.9)')
  gradient.addColorStop(0.6, 'rgba(255,110,60,0.35)')
  gradient.addColorStop(1, 'rgba(255,90,40,0)')
  haloContext.fillStyle = gradient
  haloContext.fillRect(0, 0, 64, 64)
  const haloTexture = track(new THREE.CanvasTexture(haloCanvas))
  const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: haloTexture, transparent: true, depthWrite: false })))
  scene.add(halo)
  const shadow = new THREE.Mesh(track(new THREE.CircleGeometry(1, 20)), track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })))
  shadow.rotation.x = -Math.PI / 2
  scene.add(shadow)

  const tracerGeometry = track(new LineGeometry())
  const glowGeometry = track(new LineGeometry())
  const tracerMaterial = track(new LineMaterial({ color: 0xff4d2e, linewidth: 3.5, worldUnits: false }))
  const glowMaterial = track(new LineMaterial({ color: 0xffffff, linewidth: 10, worldUnits: false, transparent: true, opacity: 0.28, depthWrite: false }))
  let tracer: Line2 | null = null
  let glow: Line2 | null = null

  const landingRing = new THREE.Mesh(track(new THREE.RingGeometry(0.8, 1.1, 40)), track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide })))
  landingRing.rotation.x = -Math.PI / 2
  scene.add(landingRing)
  const restDot = new THREE.Mesh(track(new THREE.RingGeometry(0.25, 0.45, 32)), track(new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false, side: THREE.DoubleSide })))
  restDot.rotation.x = -Math.PI / 2
  scene.add(restDot)

  const strike = track(createBurst(scene, 0x6b8f3e))
  const touchdown = track(createBurst(scene, 0x8a7a4a))

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 3000)
  let golfer: { root: THREE.Object3D; pose(clock: number): void; setAmplitude(value: number): void; dispose(): void } = createGolfer('RH')
  let disposed = false
  scene.add(golfer.root)

  let shot: RangeShot | null = null
  let onReady: (() => void) | null = null
  let landing = new THREE.Vector3()
  let rest = new THREE.Vector3()
  let width = 1
  let height = 1

  function buildRange(reach: number) {
    for (const child of [...flagGroup.children]) {
      flagGroup.remove(child)
      child.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const material = object.material as THREE.MeshStandardMaterial
          material.map?.dispose()
          material.dispose()
        }
      })
    }
    const distances = [50, 100, 150, 200, 250, 300, 350].filter(distance => distance <= Math.max(150, reach + 60))
    const offsets = [-12, 10, -8, 14, -10, 7, -5]
    distances.forEach((distance, index) => {
      const x = offsets[index]
      const radius = 6 + distance * 0.025
      const fringe = new THREE.Mesh(new THREE.CircleGeometry(radius + 2.2, 40), new THREE.MeshStandardMaterial({ color: 0x5a9a3e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }))
      fringe.rotation.x = -Math.PI / 2
      fringe.position.set(x, 0.01, -distance)
      fringe.receiveShadow = true
      const green = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshStandardMaterial({ color: 0x86c45f, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }))
      green.rotation.x = -Math.PI / 2
      green.position.set(x, 0.02, -distance)
      green.receiveShadow = true
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }))
      pole.position.set(x, 1.3, -distance)
      const shape = new THREE.Shape()
      shape.moveTo(0, 0)
      shape.lineTo(0.9, -0.3)
      shape.lineTo(0, -0.6)
      const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: flagColors[index], side: THREE.DoubleSide, roughness: 0.8 }))
      flag.position.set(x + 0.03, 2.6, -distance)
      const board = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 0.25), new THREE.MeshStandardMaterial({ map: textTexture(String(distance)), roughness: 0.7 }))
      board.position.set(-34, 2.6, -distance)
      board.rotation.y = 0.35
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.5, 0.25), new THREE.MeshStandardMaterial({ color: 0x3b3b3b }))
      post.position.set(-34, 0.75, -distance)
      flagGroup.add(fringe, green, pole, flag, board, post)
    })
    const count = 0
    treeTrunks.count = treeTops.count = count
    treeTrunks.instanceMatrix.needsUpdate = treeTops.instanceMatrix.needsUpdate = true
    if (treeTops.instanceColor) treeTops.instanceColor.needsUpdate = true
  }

  function setShot(next: RangeShot) {
    shot = next
    if (golfer) { scene.remove(golfer.root); golfer.dispose() }
    const amplitude = Math.max(0.18, Math.min(1, next.ballSpeed / 140))
    golfer = createGolfer(next.handed)
    golfer.setAmplitude(amplitude)
    scene.add(golfer.root)
    loadGolfAssets().then(assets => {
      if (disposed || shot !== next) return
      const rigged = createRiggedGolfer(assets, next.handed, clubModelFor(next.club))
      rigged.setAmplitude(amplitude)
      scene.remove(golfer.root)
      golfer.dispose()
      golfer = rigged
      scene.add(golfer.root)
      onReady?.()
    }).catch(() => undefined)
    const positions = next.points.flatMap(point => { const v = toScene(point); return [v.x, v.y, v.z] })
    if (tracer) scene.remove(tracer)
    if (glow) scene.remove(glow)
    tracerGeometry.setPositions(positions)
    glowGeometry.setPositions(positions)
    tracer = new Line2(tracerGeometry, tracerMaterial)
    glow = new Line2(glowGeometry, glowMaterial)
    tracer.computeLineDistances()
    scene.add(glow, tracer)
    landing = toScene(next.points[next.landingIndex])
    rest = toScene(next.points[next.points.length - 1])
    const reach = Math.max(...next.points.map(point => point.x))
    buildRange(reach)
    scenery.setReach(reach)
  }

  function resize(nextWidth: number, nextHeight: number, ratio: number) {
    width = nextWidth
    height = nextHeight
    renderer.setPixelRatio(Math.min(2, ratio))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    tracerMaterial.resolution.set(width, height)
    glowMaterial.resolution.set(width, height)
  }

  const look = new THREE.Vector3()
  const scratch = new THREE.Vector3()

  function placeCamera(mode: CameraMode, clock: number, ballPosition: THREE.Vector3) {
    if (!shot) return
    const points = shot.points
    const landTime = points[shot.landingIndex].t
    const carry = -landing.z
    if (clock <= 0 || mode === 'tee' || (mode === 'broadcast' && (carry < 45 || clock < landTime - Math.min(2.2, landTime * 0.45)))) {
      camera.position.copy(TEE_CAMERA)
      const follow = clock <= 0 ? 0 : Math.min(1, clock / 0.6)
      look.copy(TEE_LOOK).lerp(scratch.copy(ballPosition).setY(Math.max(ballPosition.y, 0.6)), mode === 'tee' ? follow * 0.75 : follow)
      camera.fov = 45
    } else if (mode === 'broadcast') {
      const side = landing.x >= 0 ? 1 : -1
      camera.position.set(landing.x + side * 22, 7.5, landing.z + 32)
      look.copy(clock < landTime ? ballPosition : rest).lerp(landing, 0.25)
      camera.fov = 38
    } else {
      const lag = sampleAt(points, Math.max(0, clock - 0.25)).position
      const direction = scratch.copy(ballPosition).sub(lag).setY(0)
      if (direction.lengthSq() < 1e-4) direction.set(0, 0, -1)
      direction.normalize()
      camera.position.copy(lag).addScaledVector(direction, -6).add(new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(1.6)).setY(Math.max(lag.y, 0) + 2.2)
      look.copy(ballPosition).addScaledVector(direction, 2)
      camera.fov = 55
    }
    camera.updateProjectionMatrix()
    camera.lookAt(look)
  }

  function project(point: THREE.Vector3) {
    const projected = point.clone().project(camera)
    if (projected.z > 1 || projected.z < -1) return null
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height }
  }

  /** Draws the replay at `clock` seconds (impact at 0, the swing starts at −SWING_LEAD). */
  function render(clock: number, mode: CameraMode): FrameInfo {
    if (!shot) { renderer.render(scene, camera); return { landing: null, rest: null } }
    golfer.pose(clock)
    const t = Math.max(0, clock)
    const { position, index } = sampleAt(shot.points, t)
    ball.position.copy(position)
    const landTime = shot.points[shot.landingIndex].t
    const end = shot.points[shot.points.length - 1].t
    placeCamera(mode, clock, position)
    const distance = camera.position.distanceTo(position)
    const radius = Math.max(BALL_RADIUS, distance * 0.0042)
    ball.scale.setScalar(radius / BALL_RADIUS)
    halo.position.copy(position)
    halo.visible = clock > 0 && t < end
    halo.scale.setScalar(radius * 10)
    const heightAbove = Math.max(0, position.y - BALL_RADIUS)
    shadow.position.set(position.x, 0.03, position.z)
    shadow.scale.setScalar(radius * 1.2 * (1 + heightAbove * 0.02))
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 / (1 + heightAbove * 0.08)
    const segments = clock <= 0 ? 0 : Math.max(0, index - 1)
    tracerGeometry.instanceCount = segments
    glowGeometry.instanceCount = segments
    const landed = t >= landTime
    landingRing.visible = landed
    landingRing.position.set(landing.x, 0.05, landing.z)
    const ringAge = t - landTime
    landingRing.scale.setScalar(Math.max(0.6, Math.min(1, 0.6 + ringAge * 2)) * Math.max(0.35, camera.position.distanceTo(landing) / 90))
    ;(landingRing.material as THREE.MeshBasicMaterial).opacity = landed ? 0.85 : 0
    restDot.visible = t >= end - 1e-6 && clock > 0
    restDot.position.set(rest.x, 0.05, rest.z)
    restDot.scale.setScalar(Math.max(0.35, camera.position.distanceTo(rest) / 90))
    strike.update(new THREE.Vector3(0, 0.03, 0), clock, 0.35)
    touchdown.update(landing, t - landTime, Math.max(0.6, -landing.z / 140))
    renderer.render(scene, camera)
    return { landing: landed ? project(landing) : null, rest: restDot.visible ? project(rest) : null }
  }

  return {
    setShot,
    resize,
    render,
    lead: SWING_LEAD,
    onReady(callback: () => void) { onReady = callback },
    dispose() {
      disposed = true
      golfer.dispose()
      for (const item of disposables) item.dispose()
      flagGroup.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose() } })
      scene.traverse(object => { if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial && object.geometry instanceof THREE.SphereGeometry) { object.geometry.dispose(); object.material.dispose() } })
      renderer.dispose()
    },
  }
}

export type RangeSceneApi = ReturnType<typeof createRangeScene>
