import { clubFromGsproIndex } from './clubs'
import type { TracePoint } from './flight'

/** GSPro world position. Units are yards; x and z are horizontal (Unity, left-handed), y is up. */
export type WorldPoint = { x: number; y: number; z: number }

/** One shot from GSPro's round file as the bridge sends it (absolute world coordinates, yards). */
export type CourseShotInput = {
  ref: string
  round: string
  seenAt: number
  player: string
  course: string
  hole: number
  holeShot: number
  par: number
  clubIndex: number | null
  final: boolean
  putt: boolean
  water: boolean
  startSurface: number
  endSurface: number
  toPin: number
  total: number
  ball: { speed: number; launch: number; direction: number; totalSpin: number; backSpin: number; sideSpin: number; spinAxis: number }
  start: WorldPoint
  touchdown: WorldPoint
  end: WorldPoint
  flight: [number, number, number][]
  touchdownTime: number
  roll: [number, number, number, number][]
  material: string | null
}

export type CourseShot = CourseShotInput & { id: number; roundId: string }

export type CourseRound = { id: string; course: string; startedAt: number; lastShotAt: number; shotCount: number; players: string[] }

const surfaces: Record<number, string> = { 1: 'Rough', 2: 'Fairway', 5: 'Green', 11: 'Sand' }

export function surfaceName(code: number) {
  return surfaces[code] ?? `Other (${code})`
}

