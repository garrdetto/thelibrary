import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MutableRefObject, PointerEvent } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three'
import type { Mesh, Object3D } from 'three'
import { BodySmoother } from './bodySmooth'
import type { AutoPlan, DetectReport, Px, SelectionReport, SmoothSettings } from './bodySmooth'

/** What the editor can ask of the smoother inside the canvas. */
export type SmootherApi = {
  select: (polygon: Px[], featherPx: number) => SelectionReport
  selectAll: () => SelectionReport
  selectMarked: (thresholdMm: number) => SelectionReport
  resize: (mode: 'grow' | 'shrink') => SelectionReport
  analyse: (creaseDeg: number) => DetectReport
  showHeat: (thresholdMm: number | null) => { spots: number; share: number }
  autoPlan: (settings: SmoothSettings) => AutoPlan | null
  preview: (settings: SmoothSettings) => void
  compare: (original: boolean) => void
  shadeSmooth: (creaseDeg: number) => void
  apply: () => void
  cancel: () => void
  undo: () => void
  readonly hasSelection: boolean
  readonly analysed: boolean
  readonly undoDepth: number
  readonly edits: number
}

function marker(_mesh: Mesh, positions: Float32Array, colors: Float32Array | null): Object3D {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const material = colors
    ? new PointsMaterial({ vertexColors: true, size: 3, sizeAttenuation: false, depthTest: true, transparent: true, opacity: 0.85 })
    : new PointsMaterial({ color: '#5ad1ff', size: 3.5, sizeAttenuation: false, depthTest: true, transparent: true, opacity: 0.9 })
  const points = new Points(geometry, material)
  points.renderOrder = colors ? 7 : 8
  return points
}

/** Lives inside the Canvas: it knows the camera and size, and hands the editor an imperative API. */
export function DentSmoother({ scene, api }: { scene: Object3D; api: MutableRefObject<SmootherApi | null> }) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const invalidate = useThree(state => state.invalidate)
  const view = useRef({ camera, size })
  view.current = { camera, size }
  useEffect(() => {
    const smoother = new BodySmoother(scene, marker)
    let frame = 0
    let pending: SmoothSettings | null = null
    const flush = () => { if (frame) cancelAnimationFrame(frame); frame = 0; if (pending) { smoother.preview(pending); pending = null; invalidate() } }
    const after = <T,>(result: T) => { invalidate(); return result }
    const current: SmootherApi = {
      select: (polygon, featherPx) => { flush(); return after(smoother.select(polygon, view.current.camera, view.current.size, featherPx)) },
      selectAll: () => { flush(); return after(smoother.selectAll()) },
      selectMarked: thresholdMm => { flush(); return after(smoother.selectMarked(thresholdMm)) },
      resize: mode => { flush(); return after(smoother.resize(mode)) },
      analyse: creaseDeg => { flush(); return after(smoother.analyse(creaseDeg)) },
      showHeat: thresholdMm => after(smoother.showHeat(thresholdMm)),
      autoPlan: settings => { flush(); return after(smoother.autoPlan(settings)) },
      preview: settings => { pending = settings; if (!frame) frame = requestAnimationFrame(() => { frame = 0; flush() }) },
      compare: original => { flush(); smoother.compare(original); invalidate() },
      shadeSmooth: creaseDeg => { flush(); smoother.shadeSmooth(creaseDeg); invalidate() },
      apply: () => { flush(); smoother.apply(); invalidate() },
      cancel: () => { pending = null; flush(); smoother.cancel(); invalidate() },
      undo: () => { pending = null; flush(); smoother.undo(); invalidate() },
      get hasSelection() { return smoother.hasSelection },
      get analysed() { return smoother.analysed },
      get undoDepth() { return smoother.undoDepth },
      get edits() { return smoother.edits },
    }
    api.current = current
    return () => { if (frame) cancelAnimationFrame(frame); smoother.dispose(); if (api.current === current) api.current = null }
  }, [scene, api, invalidate])
  return null
}

const CLOSE_PX = 10

/** The polygon lasso drawn over the stage: click to add corners, click the first corner (or double-click) to close, Escape to start over. */
export function SmoothOverlay({ onClose, onCancel }: { onClose: (polygon: Px[]) => void; onCancel: () => void }) {
  const [points, setPoints] = useState<Px[]>([])
  const [hover, setHover] = useState<Px | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const at = (event: PointerEvent<SVGSVGElement>): Px => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const close = (list: Px[]) => { if (list.length >= 3) onClose(list); setPoints([]); setHover(null) }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const p = at(event)
    if (points.length >= 3 && Math.hypot(p.x - points[0].x, p.y - points[0].y) < CLOSE_PX) { close(points); return }
    setPoints(current => [...current, p])
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (points.length) setPoints([]); else onCancel() }
    if (event.key === 'Enter') { event.preventDefault(); close(points) }
    if (event.key === 'Backspace') { event.preventDefault(); setPoints(current => current.slice(0, -1)) }
  }
  useEffect(() => { ref.current?.focus() }, [])
  const path = points.map(p => `${p.x},${p.y}`).join(' ')
  const first = points[0]
  const nearFirst = hover && first && points.length >= 3 && Math.hypot(hover.x - first.x, hover.y - first.y) < CLOSE_PX
  return <svg ref={ref} className="ms-veh-lasso" tabIndex={0} role="application" aria-label="Draw a selection around the dented area: click to add corners, click the first corner or press Enter to close it, Escape to start over."
    onPointerDown={down} onPointerMove={event => setHover(at(event))} onPointerLeave={() => setHover(null)} onDoubleClick={event => { event.preventDefault(); close(points) }} onKeyDown={key} onContextMenu={event => event.preventDefault()}>
    {points.length > 0 && <polyline points={hover && !nearFirst ? `${path} ${hover.x},${hover.y}` : path} fill="rgba(90,209,255,.12)" stroke="#5ad1ff" strokeWidth={1.5} strokeDasharray="6 4"/>}
    {points.length >= 3 && hover && <line x1={hover.x} y1={hover.y} x2={first.x} y2={first.y} stroke="#5ad1ff" strokeWidth={1} strokeOpacity={0.5}/>}
    {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 && nearFirst ? 7 : 4} fill={i === 0 ? '#ffffff' : '#5ad1ff'} stroke="#14181d" strokeWidth={1.5}/>)}
  </svg>
}
