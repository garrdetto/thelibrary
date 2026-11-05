import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { SHAPE_LIMITS } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { Shape, ShapePoint } from '../../../../modules-src/maplestreet/shared/Shapes'

const W = 280
const H = 180
const CLOSE_PX = 10

export type MirrorAxis = 'none' | 'bottom' | 'left'

function toPx(p: ShapePoint, axis: MirrorAxis) {
  if (axis === 'bottom') return { x: p.u * W, y: H / 2 - (p.v * H) / 2 }
  if (axis === 'left') return { x: W / 2 + (p.u * W) / 2, y: (1 - p.v) * H }
  return { x: p.u * W, y: (1 - p.v) * H }
}

function fromPx(x: number, y: number, axis: MirrorAxis): ShapePoint {
  const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000))
  if (axis === 'bottom') return { u: clamp(x / W), v: clamp((H / 2 - y) / (H / 2)) }
  if (axis === 'left') return { u: clamp((x - W / 2) / (W / 2)), v: clamp(1 - y / H) }
  return { u: clamp(x / W), v: clamp(1 - y / H) }
}

function mirrored(p: { x: number; y: number }, axis: MirrorAxis) {
  if (axis === 'bottom') return { x: p.x, y: H - p.y }
  if (axis === 'left') return { x: W - p.x, y: p.y }
  return p
}

/**
 * A polygon lasso for one part's outline. Click to add corners, click the first
 * corner (or press Enter) to close it. With a mirror axis only one half is drawn;
 * the other half is its reflection, so both sides of the vehicle always match.
 */
export function ShapeDesigner({ title, hint, axis, shape, onChange }: { title: string; hint: string; axis: MirrorAxis; shape: Shape | undefined; onChange: (shape: Shape | undefined) => void }) {
  const [drawing, setDrawing] = useState<{ x: number; y: number }[] | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const at = (event: PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H }
  }
  const finish = (list: { x: number; y: number }[]) => {
    if (list.length >= SHAPE_LIMITS.minPoints) onChange(list.map(p => fromPx(p.x, p.y, axis)))
    setDrawing(null)
    setHover(null)
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !drawing) return
    event.preventDefault()
    const p = at(event)
    if (drawing.length >= 3 && Math.hypot(p.x - drawing[0].x, p.y - drawing[0].y) < CLOSE_PX) { finish(drawing); return }
    if (drawing.length >= SHAPE_LIMITS.maxPoints) return
    setDrawing([...drawing, p])
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (!drawing) return
    if (event.key === 'Escape') { event.preventDefault(); if (drawing.length) setDrawing([]); else setDrawing(null) }
    if (event.key === 'Enter') { event.preventDefault(); finish(drawing) }
    if (event.key === 'Backspace') { event.preventDefault(); setDrawing(drawing.slice(0, -1)) }
  }
  useEffect(() => { if (drawing) ref.current?.focus() }, [drawing === null])
  const placed = shape?.map(p => toPx(p, axis))
  const pointsOf = (list: { x: number; y: number }[]) => list.map(p => `${p.x},${p.y}`).join(' ')
  const first = drawing?.[0]
  const nearFirst = hover && first && drawing && drawing.length >= 3 && Math.hypot(hover.x - first.x, hover.y - first.y) < CLOSE_PX
  const liveRaw = drawing ? (hover && !nearFirst ? [...drawing, hover] : drawing) : []
  return <div className="ms-veh-shape">
    <div className="ms-veh-shape-head">
      <strong>{title}</strong>
      <span className="ms-veh-note">{shape ? `Custom outline, ${shape.length} corners` : 'Whole box (no custom outline)'}</span>
      <button type="button" onClick={() => setDrawing([])} disabled={!!drawing}>{shape ? 'Redraw outline' : 'Draw outline'}</button>
      {shape && !drawing && <button type="button" onClick={() => onChange(undefined)}>Use whole box</button>}
      {drawing && <button type="button" onClick={() => finish(drawing)} disabled={drawing.length < 3}>Close outline</button>}
      {drawing && <button type="button" onClick={() => { setDrawing(null); setHover(null) }}>Cancel</button>}
    </div>
    <svg ref={ref} className="ms-veh-shape-pad" viewBox={`0 0 ${W} ${H}`} tabIndex={drawing ? 0 : -1} role="application"
      aria-label={`${title} outline pad. ${hint} Click to add corners, click the first corner or press Enter to close, Backspace removes the last corner, Escape cancels.`}
      onPointerDown={down} onPointerMove={event => drawing && setHover(at(event))} onPointerLeave={() => setHover(null)} onDoubleClick={event => { if (drawing) { event.preventDefault(); finish(drawing) } }} onKeyDown={key} onContextMenu={event => event.preventDefault()}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.25)"/>
      {axis === 'bottom' && <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#f2b544" strokeDasharray="5 4" strokeOpacity={0.8}/>}
      {axis === 'left' && <line x1={W / 2} x2={W / 2} y1={0} y2={H} stroke="#f2b544" strokeDasharray="5 4" strokeOpacity={0.8}/>}
      {placed && !drawing && <>
        {axis !== 'none' && <polygon points={pointsOf(placed.map(p => mirrored(p, axis)))} fill="rgba(74,163,255,.18)" stroke="#4aa3ff" strokeOpacity={0.7} strokeWidth={1.5}/>}
        <polygon points={pointsOf(placed)} fill="rgba(74,163,255,.35)" stroke="#4aa3ff" strokeWidth={2}/>
      </>}
      {drawing && drawing.length > 0 && <>
        <polyline points={pointsOf(liveRaw)} fill="rgba(242,181,68,.12)" stroke="#f2b544" strokeWidth={1.5} strokeDasharray="6 4"/>
        {drawing.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 && nearFirst ? 7 : 4} fill={i === 0 ? '#ffffff' : '#f2b544'} stroke="#14181d" strokeWidth={1.5}/>)}
      </>}
    </svg>
    <p className="ms-veh-note">{axis === 'none' ? hint : `${hint} Draw on one side of the dashed line; the other side is the mirror image.`}</p>
  </div>
}
