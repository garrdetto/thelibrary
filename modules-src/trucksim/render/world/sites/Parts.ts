/**
 * Original building and equipment models for the work sites, each drawn into a `SceneryBatch` in its own frame (origin on the
 * ground at the footprint centre, front toward local +z) and returning the collision boxes of its solid parts. Commercial
 * parts (showroom, warehouse, canopy, store front) and industrial parts (tanks, columns, pipe racks, flare stack, silos,
 * crusher, mill hall, stacks, lumber and log stacks, containers, half-built frames, cranes, overpass piers). Plain block
 * lettering only; no brands.
 */

import type { SceneryBatch, UvRect } from '../../lots/Batch'
import { dieselIsland, localBox } from '../../lots/Items'
import type { LocalBox } from '../../lots/Items'

/** A shop front: brick or siding box with a glass band, door, slanted awning, parapet and an optional lettered board. */
export function shopFront(b: SceneryBatch, wl: number, dl: number, h: number, wall: string, awning: string, uv: UvRect | null): LocalBox[] {
  b.box('concrete', 0, -1, 0, wl + 0.1, 1.5, dl + 0.1)
  b.box(wall, 0, 0.5, 0, wl, h - 0.5, dl)
  b.box('roofDark', 0, h, 0, wl + 0.1, 0.25, dl + 0.1)
  b.box(wall, 0, h, dl / 2 - 0.1, wl + 0.2, 0.9, 0.2)
  b.box(wall, 0, h, -dl / 2 + 0.1, wl + 0.2, 0.9, 0.2)
  b.box(wall, -wl / 2 + 0.1, h, 0, 0.2, 0.9, dl)
  b.box(wall, wl / 2 - 0.1, h, 0, 0.2, 0.9, dl)
  const front = dl / 2
  b.box('metalDark', 0, 0.5, front + 0.03, wl - 1.2, 2.7, 0.05)
  b.box('glass', 0, 0.6, front + 0.07, wl - 1.4, 2.5, 0.03)
  const mullions = Math.max(1, Math.round((wl - 1.4) / 2.5))
  for (let i = 0; i <= mullions; i++) b.box('metalDark', -(wl - 1.4) / 2 + (i * (wl - 1.4)) / mullions, 0.5, front + 0.09, 0.08, 2.7, 0.06)
  b.box('darkSteel', wl / 2 - 1.6, 0.5, front + 0.1, 1.0, 2.2, 0.06)
  b.slope(awning, -wl / 2 + 0.3, front, wl / 2 - 0.3, front + 1.4, 3.0, 3.5, '+z')
  if (uv) {
    const width = Math.min(wl - 1.6, 4.4)
    b.box('boardDark', 0, 3.6, front + 0.12, width + 0.5, width / 4 + 0.3, 0.2)
    b.placard('boardSign', '+z', front + 0.225, 0, 3.75 + width / 8, width, uv)
  }
  if (h > 5.5) {
    const count = Math.max(1, Math.floor((wl - 1) / 3))
    for (let i = 0; i < count; i++) {
      const x = -wl / 2 + 0.5 + ((i + 0.5) * (wl - 1)) / count
      b.box('siding', x, 4.4, front + 0.04, 1.4, 1.5, 0.06)
      b.box('glass', x, 4.5, front + 0.08, 1.2, 1.3, 0.03)
    }
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, h + 0.9, dl / 2)]
}

/** A dealership showroom with a glass front, steel columns, a lettered fascia and a service wing wall at the back. */
export function showroom(b: SceneryBatch, wl: number, dl: number, uv: UvRect | null): LocalBox[] {
  const front = dl / 2
  const glassDepth = Math.min(10, dl - 8)
  b.box('concrete', 0, 0, 0, wl + 0.2, 0.4, dl + 0.2)
  b.box('metalGrey', 0, 0.4, -dl / 2 + (dl - glassDepth) / 2, wl, 5.6, dl - glassDepth)
  b.box('metalGrey', -wl / 2 + 0.15, 0.4, front - glassDepth / 2, 0.3, 5.6, glassDepth)
  b.box('metalGrey', wl / 2 - 0.15, 0.4, front - glassDepth / 2, 0.3, 5.6, glassDepth)
  b.box('concreteDark', 0, 0.4, front - glassDepth / 2, wl - 0.6, 0.05, glassDepth - 0.4)
  b.box('glass', 0, 0.8, front - 0.15, wl - 1.0, 4.6, 0.06)
  b.box('glass', -wl / 2 + 0.45, 0.8, front - glassDepth / 2, 0.06, 4.6, glassDepth - 0.8)
  b.box('glass', wl / 2 - 0.45, 0.8, front - glassDepth / 2, 0.06, 4.6, glassDepth - 0.8)
  const bays = Math.max(2, Math.round(wl / 6))
  for (let i = 0; i <= bays; i++) b.box('metalDark', -wl / 2 + 0.5 + (i * (wl - 1)) / bays, 0.4, front - 0.15, 0.3, 5.0, 0.3)
  b.box('metalDark', 0, 0.4, front - 0.15, 3.4, 2.6, 0.34)
  b.box('glass', 0, 0.45, front - 0.1, 3.0, 2.5, 0.05)
  b.box('roofDark', 0, 6.0, 0, wl + 0.8, 0.3, dl + 0.8)
  b.box('metalBlue', 0, 5.0, front + 0.35, wl + 0.8, 1.0, 0.3)
  b.box('boardDark', 0, 6.3, front - 0.4, 12, 3.0, 0.4)
  if (uv) b.placard('boardSign', '+z', front - 0.19, 0, 7.8, 11.2, uv)
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * (wl / 4)
    b.box('steelRaw', x, 0.45, front - 5.5, 4.2, 0.35, 8.5)
    b.box('lampWhite', x, 5.6, front - 5.5, 3.2, 0.05, 1.0)
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 6.3, dl / 2)]
}

