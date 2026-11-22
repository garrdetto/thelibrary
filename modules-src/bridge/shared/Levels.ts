import { designCost, pointProblem } from './Design'
import type { Beam, Design, Level, Pillar, Point, Zone } from './Design'
import { unlockedMaterials } from './Materials'
import type { MaterialId } from './Materials'
import type { VehicleId } from './Vehicles'
import { REFERENCE } from './Reference'

export const LEVEL_COUNT = 100

export type Chapter = { name: string; theme: number; blurb: string }

export const CHAPTERS: Chapter[] = [
  { name: 'Country Creek', theme: 0, blurb: 'Wood and road over gentle creeks.' },
  { name: 'River Bend', theme: 1, blurb: 'Steel arrives, and pillars in the river.' },
  { name: 'Red Canyon', theme: 2, blurb: 'Deep drops. Cables hang from the rock.' },
  { name: 'Harbor Mouth', theme: 3, blurb: 'Leave the channel open for the ships.' },
  { name: 'Mountain Pass', theme: 4, blurb: 'Snowy gorges and heavier trucks.' },
  { name: 'Quarry Road', theme: 5, blurb: 'Dump trucks haul stone across the pits.' },
  { name: 'Fuel Run', theme: 6, blurb: 'Tankers at sunset over wide water.' },
  { name: 'Fire Brigade', theme: 7, blurb: 'Fire engines race through the forest.' },
  { name: 'Heavy Haul', theme: 8, blurb: 'Crane trucks test every joint.' },
  { name: 'Grand Spans', theme: 9, blurb: 'The longest gaps and tightest budgets.' },
]

type Plan = {
  span: number
  vehicles: VehicleId[]
  low?: number
  high?: number
  pillars?: number[]
  pillarTop?: number
  channel?: [number, number]
  water?: number
  tip?: string
}

const TIPS: Record<number, string> = {
  1: 'Drag from an anchor to lay road. Road has to be flat.',
  2: 'A loose road sags. Use the anchors under the road and wood beams to hold it up.',
  3: 'Triangles never fold. Join beams into triangles.',
  4: 'Press Test to send the vehicle. Watch the colours: red beams are close to snapping.',
  6: 'No anchors below? Build the triangles above the road instead.',
  11: 'Steel is three times as strong as wood but costs more. Use it only where the load is.',
  12: 'Pillars carry the road in the middle of the river.',
  21: 'Cables only pull. Hang the road from the high anchors with long cables.',
  31: 'Keep the channel clear for ships: build up, not down. Steel road takes heavy loads.',
  41: 'A convoy puts weight on the whole bridge at once.',
  61: 'Long spans need deep trusses. Make them taller.',
  91: 'The grand finale. Every material, every trick.',
}

