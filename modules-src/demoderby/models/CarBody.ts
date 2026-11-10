/** Car model factory: a lofted 1970s full-size wagon or sedan (fender arches and flares, rocker and belt creases, hood crown, raked glass, pillars) at crush resolution, chrome bumpers that sag and fall off, a hood and trunk lid (or tailgate) that buckle and then tear off to show the engine bay or the load floor, an exhaust that drops, drags sparks and falls off, a frame that bends the whole shell into a banana, sealed-beam lamps that break, grille, taillights, treaded tires on steel wheels that bend, go flat and come off, glass that cracks, a dark caged interior, the spray-painted number decals and a contact shadow. The paint is a node material that scrapes through to bare steel and soot where the shell has been hit (a per-vertex `wear` channel written by `dent`). Everything is in the chassis frame (forward is -Z, origin `centreHeight` above the ground). */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintById, type BodySpec } from '../config'
import type { CarDamage } from '../systems/Damage'
import type { CarLook } from '../systems/Look'
import { paintNumber } from '../systems/Numbers'
import { bar, loft, mirror, roundedBox, type Profile, type Station } from './Loft'
import { crackTexture, scuffTexture, treadTextures } from './Textures'

const { attribute, float, materialColor, materialRoughness, mix, smoothstep, texture, uv, vec2, vec3, vertexColor } = THREE.TSL

export interface DetachedPart {
  object: THREE.Object3D
  kind: 'bumper' | 'wheel' | 'hood' | 'trunk' | 'exhaust'
}

export interface CarModel {
  root: THREE.Group
  body: THREE.Mesh
  decals: THREE.Mesh[]
  wheels: THREE.Mesh[]
  paint: THREE.MeshStandardNodeMaterial
  shadow: THREE.Mesh
  /** Pushes the shell in around a point in the chassis frame along a direction, by a strength of 0–1. */
  dent(point: THREE.Vector3, direction: THREE.Vector3, strength: number, spec: DentSpec): void
  /** Shows the component damage: bumpers sag then drop, the hood and tailgate buckle, lamps break, glass cracks, lost wheels disappear. Returns parts that came off, already moved into world space, for the debris. */
  showDamage(damage: CarDamage): DetachedPart[]
  /** World position where a dragging exhaust scrapes the ground, or null when it is bolted up or gone. */
  exhaustTip(target: THREE.Vector3): THREE.Vector3 | null
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
  wear: Float32Array | null
}

/** Inserts `steps` evenly spaced points between every pair of profile points, so dents across a panel have vertices to move. */
function subdivide(profile: Profile, steps: number): Profile {
  const out: (readonly [number, number])[] = []
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, y0] = profile[i]
    const [x1, y1] = profile[i + 1]
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
    }
  }
  out.push(profile[profile.length - 1])
  return out
}

