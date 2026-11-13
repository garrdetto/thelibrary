import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { LoaderCircle, Minus, Plus, X } from 'lucide-react'
import type { Object3D } from 'three'
import { LAMP_H, LAMP_W, SHAPE_LIMITS } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { Draft } from './draft'
import { lampFromOutline } from './lampTrace'
import type { Pt, TracedLamp } from './lampTrace'
import type { ViewFrame } from './suggest'

export type { TracedLamp }

const ZOOMS = [1, 1.5, 2, 3, 4, 6] as const

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
    const traced = lampFromOutline(list, front, view!.tris, drop, lamp.x)
    if (!traced) return
    onApply(traced)
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
