import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { LoaderCircle, Minus, Plus, X } from 'lucide-react'
import type { Object3D } from 'three'
import { LAMP_DEPTH, LAMP_DEPTH_LIMIT, LAMP_GRID, LAMP_H, LAMP_SIZE_LIMITS, LAMP_W, SHAPE_LIMITS, shapeContains } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { LampDepth, LampSize, Shape } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { Draft } from './draft'
import type { ViewFrame } from './suggest'

type Pt = { x: number; y: number }
export type TracedLamp = { point: { x: number; y: number; z: number }; shape: Shape; size: LampSize; depth?: LampDepth }

const ZOOMS = [1, 1.5, 2, 3, 4, 6] as const
const PROUD = 0.012
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Where a ray along x through (z, y) meets the model: the frontmost hit for the front, the rearmost for the back. */
function surfaceX(tris: Float32Array, z: number, y: number, front: boolean): number | null {
  let best: number | null = null
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2]
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5]
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8]
    const d = (bz - az) * (cy - ay) - (cz - az) * (by - ay)
    if (Math.abs(d) < 1e-12) continue
    const u = ((z - az) * (cy - ay) - (cz - az) * (y - ay)) / d
    const v = ((bz - az) * (y - ay) - (z - az) * (by - ay)) / d
    if (u < 0 || v < 0 || u + v > 1) continue
    const x = ax + u * (bx - ax) + v * (cx - ax)
    if (best === null || (front ? x > best : x < best)) best = x
  }
  return best
}

/**
 * The body's surface under a traced lamp: a LAMP_GRID² grid of x positions
 * over the lamp's box, sampled where the grid falls inside the outline (a
 * little outside too) and filled outward from there. Null when nothing is hit.
 */
function sampleSurface(tris: Float32Array, shape: Shape, place: (u: number, v: number) => { z: number; y: number }, front: boolean): { center: number; depth: LampDepth } | null {
  const n = LAMP_GRID, cells: (number | null)[] = []
  const pad = 0.6 / (n - 1)
  const near = (u: number, v: number) => shapeContains(shape, u, v) || [[pad, 0], [-pad, 0], [0, pad], [0, -pad]].some(([du, dv]) => shapeContains(shape, u + du, v + dv))
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / (n - 1), v = j / (n - 1)
    if (!near(u, v)) { cells.push(null); continue }
    const at = place(u, v)
    cells.push(surfaceX(tris, at.z, at.y, front))
  }
  const hits = cells.filter((x): x is number => x !== null)
  if (!hits.length) return null
  const sorted = [...hits].sort((a, b) => a - b)
  const center = sorted[Math.floor(sorted.length / 2)]
  const grid = cells.map(x => x === null ? null : x - center)
  for (let pass = 0; pass < n * 2 && grid.some(x => x === null); pass++) {
    const next = [...grid]
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (grid[j * n + i] !== null) continue
      let sum = 0, count = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= n || b >= n) continue
        const x = grid[b * n + a]
        if (x !== null) { sum += x; count++ }
      }
      if (count) next[j * n + i] = sum / count
    }
    grid.splice(0, grid.length, ...next)
  }
  const depth = grid.map(x => Math.max(-LAMP_DEPTH_LIMIT, Math.min(LAMP_DEPTH_LIMIT, Math.round((x ?? 0) * 1000) / 1000)))
  return { center, depth }
}

/**
 * Trace a lamp on a straight-on render of the model. The outline is drawn in
 * metres on the real picture; the lamp marker moves to its centre, sits just
 * proud of the body there, and the plate takes the outline's own size.
 */
