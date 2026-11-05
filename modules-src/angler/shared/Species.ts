/** Sixteen Wisconsin species: log-normal size curves, length–weight form, habitat by season, light and temperature preferences, and the field-guide notes shown on catch cards. */
import type { Bottom, LakeId } from './Lakes'

export type SpeciesId =
  | 'bluegill' | 'crappie' | 'perch' | 'rockbass' | 'bullhead' | 'largemouth' | 'smallmouth' | 'walleye'
  | 'sauger' | 'pike' | 'musky' | 'laketrout' | 'whitefish' | 'channelcat' | 'flathead' | 'sturgeon'

export type Presentation = 'bobber' | 'jig' | 'livebait' | 'crank' | 'spinner' | 'bucktail' | 'cutbait' | 'crawler'

export interface SpeciesDef {
  id: SpeciesId
  name: string
  latin: string
  /** Median weight (lb) and log-normal spread. */
  median: number
  sigma: number
  /** Hard cap just above the real state record (lb). */
  cap: number
  min: number
  /** Form factor: weight (lb) = form × length(in)³ / 1000. */
  form: number
  /** Preferred depth (ft) for spring, summer, fall and winter. */
  depth: [[number, number], [number, number], [number, number], [number, number]]
  temp: [number, number]
  coldWater?: boolean
  /** Activity by month, January first. */
  months: number[]
  /** Night, dawn, day, dusk. */
  light: [number, number, number, number]
  bottom: Partial<Record<Bottom, number>>
  baits: Partial<Record<Presentation, number>>
  lakes: Partial<Record<LakeId, number>>
  jumps: boolean
  /** How hard it pulls for its size. */
  power: number
  blurb: string
  facts: string[]
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  bluegill: {
    id: 'bluegill', name: 'Bluegill', latin: 'Lepomis macrochirus', median: 0.32, sigma: 0.45, cap: 2.9, min: 0.05, form: 0.78,
    depth: [[2, 8], [4, 14], [6, 18], [10, 25]], temp: [64, 80], months: [0.5, 0.5, 0.6, 0.8, 1.2, 1.5, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5],
    light: [0.3, 0.9, 1.25, 1.0], bottom: { weed: 1.5, sand: 1.1, timber: 1.2, muck: 0.7 }, baits: { bobber: 1.6, jig: 1.1, livebait: 0.4, crawler: 0.6 },
    lakes: { 'silver-birch': 1.0, 'mill-pond': 1.2, tamarack: 1.7, 'thunder-bay': 0.35, 'wolf-rapids': 0.4 }, jumps: false, power: 1.6,
    blurb: 'The panfish most Wisconsin anglers caught first: deep, round and scrappy, with a dark ear flap.',
    facts: ['Males fan out saucer-shaped nests in shallow colonies in late spring and guard the eggs.', 'Eats insects, larvae, small crustaceans and snails.', 'A 9-inch bluegill is a good one; a 10-inch fish is a trophy.'],
  },
  crappie: {
    id: 'crappie', name: 'Black crappie', latin: 'Pomoxis nigromaculatus', median: 0.5, sigma: 0.5, cap: 4.6, min: 0.1, form: 0.45,
    depth: [[3, 10], [10, 22], [8, 20], [15, 30]], temp: [58, 75], months: [0.6, 0.6, 0.8, 1.3, 1.4, 1.0, 0.8, 0.8, 1.1, 1.3, 1.0, 0.6],
    light: [0.9, 1.2, 0.55, 1.5], bottom: { timber: 1.6, weed: 1.2, muck: 0.9 }, baits: { jig: 1.5, bobber: 1.2, livebait: 1.3 },
    lakes: { 'silver-birch': 0.4, 'mill-pond': 1.0, tamarack: 0.5, 'wolf-rapids': 0.5 }, jumps: false, power: 0.9,
    blurb: 'Speckled, paper-mouthed and found in schools around brush and timber, especially at dusk.',
    facts: ['Thin mouth membranes tear easily, so a gentle fight lands more of them.', 'Schools suspend off structure and move shallow to spawn in spring.', 'Feeds heavily on small minnows at low light.'],
  },
  perch: {
    id: 'perch', name: 'Yellow perch', latin: 'Perca flavescens', median: 0.38, sigma: 0.5, cap: 3.4, min: 0.05, form: 0.5,
    depth: [[4, 15], [10, 30], [8, 25], [12, 35]], temp: [55, 72], months: [1.1, 1.1, 1.0, 1.0, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.1, 1.1],
    light: [0.1, 1.0, 1.25, 0.8], bottom: { weed: 1.3, sand: 1.2, gravel: 1.1, muck: 0.9 }, baits: { jig: 1.4, livebait: 1.3, bobber: 1.1, crawler: 0.8 },
    lakes: { 'silver-birch': 1.2, 'mill-pond': 0.6, tamarack: 1.2, 'thunder-bay': 1.0 }, jumps: false, power: 0.9,
    blurb: 'Golden with dark saddle bars and orange fins; travels in big schools and bites all year.',
    facts: ['A favourite fish fry across the state.', 'Eggs are laid in long gelatinous ribbons draped over weeds.', 'Prey for nearly every larger predator in the lake.'],
  },
  rockbass: {
    id: 'rockbass', name: 'Rock bass', latin: 'Ambloplites rupestris', median: 0.42, sigma: 0.4, cap: 2.6, min: 0.08, form: 0.62,
    depth: [[3, 12], [6, 18], [6, 18], [12, 25]], temp: [60, 76], months: [0.5, 0.5, 0.6, 0.9, 1.2, 1.3, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5],
    light: [0.6, 1.0, 1.0, 1.1], bottom: { rock: 1.8, gravel: 1.3, timber: 1.1 }, baits: { jig: 1.3, crank: 0.8, livebait: 1.1, crawler: 1.0, bobber: 0.8 },
    lakes: { 'silver-birch': 0.8, 'mill-pond': 0.4, 'thunder-bay': 0.5, 'wolf-rapids': 0.5 }, jumps: false, power: 1.3,
    blurb: 'Red-eyed and bronze, living tight to rocks; it bites almost anything that falls past.',
    facts: ['Can change shade quickly to match its background.', 'Often mistaken for a small smallmouth until you see the red eye.', 'Eats crayfish, insects and small fish.'],
  },
  bullhead: {
    id: 'bullhead', name: 'Brown bullhead', latin: 'Ameiurus nebulosus', median: 0.8, sigma: 0.45, cap: 4.2, min: 0.15, form: 0.52,
    depth: [[2, 10], [3, 12], [4, 14], [8, 20]], temp: [65, 84], months: [0.4, 0.4, 0.6, 1.0, 1.3, 1.4, 1.4, 1.3, 1.0, 0.7, 0.5, 0.4],
    light: [1.7, 0.9, 0.45, 1.2], bottom: { muck: 1.7, weed: 1.1, timber: 1.1 }, baits: { crawler: 1.6, cutbait: 1.3, livebait: 0.9, bobber: 0.7 },
    lakes: { 'silver-birch': 0.2, 'mill-pond': 0.8, tamarack: 1.0 }, jumps: false, power: 1.0,
    blurb: 'A whiskered bottom feeder that comes alive after dark in warm, soft-bottomed bays.',
    facts: ['Tastes food with barbels and taste buds over its whole body.', 'Tolerates warm, low-oxygen water that other fish avoid.', 'Sharp spines in the dorsal and pectoral fins.'],
  },
  largemouth: {
    id: 'largemouth', name: 'Largemouth bass', latin: 'Micropterus salmoides', median: 1.8, sigma: 0.55, cap: 11.6, min: 0.25, form: 0.55,
    depth: [[2, 8], [3, 14], [3, 12], [8, 20]], temp: [65, 82], months: [0.3, 0.3, 0.4, 0.7, 1.1, 1.4, 1.4, 1.3, 1.2, 0.9, 0.5, 0.3],
    light: [0.6, 1.45, 0.8, 1.5], bottom: { weed: 1.7, timber: 1.6, muck: 0.9, sand: 0.8 }, baits: { crank: 1.4, spinner: 1.5, jig: 1.0, livebait: 1.0, bobber: 0.3 },
    lakes: { 'silver-birch': 0.4, 'mill-pond': 1.2, tamarack: 0.5 }, jumps: true, power: 1.2,
    blurb: 'The bucket-mouthed ambusher of weeds, pads and stumps, famous for head-shaking jumps.',
    facts: ['The upper jaw reaches past the back of the eye.', 'Ambushes frogs, crayfish and fish from cover.', 'Wisconsin\'s state record is 11 lb 3 oz.'],
  },
  smallmouth: {
    id: 'smallmouth', name: 'Smallmouth bass', latin: 'Micropterus dolomieu', median: 1.6, sigma: 0.55, cap: 9.8, min: 0.25, form: 0.49,
    depth: [[4, 12], [8, 22], [10, 25], [18, 35]], temp: [60, 75], months: [0.3, 0.3, 0.4, 0.7, 1.1, 1.3, 1.2, 1.2, 1.3, 1.2, 0.7, 0.3],
    light: [0.4, 1.3, 1.0, 1.3], bottom: { rock: 1.8, gravel: 1.6, sand: 0.9, weed: 0.7 }, baits: { jig: 1.4, crank: 1.3, livebait: 1.2, spinner: 0.9, crawler: 0.8 },
    lakes: { 'silver-birch': 1.0, 'thunder-bay': 0.8, 'wolf-rapids': 0.7 }, jumps: true, power: 1.6,
    blurb: 'Bronze, barred and pound-for-pound the hardest-fighting fish in the state.',
    facts: ['Prefers clear water over rock and gravel.', 'Crayfish are its favourite food.', 'The jaw stops below the eye, unlike a largemouth.'],
  },
  walleye: {
    id: 'walleye', name: 'Walleye', latin: 'Sander vitreus', median: 1.6, sigma: 0.6, cap: 18.6, min: 0.3, form: 0.375,
    depth: [[4, 14], [12, 30], [10, 28], [15, 35]], temp: [52, 70], months: [0.8, 0.8, 0.9, 1.3, 1.4, 1.0, 0.8, 0.8, 1.1, 1.3, 1.1, 0.8],
    light: [1.3, 1.4, 0.45, 1.85], bottom: { rock: 1.6, gravel: 1.5, sand: 1.0, weed: 0.9 }, baits: { jig: 1.5, livebait: 1.6, crank: 1.0, crawler: 1.0 },
    lakes: { 'silver-birch': 1.0, 'mill-pond': 0.3, 'thunder-bay': 0.9, 'wolf-rapids': 0.6 }, jumps: false, power: 0.9,
    blurb: 'Glassy-eyed and golden, the fish Wisconsin chases most, feeding at dusk and after dark.',
    facts: ['A reflective layer behind the retina lets it hunt in near darkness.', 'Look for the white tip on the lower lobe of the tail.', 'Spawns on rock and gravel as soon as the ice goes out.'],
  },
  sauger: {
    id: 'sauger', name: 'Sauger', latin: 'Sander canadensis', median: 1.0, sigma: 0.5, cap: 6.6, min: 0.2, form: 0.3,
    depth: [[8, 20], [12, 30], [12, 30], [15, 35]], temp: [52, 70], months: [1.0, 1.0, 1.2, 1.3, 1.0, 0.8, 0.7, 0.7, 1.0, 1.3, 1.3, 1.0],
    light: [1.1, 1.3, 0.7, 1.5], bottom: { gravel: 1.4, sand: 1.3, rock: 1.2 }, baits: { jig: 1.6, livebait: 1.3, crawler: 0.9 },
    lakes: { 'wolf-rapids': 0.9 }, jumps: false, power: 0.9,
    blurb: 'The walleye\'s river cousin, blotchier and built for current and stained water.',
    facts: ['Spots on the spiny dorsal fin tell it from a walleye.', 'Holds in current breaks below dams and wing dams.', 'Hybrids with walleye are called saugeye.'],
  },
  pike: {
    id: 'pike', name: 'Northern pike', latin: 'Esox lucius', median: 3.4, sigma: 0.6, cap: 39, min: 0.6, form: 0.26,
    depth: [[3, 10], [8, 20], [6, 18], [8, 22]], temp: [50, 68], months: [0.9, 0.9, 1.1, 1.3, 1.2, 1.0, 0.8, 0.8, 1.1, 1.3, 1.2, 0.9],
    light: [0.2, 1.2, 1.15, 1.2], bottom: { weed: 1.8, timber: 1.1, sand: 0.8 }, baits: { crank: 1.3, spinner: 1.5, bucktail: 1.4, livebait: 1.3, jig: 0.6 },
    lakes: { 'silver-birch': 0.6, 'mill-pond': 0.7, tamarack: 0.35, 'thunder-bay': 0.6, 'wolf-rapids': 0.3 }, jumps: true, power: 1.1,
    blurb: 'Long, toothy and green with rows of pale bean spots; the weedline\'s top predator.',
    facts: ['Spawns in flooded marsh grass right after ice-out.', 'Sensory pores along the jaw detect movement.', 'Wisconsin\'s state record pike weighed 38 lb.'],
  },
  musky: {
    id: 'musky', name: 'Muskellunge', latin: 'Esox masquinongy', median: 12, sigma: 0.45, cap: 70, min: 4, form: 0.307,
    depth: [[4, 12], [8, 22], [8, 25], [10, 25]], temp: [58, 76], months: [0.4, 0.4, 0.4, 0.5, 0.8, 1.0, 0.9, 0.9, 1.2, 1.6, 1.7, 0.5],
    light: [0.6, 1.2, 1.0, 1.5], bottom: { weed: 1.5, rock: 1.4, timber: 1.2 }, baits: { bucktail: 1.8, crank: 1.0, spinner: 0.7, livebait: 0.8 },
    lakes: { 'thunder-bay': 0.06, 'wolf-rapids': 0.05 }, jumps: true, power: 1.2,
    blurb: 'Wisconsin\'s state fish: the fish of ten thousand casts, long, barred and rare.',
    facts: ['The world-record musky, 69 lb 11 oz, came from Wisconsin\'s Chippewa Flowage in 1949.', 'Can live more than 30 years.', 'Big fish feed hardest in late fall as water cools.'],
  },
  laketrout: {
    id: 'laketrout', name: 'Lake trout', latin: 'Salvelinus namaycush', median: 4.0, sigma: 0.6, cap: 48, min: 0.8, form: 0.387, coldWater: true,
    depth: [[10, 40], [45, 100], [30, 80], [20, 60]], temp: [42, 55], months: [1.0, 1.0, 1.0, 1.2, 1.2, 1.0, 0.9, 0.9, 1.0, 1.1, 1.1, 1.0],
    light: [0.4, 1.2, 1.0, 1.1], bottom: { rock: 1.5, gravel: 1.2, muck: 0.9 }, baits: { jig: 1.3, livebait: 1.4, crank: 0.8 },
    lakes: { 'silver-birch': 0.1, 'thunder-bay': 0.7 }, jumps: false, power: 1.0,
    blurb: 'A deep, cold-water char that holds below the thermocline all summer.',
    facts: ['Needs cold, well-oxygenated water and lives in only the deepest lakes.', 'Can live past 40 years and grows slowly.', 'Spawns on rocky reefs in the fall.'],
  },
  whitefish: {
    id: 'whitefish', name: 'Lake whitefish', latin: 'Coregonus clupeaformis', median: 2.4, sigma: 0.4, cap: 13, min: 0.5, form: 0.43, coldWater: true,
    depth: [[20, 60], [40, 100], [30, 80], [25, 70]], temp: [42, 56], months: [1.3, 1.3, 1.1, 1.0, 0.9, 0.8, 0.7, 0.7, 0.8, 1.0, 1.2, 1.3],
    light: [0.3, 1.3, 1.0, 1.1], bottom: { sand: 1.3, gravel: 1.3, muck: 1.0 }, baits: { jig: 1.4, crawler: 1.0, livebait: 0.8 },
    lakes: { 'thunder-bay': 0.8 }, jumps: false, power: 0.8,
    blurb: 'Silvery, small-mouthed and schooling over deep flats, a classic Great Lakes table fish.',
    facts: ['Feeds on insect larvae, snails and tiny crustaceans on the bottom.', 'A small, overhanging snout and no teeth.', 'Commercially netted in Wisconsin for over 150 years.'],
  },
  channelcat: {
    id: 'channelcat', name: 'Channel catfish', latin: 'Ictalurus punctatus', median: 3.0, sigma: 0.6, cap: 46, min: 0.5, form: 0.43,
    depth: [[4, 14], [6, 20], [8, 22], [15, 30]], temp: [70, 86], months: [0.4, 0.4, 0.5, 0.8, 1.2, 1.4, 1.5, 1.4, 1.1, 0.8, 0.5, 0.4],
    light: [1.7, 1.0, 0.5, 1.3], bottom: { muck: 1.4, timber: 1.4, sand: 1.0 }, baits: { cutbait: 1.7, crawler: 1.3, livebait: 1.0 },
    lakes: { 'mill-pond': 0.6, 'wolf-rapids': 0.8 }, jumps: false, power: 1.4,
    blurb: 'Forked tail, blue-grey back and a nose for anything smelly on the bottom.',
    facts: ['The only Wisconsin catfish with a deeply forked tail.', 'Young fish have scattered black spots that fade with age.', 'Feeds mostly at night by smell and taste.'],
  },
  flathead: {
    id: 'flathead', name: 'Flathead catfish', latin: 'Pylodictis olivaris', median: 8, sigma: 0.65, cap: 76, min: 1.5, form: 0.48,
    depth: [[6, 18], [8, 25], [10, 28], [15, 35]], temp: [72, 86], months: [0.2, 0.2, 0.3, 0.6, 1.0, 1.4, 1.6, 1.5, 1.0, 0.6, 0.3, 0.2],
    light: [1.9, 0.9, 0.3, 1.3], bottom: { timber: 1.9, rock: 1.2, muck: 1.0 }, baits: { livebait: 1.8, cutbait: 1.0, crawler: 0.5 },
    lakes: { 'wolf-rapids': 0.35, 'mill-pond': 0.05 }, jumps: false, power: 1.5,
    blurb: 'A broad-headed giant that lives in snags and timber and hunts live fish at night.',
    facts: ['Prefers live prey and rarely scavenges.', 'Holes up in log jams and undercut banks by day.', 'Wisconsin\'s record flathead topped 74 lb.'],
  },
  sturgeon: {
    id: 'sturgeon', name: 'Lake sturgeon', latin: 'Acipenser fulvescens', median: 26, sigma: 0.55, cap: 175, min: 6, form: 0.24,
    depth: [[10, 30], [12, 35], [12, 35], [18, 40]], temp: [52, 70], months: [0.4, 0.4, 0.6, 1.0, 1.0, 0.8, 0.8, 0.9, 1.2, 1.4, 1.0, 0.5],
    light: [1.0, 1.0, 0.9, 1.0], bottom: { gravel: 1.4, sand: 1.2, rock: 1.1 }, baits: { crawler: 1.8, cutbait: 0.8 },
    lakes: { 'wolf-rapids': 0.03 }, jumps: true, power: 1.3,
    blurb: 'A living fossil with bony plates and a shark-like tail, older than the dinosaurs\' extinction.',
    facts: ['Can live more than 100 years and take 20 years to mature.', 'Vacuums snails, larvae and crayfish from the bottom with a toothless mouth.', 'Wisconsin\'s Lake Winnebago system holds one of the largest populations in the world.'],
  },
}

