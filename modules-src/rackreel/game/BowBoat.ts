import { Vector3 } from '@babylonjs/core/Maths/math.vector'

/** Anchor points on Wisco Wild Man's bowfishing boat in boat space (+z is the bow, the waterline is y = 0), measured from bowboat.rrm by tools/builders_bowfish.py. */
export const BOWBOAT = {
  length: 10.4,
  /** The shooter's feet on the raised front deck. */
  deck: new Vector3(0, 0.51, 4.45),
  /** Four shooting spots across the front deck for a party: two in the middle, two on the wider aft corners. */
  spots: [new Vector3(-0.6, 0.51, 4.45), new Vector3(0.6, 0.51, 4.45), new Vector3(-1.6, 0.51, 4.05), new Vector3(1.6, 0.51, 4.05)] as readonly Vector3[],
  /** Wild Man's hips on the raised seat box behind the console. */
  driver: new Vector3(-0.55, 0.87, -1.05),
  floor: 0.21,
  seatTop: 0.77,
  /** Centre of the galvanized stock tank's floor, and its inside radius. */
  tub: new Vector3(0, 0.24, 1.48),
  tubRadius: 0.37,
  /** Where the ring of LED floods around the gunwale is lit from: the middle of the boat, above the rails. */
  flood: new Vector3(0, 1.5, 0.79),
  /** Over the bow gunwale, where a carp is swung aboard. */
  bowLip: new Vector3(0.5, 0.92, 5.35),
  /** A soft dome light high over the middle of the boat that lights the deck and the crew (the floods only light the water). */
  dome: new Vector3(0, 3.4, -0.5),
  prop: new Vector3(0, 0.24, -4.6),
  stern: -4.81,
}

export type LightMode = 'white' | 'amber' | 'off'
export const LIGHT_ORDER: readonly LightMode[] = ['white', 'amber', 'off']
export const LIGHT_COLORS: Record<Exclude<LightMode, 'off'>, [number, number, number]> = {
  white: [0.95, 0.97, 1.0],
  amber: [1.0, 0.56, 0.16],
}
/** The floods light everything around the boat: bright out to 15 yd (13.7 m), fading out by 40 yd (36.6 m). */
export const FLOOD = { bright: 13.7, reach: 36.6, intensity: 2.6, deckRange: 12, deckIntensity: 1.7 }