/**
 * A long insulated warehouse: panel walls with a coloured band, a flat roof with refrigeration units, a raised dock face on
 * the front (+z) with flush dock doors at the given local x positions, and man doors at the ends.
 */
export function warehouse(b: SceneryBatch, wl: number, dl: number, h: number, wall: string, band: string, doorXs: readonly number[], uv: UvRect | null): LocalBox[] {
  const front = dl / 2
  b.box('concrete', 0, 0, 0, wl + 0.1, 1.2, dl + 0.1)
  b.box(wall, 0, 1.2, 0, wl, h - 1.2, dl)
  b.box(band, 0, h - 1.6, 0, wl + 0.1, 1.0, dl + 0.1)
  b.box('roofDark', 0, h, 0, wl + 0.4, 0.3, dl + 0.4)
  for (let x = -wl / 2 + 6; x < wl / 2 - 3; x += 6) {
    b.box('concreteDark', x, 1.2, front + 0.01, 0.06, h - 3, 0.02)
    b.box('concreteDark', x, 1.2, -front - 0.01, 0.06, h - 3, 0.02)
  }
  for (const x of doorXs) {
    b.box('darkSteel', x, 1.2, front + 0.02, 3.1, 3.5, 0.04)
    b.box('metalDark', x - 1.7, 1.2, front + 0.04, 0.2, 3.7, 0.08)
    b.box('metalDark', x + 1.7, 1.2, front + 0.04, 0.2, 3.7, 0.08)
    b.box('metalDark', x, 4.7, front + 0.04, 3.6, 0.25, 0.08)
    b.box('concrete', x, 0, front + 0.15, 3.6, 1.2, 0.3)
  }
  for (const end of [-1, 1]) {
    b.box('darkSteel', end * (wl / 2 - 2), 1.2, front + 0.03, 1.0, 2.1, 0.06)
    b.box('darkSteel', end * (wl / 2 + 0.03), 1.2, 0, 0.06, 2.1, 1.0)
  }
  for (let x = -wl / 2 + 12; x < wl / 2 - 8; x += 24) {
    b.box('metalGrey', x, h + 0.3, dl / 4, 4.5, 1.6, 3.0)
    b.cylinder('metalDark', x + 6, h + 0.3, dl / 4, 0.9, 0.5, 10)
    b.box('metalGrey', x, h + 0.3, -dl / 4, 2.0, 1.1, 2.0)
  }
  if (uv) {
    b.box('boardDark', -wl / 2 + 16, h - 5.2, front + 0.08, 10, 2.6, 0.16)
    b.placard('boardSign', '+z', front + 0.17, -wl / 2 + 16, h - 3.9, 9.2, uv)
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, h + 0.3, dl / 2)]
}

/** Default column positions (local) under a canopy: a column every ~14 m along both long edges. */
export function canopyColumns(wl: number, dl: number): [number, number][] {
  const out: [number, number][] = []
  const count = Math.max(2, Math.round(wl / 14) + 1)
  for (let i = 0; i < count; i++) {
    const x = -wl / 2 + 0.7 + (i * (wl - 1.4)) / (count - 1)
    out.push([x, -dl / 2 + 0.7], [x, dl / 2 - 0.7])
  }
  return out
}

