import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Box } from '../../../modules-src/tello/edits/Geom'
import { COVER } from '../../../modules-src/tello/data/MapData'
import type { EditorModel } from './model'
import { toLake } from './model'
import { HitIndex } from './hit'
import { TileCache, TILE, type BaseMode } from './tiles'
import { TreeIndex, drawVectors, highlightBuilding, highlightRing, highlightRoad, toMX, toMZ, viewBox, type DrawLayers, type View } from './draw'
import { drawOp } from './opDraw'
import { ToolRunner, type Pointer } from './tools'
import { toolInfo } from './settings'

export interface MapViewHandle {
  zoomTo(box: Box): void
  panTo(x: number, z: number): void
  centre(): { x: number; z: number; mPerPx: number }
  runner(): ToolRunner
  redraw(): void
}

interface Props {
  model: EditorModel
  layers: DrawLayers
  base: BaseMode
  hoverOp: string | null
  hidden?: boolean
  onNotify(text: string): void
}

const COVER_NAME = Object.fromEntries(Object.entries(COVER).map(([k, v]) => [v, k])) as Record<number, string>

interface Readout { x: number; z: number; ground: number; water: number | null; cover: string; under: string }

export const MapView = forwardRef<MapViewHandle, Props>(function MapView({ model, layers, base, hoverOp, hidden, onNotify }, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ cx: 110, cz: -40, s: 0.6, w: 800, h: 600 })
  const tiles = useRef(new TileCache())
  const hitRef = useRef<{ version: number; index: HitIndex | null }>({ version: -1, index: null })
  const treeRef = useRef<{ arr: unknown; index: TreeIndex | null }>({ arr: null, index: null })
  const frame = useRef(0)
  const props = useRef({ layers, hoverOp })
  props.current = { layers, hoverOp }
  const [readout, setReadout] = useState<Readout | null>(null)
  const [scale, setScale] = useState(0.6)
  const space = useRef(false)

  const hits = (): HitIndex | null => {
    const land = model.land
    if (!land) return null
    if (hitRef.current.version !== model.version || !hitRef.current.index || hitRef.current.index.doc !== land.doc) hitRef.current = { version: model.version, index: new HitIndex(land.doc) }
    return hitRef.current.index
  }

  const runnerRef = useRef<ToolRunner | null>(null)
  if (!runnerRef.current) runnerRef.current = new ToolRunner({ model, view: () => view.current, hits, redraw: () => redraw(), notify: (t) => onNotify(t) })
  const runner = runnerRef.current

  function redraw(): void {
    if (frame.current) return
    frame.current = requestAnimationFrame(draw)
  }

  function draw(): void {
    frame.current = 0
    const c = canvas.current
    const land = model.land
    if (!c || !land) return
    const dpr = window.devicePixelRatio || 1
    const v = view.current
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#1b2026'
    g.fillRect(0, 0, v.w, v.h)
    const cache = tiles.current
    cache.setLand(land)
    const dirty = model.takeDirty()
    if (dirty) cache.invalidate(dirty)
    const level = Math.max(0, Math.min(5, Math.floor(Math.log2(1 / Math.max(1e-6, v.s * land.cell)) + 0.35)))
    const span = TILE * (1 << level) * land.cell
    const vb = viewBox(v, 0)
    const ti0 = Math.max(0, Math.floor((vb[0] - land.x0) / span)), ti1 = Math.floor((vb[2] - land.x0) / span)
    const tj0 = Math.max(0, Math.floor((vb[1] - land.z0) / span)), tj1 = Math.floor((vb[3] - land.z0) / span)
    const maxT = Math.ceil(land.side / (TILE * (1 << level)))
    g.imageSmoothingEnabled = v.s * land.cell < 6
    for (let ti = ti0; ti <= Math.min(ti1, maxT - 1); ti++) {
      for (let tj = tj0; tj <= Math.min(tj1, maxT - 1); tj++) {
        const x0 = land.x0 + ti * span, z1 = land.z0 + (tj + 1) * span
        const sx = (x0 - v.cx) * v.s + v.w / 2, sy = (v.cz - z1) * v.s + v.h / 2
        const size = span * v.s
        const img = cache.get(level, ti, tj)
        if (img) g.drawImage(img, sx, sy, size + 0.5, size + 0.5)
        else {
          const parent = level < 5 ? cache.peek(level + 1, ti >> 1, tj >> 1) : null
          if (parent) {
            const half = TILE / 2
            g.drawImage(parent, (ti & 1) * half, (1 - (tj & 1)) * half, half, half, sx, sy, size + 0.5, size + 0.5)
          }
        }
      }
    }
    const painted = cache.paint(10)
    const { layers: lay, hoverOp: hov } = props.current
    let trees: TreeIndex | null = null
    if (lay.trees && v.s >= 0.45) {
      if (treeRef.current.arr !== land.grids.treeX || !treeRef.current.index || treeRef.current.index.land !== land) treeRef.current = { arr: land.grids.treeX, index: new TreeIndex(land) }
      trees = treeRef.current.index
    }
    drawVectors(g, v, land, lay, model.blockedIds, trees)
    const sel = model.selection
    if (sel?.kind === 'road') { const r = land.doc.roads.find((x) => x.id === sel.id); if (r) highlightRoad(g, v, r) }
    if (sel?.kind === 'building') { const b = land.doc.buildings.find((x) => x.id === sel.id); if (b) highlightBuilding(g, v, b) }
    if (sel?.kind === 'lot') { const l = land.doc.lots.find((x) => x.id === sel.id); if (l) highlightRing(g, v, l.p) }
    if (sel?.kind === 'op') { const op = model.ops.find((o) => o.id === sel.id); if (op) drawOp(g, v, op, land) }
    if (hov && hov !== (sel?.kind === 'op' ? sel.id : null)) { const op = model.ops.find((o) => o.id === hov); if (op) drawOp(g, v, op, land, '#ffcf3d') }
    runner.draw(g, v)
    if (painted || cache.pending) redraw()
  }

  function resize(): void {
    const c = canvas.current, w = wrap.current
    if (!c || !w) return
    const dpr = window.devicePixelRatio || 1
    const r = w.getBoundingClientRect()
    view.current.w = Math.max(100, r.width)
    view.current.h = Math.max(100, r.height)
    c.width = Math.round(view.current.w * dpr)
    c.height = Math.round(view.current.h * dpr)
    c.style.width = `${view.current.w}px`
    c.style.height = `${view.current.h}px`
    redraw()
  }

  useEffect(() => {
    const w = wrap.current
    if (!w) return
    const ro = new ResizeObserver(resize)
    ro.observe(w)
    resize()
    return () => ro.disconnect()
  }, [])

  useEffect(() => model.subscribe(() => redraw()), [model])
  useEffect(() => { tiles.current.setMode(base); redraw() }, [base])
  useEffect(() => { redraw() }, [layers, hoverOp])

  useImperativeHandle(ref, () => ({
    zoomTo(box: Box) {
      const v = view.current
      v.cx = (box.x0 + box.x1) / 2
      v.cz = (box.z0 + box.z1) / 2
      v.s = Math.max(0.02, Math.min(12, Math.min(v.w / Math.max(20, box.x1 - box.x0), v.h / Math.max(20, box.z1 - box.z0)) * 0.8))
      setScale(v.s)
      redraw()
    },
    panTo(x: number, z: number) {
      view.current.cx = x
      view.current.cz = z
      redraw()
    },
    centre() {
      return { x: view.current.cx, z: view.current.cz, mPerPx: 1 / view.current.s }
    },
    runner: () => runner,
    redraw,
  }))

  const pan = useRef<{ px: number; py: number; cx: number; cz: number } | null>(null)

  function pointer(e: React.PointerEvent | React.MouseEvent): Pointer {
    const r = canvas.current!.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    return { x: toMX(view.current, px), z: toMZ(view.current, py), px, py, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
  }

  function onDown(e: React.PointerEvent): void {
    if (!model.land) return
    canvas.current?.setPointerCapture(e.pointerId)
    const p = pointer(e)
    const wantsPan = e.button === 1 || e.button === 2 || (e.button === 0 && space.current)
    if (!wantsPan && runner.pointerDown(p)) return
    pan.current = { px: p.px, py: p.py, cx: view.current.cx, cz: view.current.cz }
  }

  function onMove(e: React.PointerEvent): void {
    const land = model.land
    if (!land) return
    const p = pointer(e)
    if (pan.current) {
      const v = view.current
      v.cx = pan.current.cx - (p.px - pan.current.px) / v.s
      v.cz = pan.current.cz + (p.py - pan.current.py) / v.s
      redraw()
    } else runner.pointerMove(p)
    const water = land.waterAt(p.x, p.z)
    const h = hits()
    const r = h?.roadAt(p.x, p.z, 4 / view.current.s)
    const b = h?.buildingAt(p.x, p.z)
    const under = b ? (b.n ? `${b.n} (${b.k})` : b.k) : r ? r.n || ['highway', 'street', 'lane', 'gravel', 'sidewalk', 'trail'][r.k] : ''
    setReadout({ x: p.x, z: p.z, ground: toLake(land.groundAt(p.x, p.z)), water: water === null ? null : toLake(water), cover: COVER_NAME[land.coverAt(p.x, p.z)] ?? '', under })
  }

  function onUp(e: React.PointerEvent): void {
    canvas.current?.releasePointerCapture(e.pointerId)
    if (pan.current) {
      pan.current = null
      return
    }
    runner.pointerUp(pointer(e))
  }

  function onWheel(e: React.WheelEvent): void {
    const v = view.current
    const p = pointer(e)
    const k = Math.exp(-e.deltaY * 0.0016)
    const s = Math.max(0.02, Math.min(12, v.s * k))
    v.cx = p.x - (p.px - v.w / 2) / s
    v.cz = p.z + (p.py - v.h / 2) / s
    v.s = s
    setScale(s)
    redraw()
  }

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const stop = (e: WheelEvent) => e.preventDefault()
    c.addEventListener('wheel', stop, { passive: false })
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isTyping(e)) space.current = true }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      c.removeEventListener('wheel', stop)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const mPerPx = 1 / scale
  const tool = toolInfo(model.tool)
  return <div className={`we-map${hidden ? ' is-hidden' : ''}`} ref={wrap}>
    <canvas
      ref={canvas}
      className={`we-canvas we-tool-${model.tool}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setReadout(null)}
      onDoubleClick={() => runner.doubleClick()}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Map of Montello. Tool: ${tool.label}. ${tool.hint}`}
      role="application"
    />
    <div className="we-status" aria-live="off">
      {readout ? <>
        <span>x {readout.x.toFixed(1)} · z {readout.z.toFixed(1)}</span>
        <span>ground {fmt(readout.ground)} m</span>
        {readout.water !== null && <span className="we-status-water">water {fmt(readout.water)} m · {(readout.water - readout.ground).toFixed(2)} deep</span>}
        <span>{readout.cover}</span>
        {readout.under && <span className="we-status-under">{readout.under}</span>}
      </> : <span>Heights are metres above (+) or below (−) Lake Montello’s surface.</span>}
      <span className="we-status-scale">{mPerPx >= 1 ? `${mPerPx.toFixed(1)} m/px` : `${(1 / mPerPx).toFixed(1)} px/m`}</span>
    </div>
  </div>
})

function fmt(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export { isTyping }
