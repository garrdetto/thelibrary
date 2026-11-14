import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react'
import { ChevronLeft, ChevronRight, Columns2, Maximize2, Minimize2, RefreshCw, SplitSquareHorizontal, ZoomIn, ZoomOut } from 'lucide-react'
import { engineInfo } from '@/lib/clipart'
import type { ClipartResult } from '@/lib/clipart-client'

type View = 'split' | 'slider' | 'original' | 'result'
export type PreviewItem = { id: string; name: string; src: string; width: number; height: number; status: string; message: string; result: ClipartResult | null }

type Props = { item: PreviewItem | null; index: number; total: number; onStep: (delta: number) => void; onRegenerate: () => void; canRegenerate: boolean }

const ZOOMS = [1, 1.5, 2, 3, 4]

export function ClipartPreview({ item, index, total, onStep, onRegenerate, canRegenerate }: Props) {
  const [view, setView] = useState<View>('split')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [split, setSplit] = useState(50)
  const [fullscreen, setFullscreen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [item?.id])
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const setZoomLevel = (next: number) => {
    const value = Math.min(4, Math.max(1, next))
    setZoom(value)
    if (value === 1) setPan({ x: 0, y: 0 })
  }
  const stepZoom = (direction: 1 | -1) => {
    const position = ZOOMS.findIndex(value => value >= zoom)
    setZoomLevel(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (position < 0 ? ZOOMS.length - 1 : position) + direction))])
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen?.()
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey && zoom === 1) return
    event.preventDefault()
    setZoomLevel(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom === 1 || (event.target as HTMLElement).closest('input,button')) return
    drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    setPan({ x: drag.current.px + (event.clientX - drag.current.x) / zoom, y: drag.current.py + (event.clientY - drag.current.y) / zoom })
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('input,textarea')) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); onStep(event.key === 'ArrowRight' ? 1 : -1) }
    if (event.key === '+' || event.key === '=') stepZoom(1)
    if (event.key === '-') stepZoom(-1)
    if (event.key === 'f') toggleFullscreen()
  }

  const transform = { transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }
  const result = item?.result ?? null
  const shown: View = result ? view : 'original'

  const pane = (label: string, src: string, alt: string) => <figure className="cg-pane">
    <figcaption>{label}</figcaption>
    <div className="cg-pane-img"><img src={src} alt={alt} style={transform} draggable={false}/></div>
  </figure>

  return <div ref={box} className={`cg-preview${fullscreen ? ' is-full' : ''}`} tabIndex={0} onKeyDown={onKey} aria-label="Preview. Arrow keys move between images, plus and minus zoom, F toggles full screen.">
    <div className="cg-preview-bar">
      <div className="cg-seg" role="group" aria-label="Comparison view">
        <button type="button" aria-pressed={shown === 'split'} disabled={!result} onClick={() => setView('split')}><Columns2 size={14}/> Side by side</button>
        <button type="button" aria-pressed={shown === 'slider'} disabled={!result} onClick={() => setView('slider')}><SplitSquareHorizontal size={14}/> Slider</button>
        <button type="button" aria-pressed={shown === 'original'} onClick={() => setView('original')}>Original</button>
        <button type="button" aria-pressed={shown === 'result'} disabled={!result} onClick={() => setView('result')}>Clipart</button>
      </div>
      <div className="cg-row">
        <button type="button" className="cg-icon" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => stepZoom(-1)}><ZoomOut size={15}/></button>
        <span className="cg-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="cg-icon" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => stepZoom(1)}><ZoomIn size={15}/></button>
        <button type="button" className="cg-icon" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button>
      </div>
    </div>

    <div className={`cg-stage${zoom > 1 ? ' is-zoomed' : ''}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      {!item && <div className="cg-empty"><p>Upload photographs on the left to begin.</p><small>JPG, PNG and WebP, as many as you like.</small></div>}
      {item && shown === 'split' && result && <div className="cg-split">{pane('Original', item.src, `Original ${item.name}`)}{pane('Clipart', result.url, `Clipart version of ${item.name}`)}</div>}
      {item && shown === 'original' && pane('Original', item.src, `Original ${item.name}`)}
      {item && shown === 'result' && result && pane('Clipart', result.url, `Clipart version of ${item.name}`)}
      {item && shown === 'slider' && result && <figure className="cg-pane cg-compare">
        <figcaption>Before <span aria-hidden>·</span> After</figcaption>
        <div className="cg-pane-img">
          <img src={result.url} alt={`Clipart version of ${item.name}`} style={transform} draggable={false}/>
          <img className="cg-before" src={item.src} alt="" aria-hidden style={{ ...transform, clipPath: `inset(0 ${100 - split}% 0 0)` }} draggable={false}/>
          <span className="cg-divider" style={{ left: `${split}%` }} aria-hidden/>
          <input type="range" className="cg-compare-range" min={0} max={100} value={split} onChange={event => setSplit(Number(event.target.value))} aria-label="Before and after position"/>
        </div>
      </figure>}
    </div>

    <div className="cg-preview-foot">
      <button type="button" className="cg-icon" aria-label="Previous image" disabled={total < 2} onClick={() => onStep(-1)}><ChevronLeft size={16}/></button>
      <div className="cg-meta">
        {item ? <>
          <strong title={item.name}>{item.name}</strong>
          <small>{index + 1} of {total} · original {item.width}×{item.height}{result ? ` · clipart ${result.width}×${result.height} returned by ${engineInfo(result.engine).label}${result.width !== result.requested.width || result.height !== result.requested.height ? ` (asked for ${result.requested.width}×${result.requested.height})` : ''}` : ''}{item.message ? ` · ${item.message}` : ''}</small>
        </> : <small>No image selected</small>}
      </div>
      <button type="button" className="cg-btn" disabled={!canRegenerate} onClick={onRegenerate}><RefreshCw size={14}/> {result ? 'Regenerate' : 'Generate'}</button>
      <button type="button" className="cg-icon" aria-label="Next image" disabled={total < 2} onClick={() => onStep(1)}><ChevronRight size={16}/></button>
    </div>
  </div>
}
