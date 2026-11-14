import { memo } from 'react'
import type { RadarToken } from '@/lib/axiom-radar-types'

export type ChartWindow = 's30' | 'm1' | 'm5' | 'm10'

export const chartWindows: Array<{ key: ChartWindow; label: string; long: string }> = [
  { key: 's30', label: '30s', long: '30 seconds' },
  { key: 'm1', label: '1m', long: '1 minute' },
  { key: 'm5', label: '5m', long: '5 minutes' },
  { key: 'm10', label: '10m', long: '10 minutes' },
]

export const chartWindowMs: Record<ChartWindow, number> = { s30: 30_000, m1: 60_000, m5: 300_000, m10: 600_000 }

export function sparkPoints(token: RadarToken, window: ChartWindow) {
  const { fast, slow } = token.spark ?? { fast: [], slow: [] }
  return window === 's30' ? fast.slice(-30) : window === 'm1' ? fast : window === 'm5' ? slow.slice(-60) : slow
}

type PriceSparkProps = { points: number[]; width?: number; height?: number; fluid?: boolean }

const samePoints = (previous: PriceSparkProps, next: PriceSparkProps) =>
  previous.width === next.width && previous.height === next.height && previous.fluid === next.fluid
  && previous.points.length === next.points.length && previous.points[0] === next.points[0] && previous.points.at(-1) === next.points.at(-1)

export const PriceSpark = memo(function PriceSpark({ points, width = 110, height = 32, fluid = false }: PriceSparkProps) {
  if (points.length < 2) return <span className="radar-spark-empty" style={{ width: fluid ? '100%' : width, height, lineHeight: `${height}px` }} aria-hidden="true">collecting…</span>
  const minimum = Math.min(...points)
  const maximum = Math.max(...points)
  const range = maximum - minimum || maximum * 0.002 || 1
  const step = (width - 2) / (points.length - 1)
  const coordinates = points.map((point, index) => `${(1 + index * step).toFixed(1)},${(height - 2 - ((point - minimum) / range) * (height - 4)).toFixed(1)}`).join(' ')
  const rising = points[points.length - 1] >= points[0]
  return <svg className={`radar-pricespark ${rising ? 'up' : 'down'}`} viewBox={`0 0 ${width} ${height}`} width={fluid ? '100%' : width} height={height} preserveAspectRatio="none" aria-hidden="true">
    <polygon points={`1,${height} ${coordinates} ${width - 1},${height}`}/>
    <polyline points={coordinates}/>
  </svg>
}, samePoints)

export function ChartWindowPicker({ value, onChange, label = 'Chart window' }: { value: ChartWindow; onChange: (value: ChartWindow) => void; label?: string }) {
  return <div className="radar-window-picker" role="group" aria-label={label}>
    <span>{label}</span>
    {chartWindows.map(item => <button key={item.key} type="button" aria-pressed={value === item.key} className={value === item.key ? 'active' : ''} onClick={() => onChange(item.key)} title={`Show the last ${item.long}`}>{item.label}</button>)}
  </div>
}
