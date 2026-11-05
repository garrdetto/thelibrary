/** Car model factory: a lofted 1970s full-size wagon or sedan (fender arches and flares, rocker and belt creases, hood crown, raked glass, pillars), chrome bumpers, sealed-beam lamps, grille, taillights, steel wheels, a dark caged interior, the spray-painted number decals and a contact shadow; one deformable vertex-coloured shell, all in the chassis frame (forward is -Z, origin `centreHeight` above the ground). */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintById, type BodySpec } from '../config'
import type { CarLook } from '../systems/Look'
import { paintNumber } from '../systems/Numbers'
import { bar, loft, mirror, roundedBox, type Profile, type Station } from './Loft'

export interface CarModel {
  root: THREE.Group
  body: THREE.Mesh
  decals: THREE.Mesh[]
  wheels: THREE.Mesh[]
  paint: THREE.MeshStandardMaterial
  shadow: THREE.Mesh
  /** Pushes the shell in around a point in the chassis frame along a direction, by a strength of 0–1. */
  dent(point: THREE.Vector3, direction: THREE.Vector3, strength: number, spec: DentSpec): void
  dispose(): void
}

export interface DentSpec {
  radius: number
  depth: number
  maxDepth: number
  darken: number
}

interface Deformable {
  geometry: THREE.BufferGeometry
  original: Float32Array
  colors: Float32Array | null
  baseColors: Float32Array | null
}

const scratch = new THREE.Vector3()
let shadowTexture: THREE.CanvasTexture | null = null
let grilleTexture: THREE.CanvasTexture | null = null

function hashNoise(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return value - Math.floor(value)
}

function smoothNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const sample = (dx: number, dy: number, dz: number) => hashNoise(ix + dx, iy + dy, iz + dz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t))
  return lerp(
    lerp(lerp(sample(0, 0, 0), sample(1, 0, 0), fx), lerp(sample(0, 1, 0), sample(1, 1, 0), fx), fy),
    lerp(lerp(sample(0, 0, 1), sample(1, 0, 1), fx), lerp(sample(0, 1, 1), sample(1, 1, 1), fx), fy),
    fz,
  )
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/** Piecewise-linear value over t in [0, 1]. */
function ramp(t: number, keys: readonly (readonly [t: number, value: number])[]): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
  }
  return keys[keys.length - 1][1]
}

interface BodyFrame {
  half: number
  noseZ: number
  tailZ: number
  cowlZ: number
  bZ: number
  cZ: number
  frontAxleZ: number
  rearAxleZ: number
  axleY: number
  archRadius: number
  y0: number
  aTopZ: number
  cTopZ: number
  tailGlassZ: number
}

function frameOf(spec: BodySpec): BodyFrame {
  const cowlZ = -spec.length / 2 + spec.cowl * spec.length
  const cTopZ = spec.length / 2 - spec.backlightRake - (spec.id === 'wagon' ? 0.12 : 0.55)
  return {
    aTopZ: cowlZ + spec.windshieldRake,
    cTopZ,
    tailGlassZ: cTopZ + spec.backlightRake,
    half: spec.width / 2,
    noseZ: -spec.length / 2,
    tailZ: spec.length / 2,
    cowlZ: -spec.length / 2 + spec.cowl * spec.length,
    bZ: -spec.length / 2 + spec.bPillar * spec.length,
    cZ: -spec.length / 2 + spec.cPillar * spec.length,
    frontAxleZ: -spec.wheelbase / 2,
    rearAxleZ: spec.wheelbase / 2,
    axleY: spec.wheelRadius,
    archRadius: spec.wheelRadius + 0.11,
    y0: spec.centreHeight,
  }
}

