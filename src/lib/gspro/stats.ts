import { clubInfo, clubOrder } from './clubs'
import { estimateFlight, type TracePoint } from './flight'
import type { GsproShot } from './types'

export type EnrichedShot = GsproShot & {
  smash: number | null
  faceToPath: number | null
  spinLoft: number | null
  carryYards: number | null
  carryEstimated: boolean
  totalYards: number | null
  offline: number | null
  apex: number | null
  descent: number | null
  /** Spin axis, path, face and start line signed so positive is the player's fade side (right for RH, left for LH). */
  fadeAxis: number
  shape: string
  /** GSPro's own path for course shots (replay frame), with the touchdown sample index and a context line. */
  actualPath?: TracePoint[]
  landingIndex?: number
  context?: string
}

export type Metric = { n: number; mean: number; sd: number; median: number; min: number; max: number }

export type ClubSummary = {
  club: string | null
  shots: number
  carry: Metric | null
  total: Metric | null
  offline: Metric | null
  ballSpeed: Metric | null
  clubSpeed: Metric | null
  smash: Metric | null
  launch: Metric | null
  spin: Metric | null
  spinAxis: Metric | null
  apex: Metric | null
  descent: Metric | null
  attackAngle: Metric | null
  path: Metric | null
  face: Metric | null
  faceToPath: Metric | null
  dynamicLoft: Metric | null
  impactH: Metric | null
  impactV: Metric | null
  carryEstimated: boolean
}

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places

export function sideSign(shot: Pick<GsproShot, 'handed'>) {
  return shot.handed === 'LH' ? -1 : 1
}

export function shapeName(startLine: number, fadeAxis: number) {
  const start = Math.abs(startLine) < 2 ? 'straight' : startLine > 0 ? 'push' : 'pull'
  const curve = Math.abs(fadeAxis) < 3 ? '' : fadeAxis > 0 ? (fadeAxis > 12 ? 'slice' : 'fade') : (fadeAxis < -12 ? 'hook' : 'draw')
  if (!curve) return start === 'straight' ? 'Straight' : start === 'push' ? 'Push' : 'Pull'
  if (start === 'straight') return curve[0].toUpperCase() + curve.slice(1)
  return `${start[0].toUpperCase()}${start.slice(1)} ${curve}`
}

export function enrichShot(shot: GsproShot): EnrichedShot {
  const sign = sideSign(shot)
  const smash = shot.clubSpeed && shot.clubSpeed > 20 ? shot.ballSpeed / shot.clubSpeed : null
  const faceToPath = shot.face !== null && shot.path !== null ? shot.face - shot.path : null
  const spinLoft = shot.dynamicLoft !== null && shot.attackAngle !== null ? shot.dynamicLoft - shot.attackAngle : null
  const flight = shot.club === 'PT' ? null : estimateFlight(shot)
  const reported = shot.carry !== null && shot.carry > 1 ? shot.carry : null
  const carryYards = reported ?? flight?.carry ?? null
  const scale = flight && reported && flight.carry > 1 ? reported / flight.carry : 1
  return {
    ...shot,
    smash: smash && smash < 1.7 ? smash : null,
    faceToPath,
    spinLoft,
    carryYards,
    carryEstimated: reported === null && carryYards !== null,
    totalYards: flight ? flight.total * scale : null,
    offline: flight ? flight.offline * scale : null,
    apex: flight ? flight.apex * scale : null,
    descent: flight?.descent ?? null,
    fadeAxis: shot.spinAxis * sign,
    shape: shapeName(shot.direction * sign, shot.spinAxis * sign),
  }
}

export function metric(values: (number | null | undefined)[]): Metric | null {
  const list = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => a - b)
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length
  const sd = list.length > 1 ? Math.sqrt(list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (list.length - 1)) : 0
  const middle = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { n: list.length, mean, sd, median, min: sorted[0], max: sorted[sorted.length - 1] }
}

export function summarizeClub(club: string | null, shots: EnrichedShot[]): ClubSummary {
  const sign = (shot: EnrichedShot) => sideSign(shot)
  return {
    club,
    shots: shots.length,
    carry: metric(shots.map(shot => shot.carryYards)),
    total: metric(shots.map(shot => shot.totalYards)),
    offline: metric(shots.map(shot => shot.offline === null ? null : shot.offline * sign(shot))),
    ballSpeed: metric(shots.map(shot => shot.ballSpeed)),
    clubSpeed: metric(shots.map(shot => shot.clubSpeed)),
    smash: metric(shots.map(shot => shot.smash)),
    launch: metric(shots.map(shot => shot.launch)),
    spin: metric(shots.map(shot => shot.totalSpin)),
    spinAxis: metric(shots.map(shot => shot.fadeAxis)),
    apex: metric(shots.map(shot => shot.apex)),
    descent: metric(shots.map(shot => shot.descent)),
    attackAngle: metric(shots.map(shot => shot.attackAngle)),
    path: metric(shots.map(shot => shot.path === null ? null : shot.path * sign(shot))),
    face: metric(shots.map(shot => shot.face === null ? null : shot.face * sign(shot))),
    faceToPath: metric(shots.map(shot => shot.faceToPath === null ? null : shot.faceToPath * sign(shot))),
    dynamicLoft: metric(shots.map(shot => shot.dynamicLoft)),
    impactH: metric(shots.map(shot => shot.impactH === null ? null : shot.impactH * sign(shot))),
    impactV: metric(shots.map(shot => shot.impactV)),
    carryEstimated: shots.some(shot => shot.carryEstimated),
  }
}

/** Shots grouped by club, longest clubs first; excluded shots and putts are left out. */
export function summarizeByClub(shots: EnrichedShot[]): ClubSummary[] {
  const groups = new Map<string | null, EnrichedShot[]>()
  for (const shot of shots) {
    if (shot.excluded || shot.club === 'PT') continue
    const list = groups.get(shot.club) ?? []
    list.push(shot)
    groups.set(shot.club, list)
  }
  return [...groups.entries()].sort((a, b) => clubOrder(a[0]) - clubOrder(b[0])).map(([club, list]) => summarizeClub(club, list))
}

export function clubKind(code: string | null) {
  return clubInfo(code)?.kind ?? null
}

export function fmt(value: number | null | undefined, places = 1, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${round(value, places).toFixed(places)}${suffix}`
}

export function signed(value: number | null | undefined, places = 1, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = round(value, places)
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(places)}${suffix}`
}
