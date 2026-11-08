/** A house from its tile data and exterior style: two-tone cladding with a wainscot, trim, shutters, windows, doors, lights, a generated roof (hip, gable or flat) with fascia and gutters, plus floors. */
import * as THREE from 'three/webgpu'
import { FLOOR_MATERIALS } from '../../shared/Catalog'
import { D, LotGrid, W, edgeKey, inLot, type Edge } from '../../shared/Lot'
import { OVERHANGS, PAINTS, PITCHES, WAINSCOTS, type Cladding, type Feature, type HouseStyle } from '../../shared/Style'
import { buildFeatures } from './Features'
import { material, unitBox } from './Kit'
import { surface } from './Surfaces'
import type { TextureName } from './Textures'

export const WALL_HEIGHT = 2.75
const THICK = 0.08
const LOW = 0.32
const DOOR_TOP = 2.15
const SILL = 0.9
const HEAD = 2.05
const FOOTING = 0.24
const MAX_RUN = 4.5
const ROOF_BASE = WALL_HEIGHT + 0.1

export type WallMode = 'up' | 'cut' | 'down'

export interface HouseData {
  walls: Edge[]
  doors: Edge[]
  windows: Edge[]
  floors: [number, number][]
  style: HouseStyle
  features?: Feature[]
}

export interface House {
  group: THREE.Group
  grid: LotGrid
  /** Rebuilds the wall heights for a viewing mode and camera position (in lot tiles). */
  setView(mode: WallMode, camera: THREE.Vector3, roof: boolean): void
  setNight(amount: number, lightsOn: boolean): void
}

const FLOOR_KINDS: { texture: TextureName; size: number; roughness?: number }[] = [
  { texture: 'planks', size: 2.4 }, { texture: 'planks', size: 2.4 }, { texture: 'tile', size: 1.2, roughness: 0.35 },
  { texture: 'tile', size: 1.2, roughness: 0.35 }, { texture: 'carpet', size: 1.5, roughness: 0.95 }, { texture: 'pavers', size: 1.8, roughness: 0.9 },
  { texture: 'planks', size: 3.2, roughness: 0.7 }, { texture: 'brick', size: 1.0, roughness: 0.9 }, { texture: 'stone', size: 2.2, roughness: 0.9 },
  { texture: 'concrete', size: 2.0, roughness: 0.9 }, { texture: 'gravel', size: 1.2, roughness: 1 }, { texture: 'herringbone', size: 1.6 },
  { texture: 'hex', size: 0.8, roughness: 0.35 }, { texture: 'marble', size: 1.4, roughness: 0.2 }, { texture: 'tile', size: 1.0, roughness: 0.5 },
]

const CLADDING_TEXTURES: Record<Cladding, { texture: TextureName; size: number; roughness: number }> = {
  lap: { texture: 'siding', size: 2, roughness: 0.75 }, board: { texture: 'batten', size: 2, roughness: 0.8 }, shake: { texture: 'shake', size: 1.6, roughness: 0.9 },
  brick: { texture: 'brick', size: 1.0, roughness: 0.9 }, stone: { texture: 'stone', size: 1.4, roughness: 0.95 }, stucco: { texture: 'stucco', size: 2, roughness: 0.95 },
  panel: { texture: 'panel', size: 2.4, roughness: 0.6 },
}

const ROOF_SURFACES: Record<HouseStyle['roofMaterial'], { texture: TextureName; size: number; roughness: number; metalness: number }> = {
  shingle: { texture: 'shingles', size: 1.6, roughness: 0.9, metalness: 0 },
  metal: { texture: 'metal', size: 2.4, roughness: 0.35, metalness: 0.55 },
  clay: { texture: 'clay', size: 1.4, roughness: 0.8, metalness: 0 },
  slate: { texture: 'slate', size: 1.2, roughness: 0.6, metalness: 0 },
}

const WHITE = new THREE.Color(1, 1, 1)
const paint = (index: number) => PAINTS[index]?.color ?? PAINTS[0].color