/** The lower body half profile at a station: floor centre, rocker, door, belt crease, shoulder, hood or deck centre. */
function lowerProfile(spec: BodySpec, frame: BodyFrame, z: number): Profile {
  const t = (z - frame.noseZ) / spec.length
  const deckT = (frame.tailGlassZ - frame.noseZ) / spec.length
  const taper = ramp(t, [
    [0, 0.9],
    [0.07, 1],
    [0.9, 1],
    [1, 0.94],
  ])
  const w = frame.half * taper
  const top = ramp(t, [
    [0, spec.noseTop],
    [0.12, spec.noseTop + 0.03],
    [spec.cowl - 0.02, spec.belt + 0.03],
    [spec.cowl, spec.belt + 0.02],
    [deckT, spec.belt + 0.02],
    [deckT + 0.03, spec.tailTop + 0.02],
    [1, spec.tailTop - 0.02],
  ])
  const crown = t < spec.cowl ? 0.05 : t > deckT + 0.03 ? 0.03 : 0.0
  let sill = spec.sill
  let flare = 0
  for (const axleZ of [frame.frontAxleZ, frame.rearAxleZ]) {
    const dz = z - axleZ
    if (Math.abs(dz) < frame.archRadius) {
      const arch = frame.axleY + Math.sqrt(frame.archRadius * frame.archRadius - dz * dz)
      sill = Math.max(sill, arch)
      flare = Math.max(flare, 0.035 * Math.cos((dz / frame.archRadius) * Math.PI * 0.5))
    } else if (Math.abs(dz) < frame.archRadius + 0.25) {
      flare = Math.max(flare, 0.035 * (1 - (Math.abs(dz) - frame.archRadius) / 0.25) * 0.5)
    }
  }
  const belt = Math.min(spec.belt, top)
  const rockerY = Math.min(Math.max(sill + 0.06, Math.min(sill + 0.1, belt - 0.2)), belt - 0.03)
  const doorY = Math.min(Math.max(rockerY + 0.02, belt - 0.16), belt - 0.015)
  const y0 = frame.y0
  return [
    [0, sill - y0],
    [w * 0.86, sill - y0],
    [w * 0.985 + flare, rockerY - y0],
    [w + flare, doorY - y0],
    [w * 0.99 + flare * 0.5, belt - y0],
    [w * 0.9, top - y0],
    [w * 0.5, top + crown * 0.8 - y0],
    [0, top + crown - y0],
  ]
}

/** The greenhouse ring, left belt up over the roof to the right belt: belt, window, roof edge, roof top, centre and back down. */
function upperRing(spec: BodySpec, frame: BodyFrame, z: number, collapse: number, inset = 0): Profile {
  const half = upperProfile(spec, frame, z, collapse).map(([x, y]) => [x * (1 - inset), y - inset * 0.8] as const)
  const [belt, window, edge, top, centre] = half
  return [[-belt[0], belt[1]], [-window[0], window[1]], [-edge[0], edge[1]], [-top[0], top[1]], centre, top, edge, window, belt]
}

/** The greenhouse half profile: belt, window, roof edge, roof top, roof centre. */
function upperProfile(spec: BodySpec, frame: BodyFrame, z: number, collapse: number): Profile {
  const t = (z - frame.noseZ) / spec.length
  const wg = frame.half * 0.93 * ramp(t, [
    [0, 1],
    [spec.cPillar, 1],
    [1, 0.96],
  ])
  const roof = spec.belt + (spec.roof - spec.belt) * (1 - collapse)
  const y0 = frame.y0
  const window = spec.belt + (roof - spec.belt) * 0.55
  return [
    [wg * 0.99, spec.belt - y0],
    [wg * 0.95, window - y0],
    [wg * 0.86, roof - 0.04 * (1 - collapse) - y0],
    [wg * 0.7, roof - y0],
    [0, roof + 0.015 - y0],
  ]
}

