import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export type Level = 'floor' | 'north' | 'south'

interface Ramp {
  bottom: Vector3
  top: Vector3
}

const FLOOR_LIMIT = 1.1
const ARRIVE = 1.3

function rampsFor(side: 1 | -1): Ramp[] {
  const ramps: Ramp[] = []
  for (const sx of [1, -1]) {
    ramps.push({ bottom: new Vector3(sx * 8, 0, side * 29.5), top: new Vector3(sx * 8, 4, side * 42) })
    ramps.push({ bottom: new Vector3(sx * 30.5, 0, side * 2.5), top: new Vector3(sx * 30.5, 4, side * 15) })
  }
  return ramps
}

export const RAMPS: Record<Exclude<Level, 'floor'>, Ramp[]> = {
  north: rampsFor(1),
  south: rampsFor(-1),
}

export function levelOf(position: Vector3): Level {
  if (position.y < FLOOR_LIMIT) return 'floor'
  if (Math.abs(position.x) < 7 && Math.abs(position.z) < 7) return 'floor'
  return position.z >= 0 ? 'north' : 'south'
}

const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z)

function onRamp(position: Vector3, ramp: Ramp): boolean {
  const minZ = Math.min(ramp.bottom.z, ramp.top.z) - 0.5
  const maxZ = Math.max(ramp.bottom.z, ramp.top.z) + 0.5
  return Math.abs(position.x - ramp.bottom.x) < 2.4 && position.z > minZ && position.z < maxZ
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

const ALL_RAMPS = [...RAMPS.north, ...RAMPS.south]

export function nextWaypoint(from: Vector3, feet: Vector3): Vector3 {
  for (const ramp of ALL_RAMPS) {
    if (!onRamp(from, ramp) || from.y < 0.2 || from.y > ramp.top.y - 0.3) continue
    if (feet.y > from.y + 0.4) return ramp.top
    if (feet.y < from.y - 0.4) return ramp.bottom
    return feet
  }
  const mine = levelOf(from)
  const theirs = levelOf(feet)
  if (mine === theirs) return feet
  if (mine === 'floor') {
    const ramps = RAMPS[theirs as Exclude<Level, 'floor'>]
    const ramp = bestRamp(ramps, from, feet, 'bottom')
    if (onRamp(from, ramp) || flat(from, ramp.bottom) < ARRIVE) return ramp.top
    return ramp.bottom
  }
  const ramps = RAMPS[mine]
  const ramp = bestRamp(ramps, from, feet, 'top')
  if (onRamp(from, ramp) || flat(from, ramp.top) < ARRIVE) return ramp.bottom
  return ramp.top
}