export function LampTracer({ kind, scene, draft, center, drop, onApply, onClose }: {
  kind: 'head' | 'tail'
  scene: Object3D
  draft: Draft
  center: { x: number; z: number; minY: number }
  /** Ground frame y minus this is chassis y. */
  drop: number
  onApply: (lamp: TracedLamp) => void
  onClose: () => void
}) {
  const front = kind === 'head'
  const [view, setView] = useState<{ image: string; frame: ViewFrame; tris: Float32Array } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3)
  const [drawing, setDrawing] = useState<Pt[]>([])
  const [hover, setHover] = useState<Pt | null>(null)
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const { groundMatrix, groundTriangles, renderView } = await import('./suggestRender')
        const ground = groundMatrix(draft, center)
        const tris = groundTriangles(scene, ground)
        const { image, frame } = renderView(scene, ground, front ? 'front' : 'rear')
        if (live) setView({ image, frame, tris })
      } catch {
        if (live) setError('The model couldn’t be rendered for tracing. Try again once it has finished loading.')
      }
    })()
    return () => { live = false }
  }, [])
  useEffect(() => { ref.current?.focus() }, [view])

  const lamp = draft[kind]
  const toScreen = (z: number, yGround: number): Pt => ({ x: front ? -z : z, y: -yGround })
  const markerAt = toScreen(lamp.z, lamp.y + drop)

  if (error) return <div className="ms-veh-trace"><p className="ms-veh-note" role="alert">{error}</p><button type="button" onClick={onClose}>Close</button></div>
  if (!view) return <div className="ms-veh-trace"><p className="ms-veh-note" role="status"><LoaderCircle className="spin" size={14} aria-hidden/> Rendering the {front ? 'front' : 'back'} of the model…</p></div>

  const f = view.frame
  const fullW = f.right - f.left, fullH = f.top - f.bottom
  const vw = fullW / zoom, vh = fullH / zoom
  const clampTo = (v: number, lo: number, hi: number) => hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v))
  const vx = clampTo(markerAt.x - vw / 2, f.left, f.right - vw)
  const vy = clampTo(markerAt.y - vh / 2, -f.top, -f.bottom - vh)
  const closeDist = vw / 40
  const px = vw / 400

  const at = (event: PointerEvent<SVGSVGElement>): Pt => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: vx + ((event.clientX - rect.left) / rect.width) * vw, y: vy + ((event.clientY - rect.top) / rect.height) * vh }
  }

  function finish(list: Pt[]) {
    if (list.length < SHAPE_LIMITS.minPoints) return
    const pts = list.map(p => ({ z: front ? -p.x : p.x, y: -p.y }))
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length
    const sign = cz < 0 ? -1 : 1
    const zs = pts.map(p => p.z * sign), ys = pts.map(p => p.y)
    const zMin = Math.min(...zs), zMax = Math.max(...zs), yMin = Math.min(...ys), yMax = Math.max(...ys)
    const w = Math.min(LAMP_SIZE_LIMITS.max, Math.max(LAMP_SIZE_LIMITS.min, zMax - zMin))
    const h = Math.min(LAMP_SIZE_LIMITS.max, Math.max(LAMP_SIZE_LIMITS.min, yMax - yMin))
    const zc = (zMin + zMax) / 2, yc = (yMin + yMax) / 2
    const unit = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000))
    const shape = zs.map((z, i) => ({ u: unit((z - zc) / w + 0.5), v: unit((ys[i] - yc) / h + 0.5) }))
    const cyMean = ys.reduce((a, b) => a + b, 0) / ys.length
    const czMean = pts.reduce((a, p) => a + p.z, 0) / pts.length
    const samples = [{ z: czMean, y: cyMean }, ...pts.map(p => ({ z: p.z + (czMean - p.z) * 0.3, y: p.y + (cyMean - p.y) * 0.3 }))]
    const hits = samples.map(s => surfaceX(view!.tris, s.z, s.y, front)).filter((x): x is number => x !== null)
    const surface = sampleSurface(view!.tris, shape, (u, v) => ({ z: sign * (zc + (u - 0.5) * w), y: yc + (v - 0.5) * h }), front)
    let x: number
    if (surface) x = surface.center
    else if (hits.length) {
      const edge = front ? Math.max(...hits) : Math.min(...hits)
      x = front ? edge - LAMP_DEPTH / 2 + PROUD : edge + LAMP_DEPTH / 2 - PROUD
    } else x = lamp.x
    onApply({ point: { x: r3(x), y: r3(yc - drop), z: r3(Math.abs(zc) < 0.01 ? 0 : zc) }, shape, size: { w: r3(w), h: r3(h) }, ...(surface ? { depth: surface.depth } : {}) })
    setDrawing([])
    setHover(null)
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const p = at(event)
    if (drawing.length >= 3 && Math.hypot(p.x - drawing[0].x, p.y - drawing[0].y) < closeDist) { finish(drawing); return }
    if (drawing.length >= SHAPE_LIMITS.maxPoints) return
    setDrawing([...drawing, p])
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (drawing.length) setDrawing([]); else onClose() }
    if (event.key === 'Enter') { event.preventDefault(); finish(drawing) }
    if (event.key === 'Backspace') { event.preventDefault(); setDrawing(drawing.slice(0, -1)) }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z as (typeof ZOOMS)[number]) + 1)]) }
    if (event.key === '-') { event.preventDefault(); setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z as (typeof ZOOMS)[number]) - 1)]) }
  }

  const shape = draft.lampShapes[kind]
  const size = draft.lampShapes[kind === 'head' ? 'headSize' : 'tailSize'] ?? { w: LAMP_W, h: LAMP_H }
  const current = shape ? [1, -1].map(side => shape.map(p => toScreen(side * (lamp.z + (p.u - 0.5) * size.w), lamp.y + drop + (p.v - 0.5) * size.h))) : []
  const pointsOf = (list: Pt[]) => list.map(p => `${p.x},${p.y}`).join(' ')
  const first = drawing[0]
  const nearFirst = !!(hover && first && drawing.length >= 3 && Math.hypot(hover.x - first.x, hover.y - first.y) < closeDist)
  const live = hover && !nearFirst ? [...drawing, hover] : drawing
  const zi = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number])
  const name = front ? 'headlight' : 'taillight'

  return <div className="ms-veh-trace">
    <div className="ms-veh-shape-head">
      <strong>Trace the {name} on the model</strong>
      <button type="button" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0} aria-label="Zoom out"><Minus size={14} aria-hidden/></button>
      <span className="ms-veh-note">{zoom}×</span>
      <button type="button" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi >= ZOOMS.length - 1} aria-label="Zoom in"><Plus size={14} aria-hidden/></button>
      <button type="button" onClick={() => finish(drawing)} disabled={drawing.length < 3}>Close outline</button>
      {drawing.length > 0 && <button type="button" onClick={() => setDrawing([])}>Start over</button>}
      <button type="button" onClick={onClose}><X size={14} aria-hidden/> Done</button>
    </div>
    <svg ref={ref} className="ms-veh-trace-pad" viewBox={`${vx} ${vy} ${vw} ${vh}`} style={{ aspectRatio: `${vw} / ${vh}` }} tabIndex={0} role="application"
      aria-label={`${front ? 'Front' : 'Back'} view of the model. Click around one ${name} to outline it; click the first corner or press Enter to close, Backspace removes the last corner, plus and minus zoom, Escape cancels.`}
      onPointerDown={down} onPointerMove={event => setHover(at(event))} onPointerLeave={() => setHover(null)} onDoubleClick={event => { event.preventDefault(); finish(drawing) }} onKeyDown={key} onContextMenu={event => event.preventDefault()}>
      <image href={view.image} x={f.left} y={-f.top} width={fullW} height={fullH} preserveAspectRatio="none"/>
      {current.map((list, i) => <polygon key={i} points={pointsOf(list)} fill="rgba(74,163,255,.25)" stroke="#4aa3ff" strokeWidth={px * 1.5}/>)}
      {drawing.length > 0 && <>
        <polyline points={pointsOf(live)} fill="rgba(242,181,68,.18)" stroke="#f2b544" strokeWidth={px * 1.5} strokeDasharray={`${px * 5} ${px * 3}`}/>
        {drawing.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={px * (i === 0 && nearFirst ? 6 : 3.5)} fill={i === 0 ? '#ffffff' : '#f2b544'} stroke="#14181d" strokeWidth={px}/>)}
      </>}
    </svg>
    <p className="ms-veh-note">Click around the edge of either {name} on the picture{shape ? ' (the blue outline is the current one)' : ''}. The other side is mirrored, the marker moves to the middle of your outline, and the light is laid onto the body there, following its curves.</p>
  </div>
}