/** A pump canopy: a slab on the given columns with lamps underneath; only the columns are solid. */
export function canopy(b: SceneryBatch, wl: number, dl: number, color: string, uv: UvRect | null, columns: readonly (readonly [number, number])[]): LocalBox[] {
  b.box('metalWhite', 0, 5.2, 0, wl, 0.7, dl)
  b.box(color, 0, 5.3, 0, wl + 0.06, 0.4, dl + 0.06)
  const lampsX = Math.max(1, Math.floor(wl / 8))
  for (let i = 0; i < lampsX; i++) for (const z of [-dl / 4, dl / 4]) b.box('lampWhite', -wl / 2 + ((i + 0.5) * wl) / lampsX, 5.16, z, 1.2, 0.04, 1.2)
  const out: LocalBox[] = []
  for (const [x, z] of columns) {
    b.box('metalWhite', x, 0, z, 0.5, 5.2, 0.5)
    b.box('metalYellow', x, 0, z, 0.56, 0.6, 0.56)
    out.push(localBox(x - 0.28, 0, z - 0.28, x + 0.28, 5.2, z + 0.28))
  }
  if (uv) {
    b.box('boardDark', 0, 5.9, dl / 2 - 0.4, 7, 1.9, 0.2)
    b.placard('boardSign', '+z', dl / 2 - 0.29, 0, 6.85, 6.4, uv)
  }
  return out
}

/** A truck-stop diesel island along local z (see `dieselIsland`): one fuelling point per truck length, DEF beside each. */
export function pumps(b: SceneryBatch, length: number, color: string): LocalBox[] {
  dieselIsland(b, false, length, color)
  return [localBox(-0.7, 0, -length / 2, 0.7, 2.7, length / 2)]
}

/** A tall pylon with a lettered board on both faces. */
export function pylon(b: SceneryBatch, h: number, uv: UvRect | null): LocalBox[] {
  b.box('concrete', 0, 0, 0, 1.4, 0.6, 1.4)
  b.box('metalDark', 0, 0.6, 0, 0.5, h - 0.6, 0.5)
  b.box('boardDark', 0, h - 1.9, 0, 0.5, 1.9, 7)
  b.box('metalWhite', 0, h, 0, 0.56, 0.18, 7.1)
  if (uv) {
    b.placard('boardSign', '+x', 0.26, 0, h - 0.95, 6.4, uv)
    b.placard('boardSign', '-x', -0.26, 0, h - 0.95, 6.4, uv, true)
  }
  return [localBox(-0.7, 0, -0.7, 0.7, h, 0.7)]
}

/** A cylindrical storage tank with a roof, rim, ladder, bands and a concrete ring. */
export function tank(b: SceneryBatch, r: number, h: number, key: string): LocalBox[] {
  b.cylinder('concrete', 0, 0, 0, r + 0.6, 0.5, 20)
  b.cylinder(key, 0, 0.5, 0, r, h, 22)
  b.cylinder('metalDark', 0, 0.5 + h, 0, r + 0.12, 0.35, 22)
  b.cylinder(key, 0, 0.85 + h, 0, r, 1.1, 22, r * 0.2)
  for (const f of [0.33, 0.66]) b.cylinder('metalDark', 0, 0.5 + h * f, 0, r + 0.05, 0.25, 22, r + 0.05, 'y', false)
  b.box('metalDark', r + 0.12, 0.5, 0, 0.12, h, 0.7)
  b.box('metalDark', r * 0.5, 0.5 + h + 0.35, 0, r, 0.1, 0.9)
  b.cylinder('metalDark', -r * 0.4, 1.9 + h, 0, 0.5, 0.6, 8)
  const s = r * 0.8
  return [localBox(-s, 0, -s, s, h + 1.9, s)]
}

/** A distillation column: tall tapered shell, bands, platforms, a cage ladder, side piping and a domed top. */
export function column(b: SceneryBatch, r: number, h: number): LocalBox[] {
  b.cylinder('concrete', 0, 0, 0, r + 1.2, 1.0, 14)
  b.cylinder('tankSilver', 0, 1.0, 0, r, h, 16)
  b.cylinder('tankSilver', 0, 1.0 + h, 0, r, 2.2, 16, 0.25)
  for (let y = 7; y < h; y += 9) {
    b.cylinder('metalDark', 0, y, 0, r + 0.12, 0.35, 16, r + 0.12, 'y', false)
    b.cylinder('metalDark', 0, y + 1.0, 0, r + 1.3, 0.12, 16, r + 1.3)
    b.box('metalDark', 0, y + 1.1, 0, 0.06, 0.06, 0.06)
  }
  b.box('metalDark', r + 0.25, 1.0, 0, 0.8, h, 0.8)
  b.beam('metalDark', r, h * 0.82, 0, r + 4.5, h * 0.82, 0, 0.5, 0.5)
  b.beam('metalDark', r + 4.5, h * 0.82, 0, r + 4.5, 4, 0, 0.5, 0.5)
  b.cylinder('tankSilver', r + 4.5, 0, 0, 1.2, 3.8, 12)
  const s = r + 1
  return [localBox(-s, 0, -s, s, h + 3, s), localBox(r + 3.3, 0, -1.2, r + 5.7, 4, 1.2)]
}

