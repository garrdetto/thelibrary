/** Builds the Thrill Park around the derby as plain typed arrays, with no renderer of its own (it runs in a worker): Thrill Park's `ParkRenderer` draws the saved park once into a recording backend, then every recorded draw is moved into the arena's frame and merged per 64 m cell (terrain, water, paths, coaster and kart track, stalls, the park entrance and the flat rides' bases), trees and props become instance lists, and each flat ride's moving parts are kept apart so the page can animate them. */
import { ParkRenderer } from '../../../src/lib/park/renderer'
import type { DrawOptions, InstancedDrawOptions, MeshHandle, RenderBackend } from '../../../src/lib/park/backend'
import { STRIDE, mat4, type Mat4, type MeshBuilder } from '../../../src/lib/park/gl'
import { materialTable, M } from '../../../src/lib/park/materials'
import { COASTER_STYLES, FLAT_RIDES, deserializePark, type Entity } from '../../../server/park/index.mjs'

export interface ParkLot {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Quarter turns from the park's axes to the arena's (see `tools/park-scenery.mjs`). */
  turn: number
  /** Ground height of the levelled lot, in park metres. */
  height: number
  /** Lot centre in park metres. */
  centre: [number, number]
  /** The lot in the arena's own metres. */
  module: { x0: number; x1: number; z0: number; z1: number }
}

export interface ParkSceneryData {
  name: string
  owner: string
  scenario: string
  lot: ParkLot
  save: unknown
}

/** Indexed geometry: per-vertex position, normal, linear colour (AO baked in) and pbr = roughness, metalness, glow (+10 where an instance tint applies). */
export interface PackedGeometry {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  pbr: Float32Array
  index: Uint32Array
}

export interface SceneryPayload {
  name: string
  owner: string
  lot: ParkLot
  cells: { geometry: PackedGeometry; kind: 'opaque' | 'water' | 'glass'; near: boolean }[]
  instanced: { geometry: PackedGeometry; matrices: Float32Array; tints: Float32Array; count: number }[]
  rides: { id: number; kind: string; size: [number, number]; wave: string | null; base: Float32Array; parts: PackedGeometry[]; rideTime: number; loadTime: number }[]
}

interface Handle {
  builder: MeshBuilder
  instances?: Float32Array
  count?: number
}

interface Draw {
  handle: Handle
  model: Float32Array | null
  opts: DrawOptions
}

/** ParkRenderer's private pieces reached into here (it runs the real renderer once, with culling switched off). */
interface RendererInternals {
  capturing: boolean
  staticKeys: string[]
  kindMeshes: Map<string, MeshHandle | null>
  list(key: string): { data: Float32Array; count: number }
  visible(x: number, y: number, z: number, r: number): boolean
  cullStatic(margin: number): void
  drawFlat(e: Entity): void
  carMesh(style: string, front: boolean, riders: number, near?: boolean): MeshHandle | null
  rideModel(kind: string, size?: [number, number], wave?: string): { base: MeshHandle | null; parts: { mesh: MeshHandle | null }[] }
  flatMatrix(e: Entity): Float32Array
  slotColors(e: Entity): [number, number, number][]
}

/** A RenderBackend that keeps what it is asked to draw instead of drawing it. */
class Recorder implements RenderBackend {
  readonly shadowsAvailable = false
  shadowPass = false
  shadowBias = 0
  windLevel = 0
  stats = { shadowDraws: 0, mainDraws: 0, shadowVerts: 0, mainVerts: 0, instanceBytes: 0 }
  draws: Draw[] = []
  instanced: { handle: Handle; opts: InstancedDrawOptions }[] = []
  setLevel(): void {}
  probe(): number {
    return 1
  }
  rendererName(): string {
    return 'derby-scenery'
  }
  upload(builder: MeshBuilder): MeshHandle | null {
    return builder.data.length ? ({ builder } satisfies Handle) : null
  }
  setInstances(mesh: MeshHandle | null, data: Float32Array, count: number): void {
    if (!mesh) return
    const handle = mesh as Handle
    handle.instances = data.slice(0, count * 8)
    handle.count = count
  }
  free(): void {}
  beginShadow(): boolean {
    return false
  }
  endShadow(): void {}
  beginPost(): boolean {
    return false
  }
  freePost(): void {}
  endPost(): void {}
  begin(): void {}
  draw(mesh: MeshHandle | null, model?: Mat4, opts: DrawOptions = {}): void {
    if (!mesh || opts.unlit) return
    this.draws.push({ handle: mesh as Handle, model: model ? Float32Array.from(model) : null, opts: { ...opts } })
  }
  drawInstanced(mesh: MeshHandle | null, opts: InstancedDrawOptions = {}): void {
    const handle = mesh as Handle | null
    if (handle?.count) this.instanced.push({ handle, opts: { ...opts } })
  }
  dispose(): void {}
}

