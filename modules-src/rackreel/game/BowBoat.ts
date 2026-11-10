import { Vector3 } from '@babylonjs/core/Maths/math.vector'

/** Anchor points on Wisco Wild Man's bowfishing boat in boat space (+z is the bow, the waterline is y = 0), measured from bowboat.rrm by tools/builders_bowfish.py (the hull stands 1.2× taller out of the water, with a knee-high sidewall rail on the gunwale). */
export const BOWBOAT = {
  length: 10.4,
  /** The shooter's feet on the raised front deck. */
  deck: new Vector3(0, 0.61, 4.45),
  /** Four shooting spots across the front deck for a party: two in the middle, two on the wider aft corners. */
  spots: [new Vector3(-0.6, 0.61, 4.45), new Vector3(0.6, 0.61, 4.45), new Vector3(-1.6, 0.61, 4.05), new Vector3(1.6, 0.61, 4.05)] as readonly Vector3[],
  /** Wild Man's hips on the raised seat box behind the console. */
  driver: new Vector3(-0.55, 0.91, -1.05),
  floor: 0.25,
  seatTop: 0.81,
  /** Centre of the galvanized stock tank's floor, and its inside radius. */
  tub: new Vector3(0, 0.28, 1.48),
  tubRadius: 0.37,
  /** Where the ring of LED floods around the gunwale is lit from: the middle of the boat, above the rails. */
  flood: new Vector3(0, 1.62, 0.79),
  /** Over the bow gunwale, where a carp is swung aboard. */
  bowLip: new Vector3(0.5, 1.38, 5.35),
  /** A soft dome light high over the middle of the boat that lights the deck and the crew (the floods only light the water). */
  dome: new Vector3(0, 3.4, -0.5),
  prop: new Vector3(0, 0.37, -4.6),
  stern: -4.81,
}

/** Where a shooter can stand, in boat space (x across, z along): the cockpit floor from the rear deck forward, then up the step onto the front deck, narrowing at the bow. */
export const DECK_AREA = { back: -2.6, front: 5.05, half: 1.45, deckHalf: 1.6, narrowFrom: 4.55, step: 3.3, stepRun: 0.18 }

/** Height of the sidewall rail's top above the waterline (boat space); carp are swung in over it. */
export const RAIL_TOP = 1.12

/** Things on the floor a shooter walks around: the stock tank (circle) and the console with Wild Man's seat (box). */
const TUB_KEEP = BOWBOAT.tubRadius + 0.32
const CONSOLE = { minX: -1.0, maxX: 0.35, minZ: -1.45, maxZ: 0.35 }

/** Height of the floor under a shooter's feet at boat-space z: cockpit floor, then the front deck. */
export function deckHeight(z: number): number {
  const k = Math.max(0, Math.min(1, (z - (DECK_AREA.step - DECK_AREA.stepRun / 2)) / DECK_AREA.stepRun))
  return BOWBOAT.floor + (BOWBOAT.deck.y - BOWBOAT.floor) * k
}

/** Keeps a shooter's feet (boat space) inside the gunwales and out of the tub and the console. Changes `p` in place. */
export function clampToDeck(p: { x: number; z: number }): void {
  const a = DECK_AREA
  p.z = Math.max(a.back, Math.min(a.front, p.z))
  let half = p.z > a.step ? a.deckHalf : a.half
  if (p.z > a.narrowFrom) half -= (p.z - a.narrowFrom) * 1.6
  p.x = Math.max(-half, Math.min(half, p.x))
  const tx = p.x - BOWBOAT.tub.x
  const tz = p.z - BOWBOAT.tub.z
  const td = Math.hypot(tx, tz)
  if (td < TUB_KEEP) {
    const k = td > 1e-4 ? TUB_KEEP / td : 1
    p.x = BOWBOAT.tub.x + (td > 1e-4 ? tx * k : TUB_KEEP)
    p.z = BOWBOAT.tub.z + (td > 1e-4 ? tz * k : 0)
  }
  const c = CONSOLE
  if (p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ) {
    const out = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z]
    const i = out.indexOf(Math.min(...out))
    if (i === 0) p.x = c.minX
    else if (i === 1) p.x = c.maxX
    else if (i === 2) p.z = c.minZ
    else p.z = c.maxZ
  }
}

export type LightMode = 'white' | 'amber' | 'off'
export const LIGHT_ORDER: readonly LightMode[] = ['white', 'amber', 'off']
export const LIGHT_COLORS: Record<Exclude<LightMode, 'off'>, [number, number, number]> = {
  white: [0.95, 0.97, 1.0],
  amber: [1.0, 0.56, 0.16],
}
/** The floods light everything around the boat and into the water: bright out to 20 yd (18.3 m), fading out by 45 yd (41.1 m). */
export const FLOOD = { bright: 18.3, reach: 41.1, intensity: 2.6, deckRange: 12, deckIntensity: 1.7 }
