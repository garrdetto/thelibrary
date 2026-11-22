/**
 * The 48 ft flatbed: steel I-beam frame with outriggers, a wood plank deck, side rails with stake pockets, a winch track with
 * tie points along both sides, a headboard, landing gear, tail lamps and the shared running gear. Cargo sits on the deck.
 */

import type { KindParts, TrailerContext } from './Chassis'
import { boxAt } from '../truck/Geometry'
import { addLandingGear, addNose, addRunningGear, addTailLamps } from './Chassis'

const PLANK = 0.17

/** Z positions of the tie points along each side of a deck from `zRear` to `zFront`. */
export function tiePoints(zRear: number, zFront: number, spacing = 1.2): number[] {
  const out: number[] = []
  for (let z = zFront - 0.5; z > zRear + 0.3; z -= spacing) out.push(z)
  return out
}

export function buildFlatbed(ctx: TrailerContext): KindParts {
  const { model, batch } = ctx
  const deck = model.deckHeight
  const rear = model.rearZ
  const front = model.frontZ
  const half = model.width / 2
  addRunningGear(ctx, { railY0: deck - 0.35, railY1: deck - 0.05, railHalfGap: 0.55, zFront: front - 0.05, zRear: rear + 0.02 })
  addNose(ctx, deck - 0.05)
  const updateGear = addLandingGear(ctx, deck - 0.35)
  const updateTail = addTailLamps(ctx, 0.64, rear)
  const length = front - rear
  const cuts = [rear + length / 3, rear + (length * 2) / 3]
  const count = Math.floor((half * 2 - 0.1) / PLANK)
  for (let i = 0; i < count; i++) {
    const x0 = -half + 0.05 + i * PLANK
    const lift = i % 2 === 0 ? 0 : 0.003
    const shift = (i % 3) * 0.5
    const edges = [rear + 0.02, cuts[0] + shift - 0.5, cuts[1] + shift - 0.5, front - 0.05]
    for (let s = 0; s < 3; s++) batch.add(i % 4 === 0 ? 'woodDark' : 'wood', boxAt(x0 + 0.004, x0 + PLANK - 0.004, deck - 0.05 + lift, deck + lift, edges[s], edges[s + 1] - 0.004))
  }
  for (let z = front - 0.8; z > rear + 0.4; z -= 0.6) batch.add('darkSteel', boxAt(-half + 0.05, half - 0.05, deck - 0.12, deck - 0.05, z - 0.05, z + 0.05))
  for (const side of [-1, 1]) {
    const x = side * half
    batch.add('steel', boxAt(x - 0.06, x + 0.06, deck - 0.14, deck + 0.03, rear + 0.02, front - 0.05))
    for (let z = front - 0.4; z > rear + 0.3; z -= 0.6) batch.add('darkSteel', boxAt(x + side * 0.05 - 0.035, x + side * 0.05 + 0.035, deck - 0.12, deck + 0.02, z - 0.04, z + 0.04))
    batch.add('steel', boxAt(x + side * 0.03 - 0.025, x + side * 0.03 + 0.025, deck - 0.22, deck - 0.14, rear + 0.1, front - 0.1))
    for (const z of tiePoints(rear, front)) {
      batch.add('darkSteel', boxAt(x + side * 0.08 - 0.03, x + side * 0.08 + 0.03, deck - 0.2, deck - 0.14, z - 0.08, z + 0.08))
      batch.add('steel', boxAt(x + side * 0.1 - 0.012, x + side * 0.1 + 0.012, deck - 0.26, deck - 0.2, z - 0.05, z + 0.05))
    }
  }
  const zh = front - 0.12
  for (const x of [-half + 0.1, -0.4, 0.4, half - 0.1]) batch.add('darkSteel', boxAt(x - 0.04, x + 0.04, deck, deck + 1.1, zh - 0.04, zh + 0.04))
  for (const y of [0.15, 0.55, 1.05]) batch.add('darkSteel', boxAt(-half + 0.1, half - 0.1, deck + y - 0.04, deck + y + 0.04, zh - 0.04, zh + 0.04))
  return {
    layout: { zRear: rear + 0.35, zFront: front - 0.35, width: model.width - 0.2, baseY: deck, clearHeight: 2.4, interior: false },
    update(pose) {
      updateGear(pose)
      updateTail(pose)
    },
  }
}
