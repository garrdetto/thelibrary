import { FLAT_RIDES } from '../../../../server/park/index.mjs'
import type { CustomRideMotion } from '../../../../server/park/index.mjs'
import { MOTION_INFO } from '@/lib/park/rideMotion'
import type { ParkRideCategory } from '@/lib/park-rides'

/** How each built-in ride moves, so neighbours can be matched on motion as well as size. */
const BUILTIN_MOTION: Record<string, CustomRideMotion['type']> = {
  carousel: 'spin', teacups: 'spin', ferris: 'wheel', swings: 'spin', bumper: 'bob', ship: 'swing', dropTower: 'drop', topSpin: 'swing', karts: 'bob',
  zipper: 'wheel', gravitron: 'spin', waterslide: 'none', bodySlides: 'none', tubeSlides: 'none', familyRaft: 'none', bowlSlide: 'spin', funnelSlide: 'swing',
  halfPipe: 'swing', trapdoor: 'drop', matRacer: 'none', aquaLoop: 'wheel', surfRider: 'bob', splashPad: 'none', kiddieLagoon: 'none', bucketFort: 'none',
  lilyPads: 'bob', cliffJump: 'drop', pool: 'none', wavePool: 'bob',
}

export type RideSuggestion = {
  cost: number; upkeep: number; capacity: number; rideTime: number; loadTime: number; price: number
  stats: { e: number; i: number; n: number }
  neighbours: { name: string; weight: number }[]
}

type Features = { category: string; tiles: number; height: number; thrill: number }
const features = (category: string, size: [number, number], height: number, motion: CustomRideMotion['type']): Features => ({ category, tiles: size[0] * size[1], height, thrill: MOTION_INFO[motion].thrill })

function distance(a: Features, b: Features) {
  const cat = a.category === b.category ? 0 : 1.1
  return Math.hypot(cat, Math.log((a.tiles + 1) / (b.tiles + 1)) * 0.9, (a.height - b.height) / 12, (a.thrill - b.thrill) * 1.6)
}

/**
 * Prices and ratings from the most similar built-in rides: a distance-weighted
 * k-nearest-neighbour estimate over category, footprint, height and motion.
 * Cost and upkeep are scaled by the footprint ratio so a bigger ride costs more.
 */
export function suggestStats(input: { category: ParkRideCategory; size: [number, number]; height: number; motion: CustomRideMotion['type'] }, k = 4): RideSuggestion {
  const target = features(input.category, input.size, input.height, input.motion)
  const pool = Object.entries(FLAT_RIDES).filter(([id, def]) => !def.custom && !def.resize && BUILTIN_MOTION[id])
    .map(([id, def]) => ({ def, d: distance(target, features(def.category, def.size, def.height, BUILTIN_MOTION[id])) }))
    .sort((a, b) => a.d - b.d).slice(0, k)
  const weights = pool.map(p => 1 / (0.15 + p.d * p.d))
  const total = weights.reduce((s, w) => s + w, 0)
  const avg = (pick: (def: (typeof pool)[number]['def']) => number) => pool.reduce((s, p, i) => s + pick(p.def) * weights[i], 0) / total
  const tileRatio = (def: (typeof pool)[number]['def']) => Math.sqrt(target.tiles / (def.size[0] * def.size[1]))
  const round = (value: number, step: number) => Math.round(value / step) * step
  const stat = (value: number) => Math.round(Math.min(10, Math.max(0, value)) * 100) / 100
  return {
    cost: Math.max(100, round(avg(def => def.cost * tileRatio(def)), 50)),
    upkeep: Math.max(0, Math.round(avg(def => def.upkeep * tileRatio(def)))),
    capacity: Math.max(1, Math.round(avg(def => def.capacity * tileRatio(def)))),
    rideTime: Math.round(avg(def => def.rideTime)),
    loadTime: Math.round(avg(def => def.loadTime)),
    price: Math.round(avg(def => def.price) * 10) / 10,
    stats: { e: stat(avg(def => def.stats.e) + (input.height - avg(def => def.height)) * 0.02), i: stat(avg(def => def.stats.i)), n: stat(avg(def => def.stats.n)) },
    neighbours: pool.map((p, i) => ({ name: p.def.name, weight: Math.round(weights[i] / total * 100) })),
  }
}
