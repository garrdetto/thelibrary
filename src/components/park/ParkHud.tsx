import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Camera, Check, Cloud, CloudRain, Droplets, Eraser, FastForward, Footprints, Gauge, Grid3x3, Landmark, LoaderCircle, LogOut, Maximize2, MessageCircle, Minus, Mountain, MousePointer2, Paintbrush, Pause, Play, Plus, RotateCw, Save, Sparkles, Store, Sun, Moon, Trash2, Trees, Undo2, Users, Wrench, X, Zap } from 'lucide-react'
import { ParkRenderer } from '@/lib/park/renderer'
import type { Preview } from '@/lib/park/renderer'
import { compressSave } from '@/lib/park/session'
import { ViewSession } from '@/lib/park/session'
import type { ParkSession, GuestInfo } from '@/lib/park/session'
import { parkApi } from '@/lib/park/api'
import type { SaveSummary } from '@/lib/park/api'
import { FLAT_RIDES, COASTER_STYLES, COASTER_PRESETS, STALLS, SCENERY, STAFF, MARKETING, SCENARIOS, MONTHS, DIRS, PATH_ADDITIONS, formatMoney, guestName, objectiveText, companyValue, footprintTiles, tileIndex, inMap, tileSlope, tileMin, validatePiece, rideCapacity, rideValue, groundHeightAt } from '../../../server/park/index.mjs'
import type { Entity, Piece } from '../../../server/park/index.mjs'

type Tool =
  | { kind: 'select' }
  | { kind: 'terrain'; op: 'raise' | 'lower' | 'level'; size: number }
  | { kind: 'water'; op: 'raise' | 'lower'; size: number }
  | { kind: 'surface'; surface: number; size: number }
  | { kind: 'path'; path: 1 | 2 }
  | { kind: 'unpath' }
  | { kind: 'pathAdd'; add: number }
  | { kind: 'flat'; ride: string; rot: number }
  | { kind: 'stall'; stall: string; rot: number }
  | { kind: 'scenery'; scenery: string; rot: number }
  | { kind: 'clear' }
  | { kind: 'gate'; ride: number; role: 'entrance' | 'exit' }
  | { kind: 'coaster'; style: string; dir: number; length: number; preset?: string }
  | { kind: 'demolish' }

type Panel = null | 'terrain' | 'paths' | 'rides' | 'coasters' | 'shops' | 'scenery' | 'staff' | 'park' | 'finance' | 'save' | 'chat'
type Selection = null | { kind: 'entity' | 'guest' | 'staff'; id: number }
type Toast = { id: number; text: string; kind: 'error' | 'info' | 'warn' }

const SURFACE_NAMES = ['Grass', 'Sand', 'Dirt', 'Rock', 'Snow']
const CURVES = [{ c: -2, label: 'Wide left' }, { c: -1, label: 'Tight left' }, { c: 0, label: 'Straight' }, { c: 1, label: 'Tight right' }, { c: 2, label: 'Wide right' }]
const SLOPES = [{ s: -2, label: 'Steep down' }, { s: -1, label: 'Down' }, { s: 0, label: 'Level' }, { s: 1, label: 'Up' }, { s: 2, label: 'Steep up' }]
const SPECIALS = [{ sp: '', label: 'Track' }, { sp: 'chain', label: 'Chain lift' }, { sp: 'booster', label: 'Booster' }, { sp: 'brakes', label: 'Brakes' }, { sp: 'loop', label: 'Loop' }, { sp: 'station', label: 'Station' }]
const level = (v: number) => v < 2 ? 'Low' : v < 4 ? 'Medium' : v < 6 ? 'High' : v < 8 ? 'Very high' : 'Extreme'
const money = (v: number) => formatMoney(v)
const TILE = 4

function Bar({ value, max = 255, invert = false, label }: { value: number; max?: number; invert?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(100, value / max * 100))
  const good = invert ? 100 - pct : pct
  return <div className="pk-bar"><span>{label}</span><i><b style={{ width: `${pct}%`, background: good > 60 ? '#4caf62' : good > 30 ? '#e2b33d' : '#d9573f' }} /></i></div>
}

