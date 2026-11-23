/**
 * Models for the lot builder's pieces, drawn into a `SceneryBatch` in the piece's own frame: origin at the footprint centre on
 * the ground, front toward local +z, width `wl` along x and depth `dl` along z. Each model returns the boxes trucks collide
 * with (centre-based, in that frame). Steel shops get a roll-up door for every 5 m of front, a man door, windows, a concrete
 * wainscot and a gable roof; pole barns are open at the front; fences are posts, rails and a chain-link or board panel.
 * Paving is drawn as thin slabs by `drawPaving`, layered by draw order so later slabs sit above earlier ones.
 */

import type { BuildDef } from '../../shared/Catalog'
import type { BuildItem } from '../../shared/Lots'
import type { CylinderAxis, SceneryBatch, UvRect } from './Batch'

/** A collision box in a piece's local frame (`y` is the centre height). */
export interface LocalBox {
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
}

export function localBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): LocalBox {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2 }
}

/** The key of a colour the player chose for painted metal. */
export function paintKey(hex: string): string {
  return `p:${hex.toLowerCase()}`
}

/** The key of a colour the player chose for a matte finish. */
export function matteKey(hex: string): string {
  return `m:${hex.toLowerCase()}`
}

/** Vertical offset of each paving layer so later slabs sit above earlier ones. */
export const PAVING_STEP = 0.006

/** Draws one paving slab with its world frame already set to the lot origin; `seq` is its order among paving. */
export function drawPaving(b: SceneryBatch, def: BuildDef, item: BuildItem, seq: number): void {
  const top = 0.03 + Math.min(seq, 40) * PAVING_STEP
  const cx = item.x + item.w / 2
  const cz = item.z + item.d / 2
  const key = def.id === 'pave-asphalt' ? 'asphalt' : def.id === 'pave-concrete' ? 'concrete' : 'gravel'
  if (key === 'concrete') b.box(key, cx, -0.06, cz, item.w, top + 0.06, item.d)
  else b.slab(key, key === 'asphalt' ? 'paveAsphalt' : 'paveGravel', cx, -0.06, cz, item.w, top + 0.06, item.d)
  if (def.id === 'pave-asphalt') {
    const long = item.w >= item.d
    const length = long ? item.w : item.d
    const across = long ? item.d : item.w
    if (across >= 8 && length >= 8) {
      const stall = Math.min(across, 16)
      const lines = Math.floor(length / 3.6)
      const rows = across >= 44 ? [-1, 1] : [1]
      for (const side of rows) {
        for (let i = 0; i <= lines; i++) {
          const u = -length / 2 + 0.2 + i * ((length - 0.4) / Math.max(1, lines))
          const v = side * (across / 2 - stall / 2)
          if (long) b.box('lineWhite', cx + u, top, cz + v, 0.12, 0.004, stall)
          else b.box('lineWhite', cx + v, top, cz + u, stall, 0.004, 0.12)
        }
        const edge = side * (across / 2 - stall)
        if (long) b.box('lineWhite', cx, top, cz + edge, length - 0.4, 0.004, 0.12)
        else b.box('lineWhite', cx + edge, top, cz, 0.12, 0.004, length - 0.4)
      }
    }
  } else if (def.id === 'pave-concrete') {
    for (let x = 5; x < item.w; x += 5) b.box('concreteDark', item.x + x, top, cz, 0.04, 0.004, item.d)
    for (let z = 5; z < item.d; z += 5) b.box('concreteDark', cx, top, item.z + z, item.w, 0.004, 0.04)
  }
}