const toLinear = (c: number): number => c * (c * (c * 0.305306 + 0.682171) + 0.012523)
const { a: MATERIAL_A } = materialTable()
const IDENTITY = mat4.identity()

/** The park-to-arena transform (column-major): the park's z-up metres turned y-up, the lot centre on the arena's lot centre, the lot floor just under y = 0. */
export function parkToArena(lot: ParkLot): Mat4 {
  const [cx, cy] = lot.centre
  const midX = (lot.module.x0 + lot.module.x1) / 2
  const midZ = (lot.module.z0 + lot.module.z1) / 2
  const [[ax, ay], [bx, by]] = [
    [[1, 0], [0, -1]],
    [[0, 1], [1, 0]],
    [[-1, 0], [0, 1]],
    [[0, -1], [-1, 0]],
  ][((lot.turn % 4) + 4) % 4]
  const m = new Float32Array(16)
  m[0] = ax
  m[2] = bx
  m[4] = ay
  m[6] = by
  m[9] = 1
  m[12] = -(ax * cx + ay * cy) + midX
  m[13] = -lot.height - 0.05
  m[14] = -(bx * cx + by * cy) + midZ
  m[15] = 1
  return m
}

class Batch {
  position: number[] = []
  normal: number[] = []
  color: number[] = []
  pbr: number[] = []
}

function resolveTint(weight: number, opts: DrawOptions): readonly number[] | null {
  if (weight <= 0.05) return null
  if (weight >= 0.95) return opts.tint ?? opts.slots?.[0] ?? [1, 1, 1]
  const slot = Math.max(0, Math.min(8, Math.round(weight * 10) - 1)) + 1
  return opts.slots?.[slot] ?? [1, 1, 1]
}

/** Appends a recorded draw, moved by `m`, with colours, slot tints and AO resolved per vertex; `instanceTint` marks the vertices an instance colour should tint. */
function append(batch: Batch, builder: MeshBuilder, m: Mat4, opts: DrawOptions, instanceTint = false): void {
  const d = builder.data
  const emissive = opts.emissive ?? 0
  for (let o = 0; o < d.length; o += STRIDE) {
    const x = d[o], y = d[o + 1], z = d[o + 2]
    batch.position.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
    const nx = d[o + 3], ny = d[o + 4], nz = d[o + 5]
    const tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz
    const length = Math.hypot(tx, ty, tz) || 1
    batch.normal.push(tx / length, ty / length, tz / length)
    const weight = d[o + 9]
    const tint = instanceTint ? null : resolveTint(weight, opts)
    const ao = 0.25 + 0.75 * Math.min(1, d[o + 11])
    for (let k = 0; k < 3; k++) batch.color.push(toLinear(Math.min(1, d[o + 6 + k] * (tint ? tint[k] : 1))) * ao)
    const material = d[o + 10]
    const glow = (material === M.neon ? 1.6 : material === M.lamp ? 0.6 : 0) + emissive
    batch.pbr.push(Math.max(0.08, MATERIAL_A[material * 4] ?? 0.6), (MATERIAL_A[material * 4 + 1] ?? 0) * 0.85, glow + (instanceTint && weight > 0.02 ? 10 : 0))
  }
}

