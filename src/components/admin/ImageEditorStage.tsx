import { useEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { clampRect } from '@/lib/image-editor'
import type { Rect } from '@/lib/image-editor'

type Drag =
  | { kind: 'new'; x: number; y: number }
  | { kind: 'move'; x: number; y: number; origin: Rect }
  | { kind: 'resize'; anchorX: number; anchorY: number }

const HANDLES = ['nw', 'ne', 'sw', 'se'] as const
const MIN_SIZE = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function ImageEditorStage({ canvas, selection, onSelect, onApply, busy, busyText, original }: {
  canvas: HTMLCanvasElement
  selection: Rect | null
  onSelect: (rect: Rect | null) => void
  onApply: () => void
  busy: boolean
  busyText: string
  original: boolean
}) {
  const view = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const { width, height } = canvas

  useEffect(() => {
    const target = view.current
    if (!target) return
    target.width = canvas.width
    target.height = canvas.height
    const context = target.getContext('2d')
    context?.clearRect(0, 0, target.width, target.height)
    context?.drawImage(canvas, 0, 0)
  }, [canvas])

  function point(event: PointerEvent<HTMLDivElement>) {
    const box = frame.current!.getBoundingClientRect()
    return {
      x: clamp((event.clientX - box.left) / box.width * width, 0, width),
      y: clamp((event.clientY - box.top) / box.height * height, 0, height),
    }
  }

  function down(event: PointerEvent<HTMLDivElement>) {
    if (busy || event.button !== 0) return
    const at = point(event)
    const handle = (event.target as HTMLElement).dataset.handle
    if (handle && selection) {
      drag.current = {
        kind: 'resize',
        anchorX: handle.includes('w') ? selection.x + selection.w : selection.x,
        anchorY: handle.includes('n') ? selection.y + selection.h : selection.y,
      }
    } else if (selection && at.x >= selection.x && at.x <= selection.x + selection.w && at.y >= selection.y && at.y <= selection.y + selection.h) {
      drag.current = { kind: 'move', x: at.x, y: at.y, origin: selection }
    } else {
      drag.current = { kind: 'new', x: at.x, y: at.y }
      onSelect(null)
    }
    frame.current?.setPointerCapture(event.pointerId)
    frame.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
    event.preventDefault()
  }

  function dragged(current: Drag, at: { x: number; y: number }): Rect {
    if (current.kind === 'move') {
      const { origin } = current
      return { ...origin, x: Math.round(clamp(origin.x + at.x - current.x, 0, width - origin.w)), y: Math.round(clamp(origin.y + at.y - current.y, 0, height - origin.h)) }
    }
    if (current.kind === 'resize') return clampRect({ x: current.anchorX, y: current.anchorY, w: at.x - current.anchorX, h: at.y - current.anchorY }, width, height)
    return clampRect({ x: current.x, y: current.y, w: at.x - current.x, h: at.y - current.y }, width, height)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) onSelect(dragged(drag.current, point(event)))
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    drag.current = null
    if (frame.current?.hasPointerCapture(event.pointerId)) frame.current.releasePointerCapture(event.pointerId)
    const rect = event.type === 'pointercancel' ? selection : dragged(current, point(event))
    onSelect(rect && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE ? rect : null)
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (busy) return
    if (event.key === 'Escape' && selection) { event.preventDefault(); onSelect(null); return }
    if (event.key === 'Enter' && selection) { event.preventDefault(); onApply(); return }
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key]
    if (!direction) return
    event.preventDefault()
    if (!selection) {
      onSelect(clampRect({ x: width * 0.3, y: height * 0.42, w: width * 0.4, h: height * 0.16 }, width, height))
      return
    }
    const step = Math.max(1, Math.round(Math.max(width, height) * (event.altKey ? 0.002 : 0.01)))
    if (event.shiftKey) {
      onSelect(clampRect({ ...selection, w: Math.max(MIN_SIZE, selection.w + direction[0] * step), h: Math.max(MIN_SIZE, selection.h + direction[1] * step) }, width, height))
    } else {
      onSelect({ ...selection, x: clamp(selection.x + direction[0] * step, 0, width - selection.w), y: clamp(selection.y + direction[1] * step, 0, height - selection.h) })
    }
  }

  const sizeBelow = selection ? selection.y / height < 0.12 : false
  return <div className="ie-stage">
    <div
      ref={frame}
      className={`ie-frame${busy ? ' is-busy' : ''}`}
      style={{ '--ie-ratio': `${width / height}` } as CSSProperties}
      tabIndex={0}
      role="group"
      aria-label="Image. Drag over the area to change. Arrow keys move the selection, Shift with arrows resizes it, Enter runs the tool and Escape clears it."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <canvas ref={view} aria-hidden/>
      {selection && selection.w > 0 && selection.h > 0 && <div className="ie-selection" style={{ left: `${selection.x / width * 100}%`, top: `${selection.y / height * 100}%`, width: `${selection.w / width * 100}%`, height: `${selection.h / height * 100}%` }}>
        {!busy && HANDLES.map(handle => <span key={handle} className={`ie-handle ie-handle-${handle}`} data-handle={handle}/>)}
        <span className={`ie-size${sizeBelow ? ' is-below' : ''}`}>{selection.w} × {selection.h}</span>
      </div>}
      {original && <span className="ie-badge">Original</span>}
      {busy && <div className="ie-busy"><LoaderCircle className="spin" size={22} aria-hidden/> <span>{busyText}</span></div>}
    </div>
  </div>
}