/** A pipe rack: paired posts every 6 m under stacked cross beams, with three pipes running the length. */
export function pipeRack(b: SceneryBatch, length: number): LocalBox[] {
  const out: LocalBox[] = []
  const posts = Math.max(2, Math.floor(length / 6) + 1)
  for (let i = 0; i < posts; i++) {
    const x = -length / 2 + (i * length) / (posts - 1)
    for (const z of [-1.5, 1.5]) b.box('metalDark', x, 0, z, 0.35, 7, 0.35)
    b.box('metalDark', x, 6.7, 0, 0.3, 0.3, 3.4)
    b.box('metalDark', x, 4.2, 0, 0.2, 0.2, 3.2)
    out.push(localBox(x - 0.2, 0, -1.7, x + 0.2, 7, 1.7))
  }
  b.cylinder('tankWhite', -length / 2, 7.2, -1.0, 0.35, length, 10, 0.35, 'x')
  b.cylinder('steelRaw', -length / 2, 7.2, 0.2, 0.22, length, 10, 0.22, 'x')
  b.cylinder('tankRed', -length / 2, 7.15, 1.1, 0.3, length, 10, 0.3, 'x')
  b.cylinder('tankSilver', -length / 2, 4.6, -0.6, 0.18, length, 8, 0.18, 'x')
  return out
}

/** A flare stack with a tapered stem, a knock-out drum at the foot and a lit flame. */
export function flareStack(b: SceneryBatch, h: number): LocalBox[] {
  b.cylinder('concrete', 0, 0, 0, 3.2, 0.4, 14)
  b.cylinder('metalDark', 0, 0.4, 0, 0.65, h, 12, 0.35)
  b.cylinder('metalDark', 0, h + 0.4, 0, 0.55, 1.2, 12, 0.55)
  b.cylinder('lampAmber', 0, h + 1.6, 0, 0.5, 3.2, 8, 0.05)
  for (let y = 14; y < h; y += 14) b.cylinder('metalWhite', 0, y, 0, 0.7, 0.4, 12, 0.7, 'y', false)
  b.cylinder('tankSilver', -4.5, 1.8, 6, 1.5, 9, 14, 1.5, 'x')
  b.box('metalDark', -2.5, 0, 6, 0.5, 1.8, 1.4)
  b.box('metalDark', 2.5, 0, 6, 0.5, 1.8, 1.4)
  b.beam('metalDark', 0, 1.6, 3, 0, 1.8, 5.5, 0.3, 0.3)
  return [localBox(-3, 0, -3, 3, h + 1, 3), localBox(-4.5, 0, 4.4, 4.5, 3.4, 7.6)]
}

/** A grid of concrete silos with a taller headhouse, a leg tower and a gallery on top. */
export function siloCluster(b: SceneryBatch, columns: number, rows: number, r: number, h: number): LocalBox[] {
  const out: LocalBox[] = []
  const pitch = r * 2 + 0.6
  const x0 = -((columns - 1) * pitch) / 2
  const z0 = -((rows - 1) * pitch) / 2
  b.box('concrete', 0, 0, 0, columns * pitch + 1.2, 1.2, rows * pitch + 1.2)
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const x = x0 + i * pitch
      const z = z0 + j * pitch
      b.cylinder('concrete', x, 1.2, z, r, h, 20)
      b.cylinder('concreteDark', x, 1.2 + h, z, r + 0.15, 0.5, 20)
      b.cylinder('concreteDark', x, 1.7 + h, z, r, 1.6, 20, r * 0.35)
      for (const y of [h * 0.3, h * 0.65]) b.cylinder('concreteDark', x, y, z, r + 0.06, 0.3, 20, r + 0.06, 'y', false)
      out.push(localBox(x - r * 0.85, 0, z - r * 0.85, x + r * 0.85, h + 3, z + r * 0.85))
    }
  }
  const hx = x0 - pitch * 0.75 - 3
  b.box('concrete', hx, 1.2, 0, 7, h + 14, 9)
  b.gable('roofDark', 'concrete', hx - 3.5, -4.5, hx + 3.5, 4.5, h + 15.2, 2.4, 'x', 0.4)
  b.box('metalGrey', hx + 5.6, 1.2, 0, 4.2, h + 22, 4.2)
  b.box('roofDark', hx + 5.6, h + 23.2, 0, 5, 0.5, 5)
  b.beam('metalDark', hx + 3.2, h + 8, 0, x0 + (columns - 1) * pitch, h + 4, 0, 1.4, 1.4)
  out.push(localBox(hx - 3.5, 0, -4.5, hx + 7.7, h + 24, 4.5))
  return out
}

