/**
 * Cargo meshes for the flatbed, lowboy and reefer: I-beam bundles, steel coils on wood cradles, rebar bundles, lumber packs with
 * dunnage, plywood stacks, roof trusses, concrete pipe and shrink-wrapped pallets. Each cargo is a list of units (one mesh group
 * each, arranged on the deck from the front) and `setFill` shows the first `ceil(fill * units)` of them, so loading progress
 * never rebuilds geometry. The file also holds `FallingMaterial`, a pooled stream of small tumbling bits for dumping gravel and
 * pouring grain. Liquids, grain and machines are drawn by their own visuals; `buildCargoModel` returns null for them.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { CargoVisual } from '../../shared/Catalog'
import type { MaterialLibrary } from '../Materials'
import type { CargoLayout } from './trailer/Chassis'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Pool } from '../../systems/Pool'
import { at, box, boxAt, cylinder, latheX, latheZ, tube } from './truck/Geometry'
import type { P3 } from './truck/Geometry'
import { MergeBatch, Palette, disposeAll } from './trailer/Merge'

/** A built cargo: show part of it with `setFill`. */
export interface CargoModel {
  root: TransformNodeType
  meshes: AbstractMesh[]
  /** Height of the cargo above the deck when full (m), for strap and chain placement. */
  height: number
  setFill(fill: number): void
  dispose(): void
}

type UnitParts = Array<[string, VertexData]>

interface Plan {
  units: UnitParts[]
  height: number
}

function beam(cx: number, y: number, z0: number, z1: number, slot: string): UnitParts {
  return [
    [slot, boxAt(cx - 0.011, cx + 0.011, y + 0.03, y + 0.27, z0, z1)],
    [slot, boxAt(cx - 0.1, cx + 0.1, y, y + 0.03, z0, z1)],
    [slot, boxAt(cx - 0.1, cx + 0.1, y + 0.27, y + 0.3, z0, z1)],
  ]
}

function planBeams(layout: CargoLayout, slot: string): Plan {
  const z0 = layout.zRear + 0.2
  const z1 = layout.zFront - 0.2
  const units: UnitParts[] = []
  const layerHeight = 0.62
  for (let layer = 0; layer < 2; layer++) {
    const y = layout.baseY + 0.12 + layer * (layerHeight + 0.12)
    for (let c = -1; c <= 1; c++) {
      const unit: UnitParts = []
      const cx = c * 0.78
      for (const dx of [-0.11, 0.11]) for (const row of [0, 0.31]) unit.push(...beam(cx + dx, y + row, z0, z1, slot))
      for (let z = z0 + 0.6; z < z1; z += 2.4) unit.push(['wood', boxAt(cx - 0.4, cx + 0.4, y - 0.12, y, z - 0.05, z + 0.05)])
      units.push(unit)
    }
  }
  return { units, height: 0.12 + 2 * layerHeight + 0.12 }
}

function planCoils(layout: CargoLayout, slot: string): Plan {
  const radius = 0.55
  const pitch = 1.3
  const count = Math.max(1, Math.floor((layout.zFront - layout.zRear - 0.2) / pitch))
  const units: UnitParts[] = []
  for (let i = 0; i < count; i++) {
    const z = layout.zFront - 0.1 - pitch * (i + 0.5)
    const unit: UnitParts = []
    for (const x of [-0.58, 0.58]) {
      const coil = latheX([[0.2, -0.5], [radius, -0.5], [radius, 0.5], [0.2, 0.5]], 24, { closed: true })
      unit.push([slot, at(coil, x, layout.baseY + 0.14 + radius, z)])
      unit.push(['darkSteel', at(cylinder(0.4, 0.4, 0.98, 14, 'x'), x, layout.baseY + 0.14 + radius, z)])
      unit.push(['wood', boxAt(x - 0.5, x + 0.5, layout.baseY, layout.baseY + 0.14, z - 0.4, z - 0.15)])
      unit.push(['wood', boxAt(x - 0.5, x + 0.5, layout.baseY, layout.baseY + 0.14, z + 0.15, z + 0.4)])
    }
    units.push(unit)
  }
  return { units, height: 0.14 + radius * 2 }
}

