import { beamProblem, designCost, isAnchor, key, sameBeam } from '../shared/Design'
import type { Beam, Design, Level } from '../shared/Design'
import { MATERIALS } from '../shared/Materials'
import type { MaterialId } from '../shared/Materials'

export type Placement = { beams: Beam[]; problem: string | null; end: [number, number] }

export function splitAt(beams: Beam[], x: number, y: number): Beam[] {
  const out: Beam[] = []
  for (const beam of beams) {
    const dx = beam.x2 - beam.x1
    const dy = beam.y2 - beam.y1
    const cells = Math.max(Math.abs(dx), Math.abs(dy))
    let split = false
    for (let t = 1; t < cells; t++) {
      if (beam.x1 + (dx / cells) * t === x && beam.y1 + (dy / cells) * t === y) {
        out.push({ x1: beam.x1, y1: beam.y1, x2: x, y2: y, m: beam.m }, { x1: x, y1: y, x2: beam.x2, y2: beam.y2, m: beam.m })
        split = true
        break
      }
    }
    if (!split) out.push(beam)
  }
  return out
}

const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]

export class Editor {
  beams: Beam[] = []
  private past: Beam[][] = []
  private future: Beam[][] = []
  constructor(readonly level: Level) {}

  load(design: Design | null) {
    let beams = design ? design.beams.filter(beam => !beamProblem(this.level, beam)).map(beam => ({ ...beam })) : []
    for (const beam of [...beams]) for (const [x, y] of [[beam.x1, beam.y1], [beam.x2, beam.y2]]) beams = splitAt(beams, x, y)
    this.beams = beams.filter((beam, i) => beams.findIndex(other => sameBeam(other, beam)) === i)
    this.past = []
    this.future = []
  }

  design(): Design {
    return { beams: this.beams.map(beam => ({ ...beam })) }
  }

  cost(): number {
    return designCost(this.design())
  }

  joints(): Set<string> {
    const set = new Set<string>()
    for (const [x, y] of this.level.anchors) set.add(key(x, y))
    for (const beam of this.beams) {
      const dx = beam.x2 - beam.x1
      const dy = beam.y2 - beam.y1
      const cells = Math.max(Math.abs(dx), Math.abs(dy))
      for (let t = 0; t <= cells; t++) set.add(key(beam.x1 + (dx / cells) * t, beam.y1 + (dy / cells) * t))
    }
    return set
  }

  nearestJoint(gx: number, gy: number, reach = 0.45): [number, number] | null {
    let best: [number, number] | null = null
    let bestDistance = reach
    for (const id of this.joints()) {
      const [x, y] = id.split(',').map(Number)
      const distance = Math.hypot(x - gx, y - gy)
      if (distance < bestDistance) {
        bestDistance = distance
        best = [x, y]
      }
    }
    return best
  }

  nearestBeam(gx: number, gy: number, reach = 0.3): number {
    let best = -1
    let bestDistance = reach
    this.beams.forEach((beam, index) => {
      const ex = beam.x2 - beam.x1
      const ey = beam.y2 - beam.y1
      const t = Math.max(0, Math.min(1, ((gx - beam.x1) * ex + (gy - beam.y1) * ey) / (ex * ex + ey * ey)))
      const distance = Math.hypot(beam.x1 + ex * t - gx, beam.y1 + ey * t - gy)
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    })
    return best
  }

  plan(start: [number, number], gx: number, gy: number, material: MaterialId): Placement {
    const spec = MATERIALS[material]
    const dx = gx - start[0]
    const dy = gy - start[1]
    let dir: [number, number]
    if (spec.road) dir = [dx < 0 ? -1 : 1, 0]
    else {
      const angle = Math.atan2(dy, dx)
      dir = DIRS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]
    }
    const unit = Math.hypot(dir[0], dir[1])
    const along = (dx * dir[0] + dy * dir[1]) / unit
    const cells = Math.max(1, Math.min(spec.maxCells, Math.round(along / unit)))
    const end: [number, number] = [start[0] + dir[0] * cells, start[1] + dir[1] * cells]
    const joints = this.joints()
    const pieces: Beam[] = []
    let from = start
    for (let t = 1; t <= cells; t++) {
      const point: [number, number] = [start[0] + dir[0] * t, start[1] + dir[1] * t]
      if (t === cells || joints.has(key(point[0], point[1]))) {
        pieces.push({ x1: from[0], y1: from[1], x2: point[0], y2: point[1], m: material })
        from = point
      }
    }
    let problem: string | null = null
    for (const piece of pieces) {
      problem = beamProblem(this.level, piece)
      if (problem) break
    }
    if (!problem && pieces.every(piece => this.beams.some(beam => sameBeam(beam, piece) && beam.m === material))) problem = 'Already built.'
    return { beams: pieces, problem, end }
  }

  private commit(next: Beam[]) {
    this.past.push(this.beams)
    if (this.past.length > 200) this.past.shift()
    this.future = []
    this.beams = next
  }

  place(placement: Placement): boolean {
    if (placement.problem) return false
    let next = this.beams.filter(beam => !placement.beams.some(piece => sameBeam(beam, piece)))
    for (const piece of placement.beams) {
      for (const [x, y] of [[piece.x1, piece.y1], [piece.x2, piece.y2]]) next = splitAt(next, x, y)
    }
    next.push(...placement.beams.map(beam => ({ ...beam })))
    this.commit(next)
    return true
  }

  remove(index: number) {
    if (index < 0 || index >= this.beams.length) return
    this.commit(this.beams.filter((_, i) => i !== index))
  }

  clear() {
    if (!this.beams.length) return
    this.commit([])
  }

  undo(): boolean {
    const previous = this.past.pop()
    if (!previous) return false
    this.future.push(this.beams)
    this.beams = previous
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push(this.beams)
    this.beams = next
    return true
  }

  canUndo() { return this.past.length > 0 }
  canRedo() { return this.future.length > 0 }

  isAnchor(x: number, y: number) {
    return isAnchor(this.level, x, y)
  }
}
