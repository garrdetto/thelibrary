/** Box score, line score and play-by-play. Lines are created as players enter and updated by the contest as plays resolve. */
import type { LineupPosition } from './types'

export interface BattingLine {
  id: string
  name: string
  pos: string
  ab: number
  r: number
  h: number
  d: number
  t: number
  hr: number
  rbi: number
  bb: number
  so: number
  hbp: number
  sb: number
  cs: number
  sf: number
  sh: number
}

export type Decision = 'W' | 'L' | 'S' | 'H' | 'BS'

export interface PitchingLine {
  id: string
  name: string
  outs: number
  h: number
  r: number
  er: number
  bb: number
  so: number
  hr: number
  hbp: number
  wp: number
  bk: number
  pitches: number
  strikes: number
  bf: number
  decisions: Decision[]
  qualityStart: boolean
}

export interface FieldingLine {
  po: number
  a: number
  e: number
}

export interface TeamBox {
  teamId: string
  batting: BattingLine[]
  pitching: PitchingLine[]
  fielding: Record<string, FieldingLine>
  lineScore: number[]
  runs: number
  hits: number
  errors: number
  leftOnBase: number
}

export interface PlayLogEntry {
  inning: number
  half: 'top' | 'bottom'
  outs: number
  batter: string
  pitcher: string
  text: string
  score: [number, number]
}

export function emptyBatting(id: string, name: string, pos: LineupPosition | 'PH' | 'PR'): BattingLine {
  return { id, name, pos, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0 }
}

export function emptyPitching(id: string, name: string): PitchingLine {
  return { id, name, outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, hbp: 0, wp: 0, bk: 0, pitches: 0, strikes: 0, bf: 0, decisions: [], qualityStart: false }
}

export function emptyTeamBox(teamId: string): TeamBox {
  return { teamId, batting: [], pitching: [], fielding: {}, lineScore: [], runs: 0, hits: 0, errors: 0, leftOnBase: 0 }
}

export function inningsPitched(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

export function fieldingLine(box: TeamBox, id: string): FieldingLine {
  return (box.fielding[id] ??= { po: 0, a: 0, e: 0 })
}