/** A conical stockpile of crushed stone or sand. */
/**
 * A stone stockpile as it lies off a stacker: a cone at the material's angle of repose (`h` about 0.7 `r`, 35°) with a slumped
 * shoulder, two side lumps where loads were dropped, and spilled stones round the toe.
 */
export function stockpile(b: SceneryBatch, r: number, h: number, key: string): LocalBox[] {
  b.cylinder(key, 0, 0, 0, r, h * 0.82, 22, r * 0.22)
  b.cylinder(key, 0, h * 0.82, 0, r * 0.22, h * 0.18, 14, r * 0.04)
  b.cylinder(key, r * 0.35, 0, -r * 0.2, r * 0.72, h * 0.62, 16, r * 0.14)
  b.cylinder(key, -r * 0.42, 0, r * 0.28, r * 0.6, h * 0.48, 14, r * 0.16)
  b.cylinder(key, 0, 0, 0, r * 1.08, h * 0.08, 22, r)
  for (let k = 0; k < 14; k++) {
    const a = k * 2.399
    const d = r * (1.02 + (k % 4) * 0.05)
    const size = 0.18 + (k % 3) * 0.09
    b.box(key, Math.cos(a) * d, 0, Math.sin(a) * d, size * 1.3, size, size)
  }
  const s = r * 0.62
  return [localBox(-s, 0, -s, s, h * 0.7, s)]
}

/** A crusher plant: a screening frame and hopper with a feed conveyor climbing to a stockpile. */
/**
 * A radial stacker: an inclined lattice conveyor from the crusher's discharge (local −x end, low) to the head pulley over a
 * stockpile (local +x end, high), on an A-frame and a wheeled pivot leg, belt and idlers, and a short spout at the head.
 * `length` is the run along local x, `rise` the head's height.
 */
export function stacker(b: SceneryBatch, length: number, rise: number): LocalBox[] {
  const x0 = -length / 2
  const x1 = length / 2
  const tail = 2.2
  for (const z of [-0.55, 0.55]) b.beam('metalYellow', x0, tail, z, x1, rise, z, 0.16, 0.22)
  const panels = Math.max(4, Math.round(length / 3))
  for (let i = 0; i <= panels; i++) {
    const t = i / panels
    const x = x0 + (x1 - x0) * t
    const y = tail + (rise - tail) * t
    b.beam('metalYellow', x, y, -0.55, x, y, 0.55, 0.1, 0.1)
    if (i < panels) {
      const xn = x0 + (x1 - x0) * (t + 1 / panels)
      const yn = tail + (rise - tail) * (t + 1 / panels)
      b.beam('metalYellow', x, y - 0.35, -0.55, xn, yn, -0.55, 0.06, 0.06)
      b.beam('metalYellow', x, y - 0.35, 0.55, xn, yn, 0.55, 0.06, 0.06)
    }
  }
  b.beam('rubber', x0, tail + 0.18, 0, x1, rise + 0.18, 0, 0.9, 0.04)
  const mid = x0 + length * 0.55
  const midY = tail + (rise - tail) * 0.55
  for (const z of [-0.5, 0.5]) b.beam('metalDark', mid - 1.2, 0, z * 3.2, mid, midY - 0.2, z, 0.18, 0.18)
  b.cylinder('rubber', mid - 1.2, 0.45, -1.9, 0.45, 0.35, 12, 0.45, 'z')
  b.cylinder('rubber', mid - 1.2, 0.45, 1.55, 0.45, 0.35, 12, 0.45, 'z')
  b.box('metalDark', x0 + 0.4, 0, 0, 0.6, tail, 0.6)
  b.cylinder('metalDark', x1, rise, -0.6, 0.32, 1.2, 12, 0.32, 'z')
  b.box('metalYellow', x1 + 0.3, rise - 1.1, 0, 0.7, 1.1, 0.9)
  return [localBox(mid - 1.6, 0, -2, mid + 0.4, midY, 2)]
}