/** Welds a batch's loose triangles into indexed geometry (vertices that match in position, normal, colour and material). */
function pack(batch: Batch): PackedGeometry {
  const count = batch.position.length / 3
  let size = 1
  while (size < count * 2) size <<= 1
  const table = new Int32Array(size).fill(-1)
  const keys = new Int32Array(count * 12)
  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const pbr = new Float32Array(count * 3)
  const index = new Uint32Array(count)
  const key = new Int32Array(12)
  let unique = 0
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      key[k] = Math.round(batch.position[i * 3 + k] * 500)
      key[3 + k] = Math.round(batch.normal[i * 3 + k] * 120)
      key[6 + k] = Math.round(batch.color[i * 3 + k] * 1000)
      key[9 + k] = Math.round(batch.pbr[i * 3 + k] * 100)
    }
    let h = 2166136261
    for (let k = 0; k < 12; k++) {
      h ^= key[k]
      h = Math.imul(h, 16777619)
    }
    let slot = (h >>> 0) & (size - 1)
    let found = -1
    while (table[slot] >= 0) {
      const j = table[slot]
      let same = true
      for (let k = 0; k < 12 && same; k++) same = keys[j * 12 + k] === key[k]
      if (same) {
        found = j
        break
      }
      slot = (slot + 1) & (size - 1)
    }
    if (found < 0) {
      found = unique++
      table[slot] = found
      keys.set(key, found * 12)
      for (let k = 0; k < 3; k++) {
        position[found * 3 + k] = batch.position[i * 3 + k]
        normal[found * 3 + k] = batch.normal[i * 3 + k]
        color[found * 3 + k] = batch.color[i * 3 + k]
        pbr[found * 3 + k] = batch.pbr[i * 3 + k]
      }
    }
    index[i] = found
  }
  return { position: position.slice(0, unique * 3), normal: normal.slice(0, unique * 3), color: color.slice(0, unique * 3), pbr: pbr.slice(0, unique * 3), index }
}

/** Every buffer in a payload, for transferring it out of the worker without a copy. */
export function payloadBuffers(payload: SceneryPayload): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = []
  const geometry = (g: PackedGeometry) => buffers.push(g.position.buffer as ArrayBuffer, g.normal.buffer as ArrayBuffer, g.color.buffer as ArrayBuffer, g.pbr.buffer as ArrayBuffer, g.index.buffer as ArrayBuffer)
  for (const cell of payload.cells) geometry(cell.geometry)
  for (const item of payload.instanced) {
    geometry(item.geometry)
    buffers.push(item.matrices.buffer as ArrayBuffer, item.tints.buffer as ArrayBuffer)
  }
  for (const ride of payload.rides) {
    buffers.push(ride.base.buffer as ArrayBuffer)
    for (const part of ride.parts) geometry(part)
  }
  return buffers
}

