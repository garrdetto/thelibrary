import { CELL, MATERIALS } from './Materials'
import type { MaterialId } from './Materials'
import type { VehicleId } from './Vehicles'

export type Point = readonly [number, number]
export type Zone = { x1: number; y1: number; x2: number; y2: number }
export type Pillar = { x: number; top: number }

export type Level = {
  index: number
  name: string
  chapter: number
  theme: number
  span: number
  anchors: Point[]
  pillars: Pillar[]
  zones: Zone[]
  yMin: number
  yMax: number
  water: number
  vehicles: VehicleId[]
  materials: MaterialId[]
  budget: number
  tip: string
}

export type Beam = { x1: number; y1: number; x2: number; y2: number; m: MaterialId }

export type Design = { beams: Beam[] }

export const key = (x: number, y: number) => `${x},${y}`

export function beamCells(beam: Pick<Beam, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return Math.max(Math.abs(beam.x2 - beam.x1), Math.abs(beam.y2 - beam.y1))
}

export function beamLength(beam: Pick<Beam, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1) * CELL
}

export function beamCost(beam: Beam): number {
  return Math.round(beamLength(beam) * MATERIALS[beam.m].costPerMetre)
}

export function designCost(design: Design): number {
  return design.beams.reduce((sum, beam) => sum + beamCost(beam), 0)
}

export function sameBeam(a: Pick<Beam, 'x1' | 'y1' | 'x2' | 'y2'>, b: Pick<Beam, 'x1' | 'y1' | 'x2' | 'y2'>): boolean {
  return (a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2) || (a.x1 === b.x2 && a.y1 === b.y2 && a.x2 === b.x1 && a.y2 === b.y1)
}

export function isAnchor(level: Level, x: number, y: number): boolean {
  return level.anchors.some(([ax, ay]) => ax === x && ay === y)
}

export function pointProblem(level: Level, x: number, y: number): string | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Joints sit on the grid.'
  if (isAnchor(level, x, y)) return null
  if (x < 0 || x > level.span || y < level.yMin || y > level.yMax) return 'Outside the building area.'
  if ((x === 0 || x === level.span) && y <= 0) return 'Only anchors can sit on the rock.'
  if (level.pillars.some(p => p.x === x && y <= p.top)) return 'Only anchors can sit on a pillar.'
  if (level.zones.some(z => x > z.x1 && x < z.x2 && y > z.y1 && y < z.y2)) return 'Keep the channel clear.'
  return null
}

function crossesZone(beam: Pick<Beam, 'x1' | 'y1' | 'x2' | 'y2'>, zone: Zone): boolean {
  const steps = 16
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = beam.x1 + (beam.x2 - beam.x1) * t
    const y = beam.y1 + (beam.y2 - beam.y1) * t
    if (x > zone.x1 + 1e-6 && x < zone.x2 - 1e-6 && y > zone.y1 + 1e-6 && y < zone.y2 - 1e-6) return true
  }
  return false
}

export function beamProblem(level: Level, beam: Beam): string | null {
  const dx = beam.x2 - beam.x1
  const dy = beam.y2 - beam.y1
  if (dx === 0 && dy === 0) return 'Too short.'
  if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return 'Beams run flat, at 45° or at 90°.'
  const material = MATERIALS[beam.m]
  if (!level.materials.includes(beam.m)) return `${material.name} isn't available yet.`
  if (beamCells(beam) > material.maxCells) return `${material.name} reaches ${material.maxCells} squares at most.`
  if (material.road && dy !== 0) return 'Road has to be flat.'
  const a = pointProblem(level, beam.x1, beam.y1)
  if (a) return a
  const b = pointProblem(level, beam.x2, beam.y2)
  if (b) return b
  if (level.zones.some(zone => crossesZone(beam, zone))) return 'Keep the channel clear.'
  return null
}

export function designProblem(level: Level, design: Design): string | null {
  if (design.beams.length > 600) return 'Too many parts.'
  for (let i = 0; i < design.beams.length; i++) {
    const problem = beamProblem(level, design.beams[i])
    if (problem) return problem
    for (let j = 0; j < i; j++) if (sameBeam(design.beams[i], design.beams[j])) return 'Two beams in the same place.'
  }
  return null
}

export function starsFor(level: Level, cost: number): number {
  if (cost > level.budget) return 0
  if (cost <= level.budget * 0.8) return 3
  if (cost <= level.budget * 0.92) return 2
  return 1
}

export function levelPoints(level: Level, cost: number): number {
  const stars = starsFor(level, cost)
  if (!stars) return 0
  return stars * 100 + Math.max(0, Math.round(((level.budget - cost) / level.budget) * 100))
}