export function courseName(key: string) {
  return key.replace(/_gsp$/i, '').replace(/_v\d+$/i, '').split(/[_-]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
}

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

/** The cup on each hole: where the holed final shot stopped (both players' finals stop at the same point). */
export function holePins(shots: CourseShot[]) {
  const pins = new Map<number, WorldPoint>()
  for (const shot of shots) if (shot.final && !pins.has(shot.hole)) pins.set(shot.hole, shot.end)
  for (const shot of shots) {
    if (pins.has(shot.hole)) continue
    const last = shots.filter(other => other.hole === shot.hole).sort((a, b) => b.holeShot - a.holeShot)[0]
    if (last) pins.set(shot.hole, last.end)
  }
  return pins
}

export type ShotAnalysis = {
  shot: CourseShot
  club: string | null
  before: number | null
  after: number | null
  carry: number
  offline: number
  apex: number
  /** GSPro's own path in the replay frame: yards toward the target line, feet above the start, yards right. */
  path: TracePoint[]
  landingIndex: number
}

/**
 * The target line is the launch heading turned back by the launch direction (HLA). In GSPro's left-handed frame the
 * right of a forward vector (fx, fz) is (fz, −fx); checked on a saved round, where left starts with draw spin finish left.
 */
export function analyzeShot(shot: CourseShot, pin: WorldPoint | null): ShotAnalysis {
  const start = shot.start
  const early = shot.flight.find(([x, , z]) => Math.hypot(x - start.x, z - start.z) > 3) ?? [shot.end.x, shot.end.y, shot.end.z]
  let lx = early[0] - start.x
  let lz = early[2] - start.z
  const length = Math.hypot(lx, lz) || 1
  lx /= length
  lz /= length
  const az = shot.putt ? 0 : (shot.ball.direction * Math.PI) / 180
  const tx = Math.cos(az) * lx - Math.sin(az) * lz
  const tz = Math.cos(az) * lz + Math.sin(az) * lx
  const frame = (x: number, y: number, z: number, t: number): TracePoint => {
    const dx = x - start.x
    const dz = z - start.z
    return { t, x: dx * tx + dz * tz, y: (y - start.y) * 3, z: dx * tz - dz * tx }
  }
  const steps = Math.max(1, shot.flight.length - 1)
  const air = shot.flight.map(([x, y, z], index) => frame(x, y, z, (index / steps) * shot.touchdownTime))
  if (air.length) air[air.length - 1] = frame(shot.touchdown.x, shot.touchdown.y, shot.touchdown.z, shot.touchdownTime)
  const roll = shot.roll.filter(([t]) => t > shot.touchdownTime).map(([t, x, y, z]) => frame(x, y, z, t))
  const endPoint = frame(shot.end.x, shot.end.y, shot.end.z, roll.length ? roll[roll.length - 1].t : shot.touchdownTime)
  const path = air.length ? [...air, ...roll] : [frame(start.x, start.y, start.z, 0), endPoint]
  if (path[path.length - 1].x !== endPoint.x) path.push({ ...endPoint, t: path[path.length - 1].t + 0.3 })
  return {
    shot,
    club: clubFromGsproIndex(shot.clubIndex),
    before: pin ? flat(start, pin) : null,
    after: shot.final ? 0 : pin ? flat(shot.end, pin) : shot.toPin,
    carry: flat(start, shot.touchdown),
    offline: endPoint.z,
    apex: Math.max(0, ...air.map(point => point.y)),
    path,
    landingIndex: Math.max(0, air.length - 1),
  }
}

export type HoleCard = { hole: number; par: number; score: number; putts: number; fairway: boolean | null; green: boolean; upAndDown: boolean | null; shots: ShotAnalysis[] }

export type Band = { label: string; shots: number; averageFeet: number | null; greens: number }

export type RoundReport = {
  holes: HoleCard[]
  score: number
  par: number
  fairways: { hit: number; chances: number }
  greens: { hit: number; chances: number }
  putts: number
  threePutts: number
  scrambling: { saved: number; chances: number }
  drive: number | null
  approach: Band[]
  lies: { surface: string; shots: number; averageFeet: number | null }[]
  putting: { label: string; holes: number; onePutts: number; threePutts: number; averagePutts: number }[]
}

const approachBands = [[0, 50], [50, 100], [100, 150], [150, 200], [200, 1000]] as const
const puttBands = [[0, 2], [2, 4], [4, 7], [7, 12], [12, 1000]] as const

function bandLabel(low: number, high: number, unit: string, scale = 1) {
  return high >= 1000 ? `${Math.round(low * scale)}+ ${unit}` : `${Math.round(low * scale)}–${Math.round(high * scale)} ${unit}`
}

export function roundPlayers(shots: CourseShot[]) {
  const counts = new Map<string, number>()
  for (const shot of shots) counts.set(shot.player, (counts.get(shot.player) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

export function roundReport(shots: CourseShot[], player: string): RoundReport {
  const pins = holePins(shots)
  const mine = shots.filter(shot => shot.player === player)
  const holes: HoleCard[] = [...new Set(mine.map(shot => shot.hole))].sort((a, b) => a - b).map(hole => {
    const list = mine.filter(shot => shot.hole === hole).sort((a, b) => a.holeShot - b.holeShot)
    const analysed = list.map(shot => analyzeShot(shot, pins.get(hole) ?? null))
    const par = list[0].par
    const score = Math.max(...list.map(shot => shot.holeShot))
    const putts = list.filter(shot => shot.putt).length
    const tee = list.find(shot => shot.holeShot === 1)
    const reached = list.find(shot => shot.endSurface === 5 || shot.final)
    const green = Boolean(reached && reached.holeShot <= par - 2)
    return { hole, par, score, putts, fairway: par >= 4 && tee ? tee.endSurface === 2 : null, green, upAndDown: green ? null : score <= par, shots: analysed }
  })
  const all = holes.flatMap(hole => hole.shots)
  const proximity = (list: ShotAnalysis[]) => {
    const values = list.map(item => item.after).filter((value): value is number => value !== null)
    return values.length ? (values.reduce((a, b) => a + b, 0) / values.length) * 3 : null
  }
  const approaches = all.filter(item => !item.shot.putt && item.before !== null && !(item.shot.holeShot === 1 && item.shot.par >= 4) && item.shot.startSurface !== 5)
  const firstPutts = holes.map(hole => ({ hole, first: hole.shots.find(item => item.shot.putt) })).filter(entry => entry.first && entry.first.before !== null)
  const drives = holes.filter(hole => hole.par >= 4).map(hole => hole.shots.find(item => item.shot.holeShot === 1)).filter((item): item is ShotAnalysis => Boolean(item && item.club === 'DR'))
  return {
    holes,
    score: holes.reduce((sum, hole) => sum + hole.score, 0),
    par: holes.reduce((sum, hole) => sum + hole.par, 0),
    fairways: { hit: holes.filter(hole => hole.fairway).length, chances: holes.filter(hole => hole.fairway !== null).length },
    greens: { hit: holes.filter(hole => hole.green).length, chances: holes.length },
    putts: holes.reduce((sum, hole) => sum + hole.putts, 0),
    threePutts: holes.filter(hole => hole.putts >= 3).length,
    scrambling: { saved: holes.filter(hole => hole.upAndDown).length, chances: holes.filter(hole => hole.upAndDown !== null).length },
    drive: drives.length ? drives.reduce((sum, item) => sum + item.shot.total, 0) / drives.length : null,
    approach: approachBands.map(([low, high]) => {
      const list = approaches.filter(item => item.before! >= low && item.before! < high)
      return { label: bandLabel(low, high, 'yd'), shots: list.length, averageFeet: proximity(list), greens: list.filter(item => item.shot.endSurface === 5 || item.shot.final).length }
    }).filter(band => band.shots > 0),
    lies: [2, 1, 11].map(code => {
      const list = approaches.filter(item => item.shot.startSurface === code && item.before! < 200)
      return { surface: surfaceName(code), shots: list.length, averageFeet: proximity(list) }
    }).filter(lie => lie.shots > 0),
    putting: puttBands.map(([low, high]) => {
      const list = firstPutts.filter(entry => entry.first!.before! >= low && entry.first!.before! < high)
      return {
        label: bandLabel(low, high, 'ft', 3),
        holes: list.length,
        onePutts: list.filter(entry => entry.hole.putts === 1).length,
        threePutts: list.filter(entry => entry.hole.putts >= 3).length,
        averagePutts: list.length ? list.reduce((sum, entry) => sum + entry.hole.putts, 0) / list.length : 0,
      }
    }).filter(band => band.holes > 0),
  }
}