class Batch {
  readonly mesh: THREE.InstancedMesh
  private count = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  constructor(capacity: number, mat: THREE.Material, group: THREE.Group, shadows = true) {
    this.mesh = new THREE.InstancedMesh(unitBox, mat, Math.max(1, capacity))
    this.mesh.count = 0
    this.mesh.castShadow = shadows
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    group.add(this.mesh)
  }

  reset(): void {
    this.count = 0
  }

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color?: THREE.Color): void {
    if (this.count >= this.mesh.instanceMatrix.count) return
    this.mesh.setMatrixAt(this.count, this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz)))
    if (color) this.mesh.setColorAt(this.count, color)
    else if (this.mesh.instanceColor) this.mesh.setColorAt(this.count, WHITE)
    this.count++
  }

  /** A box between two heights on one face of a wall edge: `along` is the offset along the edge, `out` across it. */
  onEdge(edge: Edge, along: number, width: number, y0: number, y1: number, out: number, depth: number, color?: THREE.Color): void {
    const [x, z, v] = edge
    const h = y1 - y0
    if (h <= 0.001) return
    if (v === 0) this.add(x + 0.5 + along, y0 + h / 2, z + out, width, h, depth, color)
    else this.add(x + out, y0 + h / 2, z + 0.5 + along, depth, h, width, color)
  }

  done(): void {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

function tilesAt(x: number, z: number): [number, number][] {
  const xs = Number.isInteger(x) ? [x - 1, x] : [Math.floor(x)]
  const zs = Number.isInteger(z) ? [z - 1, z] : [Math.floor(z)]
  const out: [number, number][] = []
  for (const tx of xs) for (const tz of zs) out.push([tx, tz])
  return out
}

interface RoofBuild {
  meshes: THREE.Mesh[]
  top: number
}

/** The roof over every enclosed area. Hip roofs rise with distance from all outside walls; gables slope on the long sides only and close the ends with wall; flat roofs get a deep fascia. */
function buildRoof(grid: LotGrid, style: HouseStyle): RoofBuild | null {
  const steps = 2
  const nx = W * steps, nz = D * steps
  const pitch = PITCHES[style.pitch] ?? 0.5
  const overhang = style.roofStyle === 'flat' ? 0.18 : (OVERHANGS[style.overhang] ?? 0.4)
  const isIn = (tx: number, tz: number) => inLot(tx, tz) && grid.isInside(tx, tz)
  const insideCell = (i: number, j: number) => grid.isInside(Math.floor(i / steps), Math.floor(j / steps))
  let minX = W, maxX = 0, minZ = D, maxZ = 0
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (grid.isInside(x, z)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z + 1) }
  if (minX >= maxX) return null
  const ridgeX = maxX - minX >= maxZ - minZ
  const key = (i: number, j: number) => i * (nz + 1) + j
  const boundary = new Map<number, { sx: number; sz: number; eave: boolean; x: number; z: number }>()
  const eaves: [number, number][] = []
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = i / steps, z = j / steps
    const touching = tilesAt(x, z)
    let ins = 0, cx = 0, cz = 0
    for (const [tx, tz] of touching) if (isIn(tx, tz)) { ins++; cx += tx + 0.5; cz += tz + 0.5 }
    if (ins === 0 || ins === touching.length) continue
    const dx = x - cx / ins, dz = z - cz / ins
    const sx = Math.abs(dx) < 0.01 ? 0 : Math.sign(dx), sz = Math.abs(dz) < 0.01 ? 0 : Math.sign(dz)
    let eave = true
    if (style.roofStyle === 'gable') {
      eave = false
      if (ridgeX && Number.isInteger(z)) for (const tx of Number.isInteger(x) ? [x - 1, x] : [Math.floor(x)]) if (isIn(tx, z - 1) !== isIn(tx, z)) eave = true
      if (!ridgeX && Number.isInteger(x)) for (const tz of Number.isInteger(z) ? [z - 1, z] : [Math.floor(z)]) if (isIn(x - 1, tz) !== isIn(x, tz)) eave = true
    }
    boundary.set(key(i, j), { sx, sz, eave, x, z })
    if (eave) eaves.push([x, z])
  }
  const heightAt = (x: number, z: number): number => {
    if (style.roofStyle === 'flat') return 0.12
    let d = Infinity
    if (style.roofStyle === 'gable') {
      for (const [bx, bz] of eaves) {
        if (ridgeX ? Math.abs(bx - x) < 0.001 : Math.abs(bz - z) < 0.001) d = Math.min(d, ridgeX ? Math.abs(bz - z) : Math.abs(bx - x))
      }
    }
    if (d === Infinity) for (const [bx, bz] of eaves) d = Math.min(d, Math.max(Math.abs(bx - x), Math.abs(bz - z)))
    return Math.min(d, MAX_RUN) * pitch
  }
  const cache = new Map<number, [number, number, number]>()
  const raw = new Map<number, number>()
  const rawHeight = (i: number, j: number) => {
    const k = key(i, j)
    let h = raw.get(k)
    if (h === undefined) {
      const b = boundary.get(k)
      h = b?.eave && style.roofStyle !== 'flat' ? 0 : heightAt(i / steps, j / steps)
      raw.set(k, h)
    }
    return h
  }
  const vertex = (i: number, j: number): [number, number, number] => {
    const k = key(i, j)
    const hit = cache.get(k)
    if (hit) return hit
    const b = boundary.get(k)
    const x = i / steps, z = j / steps
    let out: [number, number, number]
    if (!b) out = [x, rawHeight(i, j), z]
    else if (style.roofStyle === 'gable') {
      const endScale = 0.45
      const ox = ridgeX ? b.sx * (b.eave && !b.sx ? 0 : b.eave ? overhang : overhang * endScale) : b.sx * overhang
      const oz = ridgeX ? b.sz * overhang : b.sz * (b.eave && !b.sz ? 0 : b.eave ? overhang : overhang * endScale)
      out = [x + ox, b.eave ? -overhang * pitch : rawHeight(i, j), z + oz]
    } else out = [x + b.sx * overhang, style.roofStyle === 'flat' ? 0.12 : -overhang * pitch, z + b.sz * overhang]
    cache.set(k, out)
    return out
  }
  const roof: number[] = []
  const fascia: number[] = []
  const gutters: number[] = []
  const gables: number[] = []
  const push = (list: number[], ...points: [number, number, number][]) => { for (const p of points) list.push(...p) }
  const drop = style.roofStyle === 'flat' ? 0.42 : 0.17
  let top = 0
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (!insideCell(i, j)) continue
    const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1)
    top = Math.max(top, a[1], b[1], c[1], d[1])
    if ((i + j) % 2 === 0) push(roof, a, d, c, a, c, b)
    else push(roof, a, d, b, b, d, c)
    const sides: [boolean, [number, number, number], [number, number, number], [number, number], [number, number], [number, number]][] = [
      [j === 0 || !insideCell(i, j - 1), b, a, [i + 1, j], [i, j], [0, -1]],
      [j === nz - 1 || !insideCell(i, j + 1), d, c, [i, j + 1], [i + 1, j + 1], [0, 1]],
      [i === 0 || !insideCell(i - 1, j), a, d, [i, j], [i, j + 1], [-1, 0]],
      [i === nx - 1 || !insideCell(i + 1, j), c, b, [i + 1, j + 1], [i + 1, j], [1, 0]],
    ]
    for (const [open, p, q, pk, qk, [nxDir, nzDir]] of sides) {
      if (!open) continue
      const p2: [number, number, number] = [p[0], p[1] - drop, p[2]]
      const q2: [number, number, number] = [q[0], q[1] - drop, q[2]]
      push(fascia, p, q, q2, p, q2, p2)
      const pe = boundary.get(key(...pk))?.eave, qe = boundary.get(key(...qk))?.eave
      if (style.gutters && style.roofStyle !== 'flat' && pe && qe) {
        const o = 0.09
        const p3: [number, number, number] = [p[0] + nxDir * o, p[1] - 0.05, p[2] + nzDir * o]
        const q3: [number, number, number] = [q[0] + nxDir * o, q[1] - 0.05, q[2] + nzDir * o]
        const p4: [number, number, number] = [p3[0], p3[1] - 0.14, p3[2]]
        const q4: [number, number, number] = [q3[0], q3[1] - 0.14, q3[2]]
        push(gutters, p3, q3, q4, p3, q4, p4, p2, q2, q4, p2, q4, p4)
      }
      if (style.roofStyle === 'gable' && !(pe && qe)) {
        const px = pk[0] / steps, pz = pk[1] / steps, qx = qk[0] / steps, qz = qk[1] / steps
        const ph = rawHeight(...pk), qh = rawHeight(...qk)
        if (ph > 0.01 || qh > 0.01) push(gables, [px, -0.14, pz], [qx, -0.14, qz], [qx, qh, qz], [px, -0.14, pz], [qx, qh, qz], [px, ph, pz])
      }
    }
  }
  const make = (positions: number[], mat: THREE.Material): THREE.Mesh | null => {
    if (!positions.length) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.y = ROOF_BASE
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  const rs = ROOF_SURFACES[style.roofMaterial]
  const clad = CLADDING_TEXTURES[style.upper]
  const meshes = [
    make(roof, surface(rs.texture, 'roof', { size: rs.size, color: paint(style.roofColor), roughness: rs.roughness, metalness: rs.metalness, side: THREE.DoubleSide })),
    make(fascia, material(paint(style.trimColor), { roughness: 0.6 })),
    make(gutters, material('#d9dcdf', { roughness: 0.4, metalness: 0.5 })),
    make(gables, surface(clad.texture, 'wall', { size: clad.size, color: paint(style.upperColor), roughness: clad.roughness, side: THREE.DoubleSide })),
  ].filter((m): m is THREE.Mesh => !!m)
  for (const m of meshes) (m.material as THREE.Material).side = THREE.DoubleSide
  return { meshes, top: ROOF_BASE + top }
}

