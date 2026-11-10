/** Arena factory: the dirt floor with ruts and a normal map, the concrete barrier ring (with the collider boxes to match), bleachers with a built crowd, pennant strings, fair tents, light towers and a turning ferris wheel; no rules, only shapes. `fitToLot` trims the floor to the derby's lot and drops the fair dressing once the Thrill Park scenery stands around it. */
import * as THREE from 'three/webgpu'
import type { ModuleConfig } from '../config'
import { createCrowd, type Seat } from './Crowd'
import { normalFromHeight } from './Textures'

const { float, fract, instanceIndex, positionLocal, sin, time: shaderTime, vec3 } = THREE.TSL

export interface BarrierBox {
  position: THREE.Vector3
  half: THREE.Vector3
}

export interface ArenaModel {
  root: THREE.Group
  barriers: BarrierBox[]
  /** Advances the ferris wheel and the crowd sway. */
  update(dt: number): void
  /** Shrinks the dirt floor to the lot (arena metres) and hides the fair tents, ferris wheel and grass ring, for when a park surrounds the pad. */
  fitToLot(lot: { x0: number; x1: number; z0: number; z1: number }): void
  dispose(): void
}

function dirtTexture(size: number, light: string, dark: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, size, size)
  let state = 1234567
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < 9000; i++) {
    const radius = 1 + random() * 9
    ctx.globalAlpha = 0.05 + random() * 0.12
    ctx.fillStyle = random() < 0.55 ? dark : '#b89770'
    ctx.beginPath()
    ctx.arc(random() * size, random() * size, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 0.18
  ctx.strokeStyle = dark
  ctx.lineCap = 'round'
  for (let i = 0; i < 90; i++) {
    ctx.lineWidth = 6 + random() * 10
    ctx.beginPath()
    let x = random() * size
    let y = random() * size
    ctx.moveTo(x, y)
    const angle = random() * Math.PI * 2
    for (let step = 0; step < 6; step++) {
      x += Math.cos(angle + (random() - 0.5) * 0.8) * (40 + random() * 60)
      y += Math.sin(angle + (random() - 0.5) * 0.8) * (40 + random() * 60)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 2500; i++) {
    ctx.globalAlpha = 0.35 + random() * 0.4
    ctx.fillStyle = random() < 0.5 ? '#d8c39a' : '#5a4027'
    ctx.beginPath()
    ctx.arc(random() * size, random() * size, 0.6 + random() * 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const turned = document.createElement('canvas')
  turned.width = 256
  turned.height = 512
  const turnedCtx = turned.getContext('2d', { willReadFrequently: true })
  if (!turnedCtx) throw new Error('Canvas 2D is not available')
  turnedCtx.setTransform(0, 1, -1, 0, 256, 0)
  turnedCtx.drawImage(canvas, 0, 0)
  const texture = new THREE.CanvasTexture(turned)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / 0.85, 1 / 3)
  texture.anisotropy = 8
  return texture
}

/** The pad's top layer: the dirt plus darker watered patches (fairs wet the pad down), and a matching roughness map that makes the wet mud shine. */
function padTextures(dirt: HTMLCanvasElement, seed: number): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = dirt.width
  const colour = document.createElement('canvas')
  colour.width = size
  colour.height = size
  const ctx = colour.getContext('2d')
  const wet = document.createElement('canvas')
  wet.width = size
  wet.height = size
  const wetCtx = wet.getContext('2d')
  if (!ctx || !wetCtx) throw new Error('Canvas 2D is not available')
  ctx.drawImage(dirt, 0, 0)
  wetCtx.fillStyle = 'rgb(242,242,242)'
  wetCtx.fillRect(0, 0, size, size)
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < 22; i++) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.04 + random() * 0.12)
    for (let k = 0; k < 6; k++) {
      const ox = x + (random() - 0.5) * radius
      const oy = y + (random() - 0.5) * radius
      const r = radius * (0.4 + random() * 0.6)
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r)
      g.addColorStop(0, 'rgba(70,46,24,0.2)')
      g.addColorStop(0.7, 'rgba(70,46,24,0.09)')
      g.addColorStop(1, 'rgba(58,38,20,0)')
      ctx.fillStyle = g
      ctx.fillRect(ox - r, oy - r, r * 2, r * 2)
      const w = wetCtx.createRadialGradient(ox, oy, 0, ox, oy, r)
      w.addColorStop(0, 'rgba(120,120,120,0.7)')
      w.addColorStop(1, 'rgba(120,120,120,0)')
      wetCtx.fillStyle = w
      wetCtx.fillRect(ox - r, oy - r, r * 2, r * 2)
    }
  }
  const map = new THREE.CanvasTexture(colour)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.anisotropy = 16
  const roughness = new THREE.CanvasTexture(wet)
  roughness.wrapS = THREE.RepeatWrapping
  roughness.wrapT = THREE.RepeatWrapping
  return { map, roughness }
}