export function steelShop(b: SceneryBatch, wl: number, dl: number, wall: string, roof: string): LocalBox[] {
  const eave = 6.2
  const rise = Math.min(1.8, dl * 0.12)
  b.box(wall, 0, 0, 0, wl, eave, dl)
  b.box('concrete', 0, 0, 0, wl + 0.08, 1.1, dl + 0.08)
  b.gable(roof, wall, -wl / 2, -dl / 2, wl / 2, dl / 2, eave, rise, 'x', 0.45)
  const doors = Math.max(1, Math.floor(wl / 5))
  const usable = wl - 3.2
  const slot = usable / doors
  const doorW = Math.min(3.6, slot - 0.9)
  const front = dl / 2
  for (let i = 0; i < doors; i++) {
    const x = -wl / 2 + 3.2 + slot * (i + 0.5)
    b.box('metalWhite', x, 0, front + 0.04, doorW, 4.2, 0.08)
    for (let rib = 1; rib <= 5; rib++) b.box('metalDark', x, rib * 0.7, front + 0.09, doorW, 0.05, 0.03)
    b.box('metalDark', x, 4.2, front + 0.07, doorW + 0.4, 0.3, 0.14)
    b.box('metalDark', x - doorW / 2 - 0.1, 0, front + 0.07, 0.2, 4.2, 0.14)
    b.box('metalDark', x + doorW / 2 + 0.1, 0, front + 0.07, 0.2, 4.2, 0.14)
    b.box('lampWhite', x, 4.9, front + 0.14, 0.45, 0.2, 0.2)
  }
  const man = -wl / 2 + 1.4
  b.box('darkSteel', man, 0, front + 0.04, 1.0, 2.1, 0.08)
  b.box('glass', man, 1.2, front + 0.09, 0.5, 0.7, 0.03)
  b.box('concrete', man, 0, front + 0.55, 1.7, 0.18, 1.1)
  b.box('lampWhite', man, 2.5, front + 0.12, 0.3, 0.16, 0.16)
  b.box('darkSteel', wl / 2 - 1.4, 0, -front - 0.04, 1.0, 2.1, 0.08)
  for (const side of [-1, 1]) {
    for (let z = -dl / 2 + 3.2; z < dl / 2 - 1.6; z += 6.5) {
      b.box('metalWhite', side * (wl / 2 + 0.03), 2.1, z, 0.06, 1.4, 1.7)
      b.box('glass', side * (wl / 2 + 0.065), 2.25, z, 0.04, 1.1, 1.4)
    }
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, eave + rise, dl / 2)]
}

export function poleBarn(b: SceneryBatch, wl: number, dl: number, wall: string, roof: string): LocalBox[] {
  const eave = 5
  const rise = Math.min(1.5, wl * 0.11)
  b.box(wall, 0, 0, -dl / 2 + 0.08, wl, eave, 0.16)
  b.box(wall, -wl / 2 + 0.08, 0, 0, 0.16, eave, dl)
  b.box(wall, wl / 2 - 0.08, 0, 0, 0.16, eave, dl)
  b.box('woodDark', 0, 0, -dl / 2 + 0.22, wl - 0.3, 1.0, 0.1)
  b.gable(roof, wall, -wl / 2, -dl / 2, wl / 2, dl / 2, eave, rise, 'z', 0.5)
  b.box('gravel', 0, 0, 0, wl - 0.3, 0.05, dl - 0.3)
  const poles = Math.ceil(wl / 5) + 1
  for (let i = 0; i < poles; i++) {
    const x = -wl / 2 + 0.2 + (i * (wl - 0.4)) / (poles - 1)
    b.box('wood', x, 0, dl / 2 - 0.2, 0.3, eave, 0.3)
  }
  b.box('wood', 0, eave - 0.45, dl / 2 - 0.2, wl, 0.45, 0.3)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, eave + rise, -dl / 2 + 0.16), localBox(-wl / 2, 0, -dl / 2, -wl / 2 + 0.16, eave + rise, dl / 2), localBox(wl / 2 - 0.16, 0, -dl / 2, wl / 2, eave + rise, dl / 2)]
}

