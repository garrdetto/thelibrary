import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clubLabel } from '@/lib/gspro/clubs'
import { fmt, type ClubSummary, type EnrichedShot } from '@/lib/gspro/stats'
import { useReplay } from './ReplayContext'

type Tip = { x: number; y: number; content: ReactNode }

/** Tracks the chart box width so the SVG draws at real pixel size and its text stays readable on phones. */
function useChartWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setWidth(Math.max(280, Math.round(node.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  })
  return [ref, width] as const
}

function niceTicks(min: number, max: number, count = 5) {
  const span = Math.max(1e-6, max - min)
  const raw = span / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(f => f * power).find(f => span / f <= count) ?? power * 10
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + 1e-9; value += step) ticks.push(Math.round(value * 1000) / 1000)
  return ticks
}

function Tooltip({ tip, width, height }: { tip: Tip | null; width: number; height: number }) {
  if (!tip) return null
  const left = (tip.x / width) * 100
  const top = (tip.y / height) * 100
  return <div className={`gs-tooltip ${left > 60 ? 'flip' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} role="status">{tip.content}</div>
}

/** Landing spots for one club: offline (x) against carry (y), with the mean and a one-standard-deviation ellipse. */
export function DispersionChart({ shots, club }: { shots: EnrichedShot[]; club: string | null }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [box, W] = useChartWidth(640)
  const openReplay = useReplay()
  const points = shots.filter(shot => !shot.excluded && shot.carryYards !== null && shot.offline !== null).map(shot => ({ shot, x: shot.offline! * (shot.handed === 'LH' ? -1 : 1), y: shot.carryYards! }))
  if (points.length < 2) return <p className="gs-muted">Hit at least two shots with this club to see the dispersion.</p>
  const H = Math.round(Math.min(380, Math.max(260, W * 0.7)))
  const pad = { l: 52, r: 18, t: 16, b: 40 }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const spanX = Math.max(15, ...xs.map(Math.abs)) * 1.15
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padY = Math.max(6, (maxY - minY) * 0.15)
  const y0 = Math.max(0, minY - padY)
  const y1 = maxY + padY
  const sx = (x: number) => pad.l + ((x + spanX) / (2 * spanX)) * (W - pad.l - pad.r)
  const sy = (y: number) => H - pad.b - ((y - y0) / (y1 - y0)) * (H - pad.t - pad.b)
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const sd = (list: number[]) => { const m = mean(list); return Math.sqrt(list.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, list.length - 1)) }
  const mx = mean(xs)
  const my = mean(ys)
  const rx = Math.abs(sx(mx + sd(xs)) - sx(mx))
  const ry = Math.abs(sy(my + sd(ys)) - sy(my))
  return <figure className="gs-chart">
    <figcaption>{clubLabel(club)}: where shots land · ellipse covers about two thirds of them · click a shot to replay it</figcaption>
    <div className="gs-chart-box" ref={box} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${clubLabel(club)} dispersion: ${points.length} shots, average carry ${fmt(my, 0)} yards, ${fmt(Math.abs(mx), 0)} yards ${mx >= 0 ? 'right' : 'left'}`}>
        {niceTicks(y0, y1).map(t => <g key={`y${t}`}><line className="gs-grid" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)}/><text className="gs-axis" x={pad.l - 8} y={sy(t) + 4} textAnchor="end">{t}</text></g>)}
        {niceTicks(-spanX, spanX, 6).map(t => <text key={`x${t}`} className="gs-axis" x={sx(t)} y={H - pad.b + 18} textAnchor="middle">{t === 0 ? '0' : `${Math.abs(t)}${t > 0 ? 'R' : 'L'}`}</text>)}
        <line className="gs-target" x1={sx(0)} x2={sx(0)} y1={pad.t} y2={H - pad.b}/>
        <text className="gs-axis" x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle">Offline (yd, right-handed view)</text>
        <text className="gs-axis" x={14} y={(pad.t + H - pad.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}>Carry (yd)</text>
        <ellipse className="gs-ellipse" cx={sx(mx)} cy={sy(my)} rx={rx} ry={ry}/>
        {points.map(({ shot, x, y }, index) => <g key={shot.id}>
          <circle className="gs-dot-mark" cx={sx(x)} cy={sy(y)} r={5}/>
          <circle className="gs-hit" cx={sx(x)} cy={sy(y)} r={12} tabIndex={0} aria-label={`${fmt(y, 0)} yards carry, ${fmt(Math.abs(x), 0)} ${x >= 0 ? 'right' : 'left'}`}
            onMouseEnter={() => setTip({ x: sx(x), y: sy(y), content: <><b>{fmt(y, 0)} yd</b> carry · {fmt(Math.abs(x), 0)} {x >= 0 ? 'R' : 'L'}<br/>{shot.shape} · {fmt(shot.ballSpeed)} mph · {fmt(shot.totalSpin, 0)} rpm</> })}
            onFocus={() => setTip({ x: sx(x), y: sy(y), content: <><b>{fmt(y, 0)} yd</b> · {fmt(Math.abs(x), 0)} {x >= 0 ? 'R' : 'L'}</> })}
            onBlur={() => setTip(null)}
            onClick={() => openReplay(points.map(point => point.shot), index)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openReplay(points.map(point => point.shot), index) } }}/>
        </g>)}
        <g className="gs-mean"><line x1={sx(mx) - 7} x2={sx(mx) + 7} y1={sy(my)} y2={sy(my)}/><line x1={sx(mx)} x2={sx(mx)} y1={sy(my) - 7} y2={sy(my) + 7}/></g>
      </svg>
      <Tooltip tip={tip} width={W} height={H}/>
    </div>
  </figure>
}