function chapterPlan(chapter: number, k: number): Plan {
  switch (chapter) {
    case 0: {
      const spans = [2, 3, 3, 4, 4, 5, 5, 6, 7, 8]
      const vehicles: VehicleId[][] = [['car'], ['car'], ['car'], ['car'], ['van'], ['car'], ['van'], ['van'], ['car', 'van'], ['pickup']]
      return { span: spans[k], vehicles: vehicles[k], low: k === 0 ? 0 : k === 5 || k === 6 ? 0 : k >= 8 ? 2 : 1 }
    }
    case 1: {
      const spans = [6, 8, 9, 8, 10, 10, 11, 12, 12, 13]
      const vehicles: VehicleId[][] = [['pickup'], ['van'], ['icecream'], ['pickup', 'van'], ['minibus'], ['tractor'], ['icecream', 'car'], ['minibus'], ['tractor', 'pickup'], ['minibus', 'van']]
      const pillars: number[][] = [[], [4], [], [4], [5], [], [5], [4, 8], [6], [4, 9]]
      return { span: spans[k], vehicles: vehicles[k], low: k % 3 === 2 ? 0 : 1, pillars: pillars[k] }
    }
    case 2: {
      const spans = [8, 9, 10, 10, 11, 12, 12, 13, 14, 14]
      const vehicles: VehicleId[][] = [['minibus'], ['monster'], ['van', 'van'], ['monster'], ['minibus', 'pickup'], ['tractor'], ['monster', 'car'], ['icecream', 'icecream'], ['minibus'], ['monster', 'minibus']]
      return { span: spans[k], vehicles: vehicles[k], low: 0, high: 3 + (k % 3), water: -6, pillars: k === 8 ? [7] : [], pillarTop: -2 }
    }
    case 3: {
      const spans = [8, 9, 10, 10, 11, 12, 12, 13, 14, 14]
      const vehicles: VehicleId[][] = [['boxtruck'], ['bus'], ['boxtruck', 'car'], ['bus'], ['boxtruck'], ['bus', 'van'], ['boxtruck', 'pickup'], ['bus'], ['boxtruck', 'minibus'], ['bus', 'bus']]
      const span = spans[k]
      return { span, vehicles: vehicles[k], low: 1, high: k >= 5 ? 4 : 0, channel: [2, span - 2] }
    }
    case 4: {
      const spans = [10, 11, 11, 12, 12, 13, 13, 14, 14, 15]
      const vehicles: VehicleId[][] = [['boxtruck', 'car'], ['dump'], ['boxtruck', 'van', 'car'], ['dump'], ['bus', 'pickup'], ['dump', 'car'], ['boxtruck', 'boxtruck'], ['dump'], ['bus', 'icecream'], ['dump', 'van']]
      const pillars: number[][] = [[], [], [5], [6], [], [6], [], [7], [7], [5, 10]]
      return { span: spans[k], vehicles: vehicles[k], low: k % 2 ? 2 : 1, high: k % 3 === 1 ? 4 : 0, pillars: pillars[k] }
    }
    case 5: {
      const spans = [12, 12, 13, 13, 14, 14, 15, 15, 16, 16]
      const vehicles: VehicleId[][] = [['dump'], ['dump', 'pickup'], ['dump'], ['dump', 'dump'], ['tractor', 'dump'], ['dump'], ['dump', 'boxtruck'], ['dump'], ['dump', 'dump'], ['dump', 'tractor']]
      const pillars: number[][] = [[6], [4, 8], [6], [5, 8], [7], [5, 9], [7], [5, 10], [8], [5, 11]]
      return { span: spans[k], vehicles: vehicles[k], low: 1, pillars: pillars[k], pillarTop: k % 2 ? -1 : 0 }
    }
    case 6: {
      const spans = [12, 13, 13, 14, 14, 15, 15, 16, 16, 16]
      const vehicles: VehicleId[][] = [['tanker'], ['tanker'], ['fire'], ['tanker', 'car'], ['tanker'], ['tanker', 'van'], ['tanker'], ['fire', 'tanker'], ['tanker'], ['tanker', 'tanker']]
      const span = spans[k]
      const pillars: number[][] = [[], [6], [], [7], [7], [7], [7], [8], [8], [8]]
      const channel = k === 2
      return { span, vehicles: vehicles[k], low: k % 2 ? 1 : 2, high: channel ? 4 : 0, pillars: channel ? [] : pillars[k], channel: channel ? [3, span - 3] : undefined }
    }
    case 7: {
      const spans = [13, 13, 14, 14, 15, 15, 16, 16, 17, 17]
      const vehicles: VehicleId[][] = [['fire'], ['fire', 'car'], ['fire'], ['fire', 'van'], ['fire', 'fire'], ['fire', 'pickup'], ['fire'], ['fire', 'minibus'], ['fire', 'fire'], ['fire', 'monster']]
      const pillars: number[][] = [[6], [], [7], [], [7], [5, 10], [8], [], [8], [6, 11]]
      return { span: spans[k], vehicles: vehicles[k], low: 2, high: k % 2 ? 5 : 0, pillars: pillars[k], pillarTop: 0 }
    }
    case 8: {
      const spans = [14, 14, 15, 15, 16, 16, 17, 17, 18, 18]
      const vehicles: VehicleId[][] = [['crane'], ['crane'], ['crane', 'car'], ['crane'], ['crane', 'van'], ['crane'], ['crane', 'pickup'], ['crane'], ['crane', 'boxtruck'], ['crane', 'crane']]
      const pillars: number[][] = [[7], [5, 9], [7], [5, 10], [8], [5, 11], [8], [6, 11], [9], [5, 9, 13]]
      return { span: spans[k], vehicles: vehicles[k], low: 2, high: k % 3 === 0 ? 5 : 0, pillars: pillars[k], pillarTop: 0 }
    }
    default: {
      const spans = [16, 16, 17, 17, 18, 18, 19, 19, 20, 20]
      const vehicles: VehicleId[][] = [['tanker', 'car'], ['crane'], ['bus', 'bus', 'van'], ['fire', 'tanker'], ['crane', 'dump'], ['monster', 'tanker'], ['crane'], ['fire', 'fire', 'car'], ['crane', 'tanker'], ['crane', 'fire', 'tanker', 'car']]
      const span = spans[k]
      const pillars: number[][] = [[8], [5, 11], [8], [6, 11], [6, 12], [9], [6, 13], [6, 13], [7, 13], [5, 10, 15]]
      return { span, vehicles: vehicles[k], low: k % 2 ? 1 : 2, high: k % 2 ? 0 : 5, pillars: pillars[k], channel: k === 3 || k === 7 ? [Math.floor(span / 2) - 2, Math.floor(span / 2) + 2] : undefined, pillarTop: 0 }
    }
  }
}