function addWear(geometry: THREE.BufferGeometry): Float32Array {
  const wear = new Float32Array(geometry.attributes.position.count)
  geometry.setAttribute('wear', new THREE.BufferAttribute(wear, 1))
  return wear
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

function smoothstep01(t: number): number {
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
  for (let z = frame.noseZ; z <= frame.tailZ + 1e-6; z += 0.05) zs.add(Number(z.toFixed(3)))
  zs.add(frame.tailZ)
  for (const seam of seamZs) {
    zs.add(Number((seam - 0.012).toFixed(3)))
    zs.add(Number((seam + 0.012).toFixed(3)))
  }
  for (const axleZ of [frame.frontAxleZ, frame.rearAxleZ]) {
    for (let k = -8; k <= 8; k++) zs.add(Number((axleZ + (k / 8) * frame.archRadius).toFixed(3)))
  }
  const ordered = [...zs].sort((a, b) => a - b)
  const grime = (x: number, y: number, z: number) => 0.9 + 0.1 * smoothNoise(x * 2.2 + seed, y * 3.1, z * 1.4 + seed * 0.37)
  for (const z of ordered) {
    const profile = mirror(subdivide(lowerProfile(spec, frame, z), 3))
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
  const roofStations = [front[front.length - 1], ...mid, back[0]].map((station) => ({ ...station, profile: subdivide(station.profile.slice(2, 7), 4) }))
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
    front.push({ z, profile: upperRing(spec, frame, z, 1 - smoothstep01(f * 0.85 + 0.15), inset), shade: 0.97 })
  }
  for (let z = frame.aTopZ + 0.08; z < frame.cTopZ - 0.04; z += 0.08) mid.push({ z, profile: upperRing(spec, frame, z, 0, inset), shade: 0.97 })
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const z = frame.cTopZ + (frame.tailGlassZ - frame.cTopZ) * f
    back.push({ z, profile: upperRing(spec, frame, z, smoothstep01(f), inset), shade: 0.97 })
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
  const geometry = new THREE.LatheGeometry(points, 64)
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
  const geometry = new THREE.LatheGeometry(points, 40)
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

function paintMaterial(hex: string): THREE.MeshStandardNodeMaterial {
  const paint = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: 0.78, metalness: 0.04 })
  paint.envMapIntensity = 0.55
  const wear = attribute('wear', 'float')
  const scuff = texture(scuffTexture(), uv().mul(vec2(5, 14)))
  const scrape = smoothstep(0.5, 0.9, wear.add(scuff.r.sub(0.5).mul(1.1)))
  const soot = smoothstep(1.1, 1.7, wear.add(scuff.g.mul(0.25)))
  const base = materialColor.rgb.mul(vertexColor().rgb)
  const bare = vec3(0.5, 0.49, 0.47).mul(scuff.b.mul(0.55).add(0.55))
  paint.colorNode = mix(base, bare, scrape).mul(float(1).sub(soot.mul(0.7)))
  paint.metalnessNode = mix(float(0.04), float(0.82), scrape.mul(float(1).sub(soot)))
  paint.roughnessNode = mix(materialRoughness.add(scuff.g.sub(0.5).mul(0.16)), float(0.34), scrape).add(soot.mul(0.3)).min(1)
  return paint
}

function lampCorner(radius: number, x: number, y: number, z: number, lamp: THREE.Material, chrome: THREE.Material, quad: number[]): THREE.Group {
  const group = new THREE.Group()
  const lensParts: THREE.BufferGeometry[] = []
  const bezelParts: THREE.BufferGeometry[] = []
  for (const dx of quad) {
    const lens = new THREE.SphereGeometry(radius, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.3)
    lens.rotateX(-Math.PI / 2)
    lens.scale(1, 1, 0.5)
    lens.translate(x + dx, y, z + radius * 0.25)
    lensParts.push(lens)
    const bezel = new THREE.TorusGeometry(radius + 0.01, 0.014, 6, 28)
    bezel.translate(x + dx, y, z + 0.004)
    bezelParts.push(bezel)
  }
  const lens = new THREE.Mesh(mergeGeometries(lensParts, false) ?? lensParts[0], lamp)
  lens.name = 'lens'
  const bezel = new THREE.Mesh(mergeGeometries(bezelParts, false) ?? bezelParts[0], chrome)
  const socket = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 16).translate(x + quad[0], y, z + 0.006), new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0d0d'), roughness: 0.9 }))
  socket.name = 'socket'
  socket.visible = false
  group.add(lens, bezel, socket)
  return group
}