/** Average carry per club with a one-standard-deviation whisker, longest club on top. */
export function GappingChart({ summaries }: { summaries: ClubSummary[] }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [box, W] = useChartWidth(640)
  const rows = summaries.filter(summary => summary.carry && summary.club !== 'PT')
  if (!rows.length) return <p className="gs-muted">No carry data in this selection.</p>
  const row = 30
  const pad = { l: 116, r: 60, t: 8, b: 28 }
  const H = pad.t + pad.b + rows.length * row
  const max = Math.max(...rows.map(r => r.carry!.mean + r.carry!.sd)) * 1.05
  const sx = (v: number) => pad.l + (v / max) * (W - pad.l - pad.r)
  return <figure className="gs-chart">
    <figcaption>Average carry by club · whiskers show ± one standard deviation</figcaption>
    <div className="gs-chart-box" ref={box} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Carry distance by club">
        {niceTicks(0, max, 6).map(t => <g key={t}><line className="gs-grid" x1={sx(t)} x2={sx(t)} y1={pad.t} y2={H - pad.b}/><text className="gs-axis" x={sx(t)} y={H - 8} textAnchor="middle">{t}</text></g>)}
        {rows.map((summary, index) => {
          const y = pad.t + index * row
          const carry = summary.carry!
          const previous = rows[index - 1]?.carry
          const gap = previous ? previous.mean - carry.mean : null
          const show = () => setTip({ x: sx(carry.mean), y: y + row / 2, content: <><b>{clubLabel(summary.club)}</b>: {fmt(carry.mean, 0)} yd ± {fmt(carry.sd, 0)}<br/>{summary.shots} shots{gap !== null ? ` · ${fmt(gap, 0)} yd gap` : ''}{summary.carryEstimated ? ' · estimated' : ''}</> })
          return <g key={summary.club ?? 'none'} tabIndex={0} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} aria-label={`${clubLabel(summary.club)} ${fmt(carry.mean, 0)} yards`}>
            <text className="gs-label" x={pad.l - 10} y={y + row / 2 + 4} textAnchor="end">{clubLabel(summary.club)}</text>
            <rect className="gs-hit" x={pad.l} y={y} width={W - pad.l - pad.r} height={row}/>
            <rect className="gs-bar" x={pad.l} y={y + 7} width={Math.max(2, sx(carry.mean) - pad.l)} height={row - 14} rx={4}/>
            <line className="gs-whisker" x1={sx(Math.max(0, carry.mean - carry.sd))} x2={sx(carry.mean + carry.sd)} y1={y + row / 2} y2={y + row / 2}/>
            <text className="gs-value" x={sx(carry.mean + carry.sd) + 8} y={y + row / 2 + 4}>{fmt(carry.mean, 0)}</text>
          </g>
        })}
      </svg>
      <Tooltip tip={tip} width={W} height={H}/>
    </div>
  </figure>
}

/** One metric per shot in order, for spotting warm-up, fatigue or a change that stuck. */
export function TrendChart({ shots, label, unit, value, places = 0 }: { shots: EnrichedShot[]; label: string; unit: string; value: (shot: EnrichedShot) => number | null; places?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, W] = useChartWidth(640)
  const points = shots.filter(shot => !shot.excluded).map(shot => ({ shot, v: value(shot) })).filter((p): p is { shot: EnrichedShot; v: number } => p.v !== null && Number.isFinite(p.v))
  if (points.length < 3) return null
  const H = 200
  const pad = { l: 52, r: 16, t: 14, b: 26 }
  const vs = points.map(p => p.v)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const margin = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 1)
  const y0 = lo - margin
  const y1 = hi + margin
  const sx = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r)
  const sy = (v: number) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join('')
  const active = hover === null ? null : points[hover]
  return <figure className="gs-chart">
    <figcaption>{label} by shot</figcaption>
    <div className="gs-chart-box" ref={box} onMouseLeave={() => setHover(null)} onMouseMove={event => {
      const box = event.currentTarget.getBoundingClientRect()
      const x = ((event.clientX - box.left) / box.width) * W
      setHover(Math.max(0, Math.min(points.length - 1, Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (points.length - 1)))))
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over ${points.length} shots, from ${fmt(lo, places)} to ${fmt(hi, places)} ${unit}`}>
        {niceTicks(y0, y1, 4).map(t => <g key={t}><line className="gs-grid" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)}/><text className="gs-axis" x={pad.l - 8} y={sy(t) + 4} textAnchor="end">{t}</text></g>)}
        <path className="gs-line" d={path}/>
        {active && <><line className="gs-crosshair" x1={sx(hover!)} x2={sx(hover!)} y1={pad.t} y2={H - pad.b}/><circle className="gs-dot-mark" cx={sx(hover!)} cy={sy(active.v)} r={5}/></>}
        <text className="gs-axis" x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle">Shot number</text>
      </svg>
      {active && <Tooltip tip={{ x: sx(hover!), y: sy(active.v), content: <><b>Shot {hover! + 1}</b>: {fmt(active.v, places)} {unit}<br/>{clubLabel(active.shot.club)} · {new Date(active.shot.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</> }} width={W} height={H}/>}
    </div>
  </figure>
}