export function office(b: SceneryBatch, wl: number, dl: number, wall: string, roof: string): LocalBox[] {
  const eave = 3.3
  const rise = 0.8
  b.box('concrete', 0, 0, 0, wl + 0.1, 0.5, dl + 0.1)
  b.box(wall, 0, 0.5, 0, wl, eave - 0.5, dl)
  b.gable(roof, wall, -wl / 2, -dl / 2, wl / 2, dl / 2, eave, rise, 'x', 0.35)
  const front = dl / 2
  const door = wl / 2 - 1.8
  b.box('darkSteel', door, 0.5, front + 0.04, 1.0, 2.1, 0.08)
  b.box('glass', door, 1.4, front + 0.09, 0.6, 1.0, 0.03)
  b.box(roof, door, 2.75, front + 0.75, 2.2, 0.14, 1.5)
  b.box('concrete', door, 0, front + 0.7, 1.8, 0.25, 1.2)
  for (let x = -wl / 2 + 1.5; x < door - 1.6; x += 2.4) {
    b.box('metalWhite', x, 1.0, front + 0.03, 1.5, 1.4, 0.06)
    b.box('glass', x, 1.1, front + 0.07, 1.3, 1.2, 0.03)
  }
  for (const side of [-1, 1]) {
    for (let z = -dl / 2 + 1.8; z < dl / 2 - 1.2; z += 2.8) {
      b.box('metalWhite', side * (wl / 2 + 0.03), 1.0, z, 0.06, 1.4, 1.5)
      b.box('glass', side * (wl / 2 + 0.07), 1.1, z, 0.03, 1.2, 1.3)
    }
  }
  b.box('metalGrey', -wl / 4, eave + 0.1, -dl / 4, 1.0, 0.7, 0.8)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, eave + rise, dl / 2)]
}

export function axisBox(b: SceneryBatch, horizontal: boolean): (key: string, u: number, y: number, v: number, su: number, sy: number, sv: number) => void {
  return (key, u, y, v, su, sy, sv) => {
    if (horizontal) b.box(key, u, y, v, su, sy, sv)
    else b.box(key, v, y, u, sv, sy, su)
  }
}

export function officeTrailer(b: SceneryBatch, wl: number, dl: number, wall: string): LocalBox[] {
  const horizontal = wl > dl
  const length = horizontal ? wl : dl
  const width = horizontal ? dl : wl
  const lb = axisBox(b, horizontal)
  for (const u of [-1, 1]) for (const v of [-1, 1]) lb('concrete', u * (length / 2 - 0.5), 0, v * (width / 2 - 0.3), 0.4, 0.5, 0.4)
  lb(wall, 0, 0.5, 0, length, 2.4, width)
  lb('metalWhite', 0, 2.9, 0, length + 0.2, 0.12, width + 0.2)
  lb('metalGrey', -length / 4, 3.02, 0, 0.9, 0.5, 0.7)
  lb('darkSteel', 0, 0.5, 0, length - 0.1, 0.3, width - 0.1)
  const end = length / 2
  lb('darkSteel', end + 0.03, 0.9, 0, 0.06, 2.0, 0.95)
  lb('glass', end + 0.07, 1.8, 0, 0.03, 0.7, 0.5)
  lb('wood', end + 0.6, 0.3, 0, 1.1, 0.12, 1.5)
  lb('woodDark', end + 1.15, 0.0, 0, 0.1, 0.4, 1.5)
  for (let u = -length / 2 + 1.8; u < end - 1.8; u += 2.6) {
    for (const v of [-1, 1]) {
      lb('metalWhite', u, 1.4, v * (width / 2 + 0.03), 1.1, 1.0, 0.06)
      lb('glass', u, 1.5, v * (width / 2 + 0.07), 0.9, 0.8, 0.03)
    }
  }
  const half = [length / 2 + 0.1, 3.0, width / 2 + 0.1]
  return [horizontal ? localBox(-half[0], 0, -half[2], half[0], half[1], half[2]) : localBox(-half[2], 0, -half[0], half[2], half[1], half[0])]
}

/**
 * Draws a truck-stop diesel island along an axis: `u` runs along the island (length `length`), `v` across it. A raised kerb with
 * rounded noses and yellow edges, a pair of yellow crash posts at each end, and one fuelling point every `spacing` metres: a tall
 * high-flow dispenser with a price header and screens on both faces, hoses hanging from overhead retractor booms on both sides, a
 * smaller DEF pump, and a squeegee bucket and bin. Returns nothing; the caller adds collision.
 */