function buildShell(spec: BodySpec, frame: BodyFrame, seed: number): THREE.BufferGeometry {
  const stations: Station[] = []
  const seamZs = spec.seams.map((fraction) => frame.noseZ + fraction * spec.length)
  const zs = new Set<number>()
  for (let z = frame.noseZ; z <= frame.tailZ + 1e-6; z += 0.1) zs.add(Number(z.toFixed(3)))
  zs.add(frame.tailZ)
  for (const seam of seamZs) {
    zs.add(Number((seam - 0.012).toFixed(3)))
    zs.add(Number((seam + 0.012).toFixed(3)))
  }
  for (const axleZ of [frame.frontAxleZ, frame.rearAxleZ]) {
    for (let k = -4; k <= 4; k++) zs.add(Number((axleZ + (k / 4) * frame.archRadius).toFixed(3)))
  }
  const ordered = [...zs].sort((a, b) => a - b)
  const grime = (x: number, y: number, z: number) => 0.9 + 0.1 * smoothNoise(x * 2.2 + seed, y * 3.1, z * 1.4 + seed * 0.37)
  for (const z of ordered) {
    const profile = mirror(lowerProfile(spec, frame, z))
    const seamHere = seamZs.some((seam) => Math.abs(z - seam) < 0.02)
    const pointShade = profile.map(([x, y]) => {
      let shade = grime(x, y, z)
      if (y + frame.y0 < spec.sill + 0.12) shade *= 0.9
      if (seamHere && y + frame.y0 > spec.sill + 0.05 && y + frame.y0 < spec.belt + 0.01 && Math.abs(x) > frame.half * 0.6) shade *= 0.45
      return shade
    })
    stations.push({ z, profile, pointShade })
  }
  const noseCap: Station = { z: frame.noseZ - 0.001, profile: stations[0].profile.map(() => [0, (spec.sill + spec.noseTop) / 2 - frame.y0] as const), shade: 0.92 }
  const tailCap: Station = { z: frame.tailZ + 0.001, profile: stations[stations.length - 1].profile.map(() => [0, (spec.sill + spec.tailTop) / 2 - frame.y0] as const), shade: 0.92 }
  const shell = loft([noseCap, ...stations, tailCap], { closed: true })

  const { front, mid, back } = upperStations(spec, frame, 0)
  const roofStations = [front[front.length - 1], ...mid, back[0]].map((station) => ({ ...station, profile: station.profile.slice(2, 7) }))
  const roof = loft(roofStations, { closed: false })
  const merged = mergeGeometries([shell, roof], false)
  if (!merged) throw new Error('Could not build the car shell')
  return merged
}

function upperStations(spec: BodySpec, frame: BodyFrame, inset: number): { front: Station[]; mid: Station[]; back: Station[] } {
  const steps = 4
  const front: Station[] = []
  const mid: Station[] = []
  const back: Station[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const z = frame.cowlZ + 0.02 * inset * 10 + (frame.aTopZ - frame.cowlZ) * f
    front.push({ z, profile: upperRing(spec, frame, z, 1 - smoothstep(f * 0.85 + 0.15), inset), shade: 0.97 })
  }
  for (let z = frame.aTopZ + 0.15; z < frame.cTopZ - 0.05; z += 0.15) mid.push({ z, profile: upperRing(spec, frame, z, 0, inset), shade: 0.97 })
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const z = frame.cTopZ + (frame.tailGlassZ - frame.cTopZ) * f
    back.push({ z, profile: upperRing(spec, frame, z, smoothstep(f), inset), shade: 0.97 })
  }
  return { front, mid, back }
}

function buildGlass(spec: BodySpec, frame: BodyFrame): THREE.BufferGeometry {
  const { front, mid, back } = upperStations(spec, frame, 0.015)
  const sides = [front[front.length - 1], ...mid, back[0]]
  const left = sides.map((station) => ({ ...station, profile: station.profile.slice(0, 3) }))
  const right = sides.map((station) => ({ ...station, profile: station.profile.slice(6, 9) }))
  const parts = [loft(left, { closed: false }), loft(right, { closed: false }), loft(front, { closed: false }), loft(back, { closed: false })]
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('Could not build the glass')
  return merged
}

function pillars(spec: BodySpec, frame: BodyFrame): THREE.BufferGeometry {
  const y0 = frame.y0
  const wg = frame.half * 0.93
  const { aTopZ, cTopZ, tailGlassZ } = frame
  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    parts.push(bar(new THREE.Vector3(side * wg * 0.99, spec.belt - y0, frame.cowlZ + 0.04), new THREE.Vector3(side * wg * 0.86, spec.roof - 0.05 - y0, aTopZ), 0.045))
    parts.push(bar(new THREE.Vector3(side * wg * 0.985, spec.belt - y0, frame.bZ), new THREE.Vector3(side * wg * 0.87, spec.roof - 0.05 - y0, frame.bZ), 0.035))
    const cWidth = spec.id === 'wagon' ? 0.09 : 0.055
    parts.push(bar(new THREE.Vector3(side * wg * 0.97, spec.belt - y0, tailGlassZ - 0.04), new THREE.Vector3(side * wg * 0.86, spec.roof - 0.05 - y0, cTopZ), cWidth))
  }
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('Could not build the pillars')
  return merged
}