export const speciesIds = Object.keys(SPECIES) as SpeciesId[]

export function isSpeciesId(value: unknown): value is SpeciesId {
  return typeof value === 'string' && value in SPECIES
}

export const TIERS = ['Common', 'Keeper', 'Quality', 'Trophy', 'Legendary'] as const
export type Tier = (typeof TIERS)[number]

export function tierOf(percentile: number): Tier {
  if (percentile >= 0.998) return 'Legendary'
  if (percentile >= 0.98) return 'Trophy'
  if (percentile >= 0.9) return 'Quality'
  if (percentile >= 0.6) return 'Keeper'
  return 'Common'
}

/** Weight (lb) at a percentile of the species' size curve. */
export function weightAtPercentile(s: SpeciesDef, p: number): number {
  return Math.min(s.cap, s.median * Math.exp(s.sigma * inverseNormal(p)))
}

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

export function inverseNormal(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12)
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q))
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
  }
  if (q > 1 - 0.02425) {
    const r = Math.sqrt(-2 * Math.log(1 - q))
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
  }
  const r = q - 0.5, s = r * r
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
}

export function lengthFor(s: SpeciesDef, weightLb: number): number {
  return Math.cbrt((weightLb * 1000) / s.form)
}

export function formatWeight(lb: number): string {
  const whole = Math.floor(lb)
  const oz = Math.round((lb - whole) * 16)
  if (oz === 16) return `${whole + 1} lb 0 oz`
  return whole > 0 ? `${whole} lb ${oz} oz` : `${Math.max(1, oz)} oz`
}

export function formatLength(inches: number): string {
  const q = Math.round(inches * 4) / 4
  const whole = Math.floor(q)
  const frac = q - whole
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''
  return `${whole}${f} in`
}

/** When a catch was landed, in lake time (central): "Nov 4, 2026 · 6:42 AM". */
export function formatCaught(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}