export function dieselIsland(b: SceneryBatch, horizontal: boolean, length: number, color: string, spacing = 20): void {
  const lb = axisBox(b, horizontal)
  const at = (u: number, v: number): [number, number] => (horizontal ? [u, v] : [v, u])
  const post = (u: number, v: number, r: number, h: number, key: string, y = 0): void => {
    const [x, z] = at(u, v)
    b.cylinder(key, x, y, z, r, h, 10)
  }
  const half = length / 2
  const width = 1.3
  lb('concrete', 0, 0, 0, length - width, 0.2, width)
  for (const end of [-1, 1]) post(end * (half - width / 2), 0, width / 2, 0.2, 'concrete')
  for (const v of [-1, 1]) lb('metalYellow', 0, 0.2, v * (width / 2 - 0.04), length - width, 0.02, 0.08)
  for (const end of [-1, 1]) {
    for (const v of [-0.4, 0.4]) {
      post(end * (half - 0.35), v, 0.11, 1.15, 'metalYellow', 0.2)
      post(end * (half - 0.35), v, 0.115, 0.08, 'metalDark', 1.1)
    }
    lb('metalYellow', end * (half - 0.35), 1.0, 0, 0.12, 0.1, 0.8)
  }
  const stations = Math.max(1, Math.floor((length - 4) / spacing))
  for (let i = 0; i < stations; i++) {
    const u = -half + 2 + ((i + 0.5) * (length - 4)) / stations
    lb('metalWhite', u, 0.2, 0, 1.1, 2.0, 0.62)
    lb('darkSteel', u, 0.2, 0, 1.14, 0.18, 0.66)
    lb(color, u, 2.2, 0, 1.16, 0.5, 0.66)
    lb('boardDark', u, 2.25, 0, 0.9, 0.36, 0.68)
    for (const v of [-1, 1]) {
      lb('glassTint', u, 1.35, v * 0.315, 0.5, 0.32, 0.02)
      lb('metalDark', u - 0.32, 0.9, v * 0.32, 0.16, 0.42, 0.04)
      lb('metalYellow', u - 0.32, 1.05, v * 0.345, 0.07, 0.12, 0.05)
      lb('metalDark', u + 0.32, 0.9, v * 0.32, 0.16, 0.42, 0.04)
      lb('metalYellow', u + 0.32, 1.05, v * 0.345, 0.07, 0.12, 0.05)
    }
    post(u + 0.75, 0, 0.06, 3.2, 'steel', 0.2)
    for (const v of [-1, 1]) {
      const [ax, az] = at(u + 0.75, 0)
      const [bx, bz] = at(u + 0.75, v * 1.4)
      b.beam('steel', ax, 3.35, az, bx, 3.1, bz, 0.06, 0.06)
      const [hx, hz] = at(u + 0.75, v * 1.35)
      const [nx, nz] = at(u + 0.32, v * 0.36)
      b.beam('rubber', hx, 3.05, hz, hx, 1.7, hz, 0.035, 0.035)
      b.beam('rubber', hx, 1.7, hz, nx, 1.08, nz, 0.035, 0.035)
    }
    lb('metalWhite', u - 1.3, 0.2, 0, 0.5, 1.35, 0.45)
    lb('metalBlue', u - 1.3, 1.55, 0, 0.54, 0.22, 0.49)
    for (const v of [-1, 1]) lb('metalBlue', u - 1.3, 0.95, v * 0.235, 0.1, 0.3, 0.04)
    post(u + 1.35, 0.25, 0.17, 0.55, 'metalBlue', 0.2)
    post(u + 1.35, -0.25, 0.2, 0.85, 'darkSteel', 0.2)
    lb('steel', u + 1.35, 0.75, 0.25, 0.03, 0.55, 0.03)
  }
}