function Window({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <section className={`pk-window ${wide ? 'pk-window-wide' : ''}`} aria-label={title}><header><strong>{title}</strong><button aria-label="Close" onClick={onClose}><X size={16} /></button></header><div className="pk-window-body">{children}</div></section>
}

export function ParkHud({ session, onQuit, signedIn: accountSignedIn, onScore }: { session: ParkSession; onQuit: () => void; signedIn: boolean; onScore?: () => void }) {
  const viewOnly = session instanceof ViewSession
  const signedIn = accountSignedIn && !viewOnly
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<ParkRenderer | null>(null)
  const [, setVersion] = useState(0)
  const [glError, setGlError] = useState('')
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [panel, setPanel] = useState<Panel>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [builder, setBuilder] = useState<{ ride: number; c: number; s: number; sp: string } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null)
  const [grid, setGrid] = useState(false)
  const [rideCam, setRideCam] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [chatText, setChatText] = useState('')
  const [saves, setSaves] = useState<SaveSummary[] | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [newsSeen, setNewsSeen] = useState(0)
  const [nameDraft, setNameDraft] = useState('')
  const [naming, setNaming] = useState(false)
  const toolRef = useRef(tool)
  toolRef.current = tool
  const drag = useRef<{ button: number; x: number; y: number; moved: boolean; start?: { x: number; y: number }; cam?: { tx: number; ty: number; yaw: number; pitch: number }; anchor?: { x: number; y: number; z: number }; pointers: Map<number, { x: number; y: number }>; pinch?: number } >({ button: -1, x: 0, y: 0, moved: false, pointers: new Map() })
  const keys = useRef(new Set<string>())
  const toastId = useRef(1)

  const state = session.state
  const park = state.parks[session.park]

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId.current++
    setToasts(list => [...list.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), kind === 'error' ? 4200 : 3000)
  }, [])

  useEffect(() => session.subscribe(() => setVersion(v => v + 1)), [session])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: ParkRenderer
    try { renderer = new ParkRenderer(canvas) } catch (error) { setGlError((error as Error).message); return }
    rendererRef.current = renderer
    if (import.meta.env.DEV) (window as unknown as { __park?: unknown }).__park = { session, renderer }
    renderer.setState(session.state, session.park)
    renderer.focusPark()
    const resize = () => { const r = canvas.getBoundingClientRect(); renderer.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)) }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    let raf = 0, last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      session.tick(now)
      const cam = renderer.cam, k = keys.current, speed = cam.dist * 0.9 * dt
      const fx = -Math.cos(cam.yaw), fy = -Math.sin(cam.yaw), rx = -Math.sin(cam.yaw), ry = Math.cos(cam.yaw)
      if (k.has('w') || k.has('arrowup')) { cam.tx += fx * speed; cam.ty += fy * speed }
      if (k.has('s') || k.has('arrowdown')) { cam.tx -= fx * speed; cam.ty -= fy * speed }
      if (k.has('a') || k.has('arrowleft')) { cam.tx -= rx * speed; cam.ty -= ry * speed }
      if (k.has('d') || k.has('arrowright')) { cam.tx += rx * speed; cam.ty += ry * speed }
      if (k.has('q')) cam.yaw -= dt * 1.4
      if (k.has('e')) cam.yaw += dt * 1.4
      const s = session.state
      cam.tx = Math.max(0, Math.min(s.map.w * TILE, cam.tx)); cam.ty = Math.max(0, Math.min(s.map.h * TILE, cam.ty))
      cam.tz += (groundHeightAt(s.map, cam.tx, cam.ty, TILE) - cam.tz) * Math.min(1, dt * 4)
      renderer.setState(s, session.park)
      renderer.frame(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); renderer.dispose(); rendererRef.current = null }
  }, [session])

  useEffect(() => { const r = rendererRef.current; if (r) { r.showGrid = grid || !['select', 'flat', 'stall', 'scenery'].includes(tool.kind) } }, [grid, tool])
  useEffect(() => { const r = rendererRef.current; if (r) r.rideCam = rideCam }, [rideCam])
  useEffect(() => {
    const r = rendererRef.current
    if (r) r.preview = { selected: r.preview.selected, piece: r.preview.piece }
    if (tool.kind === 'gate' && !session.state.entities[tool.ride]) setTool({ kind: 'select' })
  }, [tool, session, state.structVersion])

  const run = useCallback(async (cmd: Parameters<ParkSession['command']>[0], success?: string) => {
    const result = await session.command(cmd)
    if (!result.ok) toast(result.error ?? 'That did not work.', 'error')
    else { if (result.warning) toast(result.warning, 'warn'); else if (success) toast(success) }
    return result
  }, [session, toast])

  const entity = selection?.kind === 'entity' ? state.entities[selection.id] : undefined
  const staffMember = selection?.kind === 'staff' ? state.staff.find(s => s.id === selection.id) : undefined

  useEffect(() => {
    if (selection?.kind !== 'guest') { setGuestInfo(null); return }
    let live = true
    const load = async () => { const info = await session.guest(selection.id); if (live) { setGuestInfo(info); if (!info) setSelection(null) } }
    void load()
    const timer = setInterval(load, 1000)
    return () => { live = false; clearInterval(timer) }
  }, [selection, session])

  useEffect(() => {
    const r = rendererRef.current
    if (r) r.preview.selected = selection?.kind === 'entity' ? selection.id : undefined
  }, [selection])

  const builderRide = builder ? state.entities[builder.ride] : undefined
  const builderPiece: Piece | null = builder ? { c: builder.c, s: builder.s, ...(builder.sp ? { sp: builder.sp as Piece['sp'] } : {}) } : null
  const builderCheck = useMemo(() => {
    if (!builderRide || !builderPiece || builderRide.complete) return null
    return validatePiece(state, builderRide, builderPiece)
  }, [builderRide, builderPiece?.c, builderPiece?.s, builderPiece?.sp, state.structVersion, builderRide?.pieces?.length])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.preview.piece = builderRide && builderPiece && !builderRide.complete ? { ride: builderRide, piece: builderPiece, ok: Boolean(builderCheck?.ok) } : undefined
  })

  function placementOk(t: Tool, x: number, y: number) {
    const map = state.map
    const free = (tx: number, ty: number) => { if (!inMap(map, tx, ty)) return false; const i = tileIndex(map, tx, ty); return map.owner[i] === session.park && !map.obj[i] && !map.path[i] && !(map.water[i] >= 0 && map.water[i] > tileMin(map, tx, ty)) }
    if (t.kind === 'flat') return footprintTiles({ id: 0, type: 'ride', kind: 'flat', ride: t.ride, x, y, rot: t.rot, park: 0 } as Entity).every(([tx, ty]) => free(tx, ty))
    if (t.kind === 'stall') { const [dx, dy] = DIRS[t.rot]; return free(x, y) && tileSlope(map, x, y).dir !== -2 && inMap(map, x + dx, y + dy) && map.path[tileIndex(map, x + dx, y + dy)] === 1 }
    if (t.kind === 'scenery') return free(x, y)
    if (t.kind === 'gate') return inMap(map, x, y) && !map.obj[tileIndex(map, x, y)] && !map.path[tileIndex(map, x, y)]
    return true
  }

  function updatePreview(clientX: number, clientY: number) {
    const r = rendererRef.current
    if (!r) return
    const hit = r.pickTile(clientX, clientY)
    setHover(hit ? { x: hit.x, y: hit.y } : null)
    const t = toolRef.current
    const p: Preview = { selected: r.preview.selected, piece: r.preview.piece }
    if (hit) {
      const d = drag.current
      const brush = 'size' in t ? t.size : 1
      if (['terrain', 'water', 'surface', 'path', 'unpath', 'clear', 'pathAdd', 'demolish'].includes(t.kind)) {
        if (d.button === 0 && d.start && t.kind !== 'pathAdd' && t.kind !== 'demolish') {
          if (t.kind === 'path') {
            const dx = Math.abs(hit.x - d.start.x), dy = Math.abs(hit.y - d.start.y)
            p.rect = dx >= dy ? { x0: d.start.x, y0: d.start.y, x1: hit.x, y1: d.start.y, ok: true } : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: hit.y, ok: true }
          } else p.rect = { x0: d.start.x, y0: d.start.y, x1: hit.x, y1: hit.y, ok: true }
        } else {
          const half = Math.floor((brush - 1) / 2)
          p.rect = { x0: hit.x - half, y0: hit.y - half, x1: hit.x - half + brush - 1, y1: hit.y - half + brush - 1, ok: t.kind !== 'demolish' }
        }
      }
      if (t.kind === 'flat') { const def = FLAT_RIDES[t.ride]; const w = t.rot % 2 ? def.size[1] : def.size[0], h = t.rot % 2 ? def.size[0] : def.size[1]; const x = hit.x - Math.floor((w - 1) / 2), y = hit.y - Math.floor((h - 1) / 2); p.ghost = { type: 'flat', kind: t.ride, x, y, rot: t.rot, ok: placementOk(t, x, y) } }
      if (t.kind === 'stall') p.ghost = { type: 'stall', kind: t.stall, x: hit.x, y: hit.y, rot: t.rot, ok: placementOk(t, hit.x, hit.y) }
      if (t.kind === 'scenery') p.ghost = { type: 'scenery', kind: t.scenery, x: hit.x, y: hit.y, rot: t.rot, ok: placementOk(t, hit.x, hit.y) }
      if (t.kind === 'gate') {
        const ride = state.entities[t.ride]
        let dir = 0
        if (ride) { const fx = hit.fx, fy = hit.fy; const cx = ride.x + (ride.kind === 'flat' ? 1 : 0), cy = ride.y; dir = Math.abs(fx - cx - 0.5) > Math.abs(fy - cy - 0.5) ? (fx > cx ? 0 : 2) : (fy > cy ? 1 : 3) }
        p.ghost = { type: 'gate', kind: 'gate', x: hit.x, y: hit.y, rot: dir, ok: placementOk(t, hit.x, hit.y), role: t.role }
      }
      if (t.kind === 'coaster') p.station = { x: hit.x, y: hit.y, dir: t.dir, length: t.length, ok: [...Array(t.length)].every((_, k) => { const [dx, dy] = DIRS[t.dir]; const tx = hit.x + dx * k, ty = hit.y + dy * k; return inMap(state.map, tx, ty) && state.map.owner[tileIndex(state.map, tx, ty)] === session.park && !state.map.obj[tileIndex(state.map, tx, ty)] && !state.map.path[tileIndex(state.map, tx, ty)] }) }
    }
    r.preview = p
  }

  async function applyTool(clientX: number, clientY: number) {
    const r = rendererRef.current
    if (!r) return
    const t = toolRef.current
    const hit = r.pickTile(clientX, clientY)
    const d = drag.current
    if (t.kind === 'select' || t.kind === 'demolish') {
      const picked = r.pick(clientX, clientY)
      if (t.kind === 'demolish') {
        if (picked?.kind === 'entity') { const e = state.entities[picked.id]; if (e && e.type !== 'parkEntrance') { const res = await run({ t: 'demolish', id: picked.id }); if (res.ok) toast(`Demolished. Refund ${money(res.refund ?? 0)}.`) } }
        else if (hit && state.map.path[tileIndex(state.map, hit.x, hit.y)]) await run({ t: 'unpath', x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y })
        return
      }
      if (picked) { setSelection(picked); setPanel(null); if (picked.kind === 'entity') { const e = state.entities[picked.id]; if (e?.type === 'gate') setSelection({ kind: 'entity', id: e.ride as number }) } }
      else setSelection(null)
      return
    }
    if (!hit) return
    const rect = r.preview.rect
    switch (t.kind) {
      case 'terrain': if (rect) await run({ t: 'terrain', op: t.op, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'water': if (rect) await run({ t: 'water', op: t.op, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'surface': if (rect) await run({ t: 'surface', surface: t.surface, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'path': if (rect) await run({ t: 'path', kind: t.path, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'unpath': if (rect) await run({ t: 'unpath', x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'clear': if (rect) await run({ t: 'clear', x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'pathAdd': await run({ t: 'pathAdd', x: hit.x, y: hit.y, add: t.add }); break
      case 'scenery': await run({ t: 'scenery', kind: t.scenery, x: hit.x, y: hit.y, rot: t.rot }); break
      case 'stall': { const res = await run({ t: 'stall', kind: t.stall, x: hit.x, y: hit.y, rot: t.rot }); if (res.ok && res.id) { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: res.id }) } break }
      case 'flat': {
        const g = r.preview.ghost
        if (!g) break
        const res = await run({ t: 'flat', ride: t.ride, x: g.x, y: g.y, rot: t.rot })
        if (res.ok && res.id) { setSelection({ kind: 'entity', id: res.id }); setTool({ kind: 'gate', ride: res.id, role: 'entrance' }); toast('Ride built. Now place its entrance on a tile beside it.') }
        break
      }
      case 'gate': {
        const res = await run({ t: 'gate', ride: t.ride, role: t.role, x: hit.x, y: hit.y })
        if (res.ok) {
          const ride = session.state.entities[t.ride]
          if (t.role === 'entrance' && ride && !ride.exit) { setTool({ kind: 'gate', ride: t.ride, role: 'exit' }); toast('Entrance placed. Now place the exit.') }
          else { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: t.ride }); if (ride?.entrance && ride.exit && ride.status !== 'open' && (ride.kind === 'flat' || ride.complete)) toast('Ready! Open the ride from its window.') }
        }
        break
      }
      case 'coaster': {
        if (t.preset) {
          const res = await run({ t: 'preset', preset: t.preset, x: hit.x, y: hit.y, dir: t.dir })
          if (res.ok && res.id) { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: res.id }); toast(`${COASTER_PRESETS[t.preset].name} built for ${money(res.cost ?? 0)}. Place its entrance and exit beside the station.`) }
          break
        }
        const res = await run({ t: 'coaster', style: t.style, x: hit.x, y: hit.y, dir: t.dir, length: t.length })
        if (res.ok && res.id) { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: res.id }); setBuilder({ ride: res.id, c: 0, s: 0, sp: '' }); toast('Station built. Lay track until the circuit returns to the station.') }
        break
      }
    }
    void d
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current
    e.currentTarget.setPointerCapture(e.pointerId)
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (d.pointers.size === 2) { const [a, b] = [...d.pointers.values()]; d.pinch = Math.hypot(a.x - b.x, a.y - b.y); d.button = 9; return }
    const r = rendererRef.current
    if (!r) return
    d.button = e.button; d.x = e.clientX; d.y = e.clientY; d.moved = false
    d.cam = { tx: r.cam.tx, ty: r.cam.ty, yaw: r.cam.yaw, pitch: r.cam.pitch }
    const hit = r.pickTile(e.clientX, e.clientY)
    d.anchor = hit ? { x: hit.wx, y: hit.wy, z: hit.wz } : { x: r.cam.tx, y: r.cam.ty, z: r.cam.tz }
    d.start = hit ? { x: hit.x, y: hit.y } : undefined
    if (rideCam && e.button === 0) setRideCam(null)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current, r = rendererRef.current
    if (!r) return
    if (d.pointers.has(e.pointerId)) d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (d.button === 9 && d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (d.pinch) r.cam.dist = Math.max(12, Math.min(420, r.cam.dist * d.pinch / dist))
      d.pinch = dist
      return
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (d.button >= 0 && Math.hypot(dx, dy) > 5) d.moved = true
    const t = toolRef.current
    const panning = d.button === 1 || (d.button === 0 && (t.kind === 'select' || t.kind === 'demolish' || e.pointerType === 'touch' && !['terrain', 'water', 'surface', 'path', 'unpath', 'clear'].includes(t.kind)))
    if (d.cam && d.moved && panning) {
      const a = d.anchor
      const p = a ? r.rayPlane(e.clientX, e.clientY, a.z) : null
      if (a && p && Math.hypot(a.x - p.x, a.y - p.y) < r.cam.dist * 3) { r.cam.tx += a.x - p.x; r.cam.ty += a.y - p.y }
      return
    }
    if (d.cam && d.button === 2) {
      r.cam.yaw = d.cam.yaw - dx * 0.006
      r.cam.pitch = Math.max(0.18, Math.min(1.45, d.cam.pitch + dy * 0.005))
      return
    }
    updatePreview(e.clientX, e.clientY)
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current
    d.pointers.delete(e.pointerId)
    if (d.button === 9) { if (!d.pointers.size) d.button = -1; return }
    const t = toolRef.current
    const areaTool = ['terrain', 'water', 'surface', 'path', 'unpath', 'clear'].includes(t.kind)
    if (d.button === 0 && (!d.moved || areaTool)) void applyTool(e.clientX, e.clientY)
    d.button = -1; d.start = undefined
    updatePreview(e.clientX, e.clientY)
  }

  function rotateTool() {
    setTool(t => 'rot' in t ? { ...t, rot: (t.rot + 1) % 4 } as Tool : t.kind === 'coaster' ? { ...t, dir: (t.dir + 1) % 4 } : t)
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { keys.current.add(key); e.preventDefault() }
      if (key === 'escape') { if (toolRef.current.kind === 'select') { setSelection(null); setPanel(null); setBuilder(null) } setTool({ kind: 'select' }); setRideCam(null); if (rendererRef.current) rendererRef.current.preview = {} }
      if (key === 'r') rotateTool()
      if (key === 'g') setGrid(v => !v)
      if (key === ' ') { e.preventDefault(); void session.command({ t: 'speed', speed: session.state.speed ? 0 : 1 }) }
      if (key === '+' || key === '=') { const r = rendererRef.current; if (r) r.cam.dist = Math.max(12, r.cam.dist * 0.85) }
      if (key === '-') { const r = rendererRef.current; if (r) r.cam.dist = Math.min(420, r.cam.dist * 1.15) }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    const blur = () => keys.current.clear()
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [session])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = rendererRef.current; if (r) r.cam.dist = Math.max(12, Math.min(420, r.cam.dist * Math.exp(e.deltaY * 0.0012))) }
    const menu = (e: Event) => e.preventDefault()
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('contextmenu', menu)
    return () => { canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', menu) }
  }, [])

  function choose(next: Tool) { setTool(next); setRideCam(null); setSelection(null); if (rendererRef.current) rendererRef.current.preview = {} }
  function togglePanel(next: Panel) { setPanel(p => p === next ? null : next); setTool({ kind: 'select' }); if (rendererRef.current) rendererRef.current.preview = {} }

  async function buildPiece() {
    if (!builder || !builderPiece) return
    const res = await run({ t: 'piece', ride: builder.ride, ...builderPiece })
    if (res.ok) {
      setBuilder(b => b && { ...b, sp: b.sp === 'loop' || b.sp === 'brakes' || b.sp === 'booster' ? '' : b.sp, c: builderPiece.c && (b.sp === 'loop') ? 0 : b.c })
      if (res.complete) { toast('Circuit complete! The test run results are in the ride window.'); setBuilder(null) }
    }
  }

  function chooseOrBuild(next: { c: number; s: number; sp: string }) {
    if (!builder) return
    if (next.c === builder.c && next.s === builder.s && next.sp === builder.sp) { if (builderCheck?.ok) void buildPiece(); else if (builderCheck?.error) toast(builderCheck.error, 'error'); return }
    setBuilder({ ...builder, ...next })
  }

  async function autoFinish() {
    if (!builder) return
    setFinishing(true)
    const res = await run({ t: 'finish', ride: builder.ride })
    setFinishing(false)
    if (res.ok) { toast(`Track finished with ${res.pieces ?? 0} new pieces for ${money(res.cost ?? 0)}. Check the test run in the ride window.`); setBuilder(null); setSelection({ kind: 'entity', id: builder.ride }) }
  }

  async function openSave() {
    setPanel('save'); setSaves(null)
    if (!signedIn) return
    try { setSaves((await parkApi.saves()).saves) } catch (error) { toast((error as Error).message, 'error'); setSaves([]) }
  }

  async function writeSave(slot: number, label?: string) {
    const data = await compressSave(await session.exportSave())
    const s = session.state, p = s.parks[session.park]
    const name = label ?? (saveName.trim() || `${p.name} · ${MONTHS[s.time.month]} Y${s.time.year}`)
    await parkApi.save(slot, name.slice(0, 40), data, { cash: Math.round(p.cash), guests: p.guestsIn, rating: p.rating, date: `${MONTHS[s.time.month]}, year ${s.time.year}`, mode: s.mode }, s.scenario)
    setLastSaved(Date.now())
    await submitScore(data)
  }

  async function submitScore(data?: string) {
    const s = session.state, p = s.parks[session.park]
    if (!signedIn || s.mode !== 'solo' || s.scenario === 'sandbox' || SCENARIOS[s.scenario]?.versus) return
    try { await parkApi.submitScore(s.scenario, p.name, p.cash - p.loan, data); onScore?.() } catch { /* score submission is best effort */ }
  }

  async function saveTo(slot: number) {
    setSaveBusy(true)
    try {
      await writeSave(slot)
      toast(`Saved to slot ${slot}.`)
      setSaves((await parkApi.saves()).saves)
    } catch (error) { toast((error as Error).message, 'error') } finally { setSaveBusy(false) }
  }

  const autosaving = useRef(false)
  const autosave = useCallback(async (quiet = false) => {
    if (!signedIn || autosaving.current) return
    autosaving.current = true
    try { await writeSave(0, `Autosave · ${session.state.parks[session.park].name}`); if (!quiet) toast('Autosaved.') }
    catch (error) { if (!quiet) toast(`Autosave failed: ${(error as Error).message}`, 'warn') }
    finally { autosaving.current = false }
  }, [signedIn, session])

  useEffect(() => {
    if (!signedIn) return
    const timer = setInterval(() => void autosave(), 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [autosave, signedIn])

  async function leave() {
    if (signedIn) { toast('Saving your park…'); await autosave(true) }
    onQuit()
  }

  function focusOn(x: number, y: number) { const r = rendererRef.current; if (r) { r.cam.tx = (x + 0.5) * TILE; r.cam.ty = (y + 0.5) * TILE } }

  async function fullscreen() {
    const el = shellRef.current
    if (!el) return
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen() } catch { toast('Fullscreen is not available here.', 'warn') }
  }

  const myRides = Object.values(state.entities).filter(e => e.type === 'ride' && e.park === session.park)
  const news = state.news.filter(n => n.park === -1 || n.park === session.park).slice(-4)
  const latestNews = state.news.length ? state.news[state.news.length - 1].id : 0
  useEffect(() => {
    const fresh = state.news.filter(n => n.id > newsSeen && (n.park === -1 || n.park === session.park) && (n.kind === 'warning' || n.kind === 'win'))
    if (newsSeen && fresh.length) for (const n of fresh.slice(-2)) toast(n.text, n.kind === 'warning' ? 'warn' : 'info')
    if (latestNews !== newsSeen) setNewsSeen(latestNews)
  }, [latestNews])

  const weatherIcon = state.weather.kind === 'rain' ? <CloudRain size={16} /> : state.weather.kind === 'cloudy' ? <Cloud size={16} /> : rendererRef.current?.isNight() ? <Moon size={16} /> : <Sun size={16} />
  const brushSize = 'size' in tool ? tool.size : 1
  const setSize = (n: number) => setTool(t => 'size' in t ? { ...t, size: Math.max(1, Math.min(9, n)) } as Tool : t)

  if (glError) return <div className="pk-error"><p>{glError}</p><button className="pk-btn" onClick={onQuit}>Back to menu</button></div>

  return <div className="pk-shell" ref={shellRef}>
    <canvas ref={canvasRef} className={`pk-canvas pk-tool-${tool.kind}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setHover(null)} aria-label="Park view. Drag to move the camera, right-drag to rotate, scroll to zoom." tabIndex={0} />

    <header className="pk-topbar">
      <div className="pk-stat pk-park-name" style={{ borderColor: park.color }}><strong>{park.name}</strong><small>{state.mode === 'versus' ? 'Versus' : state.mode === 'coop' ? 'Co-op' : SCENARIOS[state.scenario]?.name}</small></div>
      <div className={`pk-stat ${park.cash < 0 ? 'pk-neg' : ''}`}><small>Cash</small><strong>{money(park.cash)}</strong></div>
      <div className="pk-stat"><small>Guests</small><strong>{park.guestsIn}</strong></div>
      <div className="pk-stat pk-rating"><small>Rating</small><strong>{park.rating}</strong><i><b style={{ width: `${park.rating / 10}%` }} /></i></div>
      <div className="pk-stat"><small>{weatherIcon} {state.weather.temp}°C</small><strong>{MONTHS[state.time.month]} {state.time.day + 1}, Y{state.time.year}</strong></div>
      <div className="pk-speed" role="group" aria-label="Simulation speed">
        {[0, 1, 2, 4].map(sp => <button key={sp} className={state.speed === sp ? 'on' : ''} disabled={session.online && state.mode === 'versus' && !session.isHost} onClick={() => void session.command({ t: 'speed', speed: sp })} aria-label={sp ? `Speed ${sp}x` : 'Pause'} title={sp ? `${sp}x speed` : 'Pause (Space)'}>{sp === 0 ? <Pause size={14} /> : sp === 1 ? <Play size={14} /> : <><FastForward size={14} /><span>{sp}</span></>}</button>)}
      </div>
      <div className="pk-top-actions">
        <button onClick={() => setGrid(v => !v)} className={grid ? 'on' : ''} title="Grid (G)" aria-label="Toggle grid"><Grid3x3 size={16} /></button>
        <button onClick={() => void fullscreen()} title="Fullscreen" aria-label="Fullscreen"><Maximize2 size={16} /></button>
        {!viewOnly && <button onClick={() => void openSave()} title="Save park" aria-label="Save park"><Save size={16} /></button>}
        {session.online && <button onClick={() => togglePanel('chat')} className={panel === 'chat' ? 'on' : ''} title="Chat" aria-label="Chat"><MessageCircle size={16} /></button>}
        <button onClick={() => void leave()} title={viewOnly ? 'Leave park' : 'Save and leave park'} aria-label={viewOnly ? 'Leave park' : 'Save and leave park'}><LogOut size={16} /></button>
      </div>
    </header>

    {session.online && <div className="pk-players">{session.players.map(p => <span key={p.id} style={{ borderColor: state.parks[p.park]?.color }}>{p.name}{p.host ? ' ★' : ''}</span>)}</div>}

    {session instanceof ViewSession && <div className="pk-viewonly" role="status"><strong>View only</strong> · {session.owner}'s park as saved {new Date(session.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>}

    {!viewOnly && <nav className="pk-toolbar" aria-label="Build tools">
      <button className={tool.kind === 'select' && !panel ? 'on' : ''} onClick={() => { choose({ kind: 'select' }); setPanel(null) }} title="Select (Esc)"><MousePointer2 size={19} /><span>Select</span></button>
      <button className={panel === 'terrain' ? 'on' : ''} onClick={() => { togglePanel('terrain'); setTool({ kind: 'terrain', op: 'raise', size: 3 }) }}><Mountain size={19} /><span>Land</span></button>
      <button className={panel === 'paths' ? 'on' : ''} onClick={() => { togglePanel('paths'); setTool({ kind: 'path', path: 1 }) }}><Footprints size={19} /><span>Paths</span></button>
      <button className={panel === 'rides' ? 'on' : ''} onClick={() => togglePanel('rides')}><Sparkles size={19} /><span>Rides</span></button>
      <button className={panel === 'coasters' ? 'on' : ''} onClick={() => togglePanel('coasters')}><Zap size={19} /><span>Coasters</span></button>
      <button className={panel === 'shops' ? 'on' : ''} onClick={() => togglePanel('shops')}><Store size={19} /><span>Shops</span></button>
      <button className={panel === 'scenery' ? 'on' : ''} onClick={() => togglePanel('scenery')}><Trees size={19} /><span>Scenery</span></button>
      <button className={panel === 'staff' ? 'on' : ''} onClick={() => togglePanel('staff')}><Users size={19} /><span>Staff</span></button>
      <button className={panel === 'park' ? 'on' : ''} onClick={() => togglePanel('park')}><Landmark size={19} /><span>Park</span></button>
      <button className={panel === 'finance' ? 'on' : ''} onClick={() => togglePanel('finance')}><Gauge size={19} /><span>Money</span></button>
      <button className={tool.kind === 'demolish' ? 'on pk-danger' : 'pk-danger'} onClick={() => { choose({ kind: 'demolish' }); setPanel(null) }}><Trash2 size={19} /><span>Demolish</span></button>
    </nav>}

    {panel === 'terrain' && <Window title="Landscaping" onClose={() => togglePanel('terrain')}>
      <div className="pk-chips">
        {(['raise', 'lower', 'level'] as const).map(op => <button key={op} className={tool.kind === 'terrain' && tool.op === op ? 'on' : ''} onClick={() => setTool({ kind: 'terrain', op, size: brushSize })}>{op === 'raise' ? 'Raise land' : op === 'lower' ? 'Lower land' : 'Level land'}</button>)}
        {(['raise', 'lower'] as const).map(op => <button key={`w${op}`} className={tool.kind === 'water' && tool.op === op ? 'on' : ''} onClick={() => setTool({ kind: 'water', op, size: brushSize })}><Droplets size={13} /> {op === 'raise' ? 'Add water' : 'Drain water'}</button>)}
      </div>
      <p className="pk-label">Ground texture</p>
      <div className="pk-chips">{SURFACE_NAMES.map((n, i) => <button key={n} className={tool.kind === 'surface' && tool.surface === i ? 'on' : ''} onClick={() => setTool({ kind: 'surface', surface: i, size: brushSize })}><Paintbrush size={13} /> {n}</button>)}</div>
      <div className="pk-size"><span>Brush</span><button onClick={() => setSize(brushSize - 1)} aria-label="Smaller brush"><Minus size={14} /></button><strong>{brushSize}×{brushSize}</strong><button onClick={() => setSize(brushSize + 1)} aria-label="Larger brush"><Plus size={14} /></button></div>
      <p className="pk-hint">Click to apply the brush, or drag to cover an area. Land costs {money(6)} per corner moved.</p>
    </Window>}

    {panel === 'paths' && <Window title="Footpaths" onClose={() => togglePanel('paths')}>
      <div className="pk-chips">
        <button className={tool.kind === 'path' && tool.path === 1 ? 'on' : ''} onClick={() => setTool({ kind: 'path', path: 1 })}>Footpath · {money(12)}</button>
        <button className={tool.kind === 'path' && tool.path === 2 ? 'on' : ''} onClick={() => setTool({ kind: 'path', path: 2 })}>Queue line · {money(14)}</button>
        <button className={tool.kind === 'unpath' ? 'on' : ''} onClick={() => setTool({ kind: 'unpath' })}><Eraser size={13} /> Remove</button>
      </div>
      <p className="pk-label">Path furniture</p>
      <div className="pk-chips">{Object.entries(PATH_ADDITIONS).map(([id, a]) => <button key={id} className={tool.kind === 'pathAdd' && tool.add === Number(id) ? 'on' : ''} onClick={() => setTool({ kind: 'pathAdd', add: Number(id) })}>{a.name} · {money(a.cost)}</button>)}</div>
      <p className="pk-hint">Drag to lay a straight run. Queue lines connect a footpath to a ride entrance; guests waiting fill them up. Benches rest tired guests, bins stop litter, lamps light the way.</p>
    </Window>}

    {panel === 'rides' && <Window title="Build a ride" onClose={() => togglePanel('rides')} wide>
      <div className="pk-cards">{Object.entries(FLAT_RIDES).map(([id, r]) => <button key={id} className={`pk-card ${tool.kind === 'flat' && tool.ride === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'flat', ride: id, rot: 0 }); setPanel(null) }}>
        <strong>{r.name}</strong><span>{money(r.cost)} · {r.size[0]}×{r.size[1]} · {r.category}</span><small>{r.description}</small><em>Excitement {r.stats.e.toFixed(1)} · Intensity {r.stats.i.toFixed(1)}</em>
      </button>)}</div>
      <p className="pk-hint">Choose a ride, then click the map. Press R or <button className="pk-inline" onClick={rotateTool}><RotateCw size={12} /> rotate</button>. Uneven ground is levelled automatically.</p>
    </Window>}

    {panel === 'coasters' && <Window title="Build a roller coaster" onClose={() => togglePanel('coasters')} wide>
      <div className="pk-cards">{Object.entries(COASTER_STYLES).map(([id, c]) => <button key={id} className={`pk-card ${tool.kind === 'coaster' && tool.style === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'coaster', style: id, dir: 0, length: 3 }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: c.track }} />{c.name}</strong><span>{money(c.cost)} + {money(c.pieceCost)}/piece</span><small>{c.description}</small><em>{c.loops ? 'Loops · ' : ''}{c.steep ? 'Steep drops · ' : 'Gentle slopes · '}Max {Math.round(c.maxHeight * 0.5)}m</em>
      </button>)}</div>
      <p className="pk-label">Ready-made designs</p>
      <div className="pk-cards">{Object.entries(COASTER_PRESETS).map(([id, d]) => <button key={id} className={`pk-card ${tool.kind === 'coaster' && tool.preset === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'coaster', style: d.style, dir: 0, length: d.station, preset: id }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: COASTER_STYLES[d.style].track }} />{d.name}</strong><span>{COASTER_STYLES[d.style].name}</span><small>{d.description}</small>
      </button>)}</div>
      <p className="pk-hint">Click to place the station, then build the circuit piece by piece, or press Auto-finish to close the loop. Designs are built in one go and finished to fit the ground; press R to turn them before placing.</p>
    </Window>}

    {panel === 'shops' && <Window title="Shops and stalls" onClose={() => togglePanel('shops')} wide>
      <div className="pk-cards">{Object.entries(STALLS).map(([id, s]) => <button key={id} className={`pk-card ${tool.kind === 'stall' && tool.stall === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'stall', stall: id, rot: 0 }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: s.color }} />{s.name}</strong><span>{money(s.cost)}{s.price ? ` · sells for ${money(s.price)}` : ''}</span>
      </button>)}</div>
      <p className="pk-hint">The counter must face a footpath. Press R to rotate.</p>
    </Window>}

    {panel === 'scenery' && <Window title="Scenery" onClose={() => togglePanel('scenery')} wide>
      <div className="pk-cards pk-cards-small">{Object.entries(SCENERY).map(([id, s]) => <button key={id} className={`pk-card ${tool.kind === 'scenery' && tool.scenery === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'scenery', scenery: id, rot: 0 }); setPanel(null) }}><strong>{s.name}</strong><span>{money(s.cost)}</span></button>)}
        <button className={`pk-card ${tool.kind === 'clear' ? 'on' : ''}`} onClick={() => { setTool({ kind: 'clear' }); setPanel(null) }}><strong><Eraser size={13} /> Clear scenery</strong><span>Drag over an area</span></button></div>
      <p className="pk-hint">Guests are happier near trees, flowers, fountains and water.</p>
    </Window>}

    {panel === 'staff' && <Window title="Staff" onClose={() => togglePanel('staff')}>
      <div className="pk-chips">{Object.entries(STAFF).map(([id, s]) => <button key={id} onClick={() => void run({ t: 'hire', role: id }, `${s.name} hired.`)}><Plus size={13} /> Hire {s.name} · {money(s.wage)}/mo</button>)}</div>
      <p className="pk-hint">Handymen sweep litter, mechanics fix broken rides, and entertainers cheer up nearby guests.</p>
      <ul className="pk-list">{state.staff.filter(s => s.park === session.park).map(s => <li key={s.id}><button onClick={() => { setSelection({ kind: 'staff', id: s.id }); focusOn(s.x, s.y) }}><i className="pk-swatch" style={{ background: STAFF[s.role].color }} />{s.name}</button><small>{s.role === 'handyman' ? `${s.swept} swept` : s.role === 'mechanic' ? `${s.fixed} fixed${s.target ? ' · on a job' : ''}` : 'Entertaining'}</small></li>)}</ul>
    </Window>}

    {panel === 'park' && <Window title={park.name} onClose={() => togglePanel('park')} wide>
      <div className="pk-grid2">
        <div>
          <p className="pk-label">Objective</p>
          <p className={`pk-objective pk-${park.status}`}>{objectiveText(park.objective)}{park.status === 'won' ? ' ✔ Complete!' : park.status === 'lost' ? ' ✘ Failed.' : ''}</p>
          <Bar label={`Guest happiness ${park.happiness ?? 0}%`} value={park.happiness ?? 0} max={100} />
          <Bar label={`Park rating ${park.rating}`} value={park.rating} max={999} />
          <dl className="pk-dl"><dt>Guests in park</dt><dd>{park.guestsIn}</dd><dt>Total visitors</dt><dd>{park.totalGuests}</dd><dt>Park value</dt><dd>{money(park.value)}</dd><dt>Company value</dt><dd>{money(companyValue(state, session.park))}</dd><dt>Litter</dt><dd>{park.litter ?? 0}</dd></dl>
          <div className="pk-row"><span>Entry fee</span><button onClick={() => void run({ t: 'park', entryFee: Math.max(0, park.entryFee - 1) })}><Minus size={13} /></button><strong>{money(park.entryFee)}</strong><button onClick={() => void run({ t: 'park', entryFee: Math.min(100, park.entryFee + 1) })}><Plus size={13} /></button></div>
          <button className={`pk-btn ${park.open ? '' : 'pk-btn-go'}`} onClick={() => void run({ t: 'park', open: !park.open })}>{park.open ? 'Close park to new guests' : 'Open park'}</button>
        </div>
        <div>
          <p className="pk-label">What guests are thinking</p>
          {park.thoughts.length ? <ul className="pk-thoughts">{park.thoughts.map(([t, n]) => <li key={t}><span>{t}</span><b>{n}</b></li>)}</ul> : <p className="pk-hint">No strong opinions yet.</p>}
          <p className="pk-label">Marketing</p>
          <div className="pk-chips">{Object.entries(MARKETING).map(([id, m]) => { const live = park.marketing.find(c => c.kind === id); return <button key={id} disabled={Boolean(live)} onClick={() => void run({ t: 'market', kind: id })}>{m.name} · {money(m.cost)}{live ? ` · ${Math.ceil((live.until - state.time.seconds) / 40)}d left` : ''}</button> })}</div>
          <p className="pk-label">Rides</p>
          <ul className="pk-list">{myRides.map(r => <li key={r.id}><button onClick={() => { setSelection({ kind: 'entity', id: r.id }); focusOn(r.x, r.y) }}>{r.name}</button><small className={`pk-status pk-${r.status}`}>{r.kind === 'coaster' && !r.complete ? 'Building' : r.status}</small></li>)}</ul>
        </div>
      </div>
    </Window>}

    {panel === 'finance' && <Window title="Finances" onClose={() => togglePanel('finance')} wide>
      <div className="pk-grid2">
        <div>
          <p className="pk-label">This month</p>
          <dl className="pk-dl">{Object.entries({ 'Ride tickets': park.month.rides, 'Shop sales': park.month.shops, 'Park entry': park.month.entry, Construction: park.month.construction, Landscaping: park.month.landscaping, Marketing: park.month.marketing, Wages: park.month.wages, Upkeep: park.month.upkeep, 'Loan interest': park.month.interest }).flatMap(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`} className={v < 0 ? 'pk-neg' : v > 0 ? 'pk-pos' : ''}>{money(v)}</dd>])}</dl>
          <p className="pk-label">Bank loan</p>
          <div className="pk-row"><span>{money(park.loan)} of {money(park.maxLoan)}</span><button onClick={() => void run({ t: 'loan', delta: -1000 })}>Repay $1,000</button><button onClick={() => void run({ t: 'loan', delta: 1000 })}>Borrow $1,000</button></div>
          <p className="pk-hint">Interest is about 1.2% of the loan each month.</p>
        </div>
        <div>
          <p className="pk-label">Monthly profit</p>
          {park.history.length ? <div className="pk-chart">{park.history.slice(-12).map(h => { const max = Math.max(1, ...park.history.slice(-12).map(x => Math.abs(x.profit))); return <div key={h.label} title={`${h.label}: ${money(h.profit)}`}><i style={{ height: `${Math.abs(h.profit) / max * 100}%`, background: h.profit >= 0 ? '#4caf62' : '#d9573f', alignSelf: h.profit >= 0 ? 'flex-end' : 'flex-start' }} /><small>{h.label.split(' ')[0]}</small></div> })}</div> : <p className="pk-hint">Your first monthly report arrives at the end of the month.</p>}
          {state.mode === 'versus' && <><p className="pk-label">Company values</p><ul className="pk-list">{state.parks.map(p => <li key={p.id}><span><i className="pk-swatch" style={{ background: p.color }} />{p.name}</span><small>{money(companyValue(state, p.id))}</small></li>)}</ul></>}
        </div>
      </div>
    </Window>}

    {panel === 'save' && <Window title="Save park" onClose={() => setPanel(null)}>
      {!signedIn ? <p className="pk-hint">Sign in on the home page to save parks to your account.</p> : saves === null ? <p className="pk-hint"><LoaderCircle className="spin" size={14} /> Loading save slots…</p> : <>
        <label className="pk-field"><span>Name</span><input value={saveName} maxLength={40} placeholder={`${park.name} · ${MONTHS[state.time.month]} Y${state.time.year}`} onChange={e => setSaveName(e.target.value)} /></label>
        <p className="pk-hint">Your park autosaves every 5 minutes and when you leave{lastSaved ? ` · last saved ${new Date(lastSaved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.{session.state.mode === 'solo' && session.state.scenario !== 'sandbox' ? ' Each save also records your net worth on the leaderboard.' : ''}</p>
        <div className="pk-actions"><button className="pk-btn pk-btn-go" disabled={saveBusy} onClick={() => { setSaveBusy(true); void autosave().finally(async () => { setSaveBusy(false); try { setSaves((await parkApi.saves()).saves) } catch { /* list refresh is optional */ } }) }}><Save size={14} /> Save now</button></div>
        {saves.find(x => x.slot === 0) && <p className="pk-hint">Autosave: {saves.find(x => x.slot === 0)!.summary.date} · {saves.find(x => x.slot === 0)!.summary.guests} guests</p>}
        <ul className="pk-slots">{[1, 2, 3, 4, 5, 6].map(slot => { const s = saves.find(x => x.slot === slot); return <li key={slot}><div><strong>Slot {slot}</strong><small>{s ? `${s.name} · ${s.summary.date} · ${s.summary.guests} guests` : 'Empty'}</small></div><button className="pk-btn" disabled={saveBusy} onClick={() => void saveTo(slot)}>{s ? 'Overwrite' : 'Save'}</button></li> })}</ul>
      </>}
    </Window>}

    {panel === 'chat' && session.online && <Window title="Chat" onClose={() => setPanel(null)}>
      <ul className="pk-chat">{session.chat.map(line => <li key={line.id} className={line.system ? 'pk-system' : ''}>{!line.system && <b>{line.from}: </b>}{line.text}</li>)}</ul>
      <form onSubmit={e => { e.preventDefault(); if (chatText.trim()) { session.sendChat(chatText.trim()); setChatText('') } }} className="pk-chat-form"><input value={chatText} maxLength={200} onChange={e => setChatText(e.target.value)} placeholder="Say something…" aria-label="Chat message" /><button className="pk-btn">Send</button></form>
    </Window>}

    {entity?.type === 'ride' && <RideWindow ride={entity} session={session} onClose={() => setSelection(null)} run={run} onBuild={() => setBuilder({ ride: entity.id, c: 0, s: 0, sp: '' })} onGate={role => setTool({ kind: 'gate', ride: entity.id, role })} rideCam={rideCam === entity.id} onRideCam={() => setRideCam(c => c === entity.id ? null : entity.id)} />}
    {entity?.type === 'stall' && <Window title={entity.name ?? 'Stall'} onClose={() => setSelection(null)}>
      <dl className="pk-dl"><dt>Sales</dt><dd>{entity.sales}</dd><dt>Revenue</dt><dd>{money(entity.revenue ?? 0)}</dd><dt>Upkeep</dt><dd>{money(STALLS[entity.kind!].upkeep)}/month</dd></dl>
      {STALLS[entity.kind!].price > 0 && <div className="pk-row"><span>Price</span><button onClick={() => void run({ t: 'stallSet', id: entity.id, price: Math.max(0, (entity.price ?? 0) - 0.1) })}><Minus size={13} /></button><strong>{money(entity.price ?? 0)}</strong><button onClick={() => void run({ t: 'stallSet', id: entity.id, price: Math.min(20, (entity.price ?? 0) + 0.1) })}><Plus size={13} /></button></div>}
      <div className="pk-actions"><button className="pk-btn" onClick={() => void run({ t: 'stallSet', id: entity.id, open: !entity.open })}>{entity.open ? 'Close' : 'Open'}</button><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: entity.id }); setSelection(null) }}><Trash2 size={13} /> Demolish</button></div>
    </Window>}
    {entity?.type === 'scenery' && <Window title={SCENERY[entity.kind!]?.name ?? 'Scenery'} onClose={() => setSelection(null)}><div className="pk-actions"><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: entity.id }); setSelection(null) }}><Trash2 size={13} /> Remove</button></div></Window>}
    {entity?.type === 'parkEntrance' && <Window title={state.parks[entity.park]?.name ?? 'Park entrance'} onClose={() => setSelection(null)}><p className="pk-hint">Guests arrive and leave through here. Entry fee {money(state.parks[entity.park]?.entryFee ?? 0)}.</p></Window>}
    {selection?.kind === 'guest' && guestInfo && <Window title={guestName(guestInfo.id)} onClose={() => setSelection(null)}>
      <p className="pk-hint">{guestInfo.kid ? 'Young visitor' : 'Visitor'} · {guestInfo.state === 'queue' ? 'Queuing' : guestInfo.state === 'ride' ? 'On a ride' : guestInfo.state === 'sit' ? 'Resting' : 'Walking'} · {money(guestInfo.cash)} left · spent {money(guestInfo.spent)}</p>
      <Bar label="Happiness" value={guestInfo.happy} /><Bar label="Energy" value={guestInfo.energy} /><Bar label="Hunger" value={guestInfo.hunger} invert /><Bar label="Thirst" value={guestInfo.thirst} invert /><Bar label="Restroom" value={guestInfo.toilet} invert /><Bar label="Nausea" value={guestInfo.nausea} invert />
      <p className="pk-hint">Likes intensity {guestInfo.minI.toFixed(1)}–{guestInfo.maxI.toFixed(1)} · {guestInfo.rides} rides so far{guestInfo.items.length ? ` · carrying ${guestInfo.items.join(', ')}` : ''}</p>
      <ul className="pk-thoughts">{[...guestInfo.thoughts].reverse().map((t, i) => <li key={i}><span>“{t}”</span></li>)}</ul>
    </Window>}
    {staffMember && <Window title={staffMember.name} onClose={() => setSelection(null)}>
      <p className="pk-hint">{STAFF[staffMember.role].name} · {money(STAFF[staffMember.role].wage)}/month · {staffMember.role === 'handyman' ? `${staffMember.swept} tiles swept` : staffMember.role === 'mechanic' ? `${staffMember.fixed} rides fixed` : 'Keeping guests smiling'}</p>
      <div className="pk-actions"><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'fire', id: staffMember.id }, 'Staff member let go.'); setSelection(null) }}>Fire</button></div>
    </Window>}

    {builder && builderRide && !builderRide.complete && <section className="pk-builder" aria-label="Track builder">
      <header><strong><Wrench size={14} /> {builderRide.name}</strong><button aria-label="Close builder" onClick={() => setBuilder(null)}><X size={16} /></button></header>
      <div className="pk-builder-row" role="group" aria-label="Direction">{CURVES.map(c => <button key={c.c} className={builder.c === c.c ? 'on' : ''} onClick={() => chooseOrBuild({ c: c.c, s: builder.s, sp: builder.sp === 'loop' || builder.sp === 'station' || builder.sp === 'brakes' || builder.sp === 'booster' ? (c.c === builder.c ? builder.sp : '') : builder.sp })} title={builder.c === c.c ? `${c.label} · click again to build` : c.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={c.c === 0 ? 'M12 21V3' : `M12 21 C12 ${c.c > 0 ? 9 : 9} ${12 + Math.sign(c.c) * (Math.abs(c.c) === 1 ? 3 : 1)} ${Math.abs(c.c) === 1 ? 6 : 4} ${12 + Math.sign(c.c) * 9} ${Math.abs(c.c) === 1 ? 6 : 4}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg><span>{c.label}</span></button>)}</div>
      <div className="pk-builder-row" role="group" aria-label="Slope">{SLOPES.map(s => <button key={s.s} className={builder.s === s.s ? 'on' : ''} onClick={() => chooseOrBuild({ c: builder.c, s: s.s, sp: builder.sp })} title={builder.s === s.s ? `${s.label} · click again to build` : s.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={`M3 ${12 + s.s * 4} L21 ${12 - s.s * 4}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg><span>{s.label}</span></button>)}</div>
      <div className="pk-builder-row pk-builder-special" role="group" aria-label="Special piece">{SPECIALS.map(s => <button key={s.sp} className={builder.sp === s.sp ? 'on' : ''} onClick={() => chooseOrBuild({ sp: s.sp, ...(s.sp === 'loop' || s.sp === 'brakes' || s.sp === 'booster' || s.sp === 'station' ? { c: 0, s: 0 } : { c: builder.c, s: builder.s }) })}>{s.label}</button>)}</div>
      <p className={`pk-builder-status ${builderCheck?.ok ? 'ok' : 'bad'}`}>{builderCheck?.ok ? `${builderCheck.closes ? 'This piece completes the circuit! ' : ''}Cost ${money(builderCheck.cost ?? 0)}` : builderCheck?.error ?? ''}</p>
      <div className="pk-actions"><button className="pk-btn" onClick={() => void run({ t: 'unpiece', ride: builder.ride })}><Undo2 size={14} /> Remove last</button><button className="pk-btn" disabled={finishing} onClick={() => void autoFinish()}>{finishing ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} Auto-finish</button><button className="pk-btn pk-btn-go" disabled={!builderCheck?.ok} onClick={() => void buildPiece()}><Check size={14} /> Build piece</button></div>
      <p className="pk-hint">{builderRide.pieces?.length ?? 0} pieces · spent {money(builderRide.spent ?? 0)}. Click a selected button again to build it. Auto-finish routes the track back into the station, adding chain lift on climbs. Station pieces add extra stops where trains pause.</p>
    </section>}

    {['flat', 'stall', 'scenery', 'coaster', 'gate', 'clear', 'pathAdd'].includes(tool.kind) && <div className="pk-placebar" role="group" aria-label="Placement">
      <strong>{tool.kind === 'flat' ? `Place ${FLAT_RIDES[tool.ride].name} · ${money(FLAT_RIDES[tool.ride].cost)}` : tool.kind === 'stall' ? `Place ${STALLS[tool.stall].name} · ${money(STALLS[tool.stall].cost)}` : tool.kind === 'scenery' ? `Place ${SCENERY[tool.scenery].name} · ${money(SCENERY[tool.scenery].cost)}` : tool.kind === 'coaster' ? (tool.preset ? `Place ${COASTER_PRESETS[tool.preset].name}` : `Place ${COASTER_STYLES[tool.style].name} station`) : tool.kind === 'gate' ? `Place ${state.entities[tool.ride]?.name ?? 'ride'} ${tool.role}` : tool.kind === 'clear' ? 'Drag to clear scenery' : tool.kind === 'pathAdd' ? `Place ${PATH_ADDITIONS[tool.add]?.name ?? 'item'} on a footpath` : ''}</strong>
      {tool.kind === 'coaster' && !tool.preset && <><button onClick={() => setTool({ ...tool, length: Math.max(2, tool.length - 1) })} aria-label="Shorter station"><Minus size={14} /></button><span>{tool.length}-tile station</span><button onClick={() => setTool({ ...tool, length: Math.min(6, tool.length + 1) })} aria-label="Longer station"><Plus size={14} /></button></>}
      {(tool.kind === 'flat' || tool.kind === 'stall' || tool.kind === 'scenery' || tool.kind === 'coaster') && <button onClick={rotateTool}><RotateCw size={14} /> Rotate</button>}
      <button onClick={() => { setTool({ kind: 'select' }); if (rendererRef.current) rendererRef.current.preview = {} }}><X size={14} /> Done</button>
    </div>}

    <div className="pk-toasts" aria-live="polite">{toasts.map(t => <p key={t.id} className={`pk-toast pk-toast-${t.kind}`}>{t.text}</p>)}</div>

    <footer className="pk-news">
      {news.map(n => <button key={n.id} className={`pk-news-${n.kind}`} onClick={() => { if (n.ref && state.entities[n.ref]) { const e = state.entities[n.ref]; setSelection({ kind: 'entity', id: e.id }); focusOn(e.x, e.y) } }}>{n.text}</button>)}
      {hover && <span className="pk-coords">{hover.x}, {hover.y}{tool.kind !== 'select' && <> · <RotateCw size={11} /> R</>}</span>}
    </footer>

    {rideCam && <div className="pk-ridecam"><Camera size={14} /> On-ride camera · click or press Esc to exit</div>}

    {!viewOnly && !park.named && <div className="pk-ended pk-naming" role="dialog" aria-modal="true" aria-labelledby="pk-name-title"><form onSubmit={async e => { e.preventDefault(); const name = nameDraft.trim(); if (name.length < 2) return; setNaming(true); const res = await session.command({ t: 'park', name }); setNaming(false); if (!res.ok) toast(res.error ?? 'That name could not be saved.', 'error') }}>
      <h2 id="pk-name-title">Name your park</h2>
      <p>Every park needs a name before you start building. It appears on the leaderboard next to your username.</p>
      <label className="pk-field"><span>Park name</span><input autoFocus value={nameDraft} minLength={2} maxLength={32} required placeholder="Lakeside Thrills" onChange={e => setNameDraft(e.target.value)} /></label>
      <div className="pk-actions"><button type="submit" className="pk-btn pk-btn-go" disabled={naming || nameDraft.trim().length < 2}>{naming ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Open the gates</button><button type="button" className="pk-btn" onClick={onQuit}>Back to menu</button></div>
    </form></div>}

    {state.ended && <div className="pk-ended" role="dialog" aria-label="Match over"><div><h2>Match over</h2><p>{state.ended.text}</p>{state.ended.values && <ul>{state.parks.map((p, i) => <li key={p.id}><span style={{ color: p.color }}>{p.name}</span> {money(state.ended!.values![i])}</li>)}</ul>}<button className="pk-btn pk-btn-go" onClick={onQuit}>Back to menu</button></div></div>}
  </div>
}

function RideWindow({ ride, session, onClose, run, onBuild, onGate, rideCam, onRideCam }: { ride: Entity; session: ParkSession; onClose: () => void; run: (cmd: { t: string; [k: string]: unknown }, success?: string) => Promise<{ ok: boolean }>; onBuild: () => void; onGate: (role: 'entrance' | 'exit') => void; rideCam: boolean; onRideCam: () => void }) {
  const [name, setName] = useState(ride.name ?? '')
  const [editing, setEditing] = useState(false)
  const st = ride.stats
  const queue = ride.queueLength ?? ride.queue?.length ?? 0
  const coaster = ride.kind === 'coaster'
  const value = rideValue(ride)
  const colors = ['#d8432f', '#3a77d0', '#3fae5c', '#f2c230', '#9b51e0', '#f08a24', '#1fb5b0', '#e85d9b', '#2e2e36', '#f3f1ea']
  return <Window title={ride.name ?? 'Ride'} onClose={onClose}>
    {editing ? <form className="pk-chat-form" onSubmit={e => { e.preventDefault(); void run({ t: 'rideSet', id: ride.id, name }); setEditing(false) }}><input value={name} maxLength={32} onChange={e => setName(e.target.value)} aria-label="Ride name" /><button className="pk-btn">Rename</button></form> : <p className="pk-hint">{coaster ? COASTER_STYLES[ride.style!].name : FLAT_RIDES[ride.ride as string].name} · <button className="pk-inline" onClick={() => { setName(ride.name ?? ''); setEditing(true) }}>rename</button></p>}
    <div className="pk-status-row"><span className={`pk-status pk-${ride.status}`}>{coaster && !ride.complete ? 'Under construction' : ride.status === 'broken' ? 'Broken down' : ride.status === 'open' ? 'Open' : 'Closed'}</span>
      {ride.status !== 'broken' && (!coaster || ride.complete) && <button className={`pk-btn ${ride.status === 'open' ? '' : 'pk-btn-go'}`} onClick={() => void run({ t: 'rideSet', id: ride.id, status: ride.status === 'open' ? 'closed' : 'open' })}>{ride.status === 'open' ? 'Close ride' : 'Open ride'}</button>}</div>
    {st?.valid ? <dl className="pk-dl">
      <dt>Excitement</dt><dd>{st.e.toFixed(2)} ({level(st.e)})</dd><dt>Intensity</dt><dd>{st.i.toFixed(2)} ({level(st.i)})</dd><dt>Nausea</dt><dd>{st.n.toFixed(2)} ({level(st.n)})</dd>
      {coaster && <><dt>Top speed</dt><dd>{st.maxSpeed} km/h</dd><dt>Length</dt><dd>{st.length} m</dd><dt>Ride time</dt><dd>{st.rideTime} s</dd><dt>Drops</dt><dd>{st.drops} (highest {st.highestDrop} m)</dd><dt>Inversions</dt><dd>{st.inversions}</dd><dt>G-forces</dt><dd>+{st.maxG} / {st.minG} · lateral {st.latG}</dd><dt>Air time</dt><dd>{st.airtime} s</dd></>}
    </dl> : coaster && ride.complete ? <p className="pk-hint pk-neg">The test run failed. Remove pieces and try a lower hill or add a chain lift.</p> : coaster ? <p className="pk-hint">Finish the circuit to see its ratings.</p> : null}
    <dl className="pk-dl"><dt>Capacity</dt><dd>{rideCapacity(ride)} riders</dd><dt>Queue</dt><dd>{queue} guests</dd><dt>Riders</dt><dd>{ride.totalRiders ?? 0} total · {ride.monthRiders ?? 0} this month</dd><dt>Income</dt><dd>{money(ride.revenue ?? 0)}</dd><dt>Reliability</dt><dd>{Math.round(ride.reliability ?? 100)}%</dd></dl>
    <div className="pk-row"><span>Ticket</span><button onClick={() => void run({ t: 'rideSet', id: ride.id, price: Math.max(0, (ride.price ?? 0) - 0.1) })}><Minus size={13} /></button><strong>{money(ride.price ?? 0)}</strong><button onClick={() => void run({ t: 'rideSet', id: ride.id, price: Math.min(20, (ride.price ?? 0) + 0.1) })}><Plus size={13} /></button>{value > 0 && <small>Guests think it is worth about {money(Math.round(value * 1.6 * 10) / 10)}</small>}</div>
    <div className="pk-swatches">{colors.map(c => <button key={c} style={{ background: c }} aria-label={`Paint ${c}`} className={ride.color === c ? 'on' : ''} onClick={() => void run({ t: 'rideSet', id: ride.id, color: c })} />)}</div>
    <div className="pk-actions">
      {coaster && !ride.complete && <button className="pk-btn pk-btn-go" onClick={onBuild}><Wrench size={13} /> Build track</button>}
      {coaster && !ride.complete && (ride.pieces?.length ?? 0) > 0 && <button className="pk-btn" onClick={() => void run({ t: 'unpiece', ride: ride.id })}><Undo2 size={13} /> Remove last</button>}
      {coaster && ride.complete && <button className={`pk-btn ${rideCam ? 'on' : ''}`} onClick={onRideCam}><Camera size={13} /> {rideCam ? 'Exit ride camera' : 'Ride camera'}</button>}
      {coaster && ride.complete && <button className="pk-btn" onClick={() => { void run({ t: 'unpiece', ride: ride.id }); onBuild() }}><RotateCw size={13} /> Modify track</button>}
      <button className="pk-btn" onClick={() => onGate('entrance')}>{ride.entrance ? 'Move entrance' : 'Place entrance'}</button>
      <button className="pk-btn" onClick={() => onGate('exit')}>{ride.exit ? 'Move exit' : 'Place exit'}</button>
      <button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: ride.id }); onClose() }}><Trash2 size={13} /> Demolish</button>
    </div>
    {ride.status === 'broken' && <p className="pk-hint pk-neg">{ride.mechanic ? 'A mechanic is on the way.' : session.state.staff.some(s => s.role === 'mechanic' && s.park === session.park) ? 'Waiting for a free mechanic.' : 'Hire a mechanic to repair this ride.'}</p>}
  </Window>
}
