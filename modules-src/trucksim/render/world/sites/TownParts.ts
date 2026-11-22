/**
 * Millbrook's buildings: houses in four sidings, a white church with a steeple, a brick town hall with a clock tower, a diner
 * and a water tower. Foundations reach a metre below the ground so a building on a slope never floats.
 */

import type { SceneryBatch } from '../../lots/Batch'
import { localBox } from '../../lots/Items'
import type { LocalBox } from '../../lots/Items'

/** A house: gable roof, porch, door, windows, chimney and a low foundation. */
export function house(b: SceneryBatch, wl: number, dl: number, siding: string, roof: string): LocalBox[] {
  const front = dl / 2
  b.box('concrete', 0, -1, 0, wl + 0.2, 1.6, dl + 0.2)
  b.box(siding, 0, 0.6, 0, wl, 2.8, dl)
  b.gable(roof, siding, -wl / 2, -dl / 2, wl / 2, dl / 2, 3.4, Math.min(2.8, wl * 0.26), 'z', 0.5)
  b.box('brick', wl / 2 - 1.2, 3.0, 0, 0.9, 3.6, 1.0)
  b.box('wood', -wl / 2 + 1.8, 0, front + 1.0, 3.2, 0.5, 2.0)
  b.slope(roof, -wl / 2 + 0.2, front, -wl / 2 + 3.5, front + 2.2, 2.5, 3.0, '+z')
  b.box('woodDark', -wl / 2 + 2.0, 0.5, front + 0.04, 0.95, 2.1, 0.08)
  b.box('siding', wl / 2 - 2.4, 1.2, front + 0.03, 1.4, 1.4, 0.06)
  b.box('glass', wl / 2 - 2.4, 1.3, front + 0.07, 1.2, 1.2, 0.03)
  for (const side of [-1, 1]) for (const z of [-dl / 4, dl / 4]) {
    b.box('glass', side * (wl / 2 + 0.03), 1.3, z, 0.04, 1.2, 1.0)
  }
  return [localBox(-wl / 2, -1, -dl / 2, wl / 2, 3.4 + Math.min(2.8, wl * 0.26), dl / 2)]
}

/** A white clapboard church with a square bell tower and a spire. */
export function church(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const front = dl / 2
  b.box('concrete', 0, -1, 0, wl + 0.3, 1.7, dl + 0.3)
  b.box('siding', 0, 0.7, 0, wl, 5.6, dl)
  b.gable('roofDark', 'siding', -wl / 2, -dl / 2, wl / 2, dl / 2, 6.3, wl * 0.4, 'z', 0.5)
  const tx = 0
  b.box('siding', tx, 0.7, front + 1.5, 5.0, 11, 3.0)
  b.box('siding', tx, 11.7, front + 1.5, 5.0, 3.6, 3.0)
  b.box('glass', tx, 12.0, front + 3.03, 1.6, 2.4, 0.04)
  b.cylinder('roofDark', tx, 15.3, front + 1.5, 3.6, 9, 4, 0.2)
  b.box('woodDark', tx, 1.0, front + 3.04, 1.8, 3.0, 0.06)
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const z = -dl / 2 + 5 + i * 7
      b.box('glass', side * (wl / 2 + 0.03), 2.0, z, 0.04, 3.0, 1.2)
    }
  }
  return [localBox(-wl / 2, -1, -dl / 2, wl / 2, 6.3 + wl * 0.4, dl / 2), localBox(-2.5, -1, front, 2.5, 24, front + 3)]
}

/** A brick town hall with a pediment, columns, a clock tower and a flat roof. */
export function townHall(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const front = dl / 2
  b.box('concrete', 0, -1, 0, wl + 0.4, 1.7, dl + 0.4)
  b.box('brick', 0, 0.7, 0, wl, 9.0, dl)
  b.box('concrete', 0, 9.7, 0, wl + 0.6, 0.6, dl + 0.6)
  b.box('roofDark', 0, 10.3, 0, wl, 0.3, dl)
  b.box('concrete', 0, 0.7, front + 1.5, 10, 0.4, 3.0)
  for (const x of [-4, -1.4, 1.4, 4]) b.cylinder('siding', x, 1.1, front + 2.5, 0.45, 7.2, 10)
  b.box('siding', 0, 8.3, front + 1.5, 10.6, 1.4, 3.2)
  b.tri('siding', [-5.3, 9.7, front + 3.1], [5.3, 9.7, front + 3.1], [0, 12.2, front + 3.1], [0, 0, 1])
  b.box('woodDark', 0, 0.7, front + 0.05, 2.2, 3.4, 0.08)
  for (const x of [-9, -6, 6, 9]) {
    b.box('siding', x, 2.2, front + 0.03, 1.5, 2.4, 0.06)
    b.box('glass', x, 2.3, front + 0.07, 1.3, 2.2, 0.03)
    b.box('siding', x, 5.4, front + 0.03, 1.5, 2.4, 0.06)
    b.box('glass', x, 5.5, front + 0.07, 1.3, 2.2, 0.03)
  }
  b.box('brick', 0, 10.6, 0, 5, 7, 5)
  b.box('siding', 0, 15.0, 0, 4.0, 3.0, 4.0)
  for (const [x, z, face] of [[0, 2.03, '+z'], [0, -2.03, '-z'], [2.03, 0, '+x'], [-2.03, 0, '-x']] as const) {
    b.cylinder('lineWhite', face === '+x' || face === '-x' ? x : 0, 16.5, face === '+z' || face === '-z' ? z : 0, 1.0, 0.05, 14)
  }
  b.cylinder('roofDark', 0, 18.0, 0, 3.2, 4.5, 4, 0.2)
  return [localBox(-wl / 2, -1, -dl / 2, wl / 2, 12.2, dl / 2 + 3), localBox(-2.5, 10, -2.5, 2.5, 22.5, 2.5)]
}

/** A water tower: a round tank on four braced legs with a conical roof. */
export function waterTower(b: SceneryBatch): LocalBox[] {
  const legs: [number, number][] = [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]]
  for (const [x, z] of legs) {
    b.beam('metalDark', x, 0, z, x * 0.75, 24, z * 0.75, 0.5, 0.5)
    b.box('concrete', x, 0, z, 1.2, 0.8, 1.2)
  }
  for (const y of [8, 16]) {
    const k = 1 - (y / 24) * 0.25
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i]
      const [cx, cz] = legs[(i + 1) % 4]
      b.beam('metalDark', ax * k, y, az * k, cx * k, y, cz * k, 0.22, 0.22)
      b.beam('metalDark', ax * k, y, az * k, cx * (1 - (y + 8) / 24 * 0.25), y + 8, cz * (1 - (y + 8) / 24 * 0.25), 0.14, 0.14)
    }
  }
  b.cylinder('metalDark', 0, 23.6, 0, 3.0, 0.5, 14)
  b.cylinder('tankWhite', 0, 24.1, 0, 5.2, 6.4, 22, 5.2)
  b.cylinder('tankWhite', 0, 30.5, 0, 5.2, 2.2, 22, 0.6)
  b.cylinder('metalDark', 0, 24.1, 0, 5.28, 0.3, 22, 5.28, 'y', false)
  return [localBox(-4, 0, -4, 4, 6, 4)]
}