function planRebar(layout: CargoLayout, slot: string): Plan {
  const z0 = layout.zRear + 0.2
  const z1 = layout.zFront - 0.2
  const rod = 0.07
  const offsets: Array<[number, number]> = [[0, 0]]
  for (let k = 0; k < 6; k++) offsets.push([Math.cos((Math.PI / 3) * k) * rod, Math.sin((Math.PI / 3) * k) * rod])
  for (let k = 0; k < 12; k++) offsets.push([Math.cos((Math.PI / 6) * k) * rod * 1.95, Math.sin((Math.PI / 6) * k) * rod * 1.95])
  const units: UnitParts[] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let c = 0; c < 5; c++) {
      const cx = (c - 2) * 0.46
      const cy = layout.baseY + 0.12 + 0.22 + layer * 0.46
      const unit: UnitParts = []
      for (const [dx, dy] of offsets) unit.push([slot, at(cylinder(rod, rod, z1 - z0, 6, 'z'), cx + dx, cy + dy, (z0 + z1) / 2)])
      for (let z = z0 + 1; z < z1; z += 3) unit.push(['darkSteel', at(cylinder(0.43, 0.43, 0.03, 14, 'z'), cx, cy, z)])
      if (layer === 0) for (let z = z0 + 0.8; z < z1; z += 2.6) unit.push(['wood', boxAt(cx - 0.25, cx + 0.25, layout.baseY, layout.baseY + 0.12, z - 0.05, z + 0.05)])
      units.push(unit)
    }
  }
  return { units, height: 0.12 + 0.92 }
}

function planLumber(layout: CargoLayout, slot: string): Plan {
  const packLength = 4.4
  const along = Math.max(1, Math.floor((layout.zFront - layout.zRear - 0.2) / (packLength + 0.15)))
  const units: UnitParts[] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let a = 0; a < along; a++) {
      for (let c = 0; c < 2; c++) {
        const cx = c === 0 ? -0.6 : 0.6
        const zc = layout.zFront - 0.2 - packLength / 2 - a * (packLength + 0.15)
        const y = layout.baseY + 0.1 + layer * 0.9
        const unit: UnitParts = []
        for (let b = 0; b < 5; b++) unit.push([b % 2 === 0 ? slot : 'woodPale', boxAt(cx - 0.57, cx + 0.57, y + b * 0.152, y + b * 0.152 + 0.148, zc - packLength / 2, zc + packLength / 2)])
        for (let k = 0; k < 4; k++) unit.push(['wood', boxAt(cx - 0.57, cx + 0.57, y - 0.1, y, zc - packLength / 2 + 0.3 + k * 1.2, zc - packLength / 2 + 0.38 + k * 1.2)])
        for (let k = 0; k < 3; k++) unit.push(['darkSteel', boxAt(cx - 0.58, cx + 0.58, y - 0.005, y + 0.77, zc - 1.5 + k * 1.5, zc - 1.5 + k * 1.5 + 0.03)])
        units.push(unit)
      }
    }
  }
  return { units, height: 0.1 + 1.8 }
}

function planPlywood(layout: CargoLayout, slot: string): Plan {
  const stackLength = 2.44
  const along = Math.max(1, Math.floor((layout.zFront - layout.zRear - 0.2) / (stackLength + 0.06)))
  const units: UnitParts[] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let a = 0; a < along; a++) {
      const zc = layout.zFront - 0.2 - stackLength / 2 - a * (stackLength + 0.06)
      const y = layout.baseY + 0.1 + layer * 0.98
      const unit: UnitParts = []
      for (const cx of [-0.62, 0.62]) {
        for (let b = 0; b < 6; b++) unit.push([b % 2 === 0 ? slot : 'woodPale', boxAt(cx - 0.61, cx + 0.61, y + b * 0.15, y + b * 0.15 + 0.146, zc - stackLength / 2, zc + stackLength / 2)])
        unit.push(['wood', boxAt(cx - 0.61, cx + 0.61, y - 0.1, y, zc - 1.0, zc - 0.92)])
        unit.push(['wood', boxAt(cx - 0.61, cx + 0.61, y - 0.1, y, zc + 0.92, zc + 1.0)])
      }
      units.push(unit)
    }
  }
  return { units, height: 0.1 + 1.96 }
}

function truss(cx: number, y: number, z: number, slot: string): UnitParts {
  const half = 1.15
  const peak = 0.75
  const r = 0.03
  const p = (x: number, h: number): P3 => [cx + x, y + h, z]
  return [
    [slot, tube([p(-half, 0), p(half, 0)], r, 6)],
    [slot, tube([p(-half, 0), p(0, peak), p(half, 0)], r, 6)],
    [slot, tube([p(-0.575, 0), p(-0.575, peak / 2)], r * 0.8, 5)],
    [slot, tube([p(0.575, 0), p(0.575, peak / 2)], r * 0.8, 5)],
    [slot, tube([p(0, 0), p(0, peak)], r * 0.8, 5)],
    [slot, tube([p(-0.575, 0), p(0, peak)], r * 0.7, 5)],
    [slot, tube([p(0.575, 0), p(0, peak)], r * 0.7, 5)],
  ]
}

