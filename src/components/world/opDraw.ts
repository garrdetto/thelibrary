import type { TelloLand } from '../../../modules-src/tello/region'
import { boxOf as shapeBoxOf, curveOf, shapeBox, unionBox, type Box } from '../../../modules-src/tello/edits/Geom'
import { rectRing } from '../../../modules-src/tello/edits/Apply'
import type { EditOp } from '../../../modules-src/tello/edits/WorldEdits'
import { drawShape, highlightBuilding, highlightRing, highlightRoad, toSX, toSY, tracePath, type View } from './draw'

const OP_COLOR = '#ff4fd8'

/** Outlines what an edit covers on the map (for the selected edit and the one under the cursor in the list). */
export function drawOp(g: CanvasRenderingContext2D, v: View, op: EditOp, land: TelloLand, color = OP_COLOR): void {
  switch (op.type) {
    case 'terrain':
    case 'trees':
    case 'railCut':
    case 'lightCut':
      drawShape(g, v, op.shape, op.type === 'terrain' ? op.falloff : 0, color)
      return
    case 'water':
      if (op.shape) drawShape(g, v, op.shape, 0, color)
      if (op.at) marker(g, v, op.at[0], op.at[1], color)
      return
    case 'river':
    case 'road': {
      const line = curveOf(op.pts, op.curve, op.fit ?? 'arcs', 2)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.strokeStyle = color
      g.globalAlpha = 0.5
      g.lineWidth = Math.max(5, op.w * v.s + 4)
      tracePath(g, v, line)
      g.stroke()
      g.globalAlpha = 1
      dots(g, v, op.pts, color)
      return
    }
    case 'roadRemove':
    case 'buildingRemove':
    case 'lotRemove':
      for (const id of op.ids) marker(g, v, ...centreOfFeature(land, id, op.type), color)
      return
    case 'roadSet': {
      const r = land.doc.roads.find((x) => x.id === op.ref)
      if (r) highlightRoad(g, v, r, color)
      return
    }
    case 'buildingSet': {
      const b = land.doc.buildings.find((x) => x.id === op.ref)
      if (b) highlightBuilding(g, v, b, color)
      return
    }
    case 'building':
      highlightRing(g, v, rectRing(op.x, op.z, op.w / 2, op.d / 2, op.yaw), color)
      return
    case 'lot':
      highlightRing(g, v, op.ring, color)
      return
    case 'lotSet': {
      const l = land.doc.lots.find((x) => x.id === op.ref)
      if (l) highlightRing(g, v, l.p, color)
      return
    }
    case 'lotClip':
      for (const l of land.doc.lots) if (op.ids === 'all' || (l.id && op.ids.includes(l.id))) highlightRing(g, v, l.p, color)
      return
    case 'rail':
    case 'wall':
      g.strokeStyle = color
      g.lineWidth = 5
      g.globalAlpha = 0.7
      tracePath(g, v, op.pts, op.type === 'wall' && !!op.closed)
      g.stroke()
      g.globalAlpha = 1
      dots(g, v, op.pts, color)
      return
    case 'lights':
      for (let k = 0; k < op.pts.length; k += 2) marker(g, v, op.pts[k], op.pts[k + 1], color)
      return
  }
}

function marker(g: CanvasRenderingContext2D, v: View, x: number, z: number, color: string): void {
  if (!Number.isFinite(x)) return
  const px = toSX(v, x), py = toSY(v, z)
  g.strokeStyle = color
  g.lineWidth = 2.5
  g.beginPath()
  g.arc(px, py, 9, 0, Math.PI * 2)
  g.moveTo(px - 13, py)
  g.lineTo(px + 13, py)
  g.moveTo(px, py - 13)
  g.lineTo(px, py + 13)
  g.stroke()
}

function dots(g: CanvasRenderingContext2D, v: View, pts: ArrayLike<number>, color: string): void {
  g.fillStyle = color
  for (let k = 0; k + 1 < pts.length; k += 2) {
    g.beginPath()
    g.arc(toSX(v, pts[k]), toSY(v, pts[k + 1]), 3.5, 0, Math.PI * 2)
    g.fill()
  }
}

function centreOfFeature(land: TelloLand, id: string, type: 'roadRemove' | 'buildingRemove' | 'lotRemove'): [number, number] {
  const list = type === 'roadRemove' ? land.doc.roads : type === 'buildingRemove' ? land.doc.buildings : land.doc.lots
  const f = (list as { id?: string; p: number[] }[]).find((x) => x.id === id)
  if (!f) return [NaN, NaN]
  const b = shapeBoxOf(f.p)
  return [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]
}

/** The map area an edit covers, for zooming to it (null when it cannot be told). */
export function opBounds(op: EditOp, land: TelloLand): Box | null {
  switch (op.type) {
    case 'terrain': return shapeBox(op.shape, op.falloff)
    case 'trees': case 'railCut': case 'lightCut': return shapeBox(op.shape)
    case 'water': return op.shape ? shapeBox(op.shape) : op.at ? { x0: op.at[0] - 80, z0: op.at[1] - 80, x1: op.at[0] + 80, z1: op.at[1] + 80 } : null
    case 'river': case 'road': return shapeBoxOf(op.pts, op.w + 20)
    case 'rail': case 'wall': case 'lights': return shapeBoxOf(op.pts, 20)
    case 'lot': return shapeBoxOf(op.ring, 20)
    case 'building': return { x0: op.x - op.w - 20, z0: op.z - op.d - 20, x1: op.x + op.w + 20, z1: op.z + op.d + 20 }
    case 'roadSet': case 'buildingSet': case 'lotSet': {
      const list = op.type === 'roadSet' ? land.doc.roads : op.type === 'buildingSet' ? land.doc.buildings : land.doc.lots
      const f = (list as { id?: string; p: number[] }[]).find((x) => x.id === op.ref)
      return f ? shapeBoxOf(f.p, 25) : null
    }
    case 'roadRemove': case 'buildingRemove': case 'lotRemove': {
      let box: Box | null = null
      for (const id of op.ids) {
        const c = centreOfFeature(land, id, op.type)
        if (Number.isFinite(c[0])) box = unionBox(box, { x0: c[0] - 60, z0: c[1] - 60, x1: c[0] + 60, z1: c[1] + 60 })
      }
      return box
    }
    case 'lotClip': return null
  }
}