export function crusherPlant(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const cx = wl / 2 - 9
  b.box('concrete', cx, 0, 0, 14, 0.5, dl - 2)
  b.box('metalYellow', cx, 0.5, 0, 9, 6.5, 8)
  b.box('metalDark', cx + 1, 7.0, 0, 5, 1.6, 6)
  b.prism('metalYellow', [[cx - 6, 11], [cx + 1.2, 11], [cx - 0.5, 8], [cx - 4.5, 8]], -4.5, 4.5)
  for (const z of [-3, 3]) b.box('metalDark', cx - 3, 0.5, z, 0.6, 10.5, 0.6)
  b.box('metalDark', cx + 5.4, 0.5, 0, 0.5, 4.5, 3)
  const px = -wl / 2 + 9
  b.beam('metalDark', cx - 4.6, 7.5, 0, px + 2, 15, 0, 1.4, 0.7)
  b.beam('rubber', cx - 4.6, 7.9, 0, px + 2, 15.4, 0, 1.2, 0.1)
  for (let t = 0.2; t < 1; t += 0.2) {
    const x = cx - 4.6 + (px + 2 - (cx - 4.6)) * t
    const y = 7.5 + 7.5 * t
    b.box('metalDark', x, 0, 0, 0.3, y, 0.3)
  }
  b.cylinder('rock', px, 0, 0, 10, 5.6, 18, 2.4)
  b.cylinder('rock', px, 5.6, 0, 2.4, 1.3, 12, 0.5)
  b.cylinder('rock', px + 3.5, 0, 2.5, 6, 3.6, 14, 1.4)
  const s = 8 * 0.62
  return [localBox(cx - 5.5, 0, -4, cx + 5.5, 11, 4), localBox(px - s, 0, -s, px + s, 10, s)]
}

/** A tall stack: tapered brick or steel with bands and a pale cap. */
export function smokestack(b: SceneryBatch, r: number, h: number, key: string): LocalBox[] {
  b.cylinder('concrete', 0, 0, 0, r + 1.5, 1.0, 14)
  b.cylinder(key, 0, 1.0, 0, r, h, 16, r * 0.7)
  for (const f of [0.5, 0.8]) b.cylinder('metalDark', 0, 1 + h * f, 0, r * (1 - 0.3 * f) + 0.08, 0.5, 16, r * (1 - 0.3 * f) + 0.08, 'y', false)
  b.cylinder('metalWhite', 0, h, 0, r * 0.72, 1.0, 16, r * 0.72)
  b.cylinder('metalYellow', 0, h * 0.9, 0, r * 0.73, 1.2, 16, r * 0.73, 'y', false)
  const s = r + 1
  return [localBox(-s, 0, -s, s, h + 1, s)]
}

/** A big mill hall: gable roof with a glazed clerestory, end openings and wall ribs. */
export function millHall(b: SceneryBatch, wl: number, dl: number, h: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, wl + 0.1, 1.2, dl + 0.1)
  b.box('metalGrey', 0, 1.2, 0, wl, h - 1.2, dl)
  b.gable('metalDark', 'metalGrey', -wl / 2, -dl / 2, wl / 2, dl / 2, h, Math.min(5, dl * 0.12), 'x', 0.5)
  b.box('glass', 0, h + 2.4, 0, wl * 0.7, 1.1, dl * 0.2)
  for (let x = -wl / 2 + 8; x < wl / 2 - 4; x += 8) {
    b.box('metalDark', x, 1.2, dl / 2 + 0.05, 0.3, h - 2, 0.12)
    b.box('metalDark', x, 1.2, -dl / 2 - 0.05, 0.3, h - 2, 0.12)
  }
  b.box('darkSteel', -wl / 2 + 10, 0, dl / 2 + 0.05, 9, 8, 0.1)
  b.box('darkSteel', wl / 2 - 10, 0, dl / 2 + 0.05, 9, 8, 0.1)
  b.box('metalYellow', 0, h - 3, dl / 2 + 0.5, wl - 2, 0.5, 0.5)
  for (const x of [-wl / 2 + 1, wl / 2 - 1]) b.box('metalYellow', x, 0, dl / 2 + 0.5, 0.5, h - 3, 0.5)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, h + 3, dl / 2)]
}

/** A pile of steel coils, slabs and billets on timber dunnage. */
export function steelYard(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  b.box('gravel', 0, 0, 0, wl, 0.1, dl)
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5 - row; i++) b.cylinder('steelRaw', -wl / 2 + 2 + i * 2.6 + row * 1.3, 0.2 + row * 2.1 + 1.1, -dl / 2 + 2.5, 1.2, 1.5, 12, 1.2, 'z')
  }
  for (let i = 0; i < 4; i++) b.box('rust', 0, 0.2 + i * 0.35, dl / 4, wl - 6, 0.3, 2.4)
  for (let i = 0; i < 3; i++) b.box('metalDark', -wl / 2 + 2, 0.2 + i * 0.5, 0, 0.5, 0.45, dl - 4)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 3, dl / 2)]
}

