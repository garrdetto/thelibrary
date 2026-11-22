/**
 * Farm buildings: a two-storey farmhouse with a porch, a red gambrel barn with a silo, grain bins with pitched roofs, and a
 * machine shed. Plain siding and tin; no brands.
 */

import type { SceneryBatch } from '../../lots/Batch'
import { localBox, steelShop } from '../../lots/Items'
import type { LocalBox } from '../../lots/Items'

/** A farmhouse: siding, a gable roof, a front porch with posts, windows, a door and a brick chimney. */
export function farmhouse(b: SceneryBatch, wl: number, dl: number, siding: string): LocalBox[] {
  const front = dl / 2
  b.box('concrete', 0, 0, 0, wl + 0.2, 0.7, dl + 0.2)
  b.box(siding, 0, 0.7, 0, wl, 5.2, dl)
  b.gable('roofDark', siding, -wl / 2, -dl / 2, wl / 2, dl / 2, 5.9, Math.min(3.4, dl * 0.3), 'x', 0.5)
  b.box('brick', wl / 2 - 2, 5.0, -dl / 4, 1.0, 5.2, 1.2)
  const porch = wl * 0.6
  b.box('wood', -wl / 2 + porch / 2 + 0.8, 0, front + 1.4, porch, 0.6, 2.8)
  b.slope('roofDark', -wl / 2 + 0.6, front, -wl / 2 + porch + 1.0, front + 3.0, 3.0, 3.6, '+z')
  for (const x of [-wl / 2 + 1.0, -wl / 2 + porch + 0.6]) b.box('siding', x, 0.6, front + 2.6, 0.2, 2.4, 0.2)
  b.box('woodDark', -wl / 2 + 3.5, 0.6, front + 0.05, 1.1, 2.2, 0.08)
  for (const x of [-wl / 2 + 6.2, wl / 2 - 2.6]) {
    b.box('siding', x, 1.4, front + 0.03, 1.3, 1.5, 0.06)
    b.box('glass', x, 1.5, front + 0.07, 1.1, 1.3, 0.03)
  }
  for (const x of [-wl / 2 + 3.5, -wl / 2 + 6.2, wl / 2 - 2.6]) {
    b.box('siding', x, 3.6, front + 0.03, 1.3, 1.5, 0.06)
    b.box('glass', x, 3.7, front + 0.07, 1.1, 1.3, 0.03)
  }
  for (const side of [-1, 1]) for (const z of [-dl / 4, dl / 4]) {
    b.box('glass', side * (wl / 2 + 0.03), 1.5, z, 0.04, 1.3, 1.1)
    b.box('glass', side * (wl / 2 + 0.03), 3.7, z, 0.04, 1.3, 1.1)
  }
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, 6.0 + Math.min(3.4, dl * 0.3), dl / 2)]
}

/** A gambrel barn in barn red with white trim, X-braced doors, a hay door and a round silo at one end. */
export function barn(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  const hs = 5.2
  const front = dl / 2
  b.box('concrete', 0, 0, 0, wl + 0.2, 0.5, dl + 0.2)
  b.box('barnRed', 0, 0.5, 0, wl, hs - 0.5, dl)
  const profile: [number, number][] = [[-wl / 2, hs], [-wl * 0.3, hs + 3.8], [0, hs + 5.6], [wl * 0.3, hs + 3.8], [wl / 2, hs]]
  for (let i = 0; i < profile.length - 1; i++) {
    const [xa, ya] = profile[i]
    const [xb, yb] = profile[i + 1]
    b.quad2('metalGrey', [xa, ya, front + 0.5], [xb, yb, front + 0.5], [xb, yb, -front - 0.5], [xa, ya, -front - 0.5])
  }
  for (const [z, hint] of [[front, 1], [-front, -1]] as const) {
    for (let i = 1; i < profile.length - 1; i++) {
      b.tri('barnRed', [profile[0][0], profile[0][1], z], [profile[i][0], profile[i][1], z], [profile[i + 1][0], profile[i + 1][1], z], [0, 0, hint])
    }
  }
  b.box('siding', 0, 0.5, front + 0.03, 4.4, 4.0, 0.06)
  b.box('barnRed', 0, 0.6, front + 0.07, 4.0, 3.8, 0.04)
  b.beam('siding', -2.0, 0.6, front + 0.11, 2.0, 4.4, front + 0.11, 0.18, 0.04)
  b.beam('siding', 2.0, 0.6, front + 0.11, -2.0, 4.4, front + 0.11, 0.18, 0.04)
  b.box('siding', 0, hs + 1.0, front + 0.03, 1.6, 1.8, 0.06)
  b.box('woodDark', 0, hs + 1.1, front + 0.07, 1.3, 1.6, 0.04)
  for (const x of [-wl / 2 + 0.05, wl / 2 - 0.05, -wl / 2 + 0.05]) b.box('siding', x, 0.5, front + 0.02, 0.3, hs - 0.5, 0.05)
  b.box('siding', 0, 0.5, front + 0.02, wl, 0.3, 0.05)
  const sx = wl / 2 + 3.4
  b.cylinder('concrete', sx, 0, -dl / 4, 3.0, 17, 18)
  b.cylinder('metalBlue', sx, 17, -dl / 4, 3.1, 2.4, 18, 0.4)
  for (const y of [3, 6.5, 10, 13.5]) b.cylinder('concreteDark', sx, y, -dl / 4, 3.08, 0.25, 18, 3.08, 'y', false)
  return [localBox(-wl / 2, 0, -dl / 2, wl / 2, hs + 5.6, dl / 2), localBox(sx - 2.6, 0, -dl / 4 - 2.6, sx + 2.6, 18, -dl / 4 + 2.6)]
}

/** A galvanised grain bin: ribbed shell, pitched roof, ladder, a door and a vent. */
export function grainBin(b: SceneryBatch, r: number, h: number): LocalBox[] {
  b.cylinder('concrete', 0, 0, 0, r + 0.4, 0.5, 18)
  b.cylinder('tankSilver', 0, 0.5, 0, r, h, 20)
  for (let y = 1.5; y < h; y += 1.5) b.cylinder('metalGrey', 0, y, 0, r + 0.05, 0.12, 20, r + 0.05, 'y', false)
  b.cylinder('tankSilver', 0, 0.5 + h, 0, r + 0.25, 0.3, 20, r)
  b.cylinder('tankSilver', 0, 0.8 + h, 0, r, r * 0.38, 20, 0.4)
  b.cylinder('metalDark', 0, 0.8 + h + r * 0.38, 0, 0.45, 0.5, 8, 0.35)
  b.box('metalDark', 0, 0.5, r + 0.12, 0.9, 1.6, 0.1)
  b.box('metalDark', r * 0.72, 0.5, r * 0.72, 0.1, h, 0.5)
  const s = r * 0.8
  return [localBox(-s, 0, -s, s, h + r * 0.4 + 1.3, s)]
}

/** A machine shed: a wide steel building with large end doors. */
export function machineShed(b: SceneryBatch, wl: number, dl: number): LocalBox[] {
  return steelShop(b, wl, dl, 'metalWhite', 'metalGreen')
}