function planTrusses(layout: CargoLayout, slot: string): Plan {
  const count = Math.min(20, Math.max(2, Math.floor((layout.zFront - layout.zRear - 0.4) / 0.45)))
  const units: UnitParts[] = []
  for (let i = 0; i < count; i++) {
    const z = layout.zFront - 0.3 - i * 0.45
    const unit = truss(0, layout.baseY + 0.1, z, slot)
    unit.push(['wood', boxAt(-1.2, 1.2, layout.baseY, layout.baseY + 0.1, z - 0.05, z + 0.05)])
    units.push(unit)
  }
  return { units, height: 0.85 }
}

function planPipe(layout: CargoLayout, slot: string): Plan {
  const length = 2.4
  const outer = 0.5
  const count = Math.max(1, Math.floor((layout.zFront - layout.zRear - 0.2) / (length + 0.05)))
  const units: UnitParts[] = []
  for (let i = 0; i < count; i++) {
    const z = layout.zFront - 0.15 - length / 2 - i * (length + 0.05)
    const unit: UnitParts = []
    const ring = () => latheZ([[0.38, -length / 2], [outer, -length / 2], [outer, length / 2], [0.38, length / 2]], 20, { closed: true })
    for (const x of [-0.55, 0.55]) {
      unit.push([slot, at(ring(), x, layout.baseY + 0.12 + outer, z)])
      unit.push(['wood', boxAt(x - 0.12, x + 0.12, layout.baseY, layout.baseY + 0.12, z - 1.0, z - 0.8)])
      unit.push(['wood', boxAt(x - 0.12, x + 0.12, layout.baseY, layout.baseY + 0.12, z + 0.8, z + 1.0)])
    }
    unit.push([slot, at(ring(), 0, layout.baseY + 0.12 + outer + 0.86, z)])
    units.push(unit)
  }
  return { units, height: 0.12 + outer * 2 + 0.86 }
}

function planPallets(layout: CargoLayout, slot: string): Plan {
  const width = (layout.width - 0.06) / 2
  const depth = 1.0
  const loadHeight = Math.min(1.25, layout.clearHeight - 0.3)
  const rows = Math.max(1, Math.floor((layout.zFront - layout.zRear - 0.1) / (depth * 2)))
  const units: UnitParts[] = []
  for (let r = 0; r < rows; r++) {
    const unit: UnitParts = []
    for (let k = 0; k < 2; k++) {
      const z = layout.zFront - 0.05 - depth * (r * 2 + k + 0.5)
      for (const x of [-width / 2 - 0.01, width / 2 + 0.01]) {
        unit.push(['wood', boxAt(x - width / 2, x + width / 2, layout.baseY + 0.04, layout.baseY + 0.14, z - depth / 2, z + depth / 2)])
        for (const dz of [-depth / 2 + 0.06, 0, depth / 2 - 0.06]) unit.push(['wood', boxAt(x - width / 2, x + width / 2, layout.baseY, layout.baseY + 0.04, z + dz - 0.05, z + dz + 0.05)])
        unit.push([slot, boxAt(x - width / 2 + 0.03, x + width / 2 - 0.03, layout.baseY + 0.14, layout.baseY + 0.14 + loadHeight, z - depth / 2 + 0.03, z + depth / 2 - 0.03)])
        for (const f of [0.15, 0.5, 0.85]) unit.push(['wrap', boxAt(x - width / 2 + 0.022, x + width / 2 - 0.022, layout.baseY + 0.14 + loadHeight * f - 0.04, layout.baseY + 0.14 + loadHeight * f + 0.04, z - depth / 2 + 0.022, z + depth / 2 - 0.022)])
      }
    }
    units.push(unit)
  }
  return { units, height: 0.14 + loadHeight }
}

function plan(visual: CargoVisual, layout: CargoLayout, slot: string): Plan | null {
  switch (visual) {
    case 'beams': return planBeams(layout, slot)
    case 'coils': return planCoils(layout, slot)
    case 'rebar': return planRebar(layout, slot)
    case 'lumber': return planLumber(layout, slot)
    case 'plywood': return planPlywood(layout, slot)
    case 'trusses': return planTrusses(layout, slot)
    case 'pipe': return planPipe(layout, slot)
    case 'pallets': return planPallets(layout, slot)
    default: return null
  }
}

/**
 * Builds the cargo meshes for a visual on a deck or box floor, or null for visuals drawn elsewhere (dump material, fuel, grain,
 * the excavator). Everything hangs under `parent`.
 */