const NAMES = [
  'First Crossing', 'Low Water', 'Triangle Time', 'Test Drive', 'Mail Route', 'Over the Top', 'Morning Delivery', 'Mill Run', 'Two by Two', 'Farm Gate',
  'Steel Works', 'Midstream', 'Sweet Ride', 'Stepping Stones', 'School Run', 'Plough Through', 'Treat Street', 'Two Pillars', 'Harvest Haul', 'River Shuttle',
  'Hanging On', 'Big Wheels', 'Twin Vans', 'Rock Spires', 'Canyon Shuttle', 'Slow Climb', 'Wheel Party', 'Double Scoop', 'Red Gulch', 'Canyon Kings',
  'Open Channel', 'Bus Stop', 'Dock Run', 'Ferry Lane', 'Container Row', 'Rush Hour', 'Pier Pressure', 'Lighthouse', 'Harbor Lights', 'Double Decker',
  'Snowline', 'Gravel Train', 'Three Abreast', 'Avalanche Gap', 'Ski Bus', 'Ridge Run', 'Twin Haul', 'Summit', 'Frozen Falls', 'Pass Over',
  'Pit Stop', 'Rock Hauler', 'Deep Cut', 'Stone Convoy', 'Field to Pit', 'Granite', 'Crusher Road', 'Bedrock', 'Double Load', 'Last Load',
  'Full Tank', 'Refinery Road', 'Siren Song', 'Fuel Stop', 'Long Haul', 'Dusk Run', 'Gas Giant', 'Hot Water', 'Sunset Strip', 'Tanker Twins',
  'First Alarm', 'Hydrant Lane', 'Ladder Up', 'Station Run', 'Two Alarm', 'Smoke Ridge', 'Hose Down', 'Rescue Run', 'Three Alarm', 'Back to Base',
  'Heavy Lifter', 'Boom Arm', 'Lift and Shift', 'Steel Beam', 'Outrigger', 'Counterweight', 'Wide Load', 'Tower Crane', 'Mega Move', 'Twin Cranes',
  'City Gate', 'Skyline', 'Night Buses', 'Emergency', 'Iron Giants', 'Show Time', 'Long Reach', 'Double Alarm', 'Titans', 'Grand Parade',
]

function levelSlack(index: number): number {
  return 1.32 - ((index - 1) / (LEVEL_COUNT - 1)) * 0.22
}

function roundBudget(value: number): number {
  const step = value < 5_000 ? 100 : value < 20_000 ? 250 : 500
  return Math.ceil(value / step) * step
}

export function levelShape(index: number): Omit<Level, 'budget'> {
  const chapter = Math.floor((index - 1) / 10)
  const k = (index - 1) % 10
  const plan = chapterPlan(chapter, k)
  const span = plan.span
  const water = plan.water ?? (plan.span <= 4 ? -2 : -3)
  const anchors: Point[] = [[0, 0], [span, 0]]
  for (let d = 1; d <= (plan.low ?? 0); d++) anchors.push([0, -d], [span, -d])
  if (plan.high) anchors.push([0, plan.high], [span, plan.high])
  const pillarTop = plan.pillarTop ?? 0
  const pillars: Pillar[] = (plan.pillars ?? []).map(x => ({ x, top: pillarTop }))
  for (const p of pillars) {
    anchors.push([p.x, p.top])
    if (p.top - 1 > water) anchors.push([p.x, p.top - 1])
  }
  const zones: Zone[] = plan.channel ? [{ x1: plan.channel[0], y1: water - 1, x2: plan.channel[1], y2: 0 }] : []
  const materials: MaterialId[] = unlockedMaterials(index)
  return {
    index,
    name: NAMES[index - 1],
    chapter,
    theme: CHAPTERS[chapter].theme,
    span,
    anchors,
    pillars,
    zones,
    yMin: water + 1,
    yMax: Math.max(5, (plan.high ?? 0) + 1),
    water,
    vehicles: plan.vehicles,
    materials,
    tip: TIPS[index] ?? plan.tip ?? '',
  }
}