export function createCar(spec: BodySpec, look: CarLook, seed = 0): CarModel {
  const root = new THREE.Group()
  root.name = `car-${look.number}`
  const frame = frameOf(spec)
  const y0 = frame.y0
  const paintHex = paintById(look.paint).hex
  const paint = paintMaterial(paintHex)
  const shellGeometry = buildShell(spec, frame, seed)
  const shellWear = addWear(shellGeometry)
  const body = new THREE.Mesh(shellGeometry, paint)
  body.name = 'shell'
  body.castShadow = true
  body.receiveShadow = true
  root.add(body)
  const shellColors = shellGeometry.attributes.color.array as Float32Array

  const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9dbdd'), roughness: 0.22, metalness: 1, envMapIntensity: 1.2 })
  const dullChrome = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a9abae'), roughness: 0.45, metalness: 0.9, envMapIntensity: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#111316'), roughness: 0.85, metalness: 0.1 })
  const { map: treadMap, normal: treadNormal } = treadTextures()
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3a3a'), map: treadMap, normalMap: treadNormal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.94, metalness: 0 })
  const glass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#3e4a54'), roughness: 0.04, metalness: 0.55, transparent: true, opacity: 0.6, envMapIntensity: 1.7, depthWrite: false })
  const crackMaterial = new THREE.MeshStandardMaterial({ map: crackTexture(), transparent: true, opacity: 0, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const lamp = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#f2efe2'), roughness: 0.05, metalness: 0.2, transmission: 0, clearcoat: 1, emissive: new THREE.Color('#6a6450'), emissiveIntensity: 0.6, envMapIntensity: 1.3 })
  const tail = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#9b1313'), roughness: 0.18, metalness: 0.1, clearcoat: 1, emissive: new THREE.Color('#5a0808'), emissiveIntensity: 0.7 })
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9821b'), roughness: 0.3, metalness: 0.1, emissive: new THREE.Color('#5a3208'), emissiveIntensity: 0.45 })
  const grille = new THREE.MeshStandardMaterial({ map: grilleMap(), roughness: 0.35, metalness: 0.75 })
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(seed % 3 === 0 ? '#d4d4d4' : seed % 3 === 1 ? '#5a5c60' : '#b0251d'), roughness: 0.45, metalness: 0.65, envMapIntensity: 0.9 })
  const broken = new THREE.MeshStandardMaterial({ color: new THREE.Color('#151515'), roughness: 0.6, metalness: 0.3 })

  const glassGeometry = buildGlass(spec, frame)
  const glassMesh = new THREE.Mesh(glassGeometry, glass)
  glassMesh.name = 'glass'
  glassMesh.renderOrder = 3
  root.add(glassMesh)
  const crackMesh = new THREE.Mesh(glassGeometry, crackMaterial)
  crackMesh.name = 'glass-cracks'
  crackMesh.renderOrder = 4
  crackMesh.visible = false
  root.add(crackMesh)
  const pillarGeometry = pillars(spec, frame)
  const pillarColors = new Float32Array(pillarGeometry.attributes.position.count * 3).fill(0.95)
  pillarGeometry.setAttribute('color', new THREE.BufferAttribute(pillarColors, 3))
  const pillarWear = addWear(pillarGeometry)
  const pillarMesh = new THREE.Mesh(pillarGeometry, paint)
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
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1a1a'), roughness: 0.6 }))
  wheelRim.position.set(-0.42, spec.belt - 0.02 - y0, frame.cowlZ + 0.45)
  wheelRim.rotation.x = -0.9
  root.add(wheelRim)

  const bumperWidth = spec.width * 1.02
  const bumpers: Record<'frontBumper' | 'rearBumper', THREE.Group> = { frontBumper: new THREE.Group(), rearBumper: new THREE.Group() }
  for (const front of [true, false]) {
    const z = front ? frame.noseZ - 0.07 : frame.tailZ + 0.07
    const group = bumpers[front ? 'frontBumper' : 'rearBumper']
    group.name = front ? 'front-bumper' : 'rear-bumper'
    group.position.set(spec.width * 0.5, spec.sill + 0.12 - y0, z)
    const bumper = new THREE.Mesh(roundedBox(bumperWidth, 0.17, 0.14, 0.05), chrome)
    bumper.position.set(-spec.width * 0.5, 0, 0)
    bumper.castShadow = true
    group.add(bumper)
    for (const side of [-1, 1]) {
      const guard = new THREE.Mesh(roundedBox(0.09, 0.26, 0.1, 0.03), chrome)
      guard.position.set(side * spec.width * 0.28 - spec.width * 0.5, 0.01, front ? -0.04 : 0.04)
      group.add(guard)
    }
    root.add(group)
  }

  const exhaustSteel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a4c42'), roughness: 0.7, metalness: 0.55 })
  const exhaust = new THREE.Group()
  exhaust.name = 'exhaust'
  const exhaustLength = frame.tailZ + 0.05 - frame.bZ
  exhaust.position.set(frame.half * 0.42, spec.sill - 0.06 - y0, frame.bZ)
  const pipe = new THREE.Mesh(bar(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, exhaustLength), 0.032), exhaustSteel)
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 14).rotateX(Math.PI / 2).translate(0, 0, exhaustLength * 0.42), exhaustSteel)
  const tipDrop = new THREE.Mesh(bar(new THREE.Vector3(0, 0, exhaustLength), new THREE.Vector3(0, -0.05, exhaustLength + 0.08), 0.034), exhaustSteel)
  pipe.castShadow = true
  muffler.castShadow = true
  exhaust.add(pipe, muffler, tipDrop)
  root.add(exhaust)

  const engineBay = new THREE.Group()
  engineBay.name = 'engine-bay'
  engineBay.visible = false
  const bayFront = frame.noseZ + 0.32
  const bayBack = frame.cowlZ - 0.12
  const bayLength = bayBack - bayFront
  const block = new THREE.Mesh(roundedBox(0.62, 0.34, bayLength * 0.62, 0.04), new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2d31'), roughness: 0.55, metalness: 0.6 }))
  block.position.set(0, spec.noseTop - 0.26 - y0, bayFront + bayLength * 0.55)
  const covers = new THREE.MeshStandardMaterial({ color: new THREE.Color(seed % 2 ? '#c0392b' : '#d2d4d6'), roughness: 0.3, metalness: seed % 2 ? 0.2 : 0.9 })
  for (const side of [-1, 1]) {
    const cover = new THREE.Mesh(roundedBox(0.16, 0.1, bayLength * 0.58, 0.03), covers)
    cover.position.set(side * 0.2, spec.noseTop - 0.06 - y0, bayFront + bayLength * 0.55)
    cover.rotation.z = side * 0.35
    engineBay.add(cover)
  }
  const cleaner = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 24), chrome)
  cleaner.position.set(0, spec.noseTop + 0.02 - y0, bayFront + bayLength * 0.5)
  const radiator = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.62, 0.38, 0.07), new THREE.MeshStandardMaterial({ map: grilleMap(), color: new THREE.Color('#6f747a'), roughness: 0.5, metalness: 0.7 }))
  radiator.position.set(0, spec.noseTop - 0.24 - y0, bayFront - 0.08)
  const hoses = new THREE.Mesh(bar(new THREE.Vector3(0.18, spec.noseTop - 0.12 - y0, bayFront - 0.04), new THREE.Vector3(0.1, spec.noseTop - 0.14 - y0, bayFront + bayLength * 0.3), 0.03), dark)
  block.castShadow = true
  engineBay.add(block, cleaner, radiator, hoses)
  root.add(engineBay)

  const loadFloor = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.78, 0.04, 0.9), dark)
  loadFloor.name = 'load-floor'
  loadFloor.visible = false
  loadFloor.position.set(0, spec.sill + 0.22 - y0, frame.tailZ - 0.55)
  root.add(loadFloor)

  const lampY = (spec.sill + spec.noseTop) / 2 + 0.1
  const lampZ = frame.noseZ - 0.015
  const lampXs = spec.quadLamps ? [0.58, 0.8] : [0.72]
  const lampRadius = spec.quadLamps ? 0.085 : 0.11
  const lamps: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const centre = side * frame.half * 0.9 * lampXs[0]
    const offsets = lampXs.map((fx) => side * frame.half * 0.9 * fx - centre)
    const corner = lampCorner(lampRadius, centre, lampY - y0, lampZ, lamp, chrome, offsets)
    corner.name = side < 0 ? 'lamp-front-left' : 'lamp-front-right'
    lamps.push(corner)
    root.add(corner)
    const signal = new THREE.BoxGeometry(0.16, 0.06, 0.03)
    signal.translate(side * frame.half * 0.9 * 0.69, lampY - 0.15 - y0, lampZ + 0.01)
    root.add(new THREE.Mesh(signal, amber))
  }
  const grilleWidth = frame.half * 0.9 * (spec.quadLamps ? 0.46 : 0.6) * 2
  const grilleMesh = new THREE.Mesh(new THREE.BoxGeometry(grilleWidth, 0.2, 0.03), grille)
  grilleMesh.position.set(0, lampY - y0, lampZ + 0.01)
  root.add(grilleMesh)
  const grilleFrame = new THREE.Mesh(roundedBox(grilleWidth + 0.05, 0.25, 0.02, 0.01), chrome)
  grilleFrame.position.set(0, lampY - y0, lampZ + 0.012)
  root.add(grilleFrame)

  const tailZ = frame.tailZ + 0.012
  for (const side of [-1, 1]) {
    const group = new THREE.Group()
    group.name = side < 0 ? 'lamp-rear-left' : 'lamp-rear-right'
    const wagon = spec.id === 'wagon'
    const width = wagon ? 0.14 : frame.half * 0.62
    const height = wagon ? 0.42 : 0.12
    const x = side * frame.half * (wagon ? 0.86 : 0.55)
    const y = (wagon ? (spec.sill + spec.tailTop) / 2 + 0.06 : spec.tailTop - 0.2) - y0
    const light = new THREE.Mesh(roundedBox(width, height, 0.035, 0.012), tail)
    light.name = 'lens'
    light.position.set(x, y, tailZ)
    const ring = new THREE.Mesh(new THREE.BoxGeometry(width + 0.03, height + 0.03, 0.015), chrome)
    ring.position.set(x, y, tailZ - 0.004)
    const socket = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, height * 0.9, 0.02), broken)
    socket.name = 'socket'
    socket.position.set(x, y, tailZ)
    socket.visible = false
    group.add(light, ring, socket)
    lamps.push(group)
    root.add(group)
  }
  if (spec.id === 'wagon') {
    const gateTrim = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.7, 0.03, 0.015), chrome)
    gateTrim.position.set(0, spec.tailTop - 0.5 - y0, tailZ)
    root.add(gateTrim)
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
    const rackGeometry = mergeGeometries(rackParts, false) ?? rackParts[0]
    root.add(new THREE.Mesh(rackGeometry, dullChrome))
  }

  const decals: THREE.Mesh[] = []
  const deformables: Deformable[] = [
    { geometry: shellGeometry, original: Float32Array.from(shellGeometry.attributes.position.array as Float32Array), colors: shellColors, baseColors: Float32Array.from(shellColors), wear: shellWear },
    { geometry: pillarGeometry, original: Float32Array.from(pillarGeometry.attributes.position.array as Float32Array), colors: pillarColors, baseColors: Float32Array.from(pillarColors), wear: pillarWear },
    { geometry: glassGeometry, original: Float32Array.from(glassGeometry.attributes.position.array as Float32Array), colors: null, baseColors: null, wear: null },
  ]
  const sideArt = paintNumber(look, 'side')
  const roofArt = paintNumber(look, 'roof')
  const doorTop = spec.belt - 0.03
  const doorBottom = spec.sill + 0.17
  const doorHeight = doorTop - doorBottom
  const doorWidth = Math.min(2.3, doorHeight * sideArt.aspect)
  const doorZ = (frame.cowlZ + frame.cZ) / 2 + 0.05
  for (const side of [-1, 1] as const) {
    const geometry = new THREE.PlaneGeometry(doorWidth, doorHeight, 32, 12)
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
    deformables.push({ geometry, original: Float32Array.from(geometry.attributes.position.array as Float32Array), colors: null, baseColors: null, wear: null })
  }
  const roofSize = Math.min(spec.width * 0.62, 1.25)
  const roofGeometry = new THREE.PlaneGeometry(roofSize, roofSize, 20, 20)
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
  deformables.push({ geometry: roofGeometry, original: Float32Array.from(roofGeometry.attributes.position.array as Float32Array), colors: null, baseColors: null, wear: null })

  const tireGeo = tireGeometry(spec.wheelRadius, spec.wheelWidth)
  const rimGeo = rimGeometry(spec.wheelRadius, spec.wheelWidth)
  const wheels: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(tireGeo, rubber)
    const rim = new THREE.Mesh(rimGeo, steel)
    rim.rotation.y = i % 2 === 0 ? Math.PI : 0
    rim.castShadow = true
    wheel.add(rim)
    wheel.castShadow = true
    wheel.receiveShadow = true
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
  if (seed !== 0) {
    const wearBase = 0.12 + 0.2 * hashNoise(seed, 11, 2)
    const position = shellGeometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i) + y0
      const z = position.getZ(i)
      const edge = Math.abs(z) > spec.length * 0.42 || y < spec.sill + 0.15 ? 1 : 0.35
      shellWear[i] = wearBase * edge * smoothNoise(x * 3 + seed, y * 6, z * 2.2)
    }
  }

  const dent = (point: THREE.Vector3, direction: THREE.Vector3, strength: number, dentSpec: DentSpec): void => {
    const radius = dentSpec.radius * (0.6 + 0.4 * strength)
    const depth = dentSpec.depth * strength
    for (const part of deformables) {
      const position = part.geometry.attributes.position as THREE.BufferAttribute
      const array = position.array as Float32Array
      let touched = false
      for (let i = 0; i < position.count; i++) {
        const ox = part.original[i * 3]
        const oy = part.original[i * 3 + 1]
        const oz = part.original[i * 3 + 2]
        const distance = scratch.set(array[i * 3] - point.x, array[i * 3 + 1] - point.y, array[i * 3 + 2] - point.z).length()
        if (distance >= radius) continue
        touched = true
        const core = smoothstep01(1 - distance / radius)
        const crumple = 0.7 + 0.6 * hashNoise(ox * 7, oy * 5, oz * 3) + 0.25 * Math.sin(oz * 38 + oy * 21)
        const falloff = core * crumple
        const push = depth * falloff
        let nx = array[i * 3] + direction.x * push
        let ny = array[i * 3 + 1] + direction.y * push * (Math.abs(direction.y) > 0.5 ? 1 : 0.35) - (Math.abs(direction.y) > 0.5 ? 0 : push * 0.08 * (hashNoise(oz * 3, ox, 1) - 0.3))
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
        if (part.wear) part.wear[i] = Math.min(1.6, part.wear[i] + core * strength * (0.3 + 0.45 * hashNoise(ox * 13, oy * 3, oz * 9)))
      }
      if (!touched) continue
      position.needsUpdate = true
      if (part.colors) (part.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      if (part.wear) (part.geometry.attributes.wear as THREE.BufferAttribute).needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
  }

  const shown = { version: -1, bolts: { frontBumper: 0, rearBumper: 0 }, hood: 0, trunk: 0, exhaust: 0, bend: 0, lamps: [false, false, false, false], wheels: [false, false, false, false] }

  const shift = (select: (x: number, y: number, z: number) => number, dx: number, dy: number, dz: number, darkTo: number | null): void => {
    for (const part of deformables) {
      const position = part.geometry.attributes.position as THREE.BufferAttribute
      const array = position.array as Float32Array
      let touched = false
      for (let i = 0; i < position.count; i++) {
        const k = select(part.original[i * 3], part.original[i * 3 + 1], part.original[i * 3 + 2])
        if (k <= 0) continue
        touched = true
        for (const target of [array, part.original]) {
          target[i * 3] += dx * k
          target[i * 3 + 1] += dy * k
          target[i * 3 + 2] += dz * k
        }
        if (darkTo !== null && part.colors) {
          for (let c = 0; c < 3; c++) part.colors[i * 3 + c] = part.colors[i * 3 + c] * (1 - k) + darkTo * k
        }
        if (darkTo !== null && part.wear) part.wear[i] = Math.max(part.wear[i], 1.25 * k)
      }
      if (!touched) continue
      position.needsUpdate = true
      if (part.colors) (part.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      if (part.wear) (part.geometry.attributes.wear as THREE.BufferAttribute).needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
  }
  const lidPanel = (width: number, length: number, thickness: number): THREE.Mesh => {
    const geometry = roundedBox(width, thickness, length, 0.02)
    const count = geometry.attributes.position.count
    const colors = new Float32Array(count * 3).fill(0.82)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const wear = new Float32Array(count)
    for (let i = 0; i < count; i++) wear[i] = 0.55 + 0.6 * hashNoise(i, seed, 3)
    geometry.setAttribute('wear', new THREE.BufferAttribute(wear, 1))
    const mesh = new THREE.Mesh(geometry, paint)
    mesh.castShadow = true
    return mesh
  }
  const tearHood = (): THREE.Object3D => {
    const z0 = frame.noseZ + 0.1
    const z1 = frame.cowlZ - 0.03
    const edge = frame.half * 0.82
    shift((x, y, z) => {
      if (z < z0 || z > z1 || y + y0 < spec.noseTop - 0.1 || Math.abs(x) > edge) return 0
      return smoothstep01((edge - Math.abs(x)) / 0.16) * smoothstep01((z - z0) / 0.12) * smoothstep01((z1 - z) / 0.12)
    }, 0, -0.24, 0, 0.07)
    engineBay.visible = true
    const piece = lidPanel(edge * 2, z1 - z0, 0.04)
    piece.position.set(0, spec.noseTop + 0.08 - y0, (z0 + z1) / 2)
    piece.rotation.set(0.25, 0.1, -0.08)
    root.add(piece)
    return detachWorld(piece)
  }
  const tearTrunk = (): THREE.Object3D => {
    const edge = frame.half * 0.8
    let piece: THREE.Mesh
    if (spec.id === 'wagon') {
      const bottom = spec.sill + 0.12
      const top = spec.tailTop - 0.04
      shift((x, y, z) => {
        const height = y + y0
        if (z < frame.tailZ - 0.04 || height < bottom || height > top || Math.abs(x) > edge) return 0
        return smoothstep01((edge - Math.abs(x)) / 0.14) * smoothstep01((height - bottom) / 0.1) * smoothstep01((top - height) / 0.1)
      }, 0, 0, -0.3, 0.08)
      loadFloor.visible = true
      piece = lidPanel(edge * 2, top - bottom, 0.05)
      piece.rotation.set(Math.PI / 2 - 0.3, 0.12, 0.05)
      piece.position.set(0, (top + bottom) / 2 - y0, frame.tailZ + 0.1)
    } else {
      const z0 = frame.tailGlassZ + 0.06
      const z1 = frame.tailZ - 0.06
      shift((x, y, z) => {
        if (z < z0 || z > z1 || y + y0 < spec.tailTop - 0.1 || Math.abs(x) > edge) return 0
        return smoothstep01((edge - Math.abs(x)) / 0.16) * smoothstep01((z - z0) / 0.1) * smoothstep01((z1 - z) / 0.1)
      }, 0, -0.22, 0, 0.07)
      loadFloor.visible = true
      piece = lidPanel(edge * 2, z1 - z0, 0.04)
      piece.position.set(0, spec.tailTop + 0.08 - y0, (z0 + z1) / 2)
      piece.rotation.set(-0.22, -0.1, 0.06)
    }
    root.add(piece)
    return detachWorld(piece)
  }
  const bendShell = (amount: number): void => {
    const delta = amount - shown.bend
    if (Math.abs(delta) < 0.004) return
    shown.bend = amount
    const span = spec.length
    for (const part of deformables) {
      const position = part.geometry.attributes.position as THREE.BufferAttribute
      const array = position.array as Float32Array
      for (let i = 0; i < position.count; i++) {
        const t = clamp01((part.original[i * 3 + 2] - frame.noseZ) / span)
        const arc = Math.sin(t * Math.PI)
        const dx = delta * 0.17 * arc
        const dy = -Math.abs(delta) * 0.05 * arc
        array[i * 3] += dx
        array[i * 3 + 1] += dy
        part.original[i * 3] += dx
        part.original[i * 3 + 1] += dy
      }
      position.needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
  }
  const tipLocal = new THREE.Vector3(0, -0.05, exhaustLength + 0.08)
  const exhaustTip = (target: THREE.Vector3): THREE.Vector3 | null => {
    if (shown.exhaust !== 1 || exhaust.parent !== root) return null
    exhaust.updateMatrixWorld(true)
    return exhaust.localToWorld(target.copy(tipLocal))
  }
  const scrapeSpec: DentSpec = { radius: 0.9, depth: 0.12, maxDepth: 0.5, darken: 0.2 }
  const detachWorld = (object: THREE.Object3D): THREE.Object3D => {
    root.updateMatrixWorld(true)
    object.updateMatrixWorld(true)
    const world = object.matrixWorld.clone()
    object.removeFromParent()
    world.decompose(object.position, object.quaternion, object.scale)
    return object
  }
  const showDamage = (damage: CarDamage): DetachedPart[] => {
    if (damage.version === shown.version) return []
    shown.version = damage.version
    const out: DetachedPart[] = []
    for (const part of ['frontBumper', 'rearBumper'] as const) {
      const state = damage.bolts[part]
      if (state === shown.bolts[part]) continue
      shown.bolts[part] = state
      const group = bumpers[part]
      if (state === 1) {
        group.rotation.set(part === 'frontBumper' ? -0.12 : 0.12, (part === 'frontBumper' ? 1 : -1) * 0.08, -0.16)
        group.position.y -= 0.04
      } else if (state === 2 && group.parent === root) {
        out.push({ object: detachWorld(group), kind: 'bumper' })
      }
    }
    if (damage.lids.hood > shown.hood) {
      if (shown.hood === 0) {
        const hoodZ = (frame.noseZ + frame.cowlZ) / 2
        dent(new THREE.Vector3(0, spec.noseTop + 0.04 - y0, hoodZ), new THREE.Vector3(0, 1, 0.15).normalize(), 0.9, scrapeSpec)
      }
      if (damage.lids.hood === 2) out.push({ object: tearHood(), kind: 'hood' })
      shown.hood = damage.lids.hood
    }
    if (damage.lids.trunk > shown.trunk) {
      if (shown.trunk === 0) {
        const trunkZ = (frame.tailGlassZ + frame.tailZ) / 2
        dent(new THREE.Vector3(0, spec.tailTop + 0.02 - y0, trunkZ), new THREE.Vector3(0, 1, -0.15).normalize(), 0.8, scrapeSpec)
      }
      if (damage.lids.trunk === 2) out.push({ object: tearTrunk(), kind: 'trunk' })
      shown.trunk = damage.lids.trunk
    }
    if (damage.exhaust > shown.exhaust) {
      shown.exhaust = damage.exhaust
      if (damage.exhaust === 1) exhaust.rotation.set(Math.atan2(Math.max(0.05, spec.sill - 0.09), exhaustLength), 0, 0.04)
      else if (exhaust.parent === root) out.push({ object: detachWorld(exhaust), kind: 'exhaust' })
    }
    bendShell(damage.frameBend * Math.min(1, (1 - damage.frame / 100) * 1.6))
    damage.lamps.forEach((isBroken, i) => {
      if (!isBroken || shown.lamps[i]) return
      shown.lamps[i] = true
      const group = lamps[i]
      const lens = group.getObjectByName('lens')
      const socket = group.getObjectByName('socket')
      if (lens) lens.visible = false
      if (socket) socket.visible = true
    })
    crackMesh.visible = damage.glass > 0.02
    crackMaterial.opacity = Math.min(1, damage.glass * 1.4)
    glass.opacity = 0.6 + damage.glass * 0.25
    glass.roughness = 0.04 + damage.glass * 0.4
    damage.wheels.forEach((state, i) => {
      if (!state.off || shown.wheels[i]) return
      shown.wheels[i] = true
      const wheel = wheels[i]
      const lost = wheel.clone(true)
      wheel.updateMatrixWorld(true)
      wheel.matrixWorld.decompose(lost.position, lost.quaternion, lost.scale)
      wheel.visible = false
      out.push({ object: lost, kind: 'wheel' })
    })
    return out
  }

  const dispose = (): void => {
    root.removeFromParent()
    shadow.removeFromParent()
    shadow.geometry.dispose()
    ;(shadow.material as THREE.Material).dispose()
    const shared = new Set<THREE.Texture | null>([grilleTexture, treadMap, treadNormal, crackTexture(), scuffTexture()])
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const map = (material as THREE.MeshStandardMaterial).map
        if (map && !shared.has(map)) map.dispose()
        material.dispose()
      }
    })
  }

  return { root, body, decals, wheels, paint, shadow, dent, showDamage, exhaustTip, dispose }
}