export function buildCargoModel(scene: Scene, parent: TransformNodeType, mats: MaterialLibrary, visual: CargoVisual, color: string, layout: CargoLayout): CargoModel | null {
  const slot = `matte:${color.toLowerCase()}`
  const built = plan(visual, layout, slot)
  if (!built) return null
  const palette = new Palette(mats)
  const root = new TransformNode(`cargo-${visual}`, scene)
  root.parent = parent
  const meshes: AbstractMesh[] = []
  const nodes: TransformNodeType[] = []
  built.units.forEach((unit, index) => {
    const node = new TransformNode(`cargo-${visual}-${index}`, scene)
    node.parent = root
    const batch = new MergeBatch()
    for (const [part, data] of unit) batch.add(part, data)
    batch.build(scene, `cargo-${visual}-${index}`, node, palette, meshes)
    nodes.push(node)
    node.setEnabled(false)
  })
  let shown = 0
  return {
    root,
    meshes,
    height: built.height,
    setFill(fill) {
      const count = fill <= 0.0001 ? 0 : Math.min(nodes.length, Math.max(1, Math.ceil(fill * nodes.length - 1e-6)))
      if (count === shown) return
      for (let i = 0; i < nodes.length; i++) nodes[i].setEnabled(i < count)
      shown = count
    },
    dispose() {
      disposeAll(meshes)
      disposeAll(nodes)
      root.dispose()
      palette.dispose()
    },
  }
}

interface Bit {
  mesh: InstancedMesh
  vx: number
  vy: number
  vz: number
  spin: number
  life: number
}

/** A pooled stream of small falling bits (gravel, grain) that land and return to the pool. */
export class FallingMaterial {
  private readonly palette: Palette
  private readonly source: Mesh
  private readonly pool: Pool<Bit>
  private readonly live: Bit[] = []
  private readonly sourceHolder: TransformNodeType
  private carry = 0
  private seed = 12345
  private count = 0

  constructor(scene: Scene, private readonly parent: TransformNodeType, mats: MaterialLibrary, color: string, private readonly capacity = 48, size = 0.07) {
    this.palette = new Palette(mats)
    this.sourceHolder = new TransformNode('falling-holder', scene)
    this.sourceHolder.parent = parent
    const batch = new MergeBatch().add(`matte:${color.toLowerCase()}`, box(size, size * 0.8, size * 1.2))
    const meshes: AbstractMesh[] = []
    this.source = batch.build(scene, 'falling-source', this.sourceHolder, this.palette, meshes)[0]
    this.source.isVisible = false
    this.pool = new Pool<Bit>(
      () => {
        const mesh = this.source.createInstance(`falling-${this.count++}`)
        mesh.parent = this.parent
        mesh.isPickable = false
        return { mesh, vx: 0, vy: 0, vz: 0, spin: 0, life: 0 }
      },
      (bit) => bit.mesh.setEnabled(false),
      capacity,
    )
  }

  /** Bits currently in the air. */
  get active(): number {
    return this.live.length
  }

  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  /** Emits `rate * flow` bits per second from a point with a little sideways scatter. */
  pour(dt: number, x: number, y: number, z: number, flow: number, rate = 40, scatter = 0.25): void {
    this.carry += dt * rate * flow
    while (this.carry >= 1 && this.live.length < this.capacity) {
      this.carry -= 1
      const bit = this.pool.acquire()
      const mesh = bit.mesh
      mesh.position.x = x + (this.random() - 0.5) * scatter * 0.4
      mesh.position.y = y
      mesh.position.z = z + (this.random() - 0.5) * scatter * 0.4
      bit.vx = (this.random() - 0.5) * scatter
      bit.vy = -this.random() * 0.5
      bit.vz = (this.random() - 0.5) * scatter
      bit.spin = (this.random() - 0.5) * 12
      bit.life = 0
      mesh.setEnabled(true)
      this.live.push(bit)
    }
    if (this.carry > 4) this.carry = 4
  }

  update(dt: number, groundY: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const bit = this.live[i]
      const mesh = bit.mesh
      bit.vy -= 9.8 * dt
      mesh.position.x += bit.vx * dt
      mesh.position.y += bit.vy * dt
      mesh.position.z += bit.vz * dt
      mesh.rotation.x += bit.spin * dt
      mesh.rotation.z += bit.spin * 0.6 * dt
      bit.life += dt
      if (mesh.position.y <= groundY || bit.life > 4) {
        const last = this.live.length - 1
        this.live[i] = this.live[last]
        this.live.length = last
        if (!this.pool.release(bit)) mesh.dispose()
      }
    }
  }

  dispose(): void {
    for (const bit of this.live) bit.mesh.dispose()
    this.live.length = 0
    this.pool.drain((bit) => bit.mesh.dispose())
    this.source.dispose()
    this.sourceHolder.dispose()
    this.palette.dispose()
  }
}
