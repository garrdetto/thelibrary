import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export type Level = 'floor' | 'north' | 'south' | 'centre'

type Deck = Exclude<Level, 'floor'>

interface Ramp {
  deck: Deck
  bottom: Vector3
  top: Vector3
}

const FLOOR_LIMIT = 1.1
const ARRIVE = 1.3
const CENTRE_REACH = 12.6
const PYLON_CLEAR = 2.1
const PYLON_ORBIT = 2.7

function rampsFor(side: 1 | -1): Ramp[] {
  const ramps: Ramp[] = []
  for (const sx of [1, -1]) {
    const deck: Deck = side === 1 ? 'north' : 'south'
    ramps.push({ deck, bottom: new Vector3(sx * 8, 0, side * 29.5), top: new Vector3(sx * 8, 4, side * 42) })
    ramps.push({ deck, bottom: new Vector3(sx * 30.5, 0, side * 2.5), top: new Vector3(sx * 30.5, 4, side * 15) })
  }
  return ramps
}

function centreRamps(): Ramp[] {
  const ramps: Ramp[] = []
  for (const side of [1, -1]) {
    ramps.push({ deck: 'centre', bottom: new Vector3(0, 0, side * 14), top: new Vector3(0, 2, side * 4.5) })
    ramps.push({ deck: 'centre', bottom: new Vector3(side * 14, 0, 0), top: new Vector3(side * 4.5, 2, 0) })
  }
  return ramps
}

export const RAMPS: Record<Deck, Ramp[]> = {
  north: rampsFor(1),
  south: rampsFor(-1),
  centre: centreRamps(),
}

export function levelOf(position: Vector3): Level {
  if (position.y < FLOOR_LIMIT) return 'floor'
  if (Math.abs(position.x) < CENTRE_REACH && Math.abs(position.z) < CENTRE_REACH) return 'centre'
  return position.z >= 0 ? 'north' : 'south'
}

const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

function onRamp(position: Vector3, ramp: Ramp): boolean {
  const alongX = ramp.bottom.z === ramp.top.z
  const along = alongX ? position.x : position.z
  const across = alongX ? position.z - ramp.bottom.z : position.x - ramp.bottom.x
  const from = alongX ? ramp.bottom.x : ramp.bottom.z
  const to = alongX ? ramp.top.x : ramp.top.z
  return Math.abs(across) < 2.4 && along > Math.min(from, to) - 0.5 && along < Math.max(from, to) + 0.5
}

function bestRamp(ramps: Ramp[], from: Vector3, to: Vector3, entry: 'bottom' | 'top'): Ramp {
  let best = ramps[0]
  let cost = Infinity
  for (const ramp of ramps) {
    const exit = entry === 'bottom' ? ramp.top : ramp.bottom
    const total = flat(from, ramp[entry]) + flat(exit, to)
    if (total < cost) {
      cost = total
      best = ramp
    }
  }
  return best
}

function aroundPylon(from: Vector3, feet: Vector3): Vector3 {
  const dx = feet.x - from.x
  const dz = feet.z - from.z
  const length2 = dx * dx + dz * dz
  if (length2 < 1e-6) return feet
  const t = Math.max(0, Math.min(1, -(from.x * dx + from.z * dz) / length2))
  let cx = from.x + dx * t
  let cz = from.z + dz * t
  const clearance = Math.hypot(cx, cz)
  if (clearance >= PYLON_CLEAR) return feet
  if (clearance < 0.05) {
    const length = Math.sqrt(length2)
    cx = dz / length
    cz = -dx / length
  } else {
    cx /= clearance
    cz /= clearance
  }
  return new Vector3(cx * PYLON_ORBIT, feet.y, cz * PYLON_ORBIT)
}

const ALL_RAMPS = [...RAMPS.north, ...RAMPS.south, ...RAMPS.centre]

export function nextWaypoint(from: Vector3, feet: Vector3): Vector3 {
  for (const ramp of ALL_RAMPS) {
    if (!onRamp(from, ramp) || from.y < 0.2 || from.y > ramp.top.y - 0.3) continue
    const target = levelOf(feet)
    if (target !== ramp.deck && target !== 'floor') return ramp.bottom
    if (feet.y > from.y + 0.4) return ramp.top
    if (feet.y < from.y - 0.4) return ramp.bottom
    return feet
  }
  const mine = levelOf(from)
  const theirs = levelOf(feet)
  if (mine === theirs) return mine === 'centre' ? aroundPylon(from, feet) : feet
  if (mine === 'floor') {
    const ramps = RAMPS[theirs as Deck]
    const ramp = bestRamp(ramps, from, feet, 'bottom')
    if (onRamp(from, ramp) || flat(from, ramp.bottom) < ARRIVE) return ramp.top
    return ramp.bottom
  }
  const ramps = RAMPS[mine]
  const ramp = bestRamp(ramps, from, feet, 'top')
  if (onRamp(from, ramp) || flat(from, ramp.top) < ARRIVE) return ramp.bottom
  return ramp.top
}
