import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Camera, Check, Cloud, CloudRain, Droplets, Eraser, FastForward, Footprints, Gauge, Grid3x3, Hotel, Landmark, LoaderCircle, LogOut, Maximize2, MessageCircle, Minus, Mountain, MousePointer2, Paintbrush, Pause, Play, Plus, RotateCw, Save, Sparkles, Store, Sun, Moon, Trash2, Trees, Undo2, Users, Wrench, X, Zap } from 'lucide-react'
import { ParkRenderer } from '@/lib/park/renderer'
import { customRideThumb } from '@/lib/park/customRides'
import type { BackendFactory } from '@/lib/park/backend'
import { shotCamera } from '@/lib/park/shotCams'
import { QUALITY_TIERS } from '@/lib/park/quality'
import type { ParkQuality } from '@/lib/park/quality'
import type { Preview } from '@/lib/park/renderer'
import { compressSave } from '@/lib/park/session'
import { ViewSession } from '@/lib/park/session'
import type { ParkSession, GuestInfo } from '@/lib/park/session'
import { parkApi } from '@/lib/park/api'
import type { SaveSummary } from '@/lib/park/api'
import { buildableRide, FLAT_RIDES, COASTER_STYLES, COASTER_PRESETS, STALLS, SCENERY, STAFF, MARKETING, SCENARIOS, MONTHS, DIRS, PATH_ADDITIONS, formatMoney, guestName, objectiveText, companyValue, footprintTiles, stallFrontTile, stallFootprintError, stallPlacementRotation, tileIndex, inMap, tileMin, validatePiece, rideCapacity, rideValue, groundHeightAt, isWalkPath, mechanicJobDistance, ownedTileCount, landAreaPlan, LAND_SQUARE_COST, LAND_AREA_MAX, flatSpec, HOTELS, hotelSpec, hotelOrientedFits, hotelEntranceFor, kartCount, AMENITY_VISITS, rideCostScale } from '../../../server/park/index.mjs'
import { WaveControl } from './WaveControl'
import { RideComments } from './RideComments'
import { ResortCards, ResortSummary, ResortPortfolio, HotelWindowBody } from './ResortPanel'
import { GuestCapacity } from './GuestCapacity'
import { RideColors, SchemeEditor } from './RideColors'
import { planPiece, startEnd, anchorEnd, pathHeading } from '@/lib/park/pathBuilder'
import type { PathBuild, PathEnd, PathPlan, PathSegment } from '@/lib/park/pathBuilder'
import type { Entity, Piece, Staff } from '../../../server/park/index.mjs'

type Tool =
  | { kind: 'select' }
  | { kind: 'terrain'; op: 'raise' | 'lower' | 'level'; size: number }
  | { kind: 'water'; op: 'raise' | 'lower'; size: number }
  | { kind: 'surface'; surface: number; size: number }
  | { kind: 'buyLand' }
  | { kind: 'path'; path: 1 | 2 | 3 | 4; elevation: number }
  | { kind: 'pathBuilder'; path: 1 | 2 | 4; segment: PathSegment; turn: -1 | 0 | 1 }
  | { kind: 'pathPaint' }
  | { kind: 'unpath' }
  | { kind: 'pathAdd'; add: number }
  | { kind: 'flat'; ride: string; rot: number; area?: [number, number] }
  | { kind: 'stall'; stall: string; rot: number }
  | { kind: 'scenery'; scenery: string; rot: number }
  | { kind: 'clear' }
  | { kind: 'gate'; ride: number; role: 'entrance' | 'exit' }
  | { kind: 'coaster'; style: string; dir: number; length: number; preset?: string }
  | { kind: 'demolish' }
  | { kind: 'hotel'; hotel: string; floors: number }

type Panel = null | 'terrain' | 'paths' | 'rides' | 'coasters' | 'shops' | 'resorts' | 'scenery' | 'staff' | 'park' | 'finance' | 'save' | 'chat'
type RideTab = 'All' | 'Gentle' | 'Thrill' | 'Water' | 'Other'
type Selection = null | { kind: 'entity' | 'guest' | 'staff'; id: number }
type Toast = { id: number; text: string; kind: 'error' | 'info' | 'warn' }
const PATH_TURNS = [{ turn: -1, label: 'Turn left' }, { turn: 0, label: 'Straight' }, { turn: 1, label: 'Turn right' }] as const
const PATH_KINDS = [{ path: 1, label: 'Footpath', cost: 12 }, { path: 2, label: 'Queue line', cost: 14 }, { path: 4, label: 'Boardwalk', cost: 24 }] as const
const PATH_SECTIONS = [
  { segment: 'stairs-down', label: 'Stairs down', hint: '1m drop', icon: 'M3 4h4v4h4v4h4v4h6' },
  { segment: 'down', label: 'Slope down', hint: '½ stairs', icon: 'M3 8 L21 14' },
  { segment: 'level', label: 'Flat', hint: 'level', icon: 'M3 12 L21 12' },
  { segment: 'up', label: 'Slope up', hint: '½ stairs', icon: 'M3 14 L21 8' },
  { segment: 'stairs-up', label: 'Stairs up', hint: '1m rise', icon: 'M3 20h4v-4h4v-4h4V8h6' },
] as const

const SURFACE_NAMES = ['Grass', 'Sand', 'Dirt', 'Rock', 'Snow']

type LandArea = { x0: number; y0: number; x1: number; y1: number }

function hotelArea(kind: string, start: { x: number; y: number } | null, hit: { x: number; y: number }) {
  const def = HOTELS[kind]
  const lo = Math.min(def.min[0], def.min[1]), hi = Math.max(def.max[0], def.max[1])
  if (!start) return { x: hit.x - Math.floor((def.min[0] - 1) / 2), y: hit.y - Math.floor((def.min[1] - 1) / 2), size: [...def.min] as [number, number] }
  const span = (a: number, b: number) => { const len = Math.max(lo, Math.min(hi, Math.abs(b - a) + 1)); return b >= a ? [a, len] : [a - len + 1, len] }
  const [x, w] = span(start.x, hit.x), [y, h] = span(start.y, hit.y)
  return { x, y, size: [w, h] as [number, number] }
}

function resizableArea(ride: string, start: { x: number; y: number } | null, hit: { x: number; y: number }) {
  const def = FLAT_RIDES[ride], limits = def.resize!
  if (!start) {
    const [w, h] = def.size
    return { x: hit.x - Math.floor((w - 1) / 2), y: hit.y - Math.floor((h - 1) / 2), size: [w, h] as [number, number] }
  }
  const span = (a: number, b: number, min: number, max: number) => {
    const dir = b >= a ? 1 : -1
    const len = Math.max(min, Math.min(max, Math.abs(b - a) + 1))
    return dir > 0 ? [a, len] : [a - len + 1, len]
  }
  const [x, w] = span(start.x, hit.x, limits.min[0], limits.max[0])
  const [y, h] = span(start.y, hit.y, limits.min[1], limits.max[1])
  return { x, y, size: [w, h] as [number, number] }
}

function clampLandArea(r: LandArea): LandArea {
  const span = LAND_AREA_MAX - 1
  const x1 = r.x1 >= r.x0 ? Math.min(r.x1, r.x0 + span) : Math.max(r.x1, r.x0 - span)
  const y1 = r.y1 >= r.y0 ? Math.min(r.y1, r.y0 + span) : Math.max(r.y1, r.y0 - span)
  return { x0: Math.min(r.x0, x1), y0: Math.min(r.y0, y1), x1: Math.max(r.x0, x1), y1: Math.max(r.y0, y1) }
}
const CURVES = [{ c: -2, label: 'Wide left' }, { c: -1, label: 'Tight left' }, { c: 0, label: 'Straight' }, { c: 1, label: 'Tight right' }, { c: 2, label: 'Wide right' }]
const KART_CURVES = [{ c: -2, label: 'Wide left' }, { c: -1, label: 'Tight left' }, { c: -3, label: 'Hairpin left' }, { c: 0, label: 'Straight' }, { c: 3, label: 'Hairpin right' }, { c: 1, label: 'Tight right' }, { c: 2, label: 'Wide right' }]
const SLOPES = [{ s: -2, label: 'Steep down' }, { s: -1, label: 'Down' }, { s: 0, label: 'Level' }, { s: 1, label: 'Up' }, { s: 2, label: 'Steep up' }]
const SPECIALS = [{ sp: '', label: 'Track' }, { sp: 'chain', label: 'Chain lift' }, { sp: 'booster', label: 'Booster' }, { sp: 'brakes', label: 'Brakes' }, { sp: 'loop', label: 'Loop' }, { sp: 'corkscrew', label: 'Corkscrew' }, { sp: 'station', label: 'Station' }]
const level = (v: number) => v < 2 ? 'Low' : v < 4 ? 'Medium' : v < 6 ? 'High' : v < 8 ? 'Very high' : 'Extreme'
const money = (v: number) => formatMoney(v)
const TILE = 4

function Bar({ value, max = 255, invert = false, label }: { value: number; max?: number; invert?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(100, value / max * 100))
  const good = invert ? 100 - pct : pct
  return <div className="pk-bar"><span>{label}</span><i><b style={{ width: `${pct}%`, background: good > 60 ? '#4caf62' : good > 30 ? '#e2b33d' : '#d9573f' }} /></i></div>
}

function staffActivity(staff: Staff) {
  if (staff.role === 'handyman') return `${staff.swept} swept`
  if (staff.role === 'mechanic') return `${staff.fixed} fixed${staff.target ? ' · on a job' : ''}`
  if (staff.role === 'entertainer') return 'Entertaining'
  if (staff.role === 'security') return 'Patrolling'
  if (staff.role === 'supervisor') return 'Supervising'
  return 'On call'
}

const QUALITY_LABEL: Record<ParkQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' }

function Window({ title, onClose, children, wide, extraWide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; extraWide?: boolean }) {
  return <section className={`pk-window ${wide ? 'pk-window-wide' : ''} ${extraWide ? 'pk-window-xwide' : ''}`} aria-label={title}><header><strong>{title}</strong><button aria-label="Close" onClick={onClose}><X size={16} /></button></header><div className="pk-window-body">{children}</div></section>
}