export function fuelIsland(b: SceneryBatch, wl: number, dl: number, color: string): LocalBox[] {
  const horizontal = wl > dl
  const length = horizontal ? wl : dl
  const width = horizontal ? dl : wl
  const lb = axisBox(b, horizontal)
  dieselIsland(b, horizontal, length - 1, color, Math.max(4.5, (length - 5) / 2))
  lb('metalWhite', 0, 4.4, 0, width, 0.6, length)
  lb(color, 0, 4.58, 0, width + 0.04, 0.26, length + 0.04)
  for (const u of [-length / 4, length / 4]) lb('lampWhite', u, 4.36, 0, 0.8, 0.04, 0.8)
  const boxes: LocalBox[] = []
  for (const u of [-1, 1]) {
    for (const v of [-1, 1]) {
      lb('metalWhite', u * (length / 2 - 0.8), 0, v * (width / 2 - 0.6), 0.45, 4.4, 0.45)
      lb('metalYellow', u * (length / 2 - 0.8), 0, v * (width / 2 - 0.6), 0.5, 0.6, 0.5)
      const x = horizontal ? u * (length / 2 - 0.8) : v * (width / 2 - 0.6)
      const z = horizontal ? v * (width / 2 - 0.6) : u * (length / 2 - 0.8)
      boxes.push({ x, y: 2.2, z, hx: 0.25, hy: 2.2, hz: 0.25 })
    }
  }
  boxes.push(horizontal ? { x: 0, y: 0.15, z: 0, hx: (length - 1) / 2, hy: 0.15, hz: 0.7 } : { x: 0, y: 0.15, z: 0, hx: 0.7, hy: 0.15, hz: (length - 1) / 2 })
  return boxes
}

function washBay(b: SceneryBatch, wl: number, dl: number, color: string): LocalBox[] {
  const horizontal = wl > dl
  const length = horizontal ? wl : dl
  const width = horizontal ? dl : wl
  const lb = axisBox(b, horizontal)
  lb('concrete', 0, 0, 0, length, 0.1, width)
  for (let u = -length / 2 + 2; u < length / 2; u += 4) lb('darkSteel', u, 0.1, 0, 0.3, 0.02, width - 1.6)
  for (const v of [-1, 1]) {
    lb('concreteDark', 0, 0, v * (width / 2 - 0.2), length, 5.0, 0.4)
    lb(color, 0, 5.0, v * (width / 2 - 0.2), length, 0.9, 0.46)
    lb('rubber', length / 6, 0.5, v * (width / 2 - 1.5), 0.5, 3.0, 0.5)
  }
  lb(color, 0, 5.0, 0, length, 0.5, width)
  lb('metalWhite', 0, 5.5, 0, length + 0.2, 0.4, width + 0.2)
  lb('steel', -length / 6, 0, width / 2 - 0.9, 0.3, 4.0, 0.3)
  lb('steel', -length / 6, 0, -width / 2 + 0.9, 0.3, 4.0, 0.3)
  lb('steel', -length / 6, 3.8, 0, 0.3, 0.3, width - 1.2)
  for (let v = -width / 2 + 1.8; v < width / 2 - 1.5; v += 1.4) lb('metalBlue', -length / 6, 3.4, v, 0.25, 0.4, 0.25)
  lb('lampWhite', 0, 4.94, 0, length - 2, 0.04, 0.4)
  const wall = (v: number): LocalBox => (horizontal ? localBox(-length / 2, 0, v - 0.23, length / 2, 5.0, v + 0.23) : localBox(v - 0.23, 0, -length / 2, v + 0.23, 5.0, length / 2))
  const roof = horizontal ? localBox(-length / 2, 5.0, -width / 2, length / 2, 6.0, width / 2) : localBox(-width / 2, 5.0, -length / 2, width / 2, 6.0, length / 2)
  return [wall(-(width / 2 - 0.2)), wall(width / 2 - 0.2), roof]
}