function cage(spec: BodySpec, frame: BodyFrame): THREE.BufferGeometry {
  const y0 = frame.y0
  const wg = frame.half * 0.8
  const aZ = frame.cowlZ + spec.windshieldRake * 0.9
  const cZ = frame.tailZ - spec.backlightRake - (spec.id === 'wagon' ? 0.2 : 0.6)
  const parts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    parts.push(bar(new THREE.Vector3(side * wg, spec.sill + 0.1 - y0, frame.bZ), new THREE.Vector3(side * wg, spec.roof - 0.1 - y0, frame.bZ), 0.025))
    parts.push(bar(new THREE.Vector3(side * wg, spec.roof - 0.1 - y0, aZ), new THREE.Vector3(side * wg, spec.roof - 0.1 - y0, cZ), 0.025))
    parts.push(bar(new THREE.Vector3(side * wg, spec.belt - 0.1 - y0, frame.cowlZ + 0.1), new THREE.Vector3(side * wg, spec.belt - 0.1 - y0, frame.cZ), 0.025))
  }
  parts.push(bar(new THREE.Vector3(-wg, spec.roof - 0.1 - y0, frame.bZ), new THREE.Vector3(wg, spec.roof - 0.1 - y0, frame.bZ), 0.025))
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('Could not build the cage')
  return merged
}

function tireGeometry(radius: number, width: number): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [
    new THREE.Vector2(radius * 0.62, -width / 2 + 0.01),
    new THREE.Vector2(radius * 0.84, -width / 2),
    new THREE.Vector2(radius * 0.96, -width / 2 + 0.01),
    new THREE.Vector2(radius, -width * 0.3),
    new THREE.Vector2(radius, width * 0.3),
    new THREE.Vector2(radius * 0.96, width / 2 - 0.01),
    new THREE.Vector2(radius * 0.84, width / 2),
    new THREE.Vector2(radius * 0.62, width / 2 - 0.01),
  ]
  const geometry = new THREE.LatheGeometry(points, 24)
  geometry.rotateZ(Math.PI / 2)
  return geometry
}

function rimGeometry(radius: number, width: number): THREE.BufferGeometry {
  const r = radius * 0.62
  const points: THREE.Vector2[] = [
    new THREE.Vector2(0, width * 0.05),
    new THREE.Vector2(r * 0.3, width * 0.08),
    new THREE.Vector2(r * 0.45, width * 0.2),
    new THREE.Vector2(r * 0.72, width * 0.2),
    new THREE.Vector2(r * 0.9, width * 0.42),
    new THREE.Vector2(r, width * 0.44),
    new THREE.Vector2(r, -width * 0.44),
    new THREE.Vector2(r * 0.9, -width * 0.42),
    new THREE.Vector2(r * 0.7, -width * 0.1),
    new THREE.Vector2(0, -width * 0.1),
  ]
  const geometry = new THREE.LatheGeometry(points, 20)
  const lugs: THREE.BufferGeometry[] = [geometry]
  for (let i = 0; i < 5; i++) {
    const lug = new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6)
    const angle = (i / 5) * Math.PI * 2
    lug.translate(Math.cos(angle) * r * 0.38, width * 0.21, Math.sin(angle) * r * 0.38)
    lugs.push(lug)
  }
  const merged = mergeGeometries(lugs, false) ?? geometry
  merged.rotateZ(-Math.PI / 2)
  return merged
}

function contactShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(0,0,0,0.75)')
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.45)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  shadowTexture = new THREE.CanvasTexture(canvas)
  return shadowTexture
}