export function ParkHud({ session, onQuit, signedIn: accountSignedIn, onScore, backend }: { session: ParkSession; onQuit: () => void; signedIn: boolean; onScore?: () => void; backend?: BackendFactory }) {
  const viewOnly = session instanceof ViewSession
  const signedIn = accountSignedIn && !viewOnly
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<ParkRenderer | null>(null)
  const [, setVersion] = useState(0)
  const [glError, setGlError] = useState('')
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [panel, setPanel] = useState<Panel>(null)
  const [rideTab, setRideTab] = useState<RideTab>('All')
  const [selection, setSelection] = useState<Selection>(null)
  const [builder, setBuilder] = useState<{ ride: number; c: number; s: number; sp: string } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null)
  const [grid, setGrid] = useState(false)
  const [quality, setQuality] = useState<{ tier: ParkQuality; auto: boolean }>({ tier: 'medium', auto: true })
  const [pathColor, setPathColor] = useState('#cdbb93')
  const [pathBuild, setPathBuild] = useState<PathBuild | null>(null)
  const [pathHoverSegment, setPathHoverSegment] = useState<PathSegment | null>(null)
  const [pathBusy, setPathBusy] = useState(false)
  const [rideCam, setRideCam] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [chatText, setChatText] = useState('')
  const [saves, setSaves] = useState<SaveSummary[] | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [lastSaved, setLastSaved] = useState<number | null>(null)
  const [newsSeen, setNewsSeen] = useState(0)
  const [nameDraft, setNameDraft] = useState('')
  const [naming, setNaming] = useState(false)
  const toolRef = useRef(tool)
  toolRef.current = tool
  const drag = useRef<{ button: number; x: number; y: number; moved: boolean; start?: { x: number; y: number }; cam?: { tx: number; ty: number; yaw: number; pitch: number }; anchor?: { x: number; y: number; z: number }; pointers: Map<number, { x: number; y: number }>; pinch?: number; erase?: boolean } >({ button: -1, x: 0, y: 0, moved: false, pointers: new Map() })
  const keys = useRef(new Set<string>())
  const toastId = useRef(1)

  const state = session.state
  const park = state.parks[session.park]
  const rideScale = rideCostScale(state)
  const ownedLand = ownedTileCount(state, session.park)
  const maxLand = park.land ? (park.land.limit.x1 - park.land.limit.x0 + 1) * (park.land.limit.y1 - park.land.limit.y0 + 1) : 0

  const [pendingLand, setPendingLand] = useState<{ area: LandArea; count: number; cost: number } | null>(null)
  const [landQuote, setLandQuote] = useState<{ count: number; cost: number } | null>(null)
  const [buyingLand, setBuyingLand] = useState(false)
  const [hotelQuote, setHotelQuote] = useState<{ w: number; h: number; rooms: number; cost: number; bonus: number; fits: boolean } | null>(null)
  const [flatQuote, setFlatQuote] = useState<{ w: number; h: number; cost: number; capacity: number } | null>(null)

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
    try { renderer = new ParkRenderer(canvas, backend) } catch (error) { setGlError((error as Error).message); return }
    rendererRef.current = renderer
    setQuality({ tier: renderer.quality, auto: renderer.qualityReason !== '?quality=' })
    if (import.meta.env.DEV) (window as unknown as { __park?: unknown }).__park = { session, renderer }
    renderer.setState(session.state, session.park)
    renderer.focusPark()
    const shotName = new URLSearchParams(window.location.search).get('shotCam')
    if (shotName) { const cam = shotName === 'overview' ? renderer.overviewCam() : shotCamera(session.state, shotName); if (cam) Object.assign(renderer.cam, cam) }
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
      if (k.has('w')) { cam.tx += fx * speed; cam.ty += fy * speed }
      if (k.has('s')) { cam.tx -= fx * speed; cam.ty -= fy * speed }
      if (k.has('a')) { cam.tx -= rx * speed; cam.ty -= ry * speed }
      if (k.has('d')) { cam.tx += rx * speed; cam.ty += ry * speed }
      if (k.has('arrowleft') || k.has('q')) cam.yaw -= dt * 1.4
      if (k.has('arrowright') || k.has('e')) cam.yaw += dt * 1.4
      if (k.has('arrowup')) cam.pitch = Math.min(1.45, cam.pitch + dt * 0.9)
      if (k.has('arrowdown')) cam.pitch = Math.max(0.18, cam.pitch - dt * 0.9)
      const s = session.state
      cam.tx = Math.max(0, Math.min(s.map.w * TILE, cam.tx)); cam.ty = Math.max(0, Math.min(s.map.h * TILE, cam.ty))
      cam.tz += (groundHeightAt(s.map, cam.tx, cam.ty, TILE) - cam.tz) * Math.min(1, dt * 4)
      renderer.setState(s, session.park)
      renderer.frame(now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); observer.disconnect(); renderer.dispose(); rendererRef.current = null }
  }, [session, backend])

  useEffect(() => { const r = rendererRef.current; if (r) { r.showGrid = grid || !['select', 'flat', 'stall', 'scenery'].includes(tool.kind) } }, [grid, tool])
  useEffect(() => { const r = rendererRef.current; if (r) r.rideCam = rideCam }, [rideCam])
  const cycleQuality = () => {
    const r = rendererRef.current
    if (!r) return
    const next = QUALITY_TIERS[(QUALITY_TIERS.indexOf(r.quality) + 1) % QUALITY_TIERS.length]
    r.setQuality(next)
    setQuality({ tier: next, auto: false })
  }
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

  async function confirmLand() {
    if (!pendingLand) return
    setBuyingLand(true)
    const { area } = pendingLand
    const res = await run({ t: 'buyLandArea', x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y1 })
    setBuyingLand(false)
    setPendingLand(null)
    if (res.ok) toast(`Bought ${(res.count ?? 0).toLocaleString()} squares for ${money(res.cost ?? 0)}.`)
  }

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
    r.preview.piece = builderRide && builderPiece && !builderRide.complete ? { ride: builderRide, piece: builderCheck?.piece ?? builderPiece, ok: Boolean(builderCheck?.ok) } : undefined
  })

  function placementOk(t: Tool, x: number, y: number) {
    const map = state.map
    const free = (tx: number, ty: number) => { if (!inMap(map, tx, ty)) return false; const i = tileIndex(map, tx, ty); return map.owner[i] === session.park && !map.obj[i] && !map.path[i] && !(map.water[i] >= 0 && map.water[i] > tileMin(map, tx, ty)) }
    if (t.kind === 'flat') return footprintTiles({ id: 0, type: 'ride', kind: 'flat', ride: t.ride, x, y, rot: t.rot, park: 0, ...(t.area ? { size: t.area } : {}) } as Entity).every(([tx, ty]) => free(tx, ty))
    if (t.kind === 'stall') {
      const def = STALLS[t.stall]
      const shop = { id: 0, type: 'stall', kind: t.stall, size: def.size ?? [1, 1], x, y, rot: t.rot, park: session.park } as Entity
      if (stallFootprintError(state, session.park, shop, t.rot)) return false
      const front = stallFrontTile(shop)
      return inMap(map, front.x, front.y) && isWalkPath(map.path[tileIndex(map, front.x, front.y)])
    }
    if (t.kind === 'scenery') return free(x, y)
    if (t.kind === 'gate') return inMap(map, x, y) && !map.obj[tileIndex(map, x, y)] && !map.path[tileIndex(map, x, y)]
    return true
  }

  // Plans the piece a click on tile (x, y) would build: the next piece when it
  // is next to the builder's end, otherwise the start of a new run.
  function pathPlanAt(t: Extract<Tool, { kind: 'pathBuilder' }>, x: number, y: number, from: PathBuild | null = pathBuild): { plan: PathPlan | null; start?: PathEnd } {
    const map = state.map
    if (!inMap(map, x, y)) return { plan: null }
    if (from && Math.abs(x - from.x) + Math.abs(y - from.y) === 1) {
      const d = DIRS.findIndex(([dx, dy]) => dx === x - from.x && dy === y - from.y)
      const turn = d === from.dir ? 0 : d === (from.dir + 3) % 4 ? 1 : d === (from.dir + 1) % 4 ? -1 : null
      if (turn === null) return { plan: { ok: false, x, y, dir: d, error: 'The path cannot double back on itself.' } }
      return { plan: planPiece(map, session.park, from, t.segment, turn, t.path) }
    }
    const i = tileIndex(map, x, y)
    if (map.path[i]) {
      if (map.owner[i] !== session.park) return { plan: { ok: false, x, y, dir: 0, error: 'That path belongs to another park.' } }
      const end = anchorEnd(map, x, y, pathHeading(map, x, y))
      return { plan: { ok: true, anchor: true, x, y, dir: end.dir, end }, start: end }
    }
    const start = startEnd(map, x, y)
    return { plan: planPiece(map, session.park, start, 'level', 0, t.path), start }
  }

  function updatePreview(clientX: number, clientY: number) {
    const r = rendererRef.current
    if (!r) return
    const hit = r.pickTile(clientX, clientY)
    setHover(hit ? { x: hit.x, y: hit.y } : null)
    const t = toolRef.current
    const p: Preview = { selected: r.preview.selected, piece: r.preview.piece, pathGhost: r.preview.pathGhost }
    if (hit) {
      const d = drag.current
      const brush = 'size' in t ? t.size : 1
      if (['terrain', 'water', 'surface', 'path', 'pathBuilder', 'pathPaint', 'unpath', 'clear', 'pathAdd', 'demolish', 'buyLand'].includes(t.kind)) {
        if (t.kind === 'pathBuilder' && d.button === 0 && d.start && (d.start.x !== hit.x || d.start.y !== hit.y)) {
          // Quick draw: dragging with the path tool lays a straight run on the ground.
          const dx = Math.abs(hit.x - d.start.x), dy = Math.abs(hit.y - d.start.y)
          p.rect = dx >= dy ? { x0: d.start.x, y0: d.start.y, x1: hit.x, y1: d.start.y, elevation: 0, ok: true } : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: hit.y, elevation: 0, ok: true }
        } else if (t.kind === 'pathBuilder') {
          const { plan } = pathPlanAt(t, hit.x, hit.y)
          const ahead = pathBuild && plan && plan.x === hit.x && plan.y === hit.y && Math.abs(hit.x - pathBuild.x) + Math.abs(hit.y - pathBuild.y) === 1
          if (!ahead) p.rect = { x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y, elevation: plan?.ok && !plan.anchor ? plan.elevation : 0, ok: Boolean(plan?.ok) }
        } else if (d.button === 0 && d.start && t.kind !== 'pathAdd' && t.kind !== 'demolish') {
          if (t.kind === 'path') {
            const dx = Math.abs(hit.x - d.start.x), dy = Math.abs(hit.y - d.start.y)
            p.rect = dx >= dy ? { x0: d.start.x, y0: d.start.y, x1: hit.x, y1: d.start.y, ok: true } : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: hit.y, ok: true }
          } else p.rect = { x0: d.start.x, y0: d.start.y, x1: hit.x, y1: hit.y, ok: true }
        } else {
          const half = Math.floor((brush - 1) / 2)
          p.rect = { x0: hit.x - half, y0: hit.y - half, x1: hit.x - half + brush - 1, y1: hit.y - half + brush - 1, ok: t.kind !== 'demolish' }
        }
      }
      if (t.kind === 'hotel') {
        const area = hotelArea(t.hotel, d.button === 0 && d.start ? d.start : null, hit)
        const def = HOTELS[t.hotel], [w, h] = area.size
        const fits = hotelOrientedFits(def, w, h)
        const free = footprintTiles({ id: 0, type: 'hotel', x: area.x, y: area.y, size: area.size, park: 0 } as Entity).every(([tx, ty]) => { if (!inMap(state.map, tx, ty)) return false; const i = tileIndex(state.map, tx, ty); return state.map.owner[i] === session.park && !state.map.obj[i] && !state.map.path[i] && !(state.map.water[i] >= 0 && state.map.water[i] > tileMin(state.map, tx, ty)) })
        const door = hotelEntranceFor(state, session.park, area.x, area.y, w, h)
        p.ghost = { type: 'hotel', kind: t.hotel, x: area.x, y: area.y, rot: 0, size: area.size, floors: t.floors, ok: fits && free && Boolean(door) }
        const spec = hotelSpec(t.hotel, area.size, t.floors)!
        setHotelQuote(prev => prev && prev.w === w && prev.h === h && prev.cost === spec.cost && prev.fits === fits ? prev : { w, h, rooms: spec.rooms, cost: spec.cost, bonus: spec.guestBonus, fits })
      }
      if (t.kind === 'flat' && FLAT_RIDES[t.ride].resize) {
        const area = resizableArea(t.ride, d.button === 0 && d.start ? d.start : null, hit)
        const sized = { ...t, rot: 0, area: area.size }
        p.ghost = { type: 'flat', kind: t.ride, x: area.x, y: area.y, rot: 0, size: area.size, wave: FLAT_RIDES[t.ride].waves, ok: placementOk(sized, area.x, area.y) }
        const spec = flatSpec(t.ride, area.size, FLAT_RIDES[t.ride].waves)
        if (spec) setFlatQuote(prev => prev && prev.w === area.size[0] && prev.h === area.size[1] ? prev : { w: area.size[0], h: area.size[1], cost: spec.cost * rideCostScale(session.state), capacity: spec.capacity })
      } else if (t.kind === 'flat') { const def = FLAT_RIDES[t.ride]; const w = t.rot % 2 ? def.size[1] : def.size[0], h = t.rot % 2 ? def.size[0] : def.size[1]; const x = hit.x - Math.floor((w - 1) / 2), y = hit.y - Math.floor((h - 1) / 2); p.ghost = { type: 'flat', kind: t.ride, x, y, rot: t.rot, ok: placementOk(t, x, y) } }
      if (t.kind === 'stall') {
        const [baseW, baseH] = STALLS[t.stall].size ?? [1, 1]
        const w = t.rot % 2 ? baseH : baseW, h = t.rot % 2 ? baseW : baseH
        const x = hit.x - Math.floor((w - 1) / 2), y = hit.y - Math.floor((h - 1) / 2)
        const shop = { id: 0, type: 'stall', kind: t.stall, size: [baseW, baseH], x, y, rot: t.rot, park: session.park } as Entity
        const rot = stallPlacementRotation(state, session.park, shop, t.rot)
        const actualRot = rot ?? t.rot
        p.ghost = { type: 'stall', kind: t.stall, x, y, rot: actualRot, ok: rot !== null && placementOk({ ...t, rot: actualRot }, x, y) }
      }
      if (t.kind === 'scenery') p.ghost = { type: 'scenery', kind: t.scenery, x: hit.x, y: hit.y, rot: t.rot, ok: placementOk(t, hit.x, hit.y) }
      if (t.kind === 'gate') {
        const ride = state.entities[t.ride]
        let dir = 0
        if (ride) { const fx = hit.fx, fy = hit.fy; const cx = ride.x + (ride.kind === 'flat' ? 1 : 0), cy = ride.y; dir = Math.abs(fx - cx - 0.5) > Math.abs(fy - cy - 0.5) ? (fx > cx ? 0 : 2) : (fy > cy ? 1 : 3) }
        p.ghost = { type: 'gate', kind: 'gate', x: hit.x, y: hit.y, rot: dir, ok: placementOk(t, hit.x, hit.y), role: t.role }
      }
      if (t.kind === 'coaster') {
        const wide = Boolean(COASTER_STYLES[t.style]?.wide), [dx, dy] = DIRS[t.dir], [sx, sy] = DIRS[(t.dir + 1) % 4]
        const free = (tx: number, ty: number) => inMap(state.map, tx, ty) && state.map.owner[tileIndex(state.map, tx, ty)] === session.park && !state.map.obj[tileIndex(state.map, tx, ty)] && !state.map.path[tileIndex(state.map, tx, ty)]
        p.station = { x: hit.x, y: hit.y, dir: t.dir, length: t.length, wide, ok: [...Array(t.length)].every((_, k) => free(hit.x + dx * k, hit.y + dy * k) && (!wide || free(hit.x + dx * k + sx, hit.y + dy * k + sy))) }
      }
    }
    if (p.rect && t.kind === 'path') p.rect.elevation = t.elevation
    if (p.rect && t.kind === 'buyLand') {
      const area = clampLandArea(p.rect)
      const plan = landAreaPlan(state, session.park, area)
      p.rect = { ...area, ok: plan.tiles.length > 0 }
      setLandQuote(prev => !plan.tiles.length ? null : prev && prev.count === plan.tiles.length ? prev : { count: plan.tiles.length, cost: plan.cost })
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
      case 'buyLand': {
        const area = clampLandArea(rect ?? { x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y })
        if (area.x0 === area.x1 && area.y0 === area.y1) { await run({ t: 'buyLand', x: hit.x, y: hit.y }, `Land purchased for ${money(LAND_SQUARE_COST)}.`); break }
        const plan = landAreaPlan(state, session.park, area)
        if (plan.error) { toast(plan.error, 'error'); break }
        setPendingLand({ area, count: plan.tiles.length, cost: plan.cost })
        break
      }
      case 'terrain': if (rect) await run({ t: 'terrain', op: t.op, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, sx: d.start?.x ?? hit.x, sy: d.start?.y ?? hit.y }); break
      case 'water': if (rect) await run({ t: 'water', op: t.op, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'surface': if (rect) await run({ t: 'surface', surface: t.surface, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'path': if (rect) await run({ t: 'path', kind: t.path, elevation: t.elevation, color: Number.parseInt(pathColor.slice(1), 16), x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'pathBuilder': {
        if (rect && (rect.x0 !== rect.x1 || rect.y0 !== rect.y1)) {
          const res = await run({ t: 'path', kind: t.path, elevation: 0, color: Number.parseInt(pathColor.slice(1), 16), x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 })
          if (res.ok) { setPathBuild(null); if (res.warning) toast(res.warning, 'warn') }
          break
        }
        await placePathAt(t, hit.x, hit.y)
        break
      }
      case 'pathPaint': if (rect) await run({ t: 'pathPaint', color: Number.parseInt(pathColor.slice(1), 16), x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'unpath': if (rect) await run({ t: 'unpath', x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'clear': if (rect) await run({ t: 'clear', x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); break
      case 'pathAdd': await run({ t: 'pathAdd', x: hit.x, y: hit.y, add: t.add }); break
      case 'scenery': await run({ t: 'scenery', kind: t.scenery, x: hit.x, y: hit.y, rot: t.rot }); break
      case 'stall': { const ghost = r.preview.ghost; if (!ghost) break; const res = await run({ t: 'stall', kind: t.stall, x: ghost.x, y: ghost.y, rot: ghost.rot }); if (res.ok && res.id) { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: res.id }) } break }
      case 'hotel': {
        const g = r.preview.ghost
        if (!g?.size) break
        const res = await run({ t: 'hotel', kind: t.hotel, x: g.x, y: g.y, w: g.size[0], h: g.size[1], floors: t.floors })
        if (res.ok && res.id) { setTool({ kind: 'select' }); setSelection({ kind: 'entity', id: res.id }); toast(`${HOTELS[t.hotel].name} built for ${money(res.cost ?? 0)}. Pick its colors and add-ons.`) }
        break
      }
      case 'flat': {
        const g = r.preview.ghost
        if (!g) break
        const res = await run(g.size ? { t: 'flat', ride: t.ride, x: g.x, y: g.y, rot: 0, w: g.size[0], h: g.size[1] } : { t: 'flat', ride: t.ride, x: g.x, y: g.y, rot: t.rot })
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
    d.erase = Boolean(e.button === 2 && hit && !viewOnly && state.map.path[tileIndex(state.map, hit.x, hit.y)])
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
    const panning = d.button === 1 || (d.button === 0 && (t.kind === 'select' || t.kind === 'demolish' || e.pointerType === 'touch' && !['terrain', 'water', 'surface', 'path', 'pathBuilder', 'pathPaint', 'unpath', 'clear', 'buyLand', 'hotel'].includes(t.kind) && !(t.kind === 'flat' && FLAT_RIDES[t.ride].resize)))
    if (d.cam && d.moved && panning) {
      const a = d.anchor
      const p = a ? r.rayPlane(e.clientX, e.clientY, a.z) : null
      if (a && p && Math.hypot(a.x - p.x, a.y - p.y) < r.cam.dist * 3) { r.cam.tx += a.x - p.x; r.cam.ty += a.y - p.y }
      return
    }
    if (d.erase && d.button === 2 && d.start) {
      const over = r.pickTile(e.clientX, e.clientY)
      if (over) {
        const ax = Math.abs(over.x - d.start.x), ay = Math.abs(over.y - d.start.y)
        r.preview.rect = ax >= ay ? { x0: d.start.x, y0: d.start.y, x1: over.x, y1: d.start.y, ok: true } : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: over.y, ok: true }
      }
      return
    }
    if (d.cam && d.button === 2) {
      r.cam.yaw = d.cam.yaw + dx * 0.006
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
    const areaTool = ['terrain', 'water', 'surface', 'path', 'pathBuilder', 'pathPaint', 'unpath', 'clear', 'buyLand', 'hotel'].includes(t.kind) || (t.kind === 'flat' && Boolean(FLAT_RIDES[t.ride].resize))
    if (d.button === 2 && d.erase && d.start) {
      const over = rendererRef.current?.pickTile(e.clientX, e.clientY)
      const rect = d.moved && over
        ? Math.abs(over.x - d.start.x) >= Math.abs(over.y - d.start.y) ? { x0: d.start.x, y0: d.start.y, x1: over.x, y1: d.start.y } : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: over.y }
        : { x0: d.start.x, y0: d.start.y, x1: d.start.x, y1: d.start.y }
      void run({ t: 'unpath', ...rect })
    }
    d.erase = false
    if (d.button === 0 && (!d.moved || areaTool)) void applyTool(e.clientX, e.clientY)
    d.button = -1; d.start = undefined
    updatePreview(e.clientX, e.clientY)
  }

  function rotateTool() {
    setTool(t => 'rot' in t ? { ...t, rot: (t.rot + 1) % 4 } as Tool : t.kind === 'coaster' ? { ...t, dir: (t.dir + 1) % 4 } : t)
  }

  function startPathBuilder(path: 1 | 2 | 4 = 1) {
    const current = toolRef.current
    if (current.kind !== 'pathBuilder') setPathBuild(null)
    setTool({ kind: 'pathBuilder', path, segment: current.kind === 'pathBuilder' ? current.segment : 'level', turn: current.kind === 'pathBuilder' ? current.turn : 0 })
  }

  function closePathBuilder() {
    setPathBuild(null)
    setPathHoverSegment(null)
    setTool({ kind: 'select' })
    if (rendererRef.current) rendererRef.current.preview = {}
  }

  async function commitPlan(plan: PathPlan, from: PathBuild | null) {
    if (!plan.ok) { toast(plan.error, 'error'); return false }
    const trail = from ? [...from.trail, { x: from.x, y: from.y, dir: from.dir, exit: from.exit, slope: from.slope, placed: from.placed }].slice(-200) : []
    if (plan.anchor) {
      setPathBuild({ ...plan.end, trail: from ? trail : [] })
      if (!from) toast(`Building on from the path at ${plan.x + 1}, ${plan.y + 1}.`)
      return true
    }
    const result = await run({ t: 'path', kind: plan.kind, elevation: plan.elevation, color: Number.parseInt(pathColor.slice(1), 16), x0: plan.x, y0: plan.y, x1: plan.x, y1: plan.y })
    if (!result.ok) return false
    setPathBuild({ ...plan.end, trail })
    return true
  }

  async function placePathAt(t: Extract<Tool, { kind: 'pathBuilder' }>, x: number, y: number) {
    if (pathBusy) return
    setPathBusy(true)
    try {
      const { plan, start } = pathPlanAt(t, x, y)
      if (!plan) return
      const from = start ? null : pathBuild
      const ok = await commitPlan(plan, from)
      if (ok && from && plan.dir !== from.dir) setTool({ ...t, turn: 0 })
    } finally { setPathBusy(false) }
  }

  async function buildNextPath(next?: { segment?: PathSegment; turn?: -1 | 0 | 1 }) {
    const current = toolRef.current
    if (current.kind !== 'pathBuilder' || !pathBuild || pathBusy) return
    const t = { ...current, ...next }
    setPathBusy(true)
    try {
      const plan = planPiece(state.map, session.park, pathBuild, t.segment, t.turn, t.path)
      const ok = await commitPlan(plan, pathBuild)
      if (ok && t.turn !== 0) setTool({ ...t, turn: 0 })
      else if (t !== current) setTool(t)
    } finally { setPathBusy(false) }
  }

  async function removeLastPath() {
    if (!pathBuild || pathBusy) return
    if (pathBuild.placed) {
      const res = await run({ t: 'unpath', x0: pathBuild.x, y0: pathBuild.y, x1: pathBuild.x, y1: pathBuild.y })
      if (!res.ok) return
    }
    const last = pathBuild.trail[pathBuild.trail.length - 1]
    setPathBuild(last ? { ...last, trail: pathBuild.trail.slice(0, -1) } : null)
  }

  async function finishPath() {
    const t = toolRef.current
    if (t.kind !== 'pathBuilder' || !pathBuild) return
    setFinishing(true)
    try {
      const res = await run({ t: 'pathFinish', x: pathBuild.x, y: pathBuild.y, dir: (pathBuild.dir - t.turn + 4) % 4, exit: pathBuild.exit, sloped: pathBuild.slope !== 0, kind: t.path, color: Number.parseInt(pathColor.slice(1), 16) })
      if (res.ok) { toast(`Path finished down to the ground with ${res.pieces ?? 0} new sections for ${money(res.cost ?? 0)}.`); setPathBuild(null) }
    } finally { setFinishing(false) }
  }

  function choosePathSegment(segment: PathSegment) {
    const t = toolRef.current
    if (t.kind !== 'pathBuilder') return
    if (pathBuild) { void buildNextPath({ segment }); return }
    setTool({ ...t, segment })
  }

  function choosePathTurn(turn: -1 | 0 | 1) {
    const t = toolRef.current
    if (t.kind !== 'pathBuilder') return
    setTool({ ...t, turn })
  }

  const pathNextPlan = tool.kind === 'pathBuilder' && pathBuild && !viewOnly
    ? planPiece(state.map, session.park, pathBuild, pathHoverSegment ?? tool.segment, tool.turn, tool.path)
    : null

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    const ghost = pathNextPlan && !(pathNextPlan.ok && pathNextPlan.anchor) ? pathNextPlan.ghost : undefined
    r.preview.pathGhost = ghost && pathNextPlan ? { pieces: [ghost], ok: pathNextPlan.ok } : undefined
  })

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { keys.current.add(key); e.preventDefault() }
      if (key === 'escape') { if (toolRef.current.kind === 'select') { setSelection(null); setPanel(null); setBuilder(null) } setTool({ kind: 'select' }); setPathBuild(null); setRideCam(null); if (rendererRef.current) rendererRef.current.preview = {} }
      if (key === 'r') rotateTool()
      if (key === 'g') setGrid(v => !v)
      if (key === ' ' && !viewOnly) { e.preventDefault(); void session.command({ t: 'speed', speed: session.state.speed ? 0 : 1 }) }
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
      setBuilder(b => b && { ...b, sp: b.sp === 'loop' || b.sp === 'corkscrew' || b.sp === 'brakes' || b.sp === 'booster' ? '' : b.sp, c: builderPiece.c && (b.sp === 'loop' || b.sp === 'corkscrew') ? 0 : b.c })
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

  async function writeSave(): Promise<string | null> {
    const data = await compressSave(await session.exportSave())
    const s = session.state, p = s.parks[session.park]
    const value = companyValue(s, session.park)
    await parkApi.save(p.parkId, p.name.slice(0, 40), data, { cash: Math.round(p.cash), netWorth: Math.round(p.cash - p.loan), companyValue: value, guests: p.guestsIn, rating: p.rating, date: `${MONTHS[s.time.month]}, year ${s.time.year}`, mode: s.mode }, s.scenario)
    setLastSaved(Date.now())
    return submitScore(value, data)
  }

  async function submitScore(value: number, data?: string): Promise<string | null> {
    const s = session.state, p = s.parks[session.park]
    if (!signedIn || s.mode !== 'solo' || s.scenario === 'sandbox' || SCENARIOS[s.scenario]?.versus) return null
    try {
      await parkApi.submitScore(p.parkId, s.scenario, p.name, value, data)
    } catch (error) {
      return `leaderboard update failed: ${(error as Error).message}`
    }
    onScore?.()
    try {
      const shot = rendererRef.current?.captureOverview()
      if (shot) { await parkApi.submitShot(p.parkId, s.scenario, shot.mime, shot.data); onScore?.() }
    } catch (error) {
      console.error('Unable to store the park screenshot.', error)
    }
    return null
  }

  const autosaving = useRef<Promise<void> | null>(null)
  const autosave = useCallback(async (quiet = false) => {
    if (!signedIn) return
    if (autosaving.current) return autosaving.current
    const pending = (async () => {
      try {
        const scoreError = await writeSave()
        if (scoreError) toast(`Autosaved, but the ${scoreError}.`, 'warn')
        else if (!quiet) toast('Park saved.')
      } catch (error) { toast(`Autosave failed: ${(error as Error).message}`, 'warn') }
    })()
    autosaving.current = pending
    try { await pending } finally { if (autosaving.current === pending) autosaving.current = null }
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
  const brokenRides = myRides.filter((ride): ride is Entity => ride.type === 'ride' && ride.status === 'broken')
  const mechanicJobs = staffMember?.role === 'mechanic'
    ? brokenRides.filter(ride => (!ride.mechanic || ride.mechanic === staffMember.id) && mechanicJobDistance(state, staffMember, ride) >= 0)
    : []
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
    <canvas ref={canvasRef} className={`pk-canvas pk-tool-${tool.kind}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setHover(null)} aria-label="Park view. Drag to move the camera, right-drag or use the arrow keys to rotate, scroll to zoom." tabIndex={0} />

    <header className="pk-topbar">
      <div className="pk-stat pk-park-name" style={{ borderColor: park.color }}><strong>{park.name}</strong><small>{state.mode === 'versus' ? 'Versus' : state.mode === 'coop' ? 'Co-op' : SCENARIOS[state.scenario]?.name}{state.realism ? ' · Realism' : ''}</small></div>
      <div className={`pk-stat ${park.cash < 0 ? 'pk-neg' : ''}`}><small>Cash</small><strong>{money(park.cash)}</strong></div>
      <div className="pk-stat"><small>Guests</small><strong>{park.guestsIn}</strong></div>
      <div className="pk-stat pk-rating"><small>Rating</small><strong>{park.rating}</strong><i><b style={{ width: `${park.rating / 10}%` }} /></i></div>
      <div className="pk-stat"><small>{weatherIcon} {state.weather.temp}°C</small><strong>{MONTHS[state.time.month]} {state.time.day + 1}, Y{state.time.year}</strong></div>
      {!viewOnly && <div className="pk-speed" role="group" aria-label="Simulation speed">
        {[0, 1, 2, 4].map(sp => <button key={sp} className={state.speed === sp ? 'on' : ''} disabled={session.online && state.mode === 'versus' && !session.isHost} onClick={() => void session.command({ t: 'speed', speed: sp })} aria-label={sp ? `Speed ${sp}x` : 'Pause'} title={sp ? `${sp}x speed` : 'Pause (Space)'}>{sp === 0 ? <Pause size={14} /> : sp === 1 ? <Play size={14} /> : <><FastForward size={14} /><span>{sp}</span></>}</button>)}
      </div>}
      <div className="pk-top-actions">
        <button onClick={() => setGrid(v => !v)} className={grid ? 'on' : ''} title="Grid (G)" aria-label="Toggle grid"><Grid3x3 size={16} /></button>
        <button onClick={cycleQuality} title={`Graphics quality: ${QUALITY_LABEL[quality.tier]}${quality.auto ? ' (picked for this device)' : ''}. Click to change.`} aria-label={`Graphics quality ${QUALITY_LABEL[quality.tier]}, change`}><Gauge size={16} /><span>{QUALITY_LABEL[quality.tier]}</span></button>
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
      <button className={panel === 'paths' ? 'on' : ''} onClick={() => { togglePanel('paths'); startPathBuilder() }}><Footprints size={19} /><span>Paths</span></button>
      <button className={panel === 'rides' ? 'on' : ''} onClick={() => togglePanel('rides')}><Sparkles size={19} /><span>Rides</span></button>
      <button className={panel === 'coasters' ? 'on' : ''} onClick={() => togglePanel('coasters')}><Zap size={19} /><span>Coasters</span></button>
      <button className={panel === 'shops' ? 'on' : ''} onClick={() => togglePanel('shops')}><Store size={19} /><span>Shops</span></button>
      <button className={panel === 'resorts' ? 'on' : ''} onClick={() => togglePanel('resorts')}><Hotel size={19} /><span>Resorts</span></button>
      <button className={panel === 'scenery' ? 'on' : ''} onClick={() => togglePanel('scenery')}><Trees size={19} /><span>Scenery</span></button>
      <button className={panel === 'staff' ? 'on' : ''} onClick={() => togglePanel('staff')}><Users size={19} /><span>Staff</span></button>
      <button className={panel === 'park' ? 'on' : ''} onClick={() => togglePanel('park')}><Landmark size={19} /><span>Park</span></button>
      <button className={panel === 'finance' ? 'on' : ''} onClick={() => togglePanel('finance')}><Gauge size={19} /><span>Money</span></button>
      <button className={tool.kind === 'demolish' ? 'on pk-danger' : 'pk-danger'} onClick={() => { choose({ kind: 'demolish' }); setPanel(null) }}><Trash2 size={19} /><span>Demolish</span></button>
    </nav>}

    {panel === 'terrain' && <Window title="Landscaping" onClose={() => togglePanel('terrain')}>
      {park.land && <div className="pk-land-buy">
        <p className="pk-label">Purchase land</p>
        <p className="pk-hint">{ownedLand.toLocaleString()} of {maxLand.toLocaleString()} squares owned. Expansion land is tinted light red.</p>
        {!viewOnly && <><button className={`pk-btn ${tool.kind === 'buyLand' ? 'on' : ''}`} onClick={() => { setPendingLand(null); setTool({ kind: 'buyLand' }) }}>Buy land · {money(LAND_SQUARE_COST)} a square</button><p className="pk-hint">Click a red square next to your park, or drag over up to {LAND_AREA_MAX} by {LAND_AREA_MAX} squares to buy an area. You see the total before you confirm.</p></>}
      </div>}
      <div className="pk-chips">
        {(['raise', 'lower', 'level'] as const).map(op => <button key={op} className={tool.kind === 'terrain' && tool.op === op ? 'on' : ''} onClick={() => setTool({ kind: 'terrain', op, size: brushSize })}>{op === 'raise' ? 'Raise land' : op === 'lower' ? 'Lower land' : 'Level land'}</button>)}
        {(['raise', 'lower'] as const).map(op => <button key={`w${op}`} className={tool.kind === 'water' && tool.op === op ? 'on' : ''} onClick={() => setTool({ kind: 'water', op, size: brushSize })}><Droplets size={13} /> {op === 'raise' ? 'Add water' : 'Drain water'}</button>)}
      </div>
      <p className="pk-label">Ground texture</p>
      <div className="pk-chips">{SURFACE_NAMES.map((n, i) => <button key={n} className={tool.kind === 'surface' && tool.surface === i ? 'on' : ''} onClick={() => setTool({ kind: 'surface', surface: i, size: brushSize })}><Paintbrush size={13} /> {n}</button>)}</div>
      <div className="pk-size"><span>Brush</span><button onClick={() => setSize(brushSize - 1)} aria-label="Smaller brush"><Minus size={14} /></button><strong>{brushSize}×{brushSize}</strong><button onClick={() => setSize(brushSize + 1)} aria-label="Larger brush"><Plus size={14} /></button></div>
      <p className="pk-hint">Click to apply the brush, or drag to cover an area. Land costs {money(6)} per corner moved.</p>
    </Window>}

    {panel === 'paths' && <Window title="Footpaths" onClose={() => setPanel(null)}>
      <p className="pk-label">Path type</p>
      <div className="pk-chips">
        <button className={tool.kind === 'pathBuilder' && tool.path === 1 ? 'on' : ''} onClick={() => startPathBuilder(1)}>Footpath · {money(12)}</button>
        <button className={tool.kind === 'pathBuilder' && tool.path === 2 ? 'on' : ''} onClick={() => startPathBuilder(2)}>Queue line · {money(14)}</button>
        <button className={tool.kind === 'pathBuilder' && tool.path === 4 ? 'on' : ''} onClick={() => startPathBuilder(4)}>Boardwalk · {money(24)}</button>
      </div>
      <p className="pk-hint">Drag to quick-draw a straight path on the ground. Click a path, or a clear tile, to start the builder for stairs and raised walkways: each section joins the one before it.</p>
      <div className="pk-chips">
        <button className={tool.kind === 'unpath' ? 'on' : ''} onClick={() => { setPathBuild(null); setTool({ kind: 'unpath' }) }}><Eraser size={13} /> Remove</button>
      </div>
      <label className="pk-path-color"><span>Footpath color</span><input type="color" value={pathColor} onChange={event => setPathColor(event.target.value)} /></label>
      <div className="pk-chips"><button className={tool.kind === 'pathPaint' ? 'on' : ''} onClick={() => setTool({ kind: 'pathPaint' })}>Recolor existing paths</button></div>
      <p className="pk-label">Path furniture</p>
      <div className="pk-chips">{Object.entries(PATH_ADDITIONS).map(([id, a]) => <button key={id} className={tool.kind === 'pathAdd' && tool.add === Number(id) ? 'on' : ''} onClick={() => setTool({ kind: 'pathAdd', add: Number(id) })}>{a.name} · {money(a.cost)}</button>)}</div>
      <p className="pk-hint">Raised paths can cross scenery, rides, and track when there is enough clearance. Boardwalks can cross water. Queue lines connect to ride entrances and exits.</p>
    </Window>}

    {panel === 'rides' && <Window title="Build a ride" onClose={() => togglePanel('rides')} wide>
      <div className="pk-tabs" role="tablist" aria-label="Ride categories">
        {(['All', 'Gentle', 'Thrill', 'Water', 'Other'] as const).map(tab => <button key={tab} role="tab" aria-selected={rideTab === tab} className={rideTab === tab ? 'on' : ''} onClick={() => setRideTab(tab)}>{tab}</button>)}
      </div>
      <div className="pk-cards">{Object.entries(FLAT_RIDES).filter(([, ride]) => buildableRide(ride) && (rideTab === 'All' || ride.category === rideTab.toLowerCase())).map(([id, r]) => <button key={id} className={`pk-card ${tool.kind === 'flat' && tool.ride === id ? 'on' : ''}`} onClick={() => { setFlatQuote(null); setTool({ kind: 'flat', ride: id, rot: 0 }); setPanel(null) }}>
        {customRideThumb(r) && <img className="pk-card-thumb" src={customRideThumb(r)!} alt="" loading="lazy"/>}<strong>{r.name}</strong><span>{r.resize ? `from ${money((flatSpec(id, r.resize.min, r.waves)?.cost ?? r.cost) * rideScale)} · drag to size` : `${money(r.cost * rideScale)} · ${r.size[0]}×${r.size[1]}`}</span><small>{r.description}</small><em>Excitement {r.stats.e.toFixed(1)} · Intensity {r.stats.i.toFixed(1)}</em>
      </button>)}</div>
      {rideTab === 'Other' && <>
        <p className="pk-label">Custom track rides</p>
        <div className="pk-cards">{Object.entries(COASTER_STYLES).filter(([, style]) => style.category === 'other').map(([id, style]) => <button key={id} className={`pk-card ${tool.kind === 'coaster' && tool.style === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'coaster', style: id, dir: 0, length: 3 }); setPanel(null) }}>
          <strong><i className="pk-swatch" style={{ background: style.track }} />{style.name}</strong><span>{money(style.cost * rideScale)} + {money(style.pieceCost * rideScale)}/piece</span><small>{style.description}</small><em>Build each section like a coaster track.</em>
        </button>)}</div>
      </>}
      <p className="pk-hint">Choose a ride, then click the map. Press R or <button className="pk-inline" onClick={rotateTool}><RotateCw size={12} /> rotate</button>. Uneven ground is levelled automatically.</p>
    </Window>}

    {panel === 'coasters' && <Window title="Build a roller coaster" onClose={() => togglePanel('coasters')} wide>
      <div className="pk-cards">{Object.entries(COASTER_STYLES).filter(([, style]) => style.category !== 'other').map(([id, c]) => <button key={id} className={`pk-card ${tool.kind === 'coaster' && tool.style === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'coaster', style: id, dir: 0, length: 3 }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: c.track }} />{c.name}</strong><span>{money(c.cost * rideScale)} + {money(c.pieceCost * rideScale)}/piece</span><small>{c.description}</small><em>{c.loops ? 'Loops · ' : ''}{c.steep ? 'Steep drops · ' : 'Gentle slopes · '}Max {Math.round(c.maxHeight * 0.5)}m</em>
      </button>)}</div>
      <p className="pk-label">Ready-made designs</p>
      <div className="pk-cards">{Object.entries(COASTER_PRESETS).map(([id, d]) => <button key={id} className={`pk-card ${tool.kind === 'coaster' && tool.preset === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'coaster', style: d.style, dir: 0, length: d.station, preset: id }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: COASTER_STYLES[d.style].track }} />{d.name}</strong><span>{COASTER_STYLES[d.style].name}</span><small>{d.description}</small>{d.footprint && <em>{d.footprint[0]}×{d.footprint[1]} squares · {d.height} m tall · about {money((d.cost ?? 0) * rideScale)}</em>}
      </button>)}</div>
      <p className="pk-hint">Click to place the station, then build the circuit piece by piece, or press Auto-finish to close the loop. Designs are built in one go and finished to fit the ground; press R to turn them before placing.</p>
    </Window>}

    {panel === 'resorts' && <Window title="Resorts" onClose={() => togglePanel('resorts')} wide>
      <ResortCards selected={tool.kind === 'hotel' ? tool.hotel : null} onPick={kind => { setHotelQuote(null); setTool({ kind: 'hotel', hotel: kind, floors: HOTELS[kind].floors[0] }); setPanel(null) }} />
      <ResortSummary park={park} />
      <ResortPortfolio state={state} park={park} onSelect={id => { setSelection({ kind: 'entity', id }); setPanel(null) }} />
    </Window>}

    {panel === 'shops' && <Window title="Shops and stalls" onClose={() => togglePanel('shops')} wide>
      <div className="pk-cards">{Object.entries(STALLS).map(([id, s]) => <button key={id} className={`pk-card ${tool.kind === 'stall' && tool.stall === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'stall', stall: id, rot: 0 }); setPanel(null) }}>
        <strong><i className="pk-swatch" style={{ background: s.color }} />{s.name}</strong><span>{money(s.cost)}{s.size ? ` · ${s.size[0]}×${s.size[1]}` : ''}{s.price ? ` · sells for ${money(s.price)}` : ''}</span>
      </button>)}</div>
      <p className="pk-hint">The counter must face a footpath. Press R to rotate.</p>
    </Window>}

    {panel === 'scenery' && <Window title="Scenery" onClose={() => togglePanel('scenery')} wide>
      <div className="pk-cards pk-cards-small">{Object.entries(SCENERY).map(([id, s]) => <button key={id} className={`pk-card ${tool.kind === 'scenery' && tool.scenery === id ? 'on' : ''}`} onClick={() => { setTool({ kind: 'scenery', scenery: id, rot: 0 }); setPanel(null) }}><strong>{s.name}</strong><span>{money(s.cost)}</span></button>)}
        <button className={`pk-card ${tool.kind === 'clear' ? 'on' : ''}`} onClick={() => { setTool({ kind: 'clear' }); setPanel(null) }}><strong><Eraser size={13} /> Clear scenery</strong><span>Drag over an area</span></button></div>
      <p className="pk-hint">Guests are happier near trees, flowers, fountains and water.</p>
    </Window>}

    {panel === 'staff' && <Window title="Staff" onClose={() => togglePanel('staff')}>
      <div className="pk-chips">{Object.entries(STAFF).map(([id, s]) => <button key={id} onClick={() => void run({ t: 'hire', role: id }, `${s.name} hired.`)}><Plus size={13} /> Hire {s.name} · {money(s.wage)}/day</button>)}</div>
      <p className="pk-hint">Hire handymen, mechanics, entertainers, security, supervisors, or EMS workers. All staff are paid $100 per day.</p>
      <ul className="pk-list">{state.staff.filter(s => s.park === session.park).map(s => <li key={s.id}><button onClick={() => { setSelection({ kind: 'staff', id: s.id }); focusOn(s.x, s.y) }}><i className="pk-swatch" style={{ background: STAFF[s.role].color }} />{s.name}</button><small>{staffActivity(s)}</small></li>)}</ul>
    </Window>}

    {panel === 'park' && <Window title={park.name} onClose={() => togglePanel('park')} wide extraWide>
      <div className="pk-grid3">
        <div>
          <p className="pk-label">Objective</p>
          <p className={`pk-objective pk-${park.status}`}>{objectiveText(park.objective)}{park.status === 'won' ? ' ✔ Complete!' : park.status === 'lost' ? ' ✘ Failed.' : ''}</p>
          <Bar label={`Guest happiness ${park.happiness ?? 0}%`} value={park.happiness ?? 0} max={100} />
          <Bar label={`Park rating ${park.rating}`} value={park.rating} max={999} />
          <GuestCapacity park={park} />
          <dl className="pk-dl"><dt>Guests in park</dt><dd>{park.guestsIn}</dd><dt>Total visitors</dt><dd>{park.totalGuests}</dd><dt>Park value</dt><dd>{money(park.value)}</dd><dt>Company value</dt><dd>{money(companyValue(state, session.park))}</dd><dt>Litter</dt><dd>{park.litter ?? 0}</dd></dl>
          <div className="pk-row"><span>Entry fee</span><button onClick={() => void run({ t: 'park', entryFee: Math.max(0, park.entryFee - 1) })}><Minus size={13} /></button><strong>{money(park.entryFee)}</strong><button onClick={() => void run({ t: 'park', entryFee: Math.min(100, park.entryFee + 1) })}><Plus size={13} /></button></div>
          <button className={`pk-btn ${park.open ? '' : 'pk-btn-go'}`} onClick={() => void run({ t: 'park', open: !park.open })}>{park.open ? 'Close park to new guests' : 'Open park'}</button>
        </div>
        <div>
          <p className="pk-label">What guests are thinking</p>
          {park.thoughts.length ? <ul className="pk-thoughts">{park.thoughts.map(([t, n]) => <li key={t}><span>{t}</span><b>{n}</b></li>)}</ul> : <p className="pk-hint">No strong opinions yet.</p>}
          <p className="pk-label">Marketing</p>
          <div className="pk-chips">{Object.entries(MARKETING).map(([id, m]) => { const live = park.marketing.find(c => c.kind === id); return <button key={id} disabled={Boolean(live)} onClick={() => void run({ t: 'market', kind: id })}>{m.name} · {money(m.cost)}{live ? ` · ${Math.ceil((live.until - state.time.seconds) / 40)}d left` : ''}</button> })}</div>
        </div>
        <div>
          <p className="pk-label">Color schemes</p>
          <p className="pk-hint">Pick a scheme from any ride's color combo list. Changing a color here repaints every ride using it.</p>
          <SchemeEditor park={park} run={run} readOnly={viewOnly} />
          <p className="pk-label">Rides</p>
          <ul className="pk-list">{myRides.map(r => <li key={r.id}><button onClick={() => { setSelection({ kind: 'entity', id: r.id }); focusOn(r.x, r.y) }}>{r.name}</button><small className={`pk-status pk-${r.status}`}>{r.kind === 'coaster' && !r.complete ? 'Building' : r.status}</small></li>)}</ul>
        </div>
      </div>
    </Window>}

    {panel === 'finance' && <Window title="Finances" onClose={() => togglePanel('finance')} wide>
      <div className="pk-grid2">
        <div>
          <p className="pk-label">This month</p>
          <dl className="pk-dl">{Object.entries({ 'Ride tickets': park.month.rides, 'Shop sales': park.month.shops, 'Park entry': park.month.entry, 'Hotel rooms': park.month.hotels ?? 0, 'Hotel amenities': park.month.hotelAmenities ?? 0, 'Hotel staff': park.month.hotelStaff ?? 0, 'Hotel upkeep': park.month.hotelUpkeep ?? 0, Construction: park.month.construction, Landscaping: park.month.landscaping, Marketing: park.month.marketing, Wages: park.month.wages, Electricity: park.month.electricity, Upkeep: park.month.upkeep, 'Loan interest': park.month.interest }).flatMap(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`} className={v < 0 ? 'pk-neg' : v > 0 ? 'pk-pos' : ''}>{money(v)}</dd>])}</dl>
          <p className="pk-hint">Electricity costs $1 per occupied ride or shop grid square each day.</p>
          <p className="pk-label">Bank loan</p>
          <div className="pk-row"><span>{money(park.loan)} of {money(park.maxLoan)}</span>{!viewOnly && <><button onClick={() => void run({ t: 'loan', delta: -1000 })}>Repay $1,000</button><button onClick={() => void run({ t: 'loan', delta: 1000 })}>Borrow $1,000</button></>}</div>
          <p className="pk-hint">Interest is about 1.2% of the loan each month.</p>
        </div>
        <div>
          <p className="pk-label">Monthly profit</p>
          {park.history.length ? <div className="pk-chart">{park.history.slice(-12).map(h => { const max = Math.max(1, ...park.history.slice(-12).map(x => Math.abs(x.profit))); return <div key={h.label} title={`${h.label}: ${money(h.profit)}`}><i style={{ height: `${Math.abs(h.profit) / max * 100}%`, background: h.profit >= 0 ? '#4caf62' : '#d9573f', alignSelf: h.profit >= 0 ? 'flex-end' : 'flex-start' }} /><small>{h.label.split(' ')[0]}</small></div> })}</div> : <p className="pk-hint">Your first monthly report arrives at the end of the month.</p>}
          {state.mode === 'versus' && <><p className="pk-label">Company values</p><ul className="pk-list">{state.parks.map(p => <li key={p.id}><span><i className="pk-swatch" style={{ background: p.color }} />{p.name}</span><small>{money(companyValue(state, p.id))}</small></li>)}</ul></>}
        </div>
      </div>
    </Window>}

    {!viewOnly && panel === 'save' && <Window title="Save park" onClose={() => setPanel(null)}>
      {!signedIn ? <p className="pk-hint">Sign in on the home page to save parks to your account.</p> : saves === null ? <p className="pk-hint"><LoaderCircle className="spin" size={14} /> Loading your saves…</p> : <>
        <p className="pk-hint"><strong>{park.name}</strong> has its own save. {(() => { const mine = saves.find(x => x.parkId === park.parkId); return mine ? `Saved copy: ${mine.summary.date} · ${mine.summary.guests} guests.` : 'Not saved yet.' })()} Saving never replaces your other parks; a park is only removed when you delete it from Load park.</p>
        <p className="pk-hint">This park autosaves every 5 minutes and when you leave{lastSaved ? ` · last saved ${new Date(lastSaved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.{session.state.mode === 'solo' && session.state.scenario !== 'sandbox' ? ' Each save also updates your company value and park screenshot on the leaderboard.' : ''}</p>
        <div className="pk-actions"><button className="pk-btn pk-btn-go" disabled={saveBusy} onClick={() => { setSaveBusy(true); void autosave().finally(async () => { setSaveBusy(false); try { setSaves((await parkApi.saves()).saves) } catch { /* list refresh is optional */ } }) }}><Save size={14} /> Save now</button></div>
      </>}
    </Window>}

    {panel === 'chat' && session.online && <Window title="Chat" onClose={() => setPanel(null)}>
      <ul className="pk-chat">{session.chat.map(line => <li key={line.id} className={line.system ? 'pk-system' : ''}>{!line.system && <b>{line.from}: </b>}{line.text}</li>)}</ul>
      <form onSubmit={e => { e.preventDefault(); if (chatText.trim()) { session.sendChat(chatText.trim()); setChatText('') } }} className="pk-chat-form"><input value={chatText} maxLength={200} onChange={e => setChatText(e.target.value)} placeholder="Say something…" aria-label="Chat message" /><button className="pk-btn">Send</button></form>
    </Window>}

    {entity?.type === 'ride' && <RideWindow ride={entity} session={session} readOnly={viewOnly} onClose={() => setSelection(null)} run={run} onBuild={() => setBuilder({ ride: entity.id, c: 0, s: 0, sp: '' })} onGate={role => setTool({ kind: 'gate', ride: entity.id, role })} rideCam={rideCam === entity.id} onRideCam={() => setRideCam(c => c === entity.id ? null : entity.id)} />}
    {entity?.type === 'hotel' && <Window title={entity.name ?? 'Hotel'} onClose={() => setSelection(null)}>
      <HotelWindowBody hotel={entity} state={state} readOnly={viewOnly} run={run} onDemolish={async () => { const res = await run({ t: 'demolish', id: entity.id }); if (res.ok) { setSelection(null); toast('Hotel demolished.') } }} />
    </Window>}
    {entity?.type === 'stall' && <Window title={entity.name ?? 'Stall'} onClose={() => setSelection(null)}>
      <dl className="pk-dl"><dt>Sales</dt><dd>{entity.sales}</dd><dt>Revenue</dt><dd>{money(entity.revenue ?? 0)}</dd><dt>Upkeep</dt><dd>{money(STALLS[entity.kind!].upkeep)}/month</dd></dl>
      {STALLS[entity.kind!].price > 0 && <div className="pk-row"><span>Price</span>{!viewOnly && <button onClick={() => void run({ t: 'stallSet', id: entity.id, price: Math.max(0, (entity.price ?? 0) - 0.1) })}><Minus size={13} /></button>}<strong>{money(entity.price ?? 0)}</strong>{!viewOnly && <button onClick={() => void run({ t: 'stallSet', id: entity.id, price: Math.min(20, (entity.price ?? 0) + 0.1) })}><Plus size={13} /></button>}</div>}
      {!viewOnly && <div className="pk-actions"><button className="pk-btn" onClick={() => void run({ t: 'stallSet', id: entity.id, open: !entity.open })}>{entity.open ? 'Close' : 'Open'}</button><button className="pk-btn" onClick={() => void run({ t: 'stallSet', id: entity.id, rot: ((entity.rot ?? 0) + 1) % 4 }, 'Shop rotated.')}><RotateCw size={13} /> Rotate</button><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: entity.id }); setSelection(null) }}><Trash2 size={13} /> Demolish</button></div>}
    </Window>}
    {entity?.type === 'scenery' && <Window title={SCENERY[entity.kind!]?.name ?? 'Scenery'} onClose={() => setSelection(null)}>{!viewOnly && <div className="pk-actions"><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: entity.id }); setSelection(null) }}><Trash2 size={13} /> Remove</button></div>}</Window>}
    {entity?.type === 'parkEntrance' && <Window title={state.parks[entity.park]?.name ?? 'Park entrance'} onClose={() => setSelection(null)}><p className="pk-hint">Guests arrive and leave through here. Entry fee {money(state.parks[entity.park]?.entryFee ?? 0)}.</p></Window>}
    {selection?.kind === 'guest' && guestInfo && <Window title={guestName(guestInfo.id)} onClose={() => setSelection(null)}>
      <p className="pk-hint">{guestInfo.kid ? 'Young visitor' : guestInfo.type === 'thrill' ? 'Thrill seeker' : 'Visitor'}{guestInfo.hotel && state.entities[guestInfo.hotel] ? ` staying at ${state.entities[guestInfo.hotel].name}` : ''}{guestInfo.warm ? ' · warmed up' : ''} · {guestInfo.state === 'queue' ? 'Queuing' : guestInfo.state === 'ride' ? 'On a ride' : guestInfo.state === 'sit' ? 'Resting' : guestInfo.state === 'amenity' ? `${AMENITY_VISITS[guestInfo.visit?.amenity ?? '']?.doing ?? 'Inside'}${guestInfo.visit && state.entities[guestInfo.visit.hotel] ? ` at ${state.entities[guestInfo.visit.hotel].name}` : ''}`.replace(/^./, c => c.toUpperCase()) : 'Walking'} · {money(guestInfo.cash)} left · spent {money(guestInfo.spent)}</p>
      <Bar label="Happiness" value={guestInfo.happy} /><Bar label="Energy" value={guestInfo.energy} /><Bar label="Hunger" value={guestInfo.hunger} invert /><Bar label="Thirst" value={guestInfo.thirst} invert /><Bar label="Restroom" value={guestInfo.toilet} invert /><Bar label="Nausea" value={guestInfo.nausea} invert />
      <p className="pk-hint">Likes intensity {guestInfo.minI.toFixed(1)}–{(guestInfo.maxI + (guestInfo.warm ?? 0)).toFixed(1)} · {guestInfo.rides} rides so far{guestInfo.items.length ? ` · carrying ${guestInfo.items.join(', ')}` : ''}</p>
      <ul className="pk-thoughts">{[...guestInfo.thoughts].reverse().map((t, i) => <li key={i}><span>“{t}”</span></li>)}</ul>
    </Window>}
    {staffMember && <Window title={staffMember.name} onClose={() => setSelection(null)}>
      <p className="pk-hint">{STAFF[staffMember.role].name} · {money(STAFF[staffMember.role].wage)}/day · {staffActivity(staffMember)}</p>
      {staffMember.role === 'mechanic' && <>
        <p className="pk-label">Available repair jobs</p>
        {brokenRides.length === 0 ? <p className="pk-hint">No rides need repairs right now.</p> : mechanicJobs.length === 0 ? <p className="pk-hint">No unassigned broken rides are reachable from this mechanic’s footpaths or queue lines.</p> : <ul className="pk-list">{mechanicJobs.map(ride => <li key={ride.id}><span>{ride.name}</span>{!viewOnly && <button className="pk-btn" disabled={ride.mechanic === staffMember.id} onClick={() => void run({ t: 'staffJob', id: staffMember.id, ride: ride.id }, 'Repair job assigned.')}>{ride.mechanic === staffMember.id ? 'Assigned' : 'Assign'}</button>}</li>)}</ul>}
      </>}
      {!viewOnly && <div className="pk-actions"><button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'fire', id: staffMember.id }, 'Staff member let go.'); setSelection(null) }}>Fire</button></div>}
    </Window>}

    {tool.kind === 'pathBuilder' && !viewOnly && (() => {
      const plan = pathNextPlan
      const name = PATH_KINDS.find(k => k.path === tool.path)?.label ?? 'Footpath'
      const nextGround = pathBuild && inMap(state.map, pathBuild.x + DIRS[pathBuild.dir][0], pathBuild.y + DIRS[pathBuild.dir][1]) ? groundHeightAt(state.map, (pathBuild.x + 0.5 + DIRS[pathBuild.dir][0] * 0.5) * TILE, (pathBuild.y + 0.5 + DIRS[pathBuild.dir][1] * 0.5) * TILE, TILE) : 0
      const sloped = Boolean(pathBuild && pathBuild.slope !== 0)
      const status = !pathBuild ? 'Click a clear tile or the end of a path to start. Drag to quick-draw a straight ground path.'
        : !plan ? '' : plan.ok ? plan.anchor ? 'Flat joins the path ahead.' : `Next: ${PATH_SECTIONS.find(sec => sec.segment === (pathHoverSegment ?? tool.segment))?.label ?? 'Flat'} to ${(plan.end.exit).toFixed(1)}m · ${money(plan.cost)}` : plan.error
      return <section className="pk-builder pk-path-builder" aria-label="Path builder">
        <header><strong><Footprints size={14} /> {name} builder{pathBuild ? ` · ${pathBuild.exit.toFixed(1)}m` : ''}</strong><button aria-label="Close path builder" onClick={closePathBuilder}><X size={16} /></button></header>
        <div className="pk-builder-row pk-builder-row-3" role="group" aria-label="Path type">{PATH_KINDS.map(k => <button key={k.path} className={tool.path === k.path ? 'on' : ''} onClick={() => startPathBuilder(k.path)}><span>{k.label}</span><small>{money(k.cost)}</small></button>)}</div>
        <div className="pk-builder-row pk-builder-row-3" role="group" aria-label="Direction">{PATH_TURNS.map(c => <button key={c.turn} disabled={sloped && c.turn !== 0} className={tool.turn === c.turn ? 'on' : ''} onClick={() => choosePathTurn(c.turn)} title={sloped && c.turn !== 0 ? 'Slopes and stairs run straight. Add a flat piece to turn.' : c.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={c.turn === 0 ? 'M12 21V3' : `M12 21 V10 Q12 6 ${12 + c.turn * 4} 6 H${12 + c.turn * 9}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg><span>{c.label}</span></button>)}</div>
        <div className="pk-builder-row" role="group" aria-label="Section · click to build">{PATH_SECTIONS.map(sec => <button key={sec.segment} disabled={pathBusy} className={tool.segment === sec.segment ? 'on' : ''} onClick={() => choosePathSegment(sec.segment)} onMouseEnter={() => setPathHoverSegment(sec.segment)} onMouseLeave={() => setPathHoverSegment(null)} onFocus={() => setPathHoverSegment(sec.segment)} onBlur={() => setPathHoverSegment(null)} title={pathBuild ? `Build ${sec.label.toLowerCase()} (${sec.hint})` : sec.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={sec.icon} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{sec.label}</span><small>{sec.hint}</small></button>)}</div>
        <p className={`pk-builder-status ${!pathBuild ? '' : plan?.ok ? 'ok' : 'bad'}`} aria-live="polite">{status}</p>
        <div className="pk-actions"><button className="pk-btn" disabled={!pathBuild || pathBusy || (!pathBuild.placed && !pathBuild.trail.length)} onClick={() => void removeLastPath()}><Undo2 size={14} /> Remove last</button><button className="pk-btn" disabled={!pathBuild || finishing || pathBuild.exit <= nextGround + 0.05} onClick={() => void finishPath()}>{finishing ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} Auto-finish</button><button className="pk-btn pk-btn-go" disabled={!pathBuild || pathBusy || !plan?.ok} onClick={() => void buildNextPath()}><Check size={14} /> Build piece</button></div>
        <p className="pk-hint">Each section button builds that piece onto the end, so clicking Stairs up again keeps climbing. Two slopes rise as much as one flight of stairs. The faded piece shows what goes next.</p>
      </section>
    })()}

    {builder && builderRide && !builderRide.complete && <section className="pk-builder" aria-label="Track builder">
      <header><strong><Wrench size={14} /> {builderRide.name}</strong><button aria-label="Close builder" onClick={() => setBuilder(null)}><X size={16} /></button></header>
      <div className="pk-builder-row" role="group" aria-label="Direction" style={COASTER_STYLES[builderRide.style!]?.hairpin ? { gridTemplateColumns: 'repeat(7,1fr)' } : undefined}>{(COASTER_STYLES[builderRide.style!]?.hairpin ? KART_CURVES : CURVES).map(c => <button key={c.c} className={builder.c === c.c ? 'on' : ''} onClick={() => chooseOrBuild({ c: c.c, s: builder.s, sp: builder.sp === 'loop' || builder.sp === 'corkscrew' || builder.sp === 'station' || builder.sp === 'brakes' || builder.sp === 'booster' ? (c.c === builder.c ? builder.sp : '') : builder.sp })} title={builder.c === c.c ? `${c.label} · click again to build` : c.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={c.c === 0 ? 'M12 21V3' : `M12 21 C12 ${c.c > 0 ? 9 : 9} ${12 + Math.sign(c.c) * (Math.abs(c.c) === 1 ? 3 : 1)} ${Math.abs(c.c) === 1 ? 6 : 4} ${12 + Math.sign(c.c) * 9} ${Math.abs(c.c) === 1 ? 6 : 4}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg><span>{c.label}</span></button>)}</div>
      <div className="pk-builder-row" role="group" aria-label="Slope">{SLOPES.map(s => <button key={s.s} className={builder.s === s.s ? 'on' : ''} onClick={() => chooseOrBuild({ c: builder.c, s: s.s, sp: builder.sp })} title={builder.s === s.s ? `${s.label} · click again to build` : s.label}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={`M3 ${12 + s.s * 4} L21 ${12 - s.s * 4}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg><span>{s.label}</span></button>)}</div>
      <div className="pk-builder-row pk-builder-special" role="group" aria-label="Special piece">{SPECIALS.map(s => <button key={s.sp} disabled={s.sp === 'corkscrew' && !COASTER_STYLES[builderRide.style!]?.corkscrews || s.sp === 'loop' && !COASTER_STYLES[builderRide.style!]?.loops} className={builder.sp === s.sp ? 'on' : ''} onClick={() => chooseOrBuild({ sp: s.sp, ...(s.sp === 'loop' || s.sp === 'corkscrew' || s.sp === 'brakes' || s.sp === 'booster' || s.sp === 'station' ? { c: 0, s: 0 } : { c: builder.c, s: builder.s }) })}>{s.label}</button>)}</div>
      <p className={`pk-builder-status ${builderCheck?.ok ? 'ok' : 'bad'}`}>{builderCheck?.ok ? `${builderCheck.adjusted ? 'Adjusted to a gentler section to keep the track smooth. ' : ''}${builderCheck.closes ? 'This piece completes the circuit! ' : ''}Cost ${money(builderCheck.cost ?? 0)}` : builderCheck?.error ?? ''}</p>
      <div className="pk-actions"><button className="pk-btn" onClick={() => void run({ t: 'unpiece', ride: builder.ride })}><Undo2 size={14} /> Remove last</button><button className="pk-btn" disabled={finishing} onClick={() => void autoFinish()}>{finishing ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} Auto-finish</button><button className="pk-btn pk-btn-go" disabled={!builderCheck?.ok} onClick={() => void buildPiece()}><Check size={14} /> Build piece</button></div>
      <p className="pk-hint">{builderRide.pieces?.length ?? 0} pieces · spent {money(builderRide.spent ?? 0)}. Click a selected button again to build it. Auto-finish routes the track back into the station, adding chain lift on climbs. Station pieces add extra stops where trains pause.</p>
    </section>}

    {tool.kind === 'buyLand' && <div className="pk-placebar" role="group" aria-label="Buy land">
      {pendingLand ? <>
        <strong>Buy {pendingLand.count.toLocaleString()} squares for {money(pendingLand.cost)}?</strong>
        <button className="pk-btn-go" disabled={buyingLand} onClick={() => void confirmLand()}>{buyingLand ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Buy</button>
        <button onClick={() => setPendingLand(null)}><X size={14} /> Cancel</button>
      </> : <>
        <strong>{landQuote ? `${landQuote.count.toLocaleString()} squares · ${money(landQuote.cost)}` : 'Click or drag over red land next to your park'}</strong>
        <button onClick={() => { setTool({ kind: 'select' }); setLandQuote(null); if (rendererRef.current) rendererRef.current.preview = {} }}><X size={14} /> Done</button>
      </>}
    </div>}

    {tool.kind === 'hotel' && <div className="pk-placebar" role="group" aria-label="Place hotel">
      <strong>{HOTELS[tool.hotel].name}{hotelQuote ? ` · ${hotelQuote.w}×${hotelQuote.h} · ${hotelQuote.rooms.toLocaleString()} rooms · +${hotelQuote.bonus.toLocaleString()} guests · ${money(hotelQuote.cost)}` : ' · drag out a lot beside a footpath'}</strong>
      {hotelQuote && !hotelQuote.fits && <span>Size {HOTELS[tool.hotel].min.join('×')} to {HOTELS[tool.hotel].max.join('×')}</span>}
      <button aria-label="Fewer floors" disabled={tool.floors <= HOTELS[tool.hotel].floors[0]} onClick={() => { setHotelQuote(null); setTool({ ...tool, floors: tool.floors - 1 }) }}><Minus size={14} /></button>
      <span>{tool.floors} {tool.floors === 1 ? 'floor' : 'floors'}</span>
      <button aria-label="More floors" disabled={tool.floors >= HOTELS[tool.hotel].floors[1]} onClick={() => { setHotelQuote(null); setTool({ ...tool, floors: tool.floors + 1 }) }}><Plus size={14} /></button>
      <button onClick={() => { setTool({ kind: 'select' }); setHotelQuote(null); if (rendererRef.current) rendererRef.current.preview = {} }}><X size={14} /> Done</button>
    </div>}

    {['flat', 'stall', 'scenery', 'coaster', 'gate', 'clear', 'pathAdd'].includes(tool.kind) && <div className="pk-placebar" role="group" aria-label="Placement">
      <strong>{tool.kind === 'flat' && FLAT_RIDES[tool.ride].resize ? `${FLAT_RIDES[tool.ride].name} · ${flatQuote ? `${flatQuote.w}×${flatQuote.h} · ${money(flatQuote.cost)} · ${flatQuote.capacity} swimmers` : 'Drag to set the size'}` : tool.kind === 'flat' ? `Place ${FLAT_RIDES[tool.ride].name} · ${money(FLAT_RIDES[tool.ride].cost * rideScale)}` : tool.kind === 'stall' ? `Place ${STALLS[tool.stall].name} · ${money(STALLS[tool.stall].cost)}` : tool.kind === 'scenery' ? `Place ${SCENERY[tool.scenery].name} · ${money(SCENERY[tool.scenery].cost)}` : tool.kind === 'coaster' ? (tool.preset ? `Place ${COASTER_PRESETS[tool.preset].name}` : `Place ${COASTER_STYLES[tool.style].name} station`) : tool.kind === 'gate' ? `Place ${state.entities[tool.ride]?.name ?? 'ride'} ${tool.role}` : tool.kind === 'clear' ? 'Drag to clear scenery' : tool.kind === 'pathAdd' ? `Place ${PATH_ADDITIONS[tool.add]?.name ?? 'item'} on a footpath` : ''}</strong>
      {tool.kind === 'coaster' && !tool.preset && <><button onClick={() => setTool({ ...tool, length: Math.max(2, tool.length - 1) })} aria-label="Shorter station"><Minus size={14} /></button><span>{COASTER_STYLES[tool.style]?.trackType === 'kart' ? `${kartCount(tool.length, tool.style)} karts` : `${Math.min(tool.length + 1, 10)}-car train`} · {tool.length}-tile station</span><button onClick={() => setTool({ ...tool, length: Math.min(13, tool.length + 1) })} aria-label="Longer station"><Plus size={14} /></button></>}
      {tool.kind === 'flat' && FLAT_RIDES[tool.ride].resize && <span>Drag from corner to corner, {FLAT_RIDES[tool.ride].resize!.min.join('×')} to {FLAT_RIDES[tool.ride].resize!.max.join('×')}</span>}
      {((tool.kind === 'flat' && !FLAT_RIDES[tool.ride].resize) || tool.kind === 'stall' || tool.kind === 'scenery' || tool.kind === 'coaster') && <button onClick={rotateTool}><RotateCw size={14} /> Rotate</button>}
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
      <p>Choose a name before opening the gates. The leaderboard ranks each park separately and shows its name beside your username.</p>
      <label className="pk-field"><span>Park name</span><input autoFocus value={nameDraft} minLength={2} maxLength={32} required placeholder="Lakeside Thrills" onChange={e => setNameDraft(e.target.value)} /></label>
      <div className="pk-actions"><button type="submit" className="pk-btn pk-btn-go" disabled={naming || nameDraft.trim().length < 2}>{naming ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Open the gates</button><button type="button" className="pk-btn" onClick={onQuit}>Back to menu</button></div>
    </form></div>}

    {state.ended && <div className="pk-ended" role="dialog" aria-label="Match over"><div><h2>Match over</h2><p>{state.ended.text}</p>{state.ended.values && <ul>{state.parks.map((p, i) => <li key={p.id}><span style={{ color: p.color }}>{p.name}</span> {money(state.ended!.values![i])}</li>)}</ul>}<button className="pk-btn pk-btn-go" onClick={onQuit}>Back to menu</button></div></div>}
  </div>
}

function RideWindow({ ride, session, readOnly, onClose, run, onBuild, onGate, rideCam, onRideCam }: { ride: Entity; session: ParkSession; readOnly: boolean; onClose: () => void; run: (cmd: { t: string; [k: string]: unknown }, success?: string) => Promise<{ ok: boolean }>; onBuild: () => void; onGate: (role: 'entrance' | 'exit') => void; rideCam: boolean; onRideCam: () => void }) {
  const [name, setName] = useState(ride.name ?? '')
  const [editing, setEditing] = useState(false)
  const st = ride.stats
  const queue = ride.queueLength ?? ride.queue?.length ?? 0
  const coaster = ride.kind === 'coaster'
  const rollerCoaster = coaster && !COASTER_STYLES[ride.style!].trackType
  const rideName = coaster ? COASTER_STYLES[ride.style!].name : FLAT_RIDES[ride.ride as string].name
  const mechanics = session.state.staff.filter(s => s.role === 'mechanic' && s.park === session.park)
  const reachableMechanic = mechanics.some(s => mechanicJobDistance(session.state, s, ride) >= 0)
  const value = rideValue(ride)
  return <Window title={ride.name ?? 'Ride'} onClose={onClose}>
    {editing ? <form className="pk-chat-form" onSubmit={e => { e.preventDefault(); void run({ t: 'rideSet', id: ride.id, name }); setEditing(false) }}><input value={name} maxLength={32} onChange={e => setName(e.target.value)} aria-label="Ride name" /><button className="pk-btn">Rename</button></form> : <p className="pk-hint">{rideName}{!readOnly && <> · <button className="pk-inline" onClick={() => { setName(ride.name ?? ''); setEditing(true) }}>rename</button></>}</p>}
    <div className="pk-status-row"><span className={`pk-status pk-${ride.status}`}>{coaster && !ride.complete ? 'Under construction' : ride.status === 'broken' ? 'Broken down' : ride.status === 'open' ? 'Open' : 'Closed'}</span>
      {!readOnly && ride.status !== 'broken' && (!coaster || ride.complete) && <button className={`pk-btn ${ride.status === 'open' ? '' : 'pk-btn-go'}`} onClick={() => void run({ t: 'rideSet', id: ride.id, status: ride.status === 'open' ? 'closed' : 'open' })}>{ride.status === 'open' ? 'Close ride' : 'Open ride'}</button>}</div>
    {!readOnly && <RideColors ride={ride} park={session.state.parks[ride.park]} run={run} />}
    {st?.valid ? <dl className="pk-dl">
      <dt>Excitement</dt><dd>{st.e.toFixed(2)} ({level(st.e)})</dd><dt>Intensity</dt><dd>{st.i.toFixed(2)} ({level(st.i)})</dd><dt>Nausea</dt><dd>{st.n.toFixed(2)} ({level(st.n)})</dd>
      {coaster && <><dt>Top speed</dt><dd>{st.maxSpeed} km/h</dd><dt>Length</dt><dd>{st.length} m</dd><dt>Ride time</dt><dd>{st.rideTime} s</dd><dt>Drops</dt><dd>{st.drops} (highest {st.highestDrop} m)</dd><dt>Inversions</dt><dd>{st.inversions}</dd><dt>G-forces</dt><dd>+{st.maxG} / {st.minG} · lateral {st.latG}</dd><dt>Air time</dt><dd>{st.airtime} s</dd></>}
    </dl> : coaster && ride.complete ? <p className="pk-hint pk-neg">The track test failed. Remove pieces and adjust the route before trying again.</p> : coaster ? <p className="pk-hint">Finish the circuit to see its ratings.</p> : null}
    <dl className="pk-dl"><dt>Capacity</dt><dd>{rideCapacity(ride)} riders</dd><dt>Queue</dt><dd>{queue} guests</dd><dt>Riders</dt><dd>{ride.totalRiders ?? 0} total · {ride.monthRiders ?? 0} this month</dd><dt>Income</dt><dd>{money(ride.revenue ?? 0)}</dd><dt>Reliability</dt><dd>{Math.round(ride.reliability ?? 100)}%</dd></dl>
    <RideComments session={session} rideId={ride.id} />
    <div className="pk-row"><span>Ticket</span>{!readOnly && <button onClick={() => void run({ t: 'rideSet', id: ride.id, price: Math.max(0, (ride.price ?? 0) - 0.1) })}><Minus size={13} /></button>}<strong>{money(ride.price ?? 0)}</strong>{!readOnly && <button onClick={() => void run({ t: 'rideSet', id: ride.id, price: Math.min(20, (ride.price ?? 0) + 0.1) })}><Plus size={13} /></button>}{value > 0 && <small>Guests think it is worth about {money(Math.round(value * 1.6 * 10) / 10)}</small>}</div>
    {ride.kind === 'flat' && FLAT_RIDES[ride.ride as string]?.waves && <WaveControl ride={ride} readOnly={readOnly} onChange={wave => void run({ t: 'rideSet', id: ride.id, wave })} />}
    {ride.kind === 'flat' && ride.size && <p className="pk-hint">{ride.size[0]}×{ride.size[1]} squares</p>}
    {!readOnly && rollerCoaster && <p className="pk-hint">Trains: 2 sets · {ride.cars ?? 3} cars each</p>}
    {!readOnly && rollerCoaster && <div className="pk-row"><span>Cars per train</span><button aria-label="Fewer cars per train" disabled={(ride.cars ?? 3) <= 1} onClick={() => void run({ t: 'rideSet', id: ride.id, cars: Math.max(1, (ride.cars ?? 3) - 1) })}><Minus size={13} /></button><strong>{ride.cars ?? 3} / 10</strong><button aria-label="More cars per train" disabled={(ride.cars ?? 3) >= 10} onClick={() => void run({ t: 'rideSet', id: ride.id, cars: Math.min(10, (ride.cars ?? 3) + 1) })}><Plus size={13} /></button></div>}
    {!readOnly && <div className="pk-actions">
      {coaster && !ride.complete && <button className="pk-btn pk-btn-go" onClick={onBuild}><Wrench size={13} /> Build track</button>}
      {coaster && !ride.complete && (ride.pieces?.length ?? 0) > 0 && <button className="pk-btn" onClick={() => void run({ t: 'unpiece', ride: ride.id })}><Undo2 size={13} /> Remove last</button>}
      {coaster && ride.complete && <button className={`pk-btn ${rideCam ? 'on' : ''}`} onClick={onRideCam}><Camera size={13} /> {rideCam ? 'Exit ride camera' : 'Ride camera'}</button>}
      {coaster && ride.complete && <button className="pk-btn" onClick={() => { void run({ t: 'unpiece', ride: ride.id }); onBuild() }}><RotateCw size={13} /> Modify track</button>}
      <button className="pk-btn" onClick={() => onGate('entrance')}>{ride.entrance ? 'Move entrance' : 'Place entrance'}</button>
      <button className="pk-btn" onClick={() => onGate('exit')}>{ride.exit ? 'Move exit' : 'Place exit'}</button>
      <button className="pk-btn pk-btn-danger" onClick={() => { void run({ t: 'demolish', id: ride.id }); onClose() }}><Trash2 size={13} /> Demolish</button>
    </div>}
    {ride.status === 'broken' && <p className="pk-hint pk-neg">{ride.mechanic ? 'A mechanic is on the way.' : !mechanics.length ? 'Hire a mechanic to repair this ride.' : reachableMechanic ? 'Waiting for a free mechanic.' : 'No mechanic can reach this ride. Connect a footpath to its entrance or exit.'}</p>}
  </Window>
}