/** Hot-water pressure washer on a two-wheel cart: pump body in the item colour, motor, hose reel, wand on its hook. */
export function pressureWasher(b: SceneryBatch, wl: number, dl: number, body: string): LocalBox[] {
  const horizontal = wl > dl
  const length = horizontal ? wl : dl
  const half = length / 2
  const lb = axisBox(b, horizontal)
  const across: CylinderAxis = horizontal ? 'z' : 'x'
  const at = (u: number, v: number): [number, number] => (horizontal ? [u, v] : [v, u])
  const wheel = (u: number, v0: number, y: number, r: number, len: number, key: string): void => {
    const [x, z] = at(u, v0)
    b.cylinder(key, x, y, z, r, len, 12, r, across)
  }
  lb('darkSteel', 0, 0.3, 0, length - 0.2, 0.08, 0.76)
  lb(body, -half + 0.75, 0.38, 0, 0.9, 0.62, 0.7)
  lb('metalWhite', -half + 0.75, 1.0, 0, 0.94, 0.05, 0.74)
  lb('darkSteel', half - 0.55, 0.38, 0, 0.55, 0.4, 0.5)
  lb('steel', half - 0.55, 0.78, 0, 0.12, 0.1, 0.12)
  for (const v of [-0.42, 0.3]) wheel(-half + 0.45, v, 0.22, 0.22, 0.12, 'rubber')
  wheel(-half + 0.45, -0.3, 0.22, 0.05, 0.6, 'steel')
  wheel(half - 0.55, -0.27, 1.12, 0.3, 0.06, 'darkSteel')
  wheel(half - 0.55, 0.21, 1.12, 0.3, 0.06, 'darkSteel')
  wheel(half - 0.55, -0.21, 1.12, 0.24, 0.42, 'rubber')
  for (const v of [-0.34, 0.34]) lb('steel', half - 0.12, 0.38, v, 0.05, 1.05, 0.05)
  lb('steel', half - 0.12, 1.38, 0, 0.05, 0.05, 0.72)
  lb('metalDark', -half + 0.2, 1.0, 0.36, 0.05, 0.38, 0.04)
  lb('metalDark', -half + 0.22, 0.55, 0.39, 0.04, 0.9, 0.04)
  lb('tankRed', -half + 0.22, 1.25, 0.39, 0.07, 0.12, 0.05)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 1.5, dl / 2)]
}

export function partsShed(b: SceneryBatch, wl: number, dl: number, wall: string): LocalBox[] {
  b.box('concrete', 0, 0, 0, wl + 0.1, 0.3, dl + 0.1)
  b.box(wall, 0, 0.3, 0, wl, 2.5, dl)
  b.slope('roofDark', -wl / 2 - 0.2, -dl / 2 - 0.2, wl / 2 + 0.2, dl / 2 + 0.3, 2.75, 3.1, '+z')
  b.box('metalWhite', 0, 0.3, dl / 2 + 0.04, Math.min(2.4, wl - 0.6), 2.1, 0.08)
  b.box('metalDark', 0, 1.3, dl / 2 + 0.08, 0.05, 1.8, 0.04)
  b.box('glass', wl / 2 + 0.03, 1.3, 0, 0.04, 0.7, 0.9)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 3.1, dl / 2)]
}

export function tireRack(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const horizontal = wl > dl
  const length = horizontal ? wl : dl
  const width = horizontal ? dl : wl
  const lb = axisBox(b, horizontal)
  for (const u of [-1, 0, 1]) for (const v of [-1, 1]) lb('darkSteel', u * (length / 2 - 0.1), 0, v * (width / 2 - 0.1), 0.12, 2.4, 0.12)
  const count = Math.max(1, Math.floor((length - 0.4) / 0.34))
  const rows = Math.max(1, Math.floor(width / 0.9))
  for (let tier = 0; tier < 3; tier++) {
    const y = 0.05 + tier * 0.8
    lb('darkSteel', 0, y, 0, length, 0.06, width)
    for (let row = 0; row < rows; row++) {
      const v = (row - (rows - 1) / 2) * 0.9
      for (let i = 0; i < count; i++) {
        const u = -length / 2 + 0.2 + i * 0.34
        if (horizontal) b.cylinder('rubber', u, y + 0.48, v, 0.42, 0.3, 8, 0.42, 'x')
        else b.cylinder('rubber', v, y + 0.48, u, 0.42, 0.3, 8, 0.42, 'z')
      }
    }
  }
  return [horizontal ? localBox(-length / 2, 0, -width / 2, length / 2, 2.4, width / 2) : localBox(-width / 2, 0, -length / 2, width / 2, 2.4, length / 2)]
}

