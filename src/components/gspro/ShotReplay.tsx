import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Gauge, RotateCcw, Trash2, X } from 'lucide-react'
import { clubLabel } from '@/lib/gspro/clubs'
import { traceFlight, type TracePoint } from '@/lib/gspro/flight'
import { fmt, signed, type EnrichedShot } from '@/lib/gspro/stats'
import { HOLD_AFTER, SWING_LEAD } from './range/timing'
import type { CameraMode } from './range/RangeScene'
import { gsproApi } from './api'
import { useShotsRemoved } from './ReplayContext'

const RangeView = lazy(() => import('./range/RangeView'))

const cameraModes: { id: CameraMode; label: string }[] = [
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'tee', label: 'From the tee' },
  { id: 'chase', label: 'Chase' },
]

type Path = { points: TracePoint[]; landingIndex: number; end: number; carry: number; hangTime: number; actual: boolean }

/** The replay path, scaled so carry matches the launch monitor's own carry when it sent one. */
function pathFor(shot: EnrichedShot): Path | null {
  if (shot.actualPath && shot.actualPath.length > 1) {
    const landingIndex = Math.min(shot.landingIndex ?? shot.actualPath.length - 1, shot.actualPath.length - 1)
    const points = shot.actualPath
    return { points, landingIndex, end: points[points.length - 1].t, carry: points[landingIndex].x, hangTime: points[landingIndex].t, actual: true }
  }
  const trace = traceFlight(shot)
  if (!trace) return null
  const scale = shot.carry !== null && shot.carry > 1 && trace.carry > 1 ? shot.carry / trace.carry : 1
  const points = [...trace.air, ...trace.ground].map(point => ({ t: point.t, x: point.x * scale, y: point.y * scale, z: point.z * scale }))
  return { points, landingIndex: trace.air.length - 1, end: points[points.length - 1].t, carry: trace.carry * scale, hangTime: trace.hangTime, actual: false }
}

function until(points: TracePoint[], t: number) {
  const visible: TracePoint[] = []
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    if (point.t <= t) { visible.push(point); continue }
    const before = points[index - 1]
    if (before) {
      const share = (t - before.t) / (point.t - before.t)
      visible.push({ t, x: before.x + (point.x - before.x) * share, y: before.y + (point.y - before.y) * share, z: before.z + (point.z - before.z) * share })
    }
    break
  }
  return visible
}

function useBoxWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setWidth(Math.max(260, Math.round(node.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Down-the-line view from behind the golfer: a pinhole camera 12 yards back and 3 yards up, looking at the target. */
function DownTheLine({ path, t, reach }: { path: Path; t: number; reach: number }) {
  const [box, width] = useBoxWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const height = Math.round(Math.min(420, Math.max(220, width * 0.5)))

  useEffect(() => {
    const node = canvas.current
    const context = node?.getContext('2d')
    if (!node || !context) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    node.width = width * ratio
    node.height = height * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const horizon = height * 0.3
    const camX = -45
    const camY = 9
    let focal = width * 1.6
    for (const point of path.points) {
      const depth = point.x - camX
      const rise = point.y / 3 - camY
      if (rise > 0) focal = Math.min(focal, ((horizon - 14) * depth) / rise)
      if (point.z !== 0) focal = Math.min(focal, ((width / 2 - 24) * depth) / Math.abs(point.z))
    }
    const project = (x: number, yFeet: number, z: number) => {
      const depth = x - camX
      if (depth < 0.5) return null
      return { x: width / 2 + (focal * z) / depth, y: horizon + (focal * (camY - yFeet / 3)) / depth, depth }
    }
    const sky = context.createLinearGradient(0, 0, 0, horizon)
    sky.addColorStop(0, '#6f9fd1')
    sky.addColorStop(1, '#cfe1f1')
    context.fillStyle = sky
    context.fillRect(0, 0, width, horizon)
    const grass = context.createLinearGradient(0, horizon, 0, height)
    grass.addColorStop(0, '#5d8a4a')
    grass.addColorStop(1, '#2f5a25')
    context.fillStyle = grass
    context.fillRect(0, horizon, width, height - horizon)
    context.fillStyle = 'rgba(40, 70, 40, .55)'
    context.fillRect(0, horizon - 3, width, 3)

    const far = reach
    const half = 22
    const corners = [project(-40, 0, -half), project(far, 0, -half), project(far, 0, half), project(-40, 0, half)]
    if (corners.every(Boolean)) {
      context.beginPath()
      corners.forEach((corner, index) => index ? context.lineTo(corner!.x, corner!.y) : context.moveTo(corner!.x, corner!.y))
      context.closePath()
      context.fillStyle = 'rgba(150, 200, 110, .35)'
      context.fill()
    }
    context.font = '12px system-ui, sans-serif'
    context.textAlign = 'right'
    let lastLabel = Infinity
    for (let yard = 50; yard <= far; yard += 50) {
      const left = project(yard, 0, -half)
      const right = project(yard, 0, half)
      if (!left || !right || lastLabel - left.y < 14) continue
      lastLabel = left.y
      context.strokeStyle = 'rgba(255,255,255,.45)'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(left.x, left.y)
      context.lineTo(right.x, right.y)
      context.stroke()
      context.fillStyle = 'rgba(255,255,255,.85)'
      context.fillText(`${yard}`, left.x - 6, left.y + 4)
    }
    const near = project(0, 0, 0)
    const target = project(far, 0, 0)
    if (near && target) {
      context.setLineDash([6, 6])
      context.strokeStyle = 'rgba(255,255,255,.5)'
      context.beginPath()
      context.moveTo(near.x, near.y)
      context.lineTo(target.x, target.y)
      context.stroke()
      context.setLineDash([])
    }

    const visible = until(path.points, t)
    const screen = visible.map(point => project(point.x, point.y, point.z)).filter((point): point is { x: number; y: number; depth: number } => point !== null)
    if (screen.length > 1) {
      for (const [stroke, lineWidth] of [['rgba(255,255,255,.35)', 6], ['#ff4d2e', 2.5]] as const) {
        context.strokeStyle = stroke
        context.lineWidth = lineWidth
        context.lineJoin = 'round'
        context.lineCap = 'round'
        context.beginPath()
        screen.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
        context.stroke()
      }
    }
    const landing = path.points[path.landingIndex]
    if (t >= landing.t) {
      const spot = project(landing.x, 0, landing.z)
      if (spot) {
        context.strokeStyle = '#ffffff'
        context.lineWidth = 2
        context.beginPath()
        context.ellipse(spot.x, spot.y, Math.max(4, 300 / spot.depth), Math.max(1.5, 90 / spot.depth), 0, 0, Math.PI * 2)
        context.stroke()
      }
    }
    const current = visible[visible.length - 1]
    if (current) {
      const shadow = project(current.x, 0, current.z)
      const ball = project(current.x, current.y, current.z)
      if (shadow) {
        context.fillStyle = 'rgba(0,0,0,.35)'
        context.beginPath()
        context.ellipse(shadow.x, shadow.y, Math.max(1.5, 40 / shadow.depth), Math.max(0.8, 14 / shadow.depth), 0, 0, Math.PI * 2)
        context.fill()
      }
      if (ball) {
        context.fillStyle = '#ffffff'
        context.strokeStyle = 'rgba(0,0,0,.4)'
        context.lineWidth = 1
        context.beginPath()
        context.arc(ball.x, ball.y, Math.max(2.2, 60 / ball.depth), 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }
  }, [path, t, width, height, reach])

  return <div ref={box} className="gs-dtl">
    <canvas ref={canvas} style={{ width: '100%', height }} role="img" aria-label={`Down-the-line view: ${fmt(path.carry, 0)} yards carry`}/>
  </div>
}

function Plot({ kind, path, ghosts, t, reach }: { kind: 'side' | 'top'; path: Path; ghosts: Path[]; t: number; reach: number }) {
  const [box, width] = useBoxWidth<HTMLDivElement>()
  const height = kind === 'side' ? 170 : 150
  const pad = { l: 40, r: 12, t: 12, b: 24 }
  const all = [path, ...ghosts]
  const top = kind === 'side' ? Math.max(30, ...all.map(item => Math.max(...item.points.map(point => point.y)))) * 1.15 : Math.max(15, ...all.map(item => Math.max(...item.points.map(point => Math.abs(point.z))))) * 1.2
  const sx = (x: number) => pad.l + (x / reach) * (width - pad.l - pad.r)
  const sy = (point: TracePoint) => kind === 'side'
    ? height - pad.b - (point.y / top) * (height - pad.t - pad.b)
    : pad.t + ((point.z + top) / (2 * top)) * (height - pad.t - pad.b)
  const line = (points: TracePoint[]) => points.map((point, index) => `${index ? 'L' : 'M'}${sx(point.x).toFixed(1)},${sy(point).toFixed(1)}`).join('')
  const visible = until(path.points, t)
  const current = visible[visible.length - 1]
  const ticks: number[] = []
  for (let yard = 50; yard < reach; yard += 50) ticks.push(yard)
  const apex = path.points.reduce((best, point) => point.y > best.y ? point : best, path.points[0])
  return <figure className="gs-chart">
    <figcaption>{kind === 'side' ? 'Side view: height (ft) by distance' : 'From above: yards left and right of target'}</figcaption>
    <div ref={box} className="gs-chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={kind === 'side' ? `Apex ${fmt(apex.y, 0)} feet` : `Finishes ${fmt(Math.abs(path.points[path.points.length - 1].z), 0)} yards ${path.points[path.points.length - 1].z >= 0 ? 'right' : 'left'}`}>
        {ticks.map(yard => <g key={yard}><line className="gs-grid" x1={sx(yard)} x2={sx(yard)} y1={pad.t} y2={height - pad.b}/><text className="gs-axis" x={sx(yard)} y={height - 6} textAnchor="middle">{yard}</text></g>)}
        {kind === 'side'
          ? <><line className="gs-target" x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b}/><text className="gs-axis" x={pad.l - 6} y={pad.t + 8} textAnchor="end">{Math.round(top)}</text></>
          : <><line className="gs-target" x1={pad.l} x2={width - pad.r} y1={sy({ t: 0, x: 0, y: 0, z: 0 })} y2={sy({ t: 0, x: 0, y: 0, z: 0 })}/><text className="gs-axis" x={pad.l - 6} y={pad.t + 8} textAnchor="end">{Math.round(top)}L</text><text className="gs-axis" x={pad.l - 6} y={height - pad.b} textAnchor="end">{Math.round(top)}R</text></>}
        {ghosts.map((ghost, index) => <path key={index} className="gs-ghost" d={line(ghost.points)}/>)}
        <path className="gs-line" d={line(visible)}/>
        {current && <circle className="gs-dot-mark" cx={sx(current.x)} cy={sy(current)} r={5}/>}
        {kind === 'side' && t >= apex.t && <text className="gs-value" x={sx(apex.x)} y={sy(apex) - 8} textAnchor="middle">{fmt(apex.y, 0)} ft</text>}
      </svg>
    </div>
  </figure>
}

function ShotList({ shots, index, onPick }: { shots: EnrichedShot[]; index: number; onPick: (index: number) => void }) {
  const list = useRef<HTMLOListElement | null>(null)
  useEffect(() => {
    const active = list.current?.querySelector<HTMLElement>('[aria-current="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return <nav className="gs-replay-list" aria-label="Shots to replay">
    <p className="gs-replay-list-head">Shots <span>{shots.length}</span></p>
    <ol ref={list}>
      {shots.map((item, position) => <li key={`${item.id}:${position}`}>
        <button type="button" aria-current={position === index ? 'true' : undefined} className={item.excluded ? 'is-excluded' : ''} onClick={() => onPick(position)}>
          <span className="gs-replay-list-club">{item.club ?? '?'}</span>
          <span className="gs-replay-list-main"><b>{fmt(item.carryYards, 0)}<small> yd</small></b><small>{item.offline === null ? '' : `${fmt(Math.abs(item.offline), 0)} ${item.offline >= 0 ? 'R' : 'L'} · `}{fmt(item.ballSpeed, 0)} mph</small></span>
          <span className="gs-replay-list-time">{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </button>
      </li>)}
    </ol>
  </nav>
}

export function ShotReplay({ shots: startShots, index: startIndex, onClose }: { shots: EnrichedShot[]; index: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const [shots, setShots] = useState(startShots)
  const [index, setIndex] = useState(startIndex)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const removeShots = useShotsRemoved()
  const [slow, setSlow] = useState(false)
  const [clock, setClock] = useState(0)
  const [run, setRun] = useState(0)
  const [mode, setMode] = useState<CameraMode>('broadcast')
  const t = Math.max(0, clock)
  const shot = shots[index]
  const path = useMemo(() => pathFor(shot), [shot])
  const ghosts = useMemo(() => shots.filter(other => other.id !== shot.id && other.club === shot.club && !other.excluded).slice(-20).map(pathFor).filter((item): item is Path => item !== null), [shots, shot])
  const reach = useMemo(() => {
    const farthest = Math.max(path ? path.points[path.points.length - 1].x : 0, ...ghosts.map(ghost => ghost.points[ghost.points.length - 1].x))
    return Math.max(100, Math.ceil((farthest * 1.12) / 50) * 50)
  }, [path, ghosts])

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) node.showModal()
  }, [])

  useEffect(() => {
    if (!path) return
    const finish = path.end + HOLD_AFTER
    if (run === 0 && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setClock(finish); return }
    let frame = 0
    const started = performance.now()
    const rate = slow ? 0.35 : 1
    const tick = (now: number) => {
      const elapsed = ((now - started) / 1000) * rate - SWING_LEAD
      setClock(Math.min(finish, elapsed))
      if (elapsed < finish) frame = requestAnimationFrame(tick)
    }
    setClock(-SWING_LEAD)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [path, slow, run])

  const step = useCallback((delta: number) => setIndex(current => Math.max(0, Math.min(shots.length - 1, current + delta))), [shots.length])
  useEffect(() => { setConfirmDelete(false); setDeleteError(null) }, [index])
  const deletable = !shot.sessionId.startsWith('gr_')

  async function deleteShot() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    setDeleteError(null)
    try {
      await gsproApi.deleteShots([shot.id])
      removeShots([shot.id])
      const rest = shots.filter(item => item.id !== shot.id)
      if (!rest.length) { dialog.current?.close(); return }
      setShots(rest)
      setIndex(current => Math.min(current, rest.length - 1))
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : 'The shot could not be deleted.')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const stats: [string, string][] = [
    ['Carry', `${fmt(shot.carryYards, 0)} yd${shot.carryEstimated ? ' (est.)' : ''}`],
    ['Total', `${fmt(shot.totalYards, 0)} yd`],
    ['Offline', shot.offline === null ? '—' : `${fmt(Math.abs(shot.offline), 0)} yd ${shot.offline >= 0 ? 'R' : 'L'}`],
    ['Apex', `${fmt(shot.apex, 0)} ft`],
    ['Landing', `${fmt(shot.descent, 0)}°`],
    ['Hang time', `${fmt(path?.hangTime ?? null, 1)} s`],
    ['Ball speed', `${fmt(shot.ballSpeed)} mph`],
    ['Launch', `${fmt(shot.launch)}°`],
    ['Direction', `${signed(shot.direction)}°`],
    ['Spin', `${fmt(shot.totalSpin, 0)} rpm`],
    ['Spin axis', `${signed(shot.spinAxis)}°`],
    ['Club speed', shot.clubSpeed === null ? '—' : `${fmt(shot.clubSpeed)} mph`],
    ['Smash', fmt(shot.smash, 2)],
    ['Attack', shot.attackAngle === null ? '—' : `${signed(shot.attackAngle)}°`],
    ['Path', shot.path === null ? '—' : `${signed(shot.path)}°`],
    ['Face to path', shot.faceToPath === null ? '—' : `${signed(shot.faceToPath)}°`],
  ]

  return <dialog ref={dialog} className="gs-replay" aria-labelledby="gs-replay-title" onClose={onClose} onCancel={() => onClose()} onClick={event => { if (event.target === dialog.current) dialog.current?.close() }} onKeyDown={event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
  }}>
    <div className="gs-replay-inner">
      <header className="gs-replay-head">
        <div>
          <p className="gs-eyebrow">Shot replay · {index + 1} of {shots.length} · {new Date(shot.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{shot.excluded ? ' · excluded' : ''}{shot.context ? ` · ${shot.context}` : ''}</p>
          <h2 id="gs-replay-title">{clubLabel(shot.club)} <span>{shot.shape}</span></h2>
        </div>
        <div className="gs-row-actions">
          {deletable && <button type="button" className={`gs-delete ${confirmDelete ? 'is-confirming' : ''}`} disabled={deleting} onBlur={() => setConfirmDelete(false)} aria-label={confirmDelete ? 'Click again to delete this shot for good' : 'Delete this shot'} onClick={() => void deleteShot()}><Trash2 size={14} aria-hidden/>{deleting ? 'Deleting…' : confirmDelete ? 'Delete for good?' : 'Delete shot'}</button>}
          <button type="button" className="gs-icon-button" aria-label="Previous shot" disabled={index === 0} onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden/></button>
          <button type="button" className="gs-icon-button" aria-label="Next shot" disabled={index === shots.length - 1} onClick={() => step(1)}><ChevronRight size={16} aria-hidden/></button>
          <button type="button" className="gs-icon-button" aria-label="Close replay" onClick={() => dialog.current?.close()}><X size={16} aria-hidden/></button>
        </div>
      </header>
      {deleteError && <p className="gs-notice" role="alert">{deleteError}</p>}
      <div className="gs-replay-split">
      <div className="gs-replay-main">
      {path ? <>
        <Suspense fallback={<DownTheLine path={path} t={t} reach={reach}/>}>
          <RangeView points={path.points} landingIndex={path.landingIndex} handed={shot.handed} ballSpeed={shot.ballSpeed} launch={shot.launch} spin={shot.totalSpin} club={clubLabel(shot.club)} clubCode={shot.club} clock={clock} mode={mode} fallback={<DownTheLine path={path} t={t} reach={reach}/>}/>
        </Suspense>
        <div className="gs-replay-controls">
          <button type="button" className="gs-button ghost" onClick={() => setRun(value => value + 1)}><RotateCcw size={15} aria-hidden/>Replay</button>
          <button type="button" className="gs-button ghost" aria-pressed={slow} onClick={() => setSlow(value => !value)}><Gauge size={15} aria-hidden/>{slow ? 'Slow motion on' : 'Slow motion'}</button>
          <div className="gs-segments" role="group" aria-label="Camera">
            {cameraModes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} className={mode === item.id ? 'is-active' : ''} onClick={() => setMode(item.id)}>{item.label}</button>)}
          </div>
          <span className="gs-muted">{fmt(Math.min(t, path.end), 1)} s · {ghosts.length ? `${ghosts.length} other ${clubLabel(shot.club).toLowerCase()} shots in grey` : path.actual ? 'GSPro’s own flight' : 'flight recreated from launch data'}</span>
        </div>
        <div className="gs-replay-plots">
          <Plot kind="side" path={path} ghosts={ghosts} t={t} reach={reach}/>
          <Plot kind="top" path={path} ghosts={ghosts} t={t} reach={reach}/>
        </div>
      </> : <p className="gs-muted">This shot has no launch data to recreate.</p>}
      </div>
      <ShotList shots={shots} index={index} onPick={setIndex}/>
      </div>
      <dl className="gs-replay-stats">
        {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {path?.actual ? <p className="gs-muted">This is GSPro's own flight from your round, bounce and roll included, seen from behind the ball along your start line. Heights are relative to where you hit from.</p> : <p className="gs-muted">The flight is recreated from ball speed, launch, direction, spin and spin axis in calm air at sea level{shot.carryEstimated ? '' : ', scaled to the carry your launch monitor reported'}. Bounce and roll are a rough fairway estimate.</p>}
    </div>
  </dialog>
}