function grilleMap(): THREE.CanvasTexture {
  if (grilleTexture) return grilleTexture
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = '#0b0c0e'
  ctx.fillRect(0, 0, 256, 64)
  for (let y = 6; y < 64; y += 10) {
    const bar = ctx.createLinearGradient(0, y, 0, y + 4)
    bar.addColorStop(0, '#f2f2f2')
    bar.addColorStop(0.5, '#9a9ca0')
    bar.addColorStop(1, '#4a4c50')
    ctx.fillStyle = bar
    ctx.fillRect(0, y, 256, 4)
  }
  for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(x, 0, 2, 64)
  }
  grilleTexture = new THREE.CanvasTexture(canvas)
  grilleTexture.colorSpace = THREE.SRGBColorSpace
  return grilleTexture
}

export function createCar(spec: BodySpec, look: CarLook, seed = 0): CarModel {
  const root = new THREE.Group()
  root.name = `car-${look.number}`
  const frame = frameOf(spec)
  const y0 = frame.y0
  const paintHex = paintById(look.paint).hex
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(paintHex), roughness: 0.82, metalness: 0.04, vertexColors: true, envMapIntensity: 0.55 })
  const shellGeometry = buildShell(spec, frame, seed)
  const body = new THREE.Mesh(shellGeometry, paint)
  body.name = 'shell'
  body.castShadow = true
  body.receiveShadow = true
  root.add(body)
  const shellColors = shellGeometry.attributes.color.array as Float32Array

  const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9dbdd'), roughness: 0.28, metalness: 1, envMapIntensity: 1.1 })
  const dullChrome = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a9abae'), roughness: 0.45, metalness: 0.9, envMapIntensity: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#111316'), roughness: 0.85, metalness: 0.1 })
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1b1b1b'), roughness: 0.97, metalness: 0 })
  const glass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#46525c'), roughness: 0.06, metalness: 0.6, transparent: true, opacity: 0.62, envMapIntensity: 1.6, depthWrite: false })
  const lamp = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8e4d4'), roughness: 0.2, metalness: 0.3, emissive: new THREE.Color('#5a5544'), emissiveIntensity: 0.6, envMapIntensity: 1 })
  const tail = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9b1313'), roughness: 0.35, metalness: 0.1, emissive: new THREE.Color('#4a0808'), emissiveIntensity: 0.5 })
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9821b'), roughness: 0.35, metalness: 0.1, emissive: new THREE.Color('#5a3208'), emissiveIntensity: 0.4 })
  const grille = new THREE.MeshStandardMaterial({ map: grilleMap(), roughness: 0.4, metalness: 0.7 })
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(seed % 3 === 0 ? '#d4d4d4' : seed % 3 === 1 ? '#5a5c60' : '#b0251d'), roughness: 0.5, metalness: 0.6, envMapIntensity: 0.8 })

  const glassMesh = new THREE.Mesh(buildGlass(spec, frame), glass)
  glassMesh.name = 'glass'
  glassMesh.renderOrder = 3
  root.add(glassMesh)
  const pillarMesh = new THREE.Mesh(pillars(spec, frame), paint)
  pillarMesh.castShadow = true
  root.add(pillarMesh)

  const interior = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.84, spec.roof - spec.sill - 0.2, frame.tailGlassZ - frame.cowlZ - 0.1), dark)
  interior.position.set(0, (spec.roof + spec.sill) / 2 - 0.08 - y0, (frame.cowlZ + frame.tailGlassZ) / 2)
  root.add(interior)
  const cageMesh = new THREE.Mesh(cage(spec, frame), dullChrome)
  root.add(cageMesh)
  const seat = new THREE.Mesh(roundedBox(0.5, 0.55, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c2f36'), roughness: 0.9 }))
  seat.position.set(-0.42, spec.belt - 0.2 - y0, frame.bZ - 0.1)
  root.add(seat)

  const bumperWidth = spec.width * 1.02
  for (const front of [true, false]) {
    const z = front ? frame.noseZ - 0.07 : frame.tailZ + 0.07
    const bumper = new THREE.Mesh(roundedBox(bumperWidth, 0.17, 0.14, 0.05), chrome)
    bumper.position.set(0, spec.sill + 0.12 - y0, z)
    bumper.castShadow = true
    root.add(bumper)
    for (const side of [-1, 1]) {
      const guard = new THREE.Mesh(roundedBox(0.09, 0.26, 0.1, 0.03), chrome)
      guard.position.set(side * spec.width * 0.28, spec.sill + 0.13 - y0, z + (front ? -0.04 : 0.04))
      root.add(guard)
    }
  }

  const lampY = (spec.sill + spec.noseTop) / 2 + 0.1
  const lampZ = frame.noseZ - 0.015
  const lampXs = spec.quadLamps ? [0.58, 0.8] : [0.72]
  const lampRadius = spec.quadLamps ? 0.085 : 0.11
  const lampParts: THREE.BufferGeometry[] = []
  const bezelParts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    for (const fx of lampXs) {
      const lens = new THREE.CylinderGeometry(lampRadius, lampRadius, 0.04, 18)
      lens.rotateX(Math.PI / 2)
      lens.translate(side * frame.half * 0.9 * fx, lampY - y0, lampZ)
      lampParts.push(lens)
      const bezel = new THREE.CylinderGeometry(lampRadius + 0.018, lampRadius + 0.018, 0.02, 18)
      bezel.rotateX(Math.PI / 2)
      bezel.translate(side * frame.half * 0.9 * fx, lampY - y0, lampZ + 0.008)
      bezelParts.push(bezel)
    }
    const signal = new THREE.BoxGeometry(0.16, 0.06, 0.03)
    signal.translate(side * frame.half * 0.9 * 0.69, lampY - 0.15 - y0, lampZ + 0.01)
    const signalMesh = new THREE.Mesh(signal, amber)
    root.add(signalMesh)
  }
  const lampMesh = new THREE.Mesh(mergeGeometries(lampParts, false) ?? lampParts[0], lamp)
  root.add(lampMesh)
  const bezelMesh = new THREE.Mesh(mergeGeometries(bezelParts, false) ?? bezelParts[0], chrome)
  root.add(bezelMesh)
  const grilleWidth = frame.half * 0.9 * (spec.quadLamps ? 0.46 : 0.6) * 2
  const grilleMesh = new THREE.Mesh(new THREE.BoxGeometry(grilleWidth, 0.2, 0.03), grille)
  grilleMesh.position.set(0, lampY - y0, lampZ + 0.01)
  root.add(grilleMesh)
  const grilleFrame = new THREE.Mesh(roundedBox(grilleWidth + 0.05, 0.25, 0.02, 0.01), chrome)
  grilleFrame.position.set(0, lampY - y0, lampZ + 0.012)
  root.add(grilleFrame)

  const tailZ = frame.tailZ + 0.012
  if (spec.id === 'wagon') {
    for (const side of [-1, 1]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.03), tail)
      light.position.set(side * frame.half * 0.86, (spec.sill + spec.tailTop) / 2 + 0.06 - y0, tailZ)
      root.add(light)
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.45, 0.015), chrome)
      ring.position.set(side * frame.half * 0.86, (spec.sill + spec.tailTop) / 2 + 0.06 - y0, tailZ - 0.004)
      root.add(ring)
    }
    const gateTrim = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.7, 0.03, 0.015), chrome)
    gateTrim.position.set(0, spec.tailTop - 0.5 - y0, tailZ)
    root.add(gateTrim)
  } else {
    for (const side of [-1, 1]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(frame.half * 0.62, 0.12, 0.03), tail)
      light.position.set(side * frame.half * 0.55, spec.tailTop - 0.2 - y0, tailZ)
      root.add(light)
      const ring = new THREE.Mesh(new THREE.BoxGeometry(frame.half * 0.65, 0.15, 0.015), chrome)
      ring.position.set(side * frame.half * 0.55, spec.tailTop - 0.2 - y0, tailZ - 0.004)
      root.add(ring)
    }
  }

  const pinParts: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    const pin = new THREE.CylinderGeometry(0.022, 0.022, 0.06, 8)
    pin.translate(side * frame.half * 0.62, spec.noseTop + 0.05 - y0, frame.noseZ + 0.22)
    pinParts.push(pin)
  }
  root.add(new THREE.Mesh(mergeGeometries(pinParts, false) ?? pinParts[0], dullChrome))

  if (spec.roofRack) {
    const rackParts: THREE.BufferGeometry[] = []
    const aTopZ = frame.aTopZ + 0.3
    const endZ = frame.cTopZ + 0.05
    for (const side of [-1, 1]) {
      rackParts.push(bar(new THREE.Vector3(side * frame.half * 0.5, spec.roof + 0.07 - y0, aTopZ), new THREE.Vector3(side * frame.half * 0.5, spec.roof + 0.07 - y0, endZ), 0.018))
      for (const z of [aTopZ, (aTopZ + endZ) / 2, endZ]) {
        rackParts.push(bar(new THREE.Vector3(side * frame.half * 0.5, spec.roof + 0.01 - y0, z), new THREE.Vector3(side * frame.half * 0.5, spec.roof + 0.07 - y0, z), 0.014))
      }
    }
    for (const z of [aTopZ + 0.1, (aTopZ + endZ) / 2, endZ - 0.1]) {
      rackParts.push(bar(new THREE.Vector3(-frame.half * 0.5, spec.roof + 0.075 - y0, z), new THREE.Vector3(frame.half * 0.5, spec.roof + 0.075 - y0, z), 0.012))
    }
    root.add(new THREE.Mesh(mergeGeometries(rackParts, false) ?? rackParts[0], dullChrome))
  }

  const decals: THREE.Mesh[] = []
  const deformables: Deformable[] = [{ geometry: shellGeometry, original: Float32Array.from(shellGeometry.attributes.position.array as Float32Array), colors: shellColors, baseColors: Float32Array.from(shellColors) }]
  const sideArt = paintNumber(look, 'side')
  const roofArt = paintNumber(look, 'roof')
  const doorTop = spec.belt - 0.03
  const doorBottom = spec.sill + 0.17
  const doorHeight = doorTop - doorBottom
  const doorWidth = Math.min(2.3, doorHeight * sideArt.aspect)
  const doorZ = (frame.cowlZ + frame.cZ) / 2 + 0.05
  for (const side of [-1, 1] as const) {
    const geometry = new THREE.PlaneGeometry(doorWidth, doorHeight, 16, 6)
    geometry.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) + (doorTop + doorBottom) / 2
      const t = (y - doorBottom) / doorHeight
      const bulge = 0.012 + 0.02 * Math.sin(t * Math.PI)
      position.setX(i, side * (frame.half + bulge))
      position.setY(i, y - y0)
      position.setZ(i, position.getZ(i) + doorZ)
    }
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({ map: sideArt.texture, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const decal = new THREE.Mesh(geometry, material)
    decal.name = `decal-${side < 0 ? 'left' : 'right'}`
    decal.renderOrder = 2
    root.add(decal)
    decals.push(decal)
    deformables.push({ geometry, original: Float32Array.from(geometry.attributes.position.array as Float32Array), colors: null, baseColors: null })
  }
  const roofSize = Math.min(spec.width * 0.62, 1.25)
  const roofGeometry = new THREE.PlaneGeometry(roofSize, roofSize, 12, 12)
  roofGeometry.rotateX(-Math.PI / 2)
  roofGeometry.rotateY(Math.PI / 2)
  const roofZ = (frame.aTopZ + frame.cTopZ) / 2
  roofGeometry.translate(0, spec.roof + 0.03 - y0, roofZ)
  const roofMaterial = new THREE.MeshStandardMaterial({ map: roofArt.texture, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const roofDecal = new THREE.Mesh(roofGeometry, roofMaterial)
  roofDecal.name = 'decal-roof'
  roofDecal.renderOrder = 2
  root.add(roofDecal)
  decals.push(roofDecal)
  deformables.push({ geometry: roofGeometry, original: Float32Array.from(roofGeometry.attributes.position.array as Float32Array), colors: null, baseColors: null })

  const tireGeo = tireGeometry(spec.wheelRadius, spec.wheelWidth)
  const rimGeo = rimGeometry(spec.wheelRadius, spec.wheelWidth)
  const wheels: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(tireGeo, rubber)
    const rim = new THREE.Mesh(rimGeo, steel)
    rim.rotation.y = i % 2 === 0 ? Math.PI : 0
    wheel.add(rim)
    wheel.castShadow = true
    wheel.name = `wheel-${i}`
    root.add(wheel)
    wheels.push(wheel)
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(spec.width * 1.5, spec.length * 1.18), new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.renderOrder = 1
  shadow.name = 'contact-shadow'

  const rustAmount = seed === 0 ? 0 : 0.35 * hashNoise(seed, 3, 7)
  if (rustAmount > 0.12) {
    const position = shellGeometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i) + y0
      const z = position.getZ(i)
      const low = clamp01((spec.belt - 0.15 - y) / 0.5)
      const n = smoothNoise(x * 2.4 + seed * 2, y * 7 + seed, z * 1.3) * 0.7 + smoothNoise(x * 9 + seed, y * 18, z * 4.5) * 0.3
      const threshold = 1 - rustAmount * (0.5 + 0.6 * low)
      if (n > threshold) {
        const k = clamp01((n - threshold) / 0.06) * 0.85
        const speck = 0.75 + 0.5 * hashNoise(x * 31, y * 47, z * 13)
        shellColors[i * 3] = shellColors[i * 3] * (1 - k) + 0.5 * speck * k
        shellColors[i * 3 + 1] = shellColors[i * 3 + 1] * (1 - k) + 0.26 * speck * k
        shellColors[i * 3 + 2] = shellColors[i * 3 + 2] * (1 - k) + 0.1 * speck * k
      }
    }
    for (let i = 0; i < shellColors.length; i++) deformables[0].baseColors![i] = shellColors[i]
    ;(shellGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  const dent = (point: THREE.Vector3, direction: THREE.Vector3, strength: number, dentSpec: DentSpec): void => {
    const radius = dentSpec.radius * (0.6 + 0.4 * strength)
    const depth = dentSpec.depth * strength
    for (const part of deformables) {
      const position = part.geometry.attributes.position as THREE.BufferAttribute
      const array = position.array as Float32Array
      for (let i = 0; i < position.count; i++) {
        const ox = part.original[i * 3]
        const oy = part.original[i * 3 + 1]
        const oz = part.original[i * 3 + 2]
        const distance = scratch.set(array[i * 3] - point.x, array[i * 3 + 1] - point.y, array[i * 3 + 2] - point.z).length()
        if (distance >= radius) continue
        const falloff = smoothstep(1 - distance / radius) * (0.75 + 0.5 * hashNoise(ox * 7, oy * 5, oz * 3))
        const push = depth * falloff
        let nx = array[i * 3] + direction.x * push
        let ny = array[i * 3 + 1] + direction.y * push * 0.35
        let nz = array[i * 3 + 2] + direction.z * push
        const dx = nx - ox
        const dy = ny - oy
        const dz = nz - oz
        const moved = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (moved > dentSpec.maxDepth) {
          const scale = dentSpec.maxDepth / moved
          nx = ox + dx * scale
          ny = oy + dy * scale
          nz = oz + dz * scale
        }
        array[i * 3] = nx
        array[i * 3 + 1] = ny
        array[i * 3 + 2] = nz
        if (part.colors) {
          const shade = 1 - dentSpec.darken * falloff * strength
          part.colors[i * 3] = Math.max(0.18, part.colors[i * 3] * (0.6 + 0.4 * shade))
          part.colors[i * 3 + 1] = Math.max(0.12, part.colors[i * 3 + 1] * shade)
          part.colors[i * 3 + 2] = Math.max(0.1, part.colors[i * 3 + 2] * shade * 0.92)
        }
      }
      position.needsUpdate = true
      if (part.colors) (part.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
  }

  const dispose = (): void => {
    root.removeFromParent()
    shadow.removeFromParent()
    shadow.geometry.dispose()
    ;(shadow.material as THREE.Material).dispose()
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const map = (material as THREE.MeshStandardMaterial).map
        if (map && map !== grilleTexture) map.dispose()
        material.dispose()
      }
    })
  }

  return { root, body, decals, wheels, paint, shadow, dent, dispose }
}