export function lightPole(b: SceneryBatch): LocalBox[] {
  b.box('concrete', 0, 0, 0, 0.6, 0.5, 0.6)
  b.cylinder('metalDark', 0, 0.5, 0, 0.12, 8.5, 8, 0.07)
  b.box('metalDark', 0, 8.7, 0.5, 0.1, 0.1, 1.2)
  b.box('darkSteel', 0, 8.55, 1.0, 0.45, 0.15, 0.85)
  b.box('lampWhite', 0, 8.5, 1.0, 0.38, 0.04, 0.7)
  return [localBox(-0.3, 0, -0.3, 0.3, 9, 0.3)]
}

function companySign(b: SceneryBatch, wl: number, dl: number, color: string, uv: UvRect | null): LocalBox[] {
  const alongZ = dl >= wl
  const length = alongZ ? dl : wl
  const lb = axisBox(b, !alongZ)
  for (const u of [-1, 1]) lb('metalDark', u * (length / 2 - 0.4), 0, 0, 0.25, 4.8, 0.25)
  lb('boardDark', 0, 2.9, 0, length - 0.5, 2.0, 0.3)
  lb(color, 0, 4.9, 0, length - 0.3, 0.2, 0.36)
  lb(color, 0, 2.8, 0, length - 0.3, 0.12, 0.36)
  if (uv) {
    const width = Math.min(length - 0.7, 6.4)
    if (alongZ) {
      b.placard('boardSign', '+x', 0.16, 0, 3.9, width, uv)
      b.placard('boardSign', '-x', -0.16, 0, 3.9, width, uv, true)
    } else {
      b.placard('boardSign', '+z', 0.16, 0, 3.9, width, uv)
      b.placard('boardSign', '-z', -0.16, 0, 3.9, width, uv, true)
    }
  }
  return [alongZ ? localBox(-0.2, 0, -length / 2, 0.2, 5.1, length / 2) : localBox(-length / 2, 0, -0.2, length / 2, 5.1, 0.2)]
}

export function dumpster(b: SceneryBatch, wl: number, dl: number, color: string): LocalBox[] {
  b.box('darkSteel', -wl / 2 + 0.35, 0, 0, 0.2, 0.3, dl - 0.2)
  b.box('darkSteel', wl / 2 - 0.35, 0, 0, 0.2, 0.3, dl - 0.2)
  b.box(color, 0, 0.3, 0, wl, 1.3, dl)
  b.box('metalDark', 0, 1.6, 0, wl + 0.1, 0.12, dl + 0.1)
  b.box('metalDark', 0, 1.72, dl / 4, wl - 0.1, 0.06, dl / 2 - 0.1)
  b.box('steel', wl / 2 + 0.04, 0.7, 0, 0.08, 0.14, 0.5)
  b.box('steel', -wl / 2 - 0.04, 0.7, 0, 0.08, 0.14, 0.5)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 1.8, dl / 2)]
}

export function airStation(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  b.box('concrete', 0, 0, 0, Math.min(wl, 1.6), 0.15, Math.min(dl, 1.6))
  b.box('tankRed', 0, 0.15, 0, 0.8, 1.3, 0.5)
  b.box('metalWhite', 0, 1.45, 0, 0.84, 0.1, 0.54)
  b.box('glassTint', 0, 1.0, 0.26, 0.4, 0.25, 0.03)
  b.cylinder('darkSteel', 0.46, 0.8, 0, 0.22, 0.12, 10, 0.22, 'x')
  b.cylinder('rubber', 0.2, 0.2, 0.6, 0.04, 0.6, 6, 0.04, 'y')
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 1.6, dl / 2)]
}