/** Draws the saved park once and packs it for the arena; trees and props farther than `reach` metres from the arena are left out. */
export function buildParkScenery(data: ParkSceneryData, reach: number): SceneryPayload {
  const state = deserializePark(data.save)
  const recorder = new Recorder()
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement
  const renderer = new ParkRenderer(canvas, () => recorder)
  const internals = renderer as unknown as RendererInternals
  renderer.setQuality('medium')
  renderer.setState(state, 0)
  const flats: Entity[] = []
  internals.visible = () => true
  internals.cullStatic = () => {
    for (const key of internals.staticKeys) {
      const list = internals.list(key)
      recorder.setInstances(internals.kindMeshes.get(key) ?? null, list.data, list.count)
    }
  }
  internals.drawFlat = (e: Entity) => {
    flats.push(e)
  }
  const carMesh = internals.carMesh.bind(renderer)
  internals.carMesh = (style, front, riders, near) => (COASTER_STYLES[style]?.trackType === 'kart' ? carMesh(style, front, riders, near) : null)
  internals.capturing = true
  renderer.frame(1000)

  const toArena = parkToArena(data.lot)
  const cellSize = 64
  const cells = new Map<string, { opaque: Batch; water: Batch; glass: Batch; near: boolean }>()
  const cellAt = (x: number, z: number) => {
    const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize)
    const key = `${cx}:${cz}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { opaque: new Batch(), water: new Batch(), glass: new Batch(), near: Math.hypot((cx + 0.5) * cellSize, (cz + 0.5) * cellSize) < cellSize * 1.2 }
      cells.set(key, cell)
    }
    return cell
  }
  const addDraw = (builder: MeshBuilder, model: Float32Array | null, opts: DrawOptions) => {
    const m = model ? mat4.multiply(toArena, model) : toArena
    const d = builder.data
    let sx = 0, sy = 0, sz = 0, n = 0
    const step = STRIDE * Math.max(1, Math.floor(d.length / STRIDE / 64))
    for (let o = 0; o < d.length; o += step) {
      sx += d[o]
      sy += d[o + 1]
      sz += d[o + 2]
      n++
    }
    const centre = mat4.transformPoint(m, [sx / n, sy / n, sz / n])
    const cell = cellAt(centre[0], centre[2])
    const water = (opts.alpha ?? 1) < 0.99 || opts.wave !== undefined
    const glass = !water && d[10] === M.glass
    append(water ? cell.water : glass ? cell.glass : cell.opaque, builder, m, opts)
  }
  for (const draw of recorder.draws) addDraw(draw.handle.builder, draw.model, draw.opts)

  const rides: SceneryPayload['rides'] = []
  for (const e of flats) {
    const kind = e.ride as string
    const def = FLAT_RIDES[kind]
    const size = (e.size ?? def?.size ?? [1, 1]) as [number, number]
    const model = internals.rideModel(kind, e.size, e.wave)
    const base = internals.flatMatrix(e)
    const opts: DrawOptions = { slots: internals.slotColors(e) }
    if (model.base) addDraw((model.base as Handle).builder, base, opts)
    const parts: PackedGeometry[] = []
    for (const part of model.parts) {
      const batch = new Batch()
      if (part.mesh) append(batch, (part.mesh as Handle).builder, IDENTITY, opts)
      parts.push(pack(batch))
    }
    rides.push({ id: e.id, kind, size, wave: (e.wave as string | undefined) ?? null, base: Float32Array.from(mat4.multiply(toArena, base)), parts, rideTime: def?.rideTime ?? 30, loadTime: def?.loadTime ?? 8 })
  }

  const packedCells: SceneryPayload['cells'] = []
  for (const cell of cells.values()) {
    for (const kind of ['opaque', 'water', 'glass'] as const) {
      if (cell[kind].position.length) packedCells.push({ geometry: pack(cell[kind]), kind, near: cell.near })
    }
  }

  const instanced: SceneryPayload['instanced'] = []
  for (const { handle, opts } of recorder.instanced) {
    const data = handle.instances
    const count = handle.count ?? 0
    if (!data || !count) continue
    const kept: number[] = []
    for (let i = 0; i < count; i++) {
      const o = i * 8
      const at = mat4.transformPoint(toArena, [data[o], data[o + 1], data[o + 2]])
      if (Math.hypot(at[0], at[2]) <= reach) kept.push(i)
    }
    if (!kept.length) continue
    const batch = new Batch()
    append(batch, handle.builder, IDENTITY, { emissive: Math.min(0.5, opts.emissive ?? 0) }, true)
    const matrices = new Float32Array(kept.length * 16)
    const tints = new Float32Array(kept.length * 3)
    kept.forEach((i, n) => {
      const o = i * 8
      const s = data[o + 7]
      matrices.set(mat4.chain(toArena, mat4.translation(data[o], data[o + 1], data[o + 2]), mat4.rotZ(data[o + 3]), mat4.scaling(s, s, s)), n * 16)
      tints[n * 3] = toLinear(data[o + 4])
      tints[n * 3 + 1] = toLinear(data[o + 5])
      tints[n * 3 + 2] = toLinear(data[o + 6])
    })
    instanced.push({ geometry: pack(batch), matrices, tints, count: kept.length })
  }
  return { name: data.name, owner: data.owner, lot: data.lot, cells: packedCells, instanced, rides }
}