/** A stack of kiln-dried lumber under a cover, with sticker lines on both faces. */
export function lumberStack(b: SceneryBatch, wl: number, dl: number, h: number): LocalBox[] {
  b.box('woodDark', 0, 0, 0, wl - 1, 0.35, dl - 0.4)
  b.box('lumber', 0, 0.35, 0, wl, h - 0.35, dl)
  for (let y = 0.9; y < h - 0.4; y += 0.7) {
    b.box('woodDark', 0, y, dl / 2 + 0.01, wl, 0.07, 0.02)
    b.box('woodDark', 0, y, -dl / 2 - 0.01, wl, 0.07, 0.02)
  }
  b.box('metalGrey', 0, h, 0, wl + 0.2, 0.1, dl + 0.2)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, h + 0.1, dl / 2)]
}

/** A log deck: three layers of peeled logs lying on the ground. */
export function logPile(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const length = wl - 1
  const rows = Math.max(3, Math.floor(dl / 1.1))
  for (let layer = 0; layer < 3; layer++) {
    const count = rows - layer
    for (let i = 0; i < count; i++) b.cylinder('wood', -length / 2, 0.55 + layer * 0.95, -dl / 2 + 0.6 + layer * 0.55 + i * 1.1, 0.55, length, 8, 0.55, 'x')
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 3, dl / 2)]
}

/** A shipping container. */
export function container(b: SceneryBatch, wl: number, dl: number, key: string): LocalBox[] {
  b.box(key, 0, 0.1, 0, wl, 2.5, dl)
  for (let z = -dl / 2 + 0.5; z < dl / 2; z += 0.6) {
    b.box('metalDark', wl / 2 + 0.01, 0.1, z, 0.03, 2.5, 0.08)
    b.box('metalDark', -wl / 2 - 0.01, 0.1, z, 0.03, 2.5, 0.08)
  }
  b.box('metalDark', 0, 0, 0, wl - 0.2, 0.1, dl - 0.2)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 2.6, dl / 2)]
}

/** A half-built wood frame house: slab, studs, plates, rafters and two sheathed wall sections. */
export function frameHouse(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, wl + 1, 0.4, dl + 1)
  const hx = wl / 2 - 0.1
  const hz = dl / 2 - 0.1
  for (let x = -hx; x <= hx + 0.01; x += 1.2) for (const z of [-hz, hz]) b.box('lumber', x, 0.4, z, 0.1, 2.6, 0.14)
  for (let z = -hz + 1.2; z < hz - 0.01; z += 1.2) for (const x of [-hx, hx]) b.box('lumber', x, 0.4, z, 0.14, 2.6, 0.1)
  for (const z of [-hz, hz]) b.box('lumber', 0, 3.0, z, wl, 0.12, 0.16)
  for (const x of [-hx, hx]) b.box('lumber', x, 3.0, 0, 0.16, 0.12, dl)
  b.box('plywood', 0, 0.4, hz, wl * 0.45, 2.6, 0.04)
  b.box('plywood', hx, 0.4, 0, 0.04, 2.6, dl * 0.4)
  for (let x = -hx + 0.6; x <= hx; x += 1.2) {
    b.beam('lumber', x, 3.1, -hz, x, 4.8, 0, 0.1, 0.2)
    b.beam('lumber', x, 3.1, hz, x, 4.8, 0, 0.1, 0.2)
  }
  b.box('lumber', 0, 4.7, 0, wl, 0.16, 0.2)
  b.box('lumber', -wl / 2 - 1.5, 0, hz + 2, 1.0, 0.8, 1.2)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 4.9, dl / 2)]
}

/** A heap of excavated earth. */
export function mound(b: SceneryBatch, r: number, h: number): LocalBox[] {
  b.cylinder('dirt', 0, 0, 0, r, h, 12, r * 0.25)
  const s = r * 0.6
  return [localBox(-s, 0, -s, s, h * 0.7, s)]
}