export function flagPole(b: SceneryBatch): LocalBox[] {
  b.box('concrete', 0, 0, 0, 0.7, 0.3, 0.7)
  b.cylinder('metalWhite', 0, 0.3, 0, 0.07, 9.5, 8, 0.04)
  b.cylinder('metalYellow', 0, 9.8, 0, 0.1, 0.2, 8, 0.1)
  b.quad2('flagBlue', [0.06, 8.2, 0], [2.4, 8.2, 0], [2.4, 9.6, 0], [0.06, 9.6, 0])
  return [localBox(-0.35, 0, -0.35, 0.35, 10, 0.35)]
}

/**
 * Draws a fence run with the frame at its start, local +z along the run. `matte` is the colour key for the privacy fence.
 * Returns the single collision box of the run.
 */
export function drawFence(b: SceneryBatch, def: BuildDef, length: number, thickness: number, matte: string, z0 = 0): LocalBox[] {
  const posts = Math.max(1, Math.ceil(length / 3))
  const step = length / posts
  if (def.id === 'fence-chain') {
    for (let i = 0; i <= posts; i++) b.box('steel', 0, 0, z0 + i * step, 0.1, 2.3, 0.1)
    b.box('steel', 0, 2.2, z0 + length / 2, 0.06, 0.06, length)
    b.box('steel', 0, 0.12, z0 + length / 2, 0.05, 0.05, length)
    for (let i = 0; i < posts; i++) b.quad2('chain', [0, 0.15, z0 + i * step + 0.05], [0, 0.15, z0 + (i + 1) * step - 0.05], [0, 2.2, z0 + (i + 1) * step - 0.05], [0, 2.2, z0 + i * step + 0.05])
  } else {
    for (let i = 0; i <= posts; i++) {
      b.box('woodDark', 0, 0, z0 + i * step, 0.16, def.height + 0.1, 0.16)
      b.box('woodDark', 0, def.height + 0.1, z0 + i * step, 0.2, 0.05, 0.2)
    }
    b.box(matte, 0, 0.05, z0 + length / 2, thickness, def.height - 0.1, length)
    b.box('woodDark', 0, 0.3, z0 + length / 2, thickness + 0.08, 0.1, length)
    b.box('woodDark', 0, def.height - 0.35, z0 + length / 2, thickness + 0.08, 0.1, length)
    b.box('woodDark', 0, def.height - 0.05, z0 + length / 2, thickness + 0.12, 0.08, length)
    for (let z = 1; z < length; z += 1) b.box('woodDark', 0, 0.05, z0 + z, thickness + 0.03, def.height - 0.15, 0.025)
  }
  return [localBox(-thickness / 2, 0, z0, thickness / 2, def.height, z0 + length)]
}

/**
 * Draws one piece of the lot (not paving or fences) in its local frame and returns its collision boxes. `signUv` is the
 * company-name cell for a company sign (null draws a blank board).
 */
export function drawItem(b: SceneryBatch, def: BuildDef, item: BuildItem, wl: number, dl: number, signUv: UvRect | null): LocalBox[] {
  const wall = paintKey(item.color)
  const second = paintKey(item.color2 ?? def.defaultColor2 ?? item.color)
  switch (def.id) {
    case 'shop-steel': return steelShop(b, wl, dl, wall, second)
    case 'pole-barn': return poleBarn(b, wl, dl, wall, second)
    case 'office-building': return office(b, wl, dl, wall, second)
    case 'office-trailer': return officeTrailer(b, wl, dl, wall)
    case 'fuel-island': return fuelIsland(b, wl, dl, wall)
    case 'wash-bay': return washBay(b, wl, dl, wall)
    case 'pressure-washer': return pressureWasher(b, wl, dl, wall)
    case 'parts-shed': return partsShed(b, wl, dl, wall)
    case 'tire-rack': return tireRack(b, wl, dl)
    case 'light-pole': return lightPole(b)
    case 'sign': return companySign(b, wl, dl, wall, signUv)
    case 'dumpster': return dumpster(b, wl, dl, wall)
    case 'air-station': return airStation(b, wl, dl)
    case 'flag-pole': return flagPole(b)
    default: {
      b.box(wall, 0, 0, 0, wl, def.height, dl)
      return [localBox(-wl / 2, 0, -dl / 2, wl / 2, def.height, dl / 2)]
    }
  }
}