export type ReferenceConfig = { side: 'below' | 'above' | 'both'; depth: number; frame: MaterialId; road: MaterialId; brace: 'single' | 'cross' }

export function parseConfig(code: string): ReferenceConfig {
  const side = code[0] === 'b' ? 'below' : code[0] === 'a' ? 'above' : 'both'
  const frame: MaterialId = code[2] === 's' ? 'steel' : 'wood'
  const road: MaterialId = code[3] === 'h' ? 'heavy' : 'road'
  return { side, depth: Number(code[1]), frame, road, brace: code[4] === 'x' ? 'cross' : 'single' }
}

export function configCode(config: ReferenceConfig): string {
  return `${config.side === 'below' ? 'b' : config.side === 'above' ? 'a' : 'c'}${config.depth}${config.frame === 'steel' ? 's' : 'w'}${config.road === 'heavy' ? 'h' : 'r'}${config.brace === 'cross' ? 'x' : 's'}`
}

class Builder {
  readonly beams: Beam[] = []
  private readonly seen = new Set<string>()
  constructor(private readonly ok: (x: number, y: number) => boolean) {}
  add(x1: number, y1: number, x2: number, y2: number, m: MaterialId) {
    if (x1 === x2 && y1 === y2) return
    if (!this.ok(x1, y1) || !this.ok(x2, y2)) return
    const id = x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`
    if (this.seen.has(id)) return
    this.seen.add(id)
    this.beams.push({ x1, y1, x2, y2, m })
  }
}

function truss(builder: Builder, x0: number, x1: number, s: number, depth: number, m: MaterialId, brace: 'single' | 'cross') {
  const length = x1 - x0
  const d = Math.max(1, Math.min(depth, Math.floor((length - 1) / 2)))
  if (length < 2) return
  const mid = (x0 + x1) / 2
  for (let r = 1; r <= d; r++) {
    const from = x0 + r
    const to = x1 - r
    if (to < from) break
    const y = s * r
    const py = s * (r - 1)
    for (let x = from; x <= to; x++) {
      builder.add(x, py, x, y, m)
      if (x < to) builder.add(x, y, x + 1, y, m)
    }
    builder.add(from - 1, py, from, y, m)
    builder.add(to + 1, py, to, y, m)
    for (let x = from; x < to; x++) {
      const towardMid = x + 0.5 < mid
      if (brace === 'cross' || towardMid) builder.add(x, py, x + 1, y, m)
      if (brace === 'cross' || !towardMid) builder.add(x + 1, py, x, y, m)
    }
  }
}

export function referenceDesign(level: Omit<Level, 'budget'>, config: ReferenceConfig): Design {
  const full = { ...level, budget: 0 } as Level
  const builder = new Builder((x, y) => pointProblem(full, x, y) === null)
  for (let x = 0; x < level.span; x++) builder.add(x, 0, x + 1, 0, config.road)
  for (const p of level.pillars) if (p.top < 0) builder.add(p.x, p.top, p.x, 0, config.frame)
  const supports = [0, ...level.pillars.map(p => p.x), level.span].sort((a, b) => a - b)
  for (let s = 0; s < supports.length - 1; s++) {
    const x0 = supports[s]
    const x1 = supports[s + 1]
    if (config.side !== 'above') truss(builder, x0, x1, -1, config.depth, config.frame, config.brace)
    if (config.side !== 'below') truss(builder, x0, x1, 1, config.depth, config.frame, config.brace)
  }
  return { beams: builder.beams }
}

const cache = new Map<number, Level>()

export function getLevel(index: number): Level {
  const hit = cache.get(index)
  if (hit) return hit
  const shape = levelShape(index)
  const code = REFERENCE[index - 1] ?? 'c2sxh'
  const cost = designCost(referenceDesign(shape, parseConfig(code)))
  const level: Level = { ...shape, budget: roundBudget(cost * levelSlack(index)) }
  cache.set(index, level)
  return level
}

export function referenceFor(index: number): Design {
  return referenceDesign(levelShape(index), parseConfig(REFERENCE[index - 1] ?? 'c2sxh'))
}