/** A tower crane: lattice mast, jib with trolley and hook line, counter-jib weights and a cab. */
export function towerCrane(b: SceneryBatch, h: number, jib: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, 7, 1.2, 7)
  for (const x of [-0.7, 0.7]) for (const z of [-0.7, 0.7]) b.box('metalYellow', x, 1.2, z, 0.18, h, 0.18)
  for (let y = 1.2; y < h; y += 3) {
    b.beam('metalYellow', -0.7, y, -0.7, 0.7, y + 3, -0.7, 0.1, 0.1)
    b.beam('metalYellow', 0.7, y, 0.7, -0.7, y + 3, 0.7, 0.1, 0.1)
    b.beam('metalYellow', -0.7, y, 0.7, -0.7, y + 3, -0.7, 0.1, 0.1)
    b.beam('metalYellow', 0.7, y, -0.7, 0.7, y + 3, 0.7, 0.1, 0.1)
  }
  b.box('metalYellow', 0, h + 1.2, 0, 2, 2.4, 2)
  b.box('glass', 0, h + 1.6, 1.02, 1.2, 1.1, 0.04)
  b.box('metalYellow', jib / 2 - 8, h + 3.6, 0, jib, 1.2, 1.4)
  b.box('metalYellow', -9, h + 3.6, 0, 18, 1.0, 1.4)
  b.box('concrete', -15, h + 2.2, 0, 3.5, 2.4, 2.4)
  b.box('metalDark', jib * 0.6, h + 2.9, 0, 1.5, 0.7, 1.2)
  b.box('steelRaw', jib * 0.6, h * 0.35, 0, 0.05, h * 0.65 + 2.5 - 0.4, 0.05)
  b.box('metalDark', jib * 0.6, h * 0.35 - 0.8, 0, 0.5, 0.8, 0.4)
  b.beam('metalDark', 0, h + 6, 0, jib - 8, h + 4.2, 0, 0.1, 0.1)
  b.beam('metalDark', 0, h + 6, 0, -15, h + 3.4, 0, 0.1, 0.1)
  b.box('metalYellow', 0, h + 2.4, 0, 0.3, 3.6, 0.3)
  return [localBox(-3.5, 0, -3.5, 3.5, h, 3.5)]
}

/** An overpass: two end piers carrying girders and a deck at 9 m, a rail along each edge. Only the piers are solid. */
export function overpass(b: SceneryBatch, span: number, width: number): LocalBox[] {
  const out: LocalBox[] = []
  for (const x of [-span / 2 + 3, span / 2 - 3]) {
    for (const z of [-width / 3, 0, width / 3]) {
      b.cylinder('concrete', x, 0, z, 1.3, 8.4, 14)
      out.push(localBox(x - 1.1, 0, z - 1.1, x + 1.1, 8.4, z + 1.1))
    }
    b.box('concrete', x, 8.4, 0, 3.2, 1.4, width + 2)
  }
  for (const z of [-width / 3, 0, width / 3]) b.box('concreteDark', 0, 9.2, z, span, 1.4, 1.2)
  b.box('concrete', 0, 10.4, 0, span + 4, 0.6, width + 2)
  b.box('asphalt', 0, 11.0, 0, span + 4, 0.06, width - 0.4)
  for (const z of [-width / 2 - 0.6, width / 2 + 0.6]) b.box('concrete', 0, 11.0, z, span + 4, 1.0, 0.4)
  return out
}

/** A terraced quarry wall: stacked rock slabs that rise toward the back (-z), each ledge a little narrower than the last. */
export function terrace(b: SceneryBatch, wl: number, dl: number, steps: number, rise: number): LocalBox[] {
  const out: LocalBox[] = []
  for (let i = 0; i < steps; i++) {
    const depth = (dl * (steps - i)) / steps
    const height = rise * (i + 1)
    b.box(i % 2 === 0 ? 'rock' : 'rockDark', 0, 0, -dl / 2 + depth / 2, wl, height, depth)
    out.push(localBox(-wl / 2, 0, -dl / 2, wl / 2, height, -dl / 2 + depth))
  }
  return out
}

/** A refrigeration condenser bank: a steel frame with a row of fans on top. */
export function condenser(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, wl, 0.3, dl)
  b.box('metalGrey', 0, 0.3, 0, wl - 0.4, 2.2, dl - 0.4)
  const fans = Math.max(1, Math.floor(wl / 3.2))
  for (let i = 0; i < fans; i++) b.cylinder('darkSteel', -wl / 2 + ((i + 0.5) * wl) / fans, 2.5, 0, 1.2, 0.3, 12)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 2.8, dl / 2)]
}

/** A portable toilet cabin. */
export function portaJohn(b: SceneryBatch): LocalBox[] {
  b.box('metalBlue', 0, 0, 0, 1.2, 2.3, 1.2)
  b.box('metalWhite', 0, 2.3, 0, 1.3, 0.12, 1.3)
  b.box('darkSteel', 0, 0.2, 0.62, 0.8, 1.8, 0.04)
  return [localBox(-0.6, 0, -0.6, 0.6, 2.4, 0.6)]
}

/** A concrete display pad with a painted edge, for a showroom's trucks. */
export function displayPad(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, wl, 0.18, dl)
  b.box('concreteDark', 0, 0.18, 0, wl - 0.8, 0.02, dl - 0.8)
  b.box('lineYellow', 0, 0.2, dl / 2 - 0.4, wl - 0.8, 0.01, 0.12)
  return []
}