export function buildHouse(data: HouseData): House {
  const style = data.style
  const grid = new LotGrid({ walls: data.walls, doors: data.doors, windows: data.windows, floors: data.floors, objects: [] })
  const group = new THREE.Group()
  group.name = 'house'
  const upperColor = new THREE.Color(paint(style.upperColor))
  const lowerColor = new THREE.Color(paint(style.lowerColor))
  const interior = new THREE.Color(paint(style.interiorColor))
  const trimWidth = [0.05, 0.08, 0.12][style.trimWidth] ?? 0.08
  const wainscot = (WAINSCOTS[style.wainscot] ?? 0) * WALL_HEIGHT
  const windowSet = new Set(data.windows.map(([x, z, v]) => edgeKey(x, z, v)))
  const n = data.walls.length
  const nw = data.windows.length
  const nd = data.doors.length

  const cladding = new Map<Cladding, Batch>()
  for (const kind of new Set<Cladding>([style.upper, style.lower])) {
    const t = CLADDING_TEXTURES[kind]
    cladding.set(kind, new Batch(n * 4 + 4, surface(t.texture, 'wall', { size: t.size, roughness: t.roughness }), group))
  }
  const inside = new Batch(n * 2 + 4, surface('plaster', 'wall', { size: 2, roughness: 0.92 }), group)
  const footingSurface = style.foundation === 'brick' ? surface('brick', 'wall', { size: 1, color: '#b0604a', roughness: 0.9 }) : style.foundation === 'concrete' ? surface('concrete', 'wall', { size: 1.5, color: '#c9c6bf', roughness: 0.9 }) : surface('stone', 'wall', { size: 1.4, color: '#c9c2b6', roughness: 0.95 })
  const footing = new Batch(n * 2 + 4, footingSurface, group)
  const trim = new Batch(n * 6 + nw * 20 + nd * 12 + 8, material(paint(style.trimColor), { roughness: 0.55 }), group)
  const shutterMat = material(paint(style.shutterColor), { roughness: 0.6 })
  const shutters = new Batch(nw * 26 + 2, shutterMat, group)
  const doorLeaf = new Batch(nd * 8 + 1, material(paint(style.doorColor), { roughness: 0.45 }), group)
  const knobs = new Batch(nd * 4 + 1, material('#c9a24a', { roughness: 0.25, metalness: 0.9 }), group)
  const steps = new Batch(nd + 1, surface('concrete', 'ground', { size: 1.5, roughness: 0.95 }), group)
  const glassMat = new THREE.MeshStandardMaterial({ color: '#9fc1d6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.5, emissive: new THREE.Color('#ffd58a'), emissiveIntensity: 0 })
  const glass = new Batch(nw + nd * 4 + 1, glassMat, group, false)
  glass.mesh.userData.ownMaterial = glassMat
  const curtains = new Batch(nw * 4 + 1, material('#efe7d6', { roughness: 1 }), group)
  const planters = new Batch(nw + 1, surface('grain', 'tri', { size: 0.9, color: '#8a5d38', roughness: 0.7 }), group)
  const blooms = new Batch(nw * 7 + 1, material('#ffffff', { roughness: 0.9 }), group)
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 0.05, roughness: 0.4 })
  const lamps = new Batch(nd * 2 + 1, lampMat, group, false)
  lamps.mesh.userData.ownMaterial = lampMat
  const lampFrames = new Batch(nd * 4 + 1, material('#1f2124', { roughness: 0.4, metalness: 0.6 }), group)

  const floorBatches = FLOOR_KINDS.map(kind => new Batch(data.floors.length + 1, surface(kind.texture, 'ground', { size: kind.size, roughness: kind.roughness ?? 0.75 }), group, false))
  for (const [index, mat] of data.floors) {
    const x = index % W, z = Math.floor(index / W)
    const batch = floorBatches[mat] ?? floorBatches[0]
    batch.add(x + 0.5, 0.015, z + 0.5, 1, 0.03, 1, new THREE.Color(FLOOR_MATERIALS[mat]?.color ?? '#999999').multiplyScalar(1.15))
  }
  floorBatches.forEach(b => b.done())

  const roof = buildRoof(grid, style)
  const roofGroup = new THREE.Group()
  if (roof) for (const m of roof.meshes) roofGroup.add(m)
  group.add(roofGroup)
  const overhang = style.roofStyle === 'flat' ? 0.18 : (OVERHANGS[style.overhang] ?? 0.4)
  const eaveY = style.roofStyle === 'flat' ? ROOF_BASE - 0.3 : ROOF_BASE - overhang * (PITCHES[style.pitch] ?? 0.5) - 0.17
  const features = buildFeatures(data.features ?? [], grid, style, roof?.top ?? WALL_HEIGHT + 1, { y: eaveY, out: overhang })
  group.add(features.group)

  const ends = new Map<string, { at: [number, number]; h: number; v: number }>()
  for (const [x, z, v] of data.walls) {
    for (const at of [[x, z], v === 0 ? [x + 1, z] : [x, z + 1]] as [number, number][]) {
      const k = `${at[0]},${at[1]}`
      const e = ends.get(k) ?? { at, h: 0, v: 0 }
      if (v === 0) e.h++
      else e.v++
      ends.set(k, e)
    }
  }
  const posts = new Map<string, [number, number]>()
  for (const [k, e] of ends) if (!((e.h === 2 && e.v === 0) || (e.v === 2 && e.h === 0))) posts.set(k, e.at)

  const sideTile = (edge: Edge, side: -1 | 1): [number, number] => {
    const [x, z, v] = edge
    return v === 0 ? (side < 0 ? [x, z - 1] : [x, z]) : (side < 0 ? [x - 1, z] : [x, z])
  }
  const isIn = (tile: [number, number]) => inLot(...tile) && grid.isInside(...tile)
  const batches = [...cladding.values(), inside, footing, trim, shutters, doorLeaf, knobs, steps, glass, curtains, planters, blooms, lamps, lampFrames]
  const bloomColors = ['#e86f9a', '#f2d24b', '#ffffff', '#c44e3f', '#9b7bd8'].map(c => new THREE.Color(c))
  const leafColor = new THREE.Color('#4f8a3f')
  const darker = new THREE.Color(0.78, 0.78, 0.78)

  const drawShutter = (edge: Edge, along: number, out: number) => {
    const w = 0.34, y0 = SILL - 0.02, y1 = HEAD + 0.02
    const depthOut = out + Math.sign(out) * 0.012
    if (style.shutters === 'panel') {
      shutters.onEdge(edge, along, w, y0, y1, out, 0.035)
      for (const [a, b] of [[y0 + 0.08, (y0 + y1) / 2 - 0.04], [(y0 + y1) / 2 + 0.04, y1 - 0.08]]) shutters.onEdge(edge, along, w - 0.1, a, b, depthOut, 0.02, darker)
    } else if (style.shutters === 'louvered') {
      for (const a of [-w / 2 + 0.025, w / 2 - 0.025]) shutters.onEdge(edge, along + a, 0.05, y0, y1, out, 0.04)
      shutters.onEdge(edge, along, w, y0, y0 + 0.05, out, 0.04)
      shutters.onEdge(edge, along, w, y1 - 0.05, y1, out, 0.04)
      for (let k = 1; k < 12; k++) {
        const y = y0 + 0.05 + k * (y1 - y0 - 0.1) / 12
        shutters.onEdge(edge, along, w - 0.08, y - 0.018, y + 0.018, out, 0.03)
      }
    } else if (style.shutters === 'board') {
      for (const a of [-0.11, 0, 0.11]) shutters.onEdge(edge, along + a, 0.1, y0, y1, out, 0.035)
      for (const y of [y0 + 0.18, y1 - 0.18]) shutters.onEdge(edge, along, w, y - 0.04, y + 0.04, depthOut, 0.02, darker)
    }
  }

  let lastKey = ''
  return {
    group,
    grid,
    setView(mode, camera, showRoof) {
      const key = `${mode}|${showRoof}|${mode === 'cut' ? `${Math.round(camera.x / 4)},${Math.round(camera.z / 4)}` : ''}`
      if (key === lastKey) return
      lastKey = key
      for (const b of batches) b.reset()
      const heights = new Map<string, number>()
      for (const edge of data.walls) {
        const [x, z, v] = edge
        let height = WALL_HEIGHT
        if (mode === 'down') height = LOW
        else if (mode === 'cut') {
          const cameraLow = v === 0 ? camera.z < z : camera.x < x
          const far: [number, number] = v === 0 ? (cameraLow ? [x, z] : [x, z - 1]) : (cameraLow ? [x, z] : [x - 1, z])
          if (isIn(far)) height = LOW
        }
        heights.set(edgeKey(x, z, v), height)
        const door = grid.isDoor(x, z, v)
        const window = !door && windowSet.has(edgeKey(x, z, v))
        for (const side of [-1, 1] as const) {
          const out = !isIn(sideTile(edge, side))
          const offset = side * THICK / 2
          const spans: [number, number][] = door ? [[DOOR_TOP, height]] : window ? [[0, Math.min(SILL, height)], [HEAD, height]] : [[0, height]]
          for (const [y0, y1] of spans) {
            if (!out) { inside.onEdge(edge, 0, 1, y0, y1, offset, THICK, interior); continue }
            if (wainscot > 0 && y0 < wainscot) cladding.get(style.lower)!.onEdge(edge, 0, 1, y0, Math.min(y1, wainscot), offset, THICK, lowerColor)
            if (y1 > wainscot) cladding.get(style.upper)!.onEdge(edge, 0, 1, Math.max(y0, wainscot), y1, offset, THICK, upperColor)
          }
          if (!out) continue
          if (height > FOOTING + 0.1 && !door && !(wainscot > 0 && (style.lower === 'brick' || style.lower === 'stone'))) footing.onEdge(edge, 0, 1, 0, FOOTING, side * (THICK / 2 + 0.012), THICK + 0.024)
          if (wainscot > 0 && height > wainscot + 0.05 && !door && !(window && wainscot > SILL && wainscot < HEAD)) trim.onEdge(edge, 0, 1.0, wainscot - 0.03, wainscot + 0.03, side * (THICK / 2 + 0.02), 0.05)
          if (height >= WALL_HEIGHT && style.roofStyle !== 'flat') trim.onEdge(edge, 0, 1.0, WALL_HEIGHT - 0.16, WALL_HEIGHT, side * (THICK / 2 + 0.015), 0.035)
          if (door) {
            steps.onEdge(edge, 0, 1.3, 0, 0.14, side * (THICK + 0.3), 0.6)
            if (style.porchLights && height > DOOR_TOP) for (const along of [-0.62, 0.62]) {
              lamps.onEdge(edge, along, 0.12, 1.62, 1.86, side * (THICK / 2 + 0.11), 0.12)
              lampFrames.onEdge(edge, along, 0.15, 1.86, 1.9, side * (THICK / 2 + 0.11), 0.15)
              lampFrames.onEdge(edge, along, 0.05, 1.7, 1.78, side * (THICK / 2 + 0.03), 0.06)
            }
          }
        }
        if (door && height > DOOR_TOP) {
          const leafH = DOOR_TOP - 0.03
          doorLeaf.onEdge(edge, 0, 0.84, 0, leafH, 0, 0.05)
          for (const side of [-1, 1]) {
            const o = side * 0.03
            switch (style.doorStyle) {
              case 'panel':
                for (const [y0, y1] of [[0.25, 0.95], [1.15, 1.95]]) for (const a of [-0.19, 0.19]) doorLeaf.onEdge(edge, a, 0.3, y0, y1, o, 0.014)
                break
              case 'craftsman':
                for (const a of [-0.24, 0, 0.24]) glass.onEdge(edge, a, 0.18, 1.5, 1.92, o, 0.01)
                doorLeaf.onEdge(edge, 0, 0.7, 1.38, 1.44, o, 0.03)
                for (const a of [-0.19, 0.19]) doorLeaf.onEdge(edge, a, 0.3, 0.22, 1.25, o, 0.014)
                break
              case 'glass':
                glass.onEdge(edge, 0, 0.56, 0.3, 1.9, o, 0.01)
                break
              case 'farmhouse':
                glass.onEdge(edge, 0, 0.6, 1.25, 1.92, o, 0.01)
                for (const a of [-0.3, -0.15, 0, 0.15, 0.3]) doorLeaf.onEdge(edge, a, 0.02, 0.15, 1.1, o, 0.012)
                doorLeaf.onEdge(edge, 0, 0.7, 1.12, 1.2, o, 0.02)
                break
              case 'modern':
                glass.onEdge(edge, 0.3, 0.1, 0.2, 1.95, o, 0.01)
                knobs.onEdge(edge, -0.28, 0.03, 0.7, 1.5, side * 0.07, 0.03)
                break
            }
            if (style.doorStyle !== 'modern') knobs.onEdge(edge, 0.32, 0.06, 0.98, 1.04, side * 0.05, 0.05)
          }
          for (const along of [-0.46, 0.46]) trim.onEdge(edge, along, trimWidth, 0, DOOR_TOP + trimWidth, 0, THICK + 0.05)
          trim.onEdge(edge, 0, 1 + trimWidth, DOOR_TOP, DOOR_TOP + trimWidth + 0.04, 0, THICK + 0.05)
        } else if (door) doorLeaf.onEdge(edge, 0, 0.84, 0, height, 0, 0.05)
        if (window && height > HEAD) {
          const outsideSide = !isIn(sideTile(edge, -1)) ? -1 : !isIn(sideTile(edge, 1)) ? 1 : 0
          glass.onEdge(edge, 0, 0.88, SILL, HEAD, 0, 0.02)
          trim.onEdge(edge, 0, 1.0 + trimWidth, SILL - 0.05, SILL, outsideSide * 0.04, THICK + 0.1)
          trim.onEdge(edge, 0, 0.96 + trimWidth, HEAD, HEAD + trimWidth, 0, THICK + 0.04)
          for (const along of [-0.46, 0.46]) trim.onEdge(edge, along, trimWidth * 0.8, SILL, HEAD, 0, THICK + 0.04)
          const mid = (SILL + HEAD) / 2
          if (style.windowGrid === 'cross') {
            trim.onEdge(edge, 0, 0.03, SILL, HEAD, 0, 0.035)
            trim.onEdge(edge, 0, 0.88, mid - 0.015, mid + 0.015, 0, 0.035)
          } else if (style.windowGrid === 'colonial') {
            for (const a of [-0.15, 0.15]) trim.onEdge(edge, a, 0.025, SILL, HEAD, 0, 0.035)
            for (const y of [SILL + (HEAD - SILL) / 3, SILL + (HEAD - SILL) * 2 / 3]) trim.onEdge(edge, 0, 0.88, y - 0.012, y + 0.012, 0, 0.035)
          } else if (style.windowGrid === 'prairie') {
            for (const a of [-0.3, 0.3]) trim.onEdge(edge, a, 0.025, SILL, HEAD, 0, 0.035)
            for (const y of [SILL + 0.16, HEAD - 0.16]) trim.onEdge(edge, 0, 0.88, y - 0.012, y + 0.012, 0, 0.035)
          }
          if (outsideSide) {
            if (style.shutters !== 'none') for (const along of [-0.66, 0.66]) drawShutter(edge, along, outsideSide * (THICK / 2 + 0.025))
            if (style.windowBoxes) {
              planters.onEdge(edge, 0, 0.9, SILL - 0.28, SILL - 0.06, outsideSide * (THICK / 2 + 0.13), 0.22)
              for (let k = 0; k < 7; k++) blooms.onEdge(edge, -0.36 + k * 0.12, 0.1, SILL - 0.08, SILL + 0.04 + (k % 2) * 0.04, outsideSide * (THICK / 2 + 0.13 + ((k % 3) - 1) * 0.04), 0.1, k % 3 === 1 ? leafColor : bloomColors[k % bloomColors.length])
            }
          }
          const curtainSide = outsideSide ? -outsideSide : 1
          for (const along of [-0.34, 0.34]) curtains.onEdge(edge, along, 0.22, SILL + 0.05, HEAD - 0.02, curtainSide * (THICK / 2 + 0.04), 0.025)
        }
      }
      for (const [px, pz] of posts.values()) {
        let height = 0
        for (const k of [edgeKey(px, pz, 0), edgeKey(px - 1, pz, 0), edgeKey(px, pz, 1), edgeKey(px, pz - 1, 1)]) height = Math.max(height, heights.get(k) ?? 0)
        if (!height) continue
        if (style.cornerBoards) trim.add(px, height / 2, pz, THICK + trimWidth + 0.05, height, THICK + trimWidth + 0.05)
        else cladding.get(style.upper)!.add(px, height / 2, pz, THICK + 0.005, height, THICK + 0.005, upperColor)
      }
      for (const b of batches) b.done()
      roofGroup.visible = showRoof
      features.setRoof(showRoof)
    },
    setNight(amount, lightsOn) {
      glassMat.emissiveIntensity = lightsOn ? 0.1 + amount * 1.6 : 0
      lampMat.emissiveIntensity = style.porchLights ? 0.05 + amount * 3 : 0
      features.setNight(amount)
    },
  }
}