/** Weathered precast concrete: speckle, stains running down from the top, and black rubber scuffs low on the face. */
function concreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = '#cdc8bc'
  ctx.fillRect(0, 0, 512, 256)
  let state = 4242
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < 9000; i++) {
    const shade = 150 + random() * 90
    ctx.fillStyle = `rgba(${shade},${shade - 4},${shade - 12},${0.15 + random() * 0.3})`
    ctx.fillRect(random() * 512, random() * 256, 1 + random() * 2, 1 + random() * 2)
  }
  for (let i = 0; i < 40; i++) {
    const x = random() * 512
    const g = ctx.createLinearGradient(0, 0, 0, 120 + random() * 120)
    g.addColorStop(0, 'rgba(90,80,64,0.22)')
    g.addColorStop(1, 'rgba(90,80,64,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, 0, 4 + random() * 16, 256)
  }
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = `rgba(20,20,20,${0.12 + random() * 0.25})`
    ctx.lineWidth = 2 + random() * 8
    ctx.beginPath()
    const y = 170 + random() * 70
    const x = random() * 512
    ctx.moveTo(x, y)
    ctx.lineTo(x + 30 + random() * 120, y + (random() - 0.5) * 20)
    ctx.stroke()
  }
  const turned = document.createElement('canvas')
  turned.width = 256
  turned.height = 512
  const turnedCtx = turned.getContext('2d', { willReadFrequently: true })
  if (!turnedCtx) throw new Error('Canvas 2D is not available')
  turnedCtx.setTransform(0, 1, -1, 0, 256, 0)
  turnedCtx.drawImage(canvas, 0, 0)
  const texture = new THREE.CanvasTexture(turned)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / 0.85, 1 / 3)
  texture.anisotropy = 8
  return texture
}

function hazardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = '#d8d3c6'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#f0a21a'
  for (let x = -64; x < 256; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 64)
    ctx.lineTo(x + 32, 64)
    ctx.lineTo(x + 64, 0)
    ctx.lineTo(x + 32, 0)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(60,50,40,.25)'
  for (let i = 0; i < 160; i++) ctx.fillRect(Math.random() * 256, 40 + Math.random() * 24, 2 + Math.random() * 6, 1 + Math.random() * 3)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

function jerseyBarrier(length: number, height: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const half = thickness / 2
  shape.moveTo(-half, 0)
  shape.lineTo(half, 0)
  shape.lineTo(half, height * 0.3)
  shape.lineTo(half * 0.45, height * 0.72)
  shape.lineTo(half * 0.4, height)
  shape.lineTo(-half * 0.4, height)
  shape.lineTo(-half * 0.45, height * 0.72)
  shape.lineTo(-half, height * 0.3)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  geometry.translate(0, 0, -length / 2)
  return geometry
}

export function createArena(config: ModuleConfig['arena'], crowdSeed = 7, dirtSize = config.dirtTexture): ArenaModel {
  const root = new THREE.Group()
  root.name = 'arena'
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(resource: T): T => {
    disposables.push(resource)
    return resource
  }

  const dirt = own(dirtTexture(dirtSize, config.groundColor, config.groundDark))
  dirt.repeat.set(config.groundSize / 18, config.groundSize / 18)
  const dirtNormal = own(normalFromHeight(dirt.image as HTMLCanvasElement, 1.6))
  dirtNormal.repeat.copy(dirt.repeat)
  const groundMaterial = own(new THREE.MeshStandardMaterial({ map: dirt, normalMap: dirtNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.96, metalness: 0 }))
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(config.groundSize, config.groundSize)), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.name = 'dirt'
  root.add(ground)

  const grassMaterial = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#5f7d3a'), roughness: 1 }))
  const outfield = new THREE.Mesh(own(new THREE.RingGeometry(config.groundSize * 0.42, config.groundSize * 0.75, 48)), grassMaterial)
  outfield.rotation.x = -Math.PI / 2
  outfield.position.y = -0.02
  root.add(outfield)

  const innerNormal = own(normalFromHeight(dirt.image as HTMLCanvasElement, 2.2))
  innerNormal.repeat.set((config.length + 2) / 12, (config.width + 2) / 12)
  const pad = padTextures(dirt.image as HTMLCanvasElement, crowdSeed * 31 + 5)
  const innerMap = own(pad.map)
  innerMap.repeat.copy(innerNormal.repeat)
  const innerRoughness = own(pad.roughness)
  innerRoughness.repeat.copy(innerNormal.repeat)
  const inner = new THREE.Mesh(own(new THREE.PlaneGeometry(config.length + 2, config.width + 2)), own(new THREE.MeshStandardMaterial({ map: innerMap, normalMap: innerNormal, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: innerRoughness, roughness: 1, color: new THREE.Color('#cfae84'), envMapIntensity: 0.6 })))
  inner.rotation.x = -Math.PI / 2
  inner.position.y = 0.005
  inner.receiveShadow = true
  root.add(inner)

  const barriers: BarrierBox[] = []
  const hazard = own(hazardTexture())
  const concreteMap = own(concreteTexture())
  const concreteNormal = own(normalFromHeight(concreteMap.image as HTMLCanvasElement, 1.4))
  concreteNormal.repeat.copy(concreteMap.repeat)
  const concrete = own(new THREE.MeshStandardMaterial({ map: concreteMap, normalMap: concreteNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.93, metalness: 0 }))
  const stripe = own(new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.9 }))
  const segmentGeometry = own(jerseyBarrier(config.barrierSegment - 0.04, config.barrierHeight, config.barrierThickness))
  const halfL = config.length / 2
  const halfW = config.width / 2
  const sides: { from: THREE.Vector3; to: THREE.Vector3 }[] = [
    { from: new THREE.Vector3(-halfL, 0, -halfW), to: new THREE.Vector3(halfL, 0, -halfW) },
    { from: new THREE.Vector3(halfL, 0, -halfW), to: new THREE.Vector3(halfL, 0, halfW) },
    { from: new THREE.Vector3(halfL, 0, halfW), to: new THREE.Vector3(-halfL, 0, halfW) },
    { from: new THREE.Vector3(-halfL, 0, halfW), to: new THREE.Vector3(-halfL, 0, -halfW) },
  ]
  const barrierGroup = new THREE.Group()
  barrierGroup.name = 'barriers'
  for (const side of sides) {
    const direction = side.to.clone().sub(side.from)
    const length = direction.length()
    direction.normalize()
    const count = Math.round(length / config.barrierSegment)
    const yaw = Math.atan2(direction.x, direction.z)
    for (let i = 0; i < count; i++) {
      const centre = side.from.clone().add(direction.clone().multiplyScalar((i + 0.5) * (length / count)))
      const segment = new THREE.Mesh(segmentGeometry, i % 3 === 1 ? stripe : concrete)
      segment.position.copy(centre)
      segment.rotation.y = yaw
      segment.castShadow = true
      segment.receiveShadow = true
      barrierGroup.add(segment)
    }
    const normal = new THREE.Vector3(direction.z, 0, -direction.x)
    const centre = side.from.clone().add(side.to).multiplyScalar(0.5)
    const half = new THREE.Vector3()
    if (Math.abs(normal.x) > 0.5) half.set(config.barrierThickness / 2, config.barrierHeight / 2, length / 2 + config.barrierThickness / 2)
    else half.set(length / 2 + config.barrierThickness / 2, config.barrierHeight / 2, config.barrierThickness / 2)
    barriers.push({ position: new THREE.Vector3(centre.x, config.barrierHeight / 2, centre.z), half })
  }
  root.add(barrierGroup)

  const tireMaterial = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1a1a'), roughness: 0.9 }))
  const tireGeometry = own(new THREE.TorusGeometry(0.36, 0.14, 14, 36))
  const tires = new THREE.InstancedMesh(tireGeometry, tireMaterial, 48)
  const tireMatrix = new THREE.Matrix4()
  let tireIndex = 0
  for (const corner of [
    [-halfL, -halfW],
    [halfL, -halfW],
    [halfL, halfW],
    [-halfL, halfW],
  ]) {
    for (let i = 0; i < 12; i++) {
      const stackX = corner[0] + Math.sign(-corner[0]) * (1 + (i % 4) * 0.8)
      const stackZ = corner[1] + Math.sign(-corner[1]) * (1 + Math.floor(i / 4) * 0.8)
      tireMatrix.makeRotationX(Math.PI / 2)
      tireMatrix.setPosition(stackX, 0.15 + (i % 2) * 0.28, stackZ)
      tires.setMatrixAt(tireIndex++, tireMatrix)
    }
  }
  tires.instanceMatrix.needsUpdate = true
  tires.castShadow = true
  tires.receiveShadow = true
  root.add(tires)

  const standGroup = new THREE.Group()
  standGroup.name = 'grandstand'
  const standWood = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#8b6a46'), roughness: 0.9 }))
  const standSteel = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f47'), roughness: 0.6, metalness: 0.5 }))
  const rowDepth = 0.9
  const rowRise = 0.42
  const standWidth = config.length + 6
  const standZ = halfW + 4.5
  for (let row = 0; row < config.grandstandRows; row++) {
    const bench = new THREE.Mesh(own(new THREE.BoxGeometry(standWidth, 0.12, rowDepth)), standWood)
    bench.position.set(0, rowRise * (row + 1), standZ + rowDepth * row)
    bench.castShadow = true
    bench.receiveShadow = true
    standGroup.add(bench)
    const riser = new THREE.Mesh(own(new THREE.BoxGeometry(standWidth, rowRise, 0.08)), standSteel)
    riser.position.set(0, rowRise * (row + 0.5), standZ + rowDepth * row - rowDepth / 2)
    standGroup.add(riser)
  }
  const seats: Seat[] = []
  let state = crowdSeed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let row = 0; row < config.grandstandRows; row++) {
    for (let seat = 0; seat < config.grandstandSeats; seat++) {
      if (random() < 0.1) continue
      const x = -standWidth / 2 + 0.6 + (seat + 0.5) * ((standWidth - 1.2) / config.grandstandSeats) + (random() - 0.5) * 0.25
      const y = rowRise * (row + 1) + 0.06
      const z = standZ + rowDepth * row + 0.2
      seats.push({ x, y, z, yaw: Math.PI })
    }
  }
  const crowd = own(createCrowd(seats, { shirts: config.crowdColors, skins: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a1665e', '#5c3a21'], pants: ['#1f2a44', '#2b2b2b', '#3d405b', '#4a4e69', '#5e503f', '#2f3e46', '#6b705c'], caps: config.crowdColors }, crowdSeed))
  standGroup.add(crowd.root)
  const roofPosts = new THREE.Group()
  for (let i = -2; i <= 2; i++) {
    const post = new THREE.Mesh(own(new THREE.CylinderGeometry(0.08, 0.08, 6, 8)), standSteel)
    post.position.set((i * standWidth) / 4.4, 3, standZ + rowDepth * config.grandstandRows + 0.4)
    roofPosts.add(post)
  }
  const canopy = new THREE.Mesh(own(new THREE.BoxGeometry(standWidth + 1, 0.12, rowDepth * config.grandstandRows + 1.5)), own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f6ea8'), roughness: 0.8 })))
  canopy.position.set(0, 6.1, standZ + (rowDepth * config.grandstandRows) / 2)
  canopy.rotation.x = -0.06
  canopy.castShadow = true
  standGroup.add(roofPosts, canopy)
  root.add(standGroup)

  const tents = new THREE.Group()
  tents.name = 'fairgrounds'
  const tentColors = ['#f0e7d2', '#c92f2a', '#2d5aa3', '#f0c23a']
  for (let i = 0; i < 7; i++) {
    const tent = new THREE.Group()
    const w = 5 + (i % 3) * 1.5
    const walls = new THREE.Mesh(own(new THREE.BoxGeometry(w, 2.4, w * 0.8)), own(new THREE.MeshStandardMaterial({ color: new THREE.Color(tentColors[i % tentColors.length]), roughness: 0.9 })))
    walls.position.y = 1.2
    const roof = new THREE.Mesh(own(new THREE.ConeGeometry(w * 0.75, 1.8, 4)), own(new THREE.MeshStandardMaterial({ color: new THREE.Color(i % 2 ? '#f5f0e2' : '#d33a33'), roughness: 0.9 })))
    roof.position.y = 3.3
    roof.rotation.y = Math.PI / 4
    tent.add(walls, roof)
    const angle = -0.4 - i * 0.28
    tent.position.set(Math.cos(angle) * 58, 0, Math.sin(angle) * 58 - 6)
    tent.rotation.y = -angle
    tents.add(tent)
  }
  root.add(tents)

  const wheelGroup = new THREE.Group()
  wheelGroup.name = 'ferris-wheel'
  const wheelRadius = 11
  const spokeMaterial = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8e4da'), roughness: 0.6, metalness: 0.4 }))
  const rim = new THREE.Mesh(own(new THREE.TorusGeometry(wheelRadius, 0.18, 8, 48)), spokeMaterial)
  wheelGroup.add(rim)
  const gondolaGeometry = own(new THREE.BoxGeometry(1.3, 1.1, 1.0))
  const gondolaColors = ['#e14b3b', '#f3c13a', '#3c9ad6', '#49b86b', '#ad5ad1']
  const gondolas: THREE.Mesh[] = []
  for (let i = 0; i < 12; i++) {
    const spoke = new THREE.Mesh(own(new THREE.CylinderGeometry(0.07, 0.07, wheelRadius, 6)), spokeMaterial)
    spoke.position.set(Math.cos((i / 12) * Math.PI * 2) * wheelRadius * 0.5, Math.sin((i / 12) * Math.PI * 2) * wheelRadius * 0.5, 0)
    spoke.rotation.z = (i / 12) * Math.PI * 2 + Math.PI / 2
    wheelGroup.add(spoke)
    const gondola = new THREE.Mesh(gondolaGeometry, own(new THREE.MeshStandardMaterial({ color: new THREE.Color(gondolaColors[i % gondolaColors.length]), roughness: 0.8 })))
    gondolas.push(gondola)
    wheelGroup.add(gondola)
  }
  const wheelMount = new THREE.Group()
  wheelMount.position.set(-34, wheelRadius + 2.5, -48)
  wheelMount.rotation.y = 0.5
  const legs = new THREE.Mesh(own(new THREE.ConeGeometry(4, wheelRadius + 2.5, 4, 1, true)), spokeMaterial)
  legs.position.y = -(wheelRadius + 2.5) / 2
  wheelMount.add(wheelGroup, legs)
  root.add(wheelMount)

  const poles = new THREE.Group()
  poles.name = 'light-towers'
  const poleMaterial = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#6c7076'), roughness: 0.7, metalness: 0.5 }))
  const lampMaterial = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#fff6dc'), emissive: new THREE.Color('#ffe9b8'), emissiveIntensity: 0.6 }))
  for (let i = 0; i < config.lightPoles; i++) {
    const x = (i % 2 ? 1 : -1) * (halfL + 3)
    const z = (i < 2 ? -1 : 1) * (halfW + 2.5)
    const pole = new THREE.Mesh(own(new THREE.CylinderGeometry(0.14, 0.2, 12, 8)), poleMaterial)
    pole.position.set(x, 6, z)
    pole.castShadow = true
    const head = new THREE.Mesh(own(new THREE.BoxGeometry(1.6, 0.5, 0.4)), lampMaterial)
    head.position.set(x, 12, z)
    head.lookAt(0, 2, 0)
    poles.add(pole, head)
  }
  root.add(poles)

  const pennantGeometry = own(new THREE.BufferGeometry())
  pennantGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.14, 0, 0, 0.14, 0, 0, 0, -0.42, 0], 3))
  pennantGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  pennantGeometry.setIndex([0, 1, 2])
  const pennantMaterial = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide }))
  const flap = sin(shaderTime.mul(4.2).add(fract(instanceIndex.toFloat().mul(0.37)).mul(6.28))).mul(positionLocal.y.negate()).mul(0.35)
  pennantMaterial.positionNode = positionLocal.add(vec3(float(0), float(0), flap))
  const poleTops: THREE.Vector3[] = []
  for (let i = 0; i < config.lightPoles; i++) poleTops.push(new THREE.Vector3((i % 2 ? 1 : -1) * (halfL + 3), 11.6, (i < 2 ? -1 : 1) * (halfW + 2.5)))
  const strings: [THREE.Vector3, THREE.Vector3][] = [[poleTops[0], poleTops[1]], [poleTops[2], poleTops[3]], [poleTops[0], poleTops[2]], [poleTops[1], poleTops[3]]]
  const perString = 28
  const pennants = new THREE.InstancedMesh(pennantGeometry, pennantMaterial, strings.length * perString)
  const pennantColors = ['#e63946', '#f1faee', '#ffb703', '#2a9d8f', '#3a86ff', '#ff006e']
  const color = new THREE.Color()
  const lineMaterial = own(new THREE.LineBasicMaterial({ color: new THREE.Color('#2b2b2b') }))
  let pennantIndex = 0
  for (const [from, to] of strings) {
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= perString; i++) {
      const t = i / perString
      const sag = Math.sin(t * Math.PI) * 1.6
      const point = from.clone().lerp(to, t)
      point.y -= sag
      points.push(point)
      if (i < perString) {
        const yaw = Math.atan2(to.x - from.x, to.z - from.z)
        tireMatrix.makeRotationY(yaw + Math.PI / 2)
        tireMatrix.setPosition(point)
        pennants.setMatrixAt(pennantIndex, tireMatrix)
        color.set(pennantColors[pennantIndex % pennantColors.length])
        pennants.setColorAt(pennantIndex, color)
        pennantIndex++
      }
    }
    root.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), lineMaterial))
  }
  pennants.instanceMatrix.needsUpdate = true
  if (pennants.instanceColor) pennants.instanceColor.needsUpdate = true
  pennants.frustumCulled = false
  root.add(pennants)

  let time = 0
  const wheelAngle = { value: 0 }
  const fitToLot = (lot: { x0: number; x1: number; z0: number; z1: number }): void => {
    const width = lot.x1 - lot.x0
    const depth = lot.z1 - lot.z0
    ground.scale.set(width / config.groundSize, depth / config.groundSize, 1)
    ground.position.set((lot.x0 + lot.x1) / 2, 0, (lot.z0 + lot.z1) / 2)
    dirt.repeat.set(width / 18, depth / 18)
    dirtNormal.repeat.copy(dirt.repeat)
    outfield.visible = false
    tents.visible = false
    wheelMount.visible = false
  }

  const update = (dt: number): void => {
    time += dt
    wheelAngle.value += dt * 0.12
    wheelGroup.rotation.z = wheelAngle.value
    gondolas.forEach((gondola, i) => {
      const angle = (i / 12) * Math.PI * 2 + wheelAngle.value
      gondola.position.set(Math.cos(angle) * wheelRadius, Math.sin(angle) * wheelRadius - 0.7, 0)
      gondola.rotation.z = -wheelAngle.value
    })
  }

  const dispose = (): void => {
    root.removeFromParent()
    for (const resource of disposables.reverse()) resource.dispose()
    tires.dispose()
    pennants.dispose()
  }

  return { root, barriers, update, fitToLot, dispose }
}
