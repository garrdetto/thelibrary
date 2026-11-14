import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LoaderCircle, Minus, Plus } from 'lucide-react'
import { formatPrice, formatUsd } from './format'

type CandleInterval = 'm1' | 'm5' | 'm15' | 'h1' | 'h4' | 'd1'
type Candle = { t: number; open: number; high: number; low: number; close: number; volume: number }
type IntervalSpec = { id: CandleInterval; label: string; timeframe: 'minute' | 'hour' | 'day'; aggregate: number; seconds: number; refreshMs: number }

const intervals: IntervalSpec[] = [
  { id: 'm1', label: '1m', timeframe: 'minute', aggregate: 1, seconds: 60, refreshMs: 15_000 },
  { id: 'm5', label: '5m', timeframe: 'minute', aggregate: 5, seconds: 300, refreshMs: 20_000 },
  { id: 'm15', label: '15m', timeframe: 'minute', aggregate: 15, seconds: 900, refreshMs: 30_000 },
  { id: 'h1', label: '1h', timeframe: 'hour', aggregate: 1, seconds: 3_600, refreshMs: 60_000 },
  { id: 'h4', label: '4h', timeframe: 'hour', aggregate: 4, seconds: 14_400, refreshMs: 60_000 },
  { id: 'd1', label: '1D', timeframe: 'day', aggregate: 1, seconds: 86_400, refreshMs: 120_000 },
]
const zoomLevels = [30, 60, 90, 140, 200]
const chartHeight = 290
const priceBottom = 214
const volumeTop = 228
const volumeBottom = 266
const axisWidth = 70
const busyRetryMs = 30_000
const candleCache = new Map<string, Candle[]>()

class BusyError extends Error {}

async function fetchCandles(pairAddress: string, spec: IntervalSpec, signal: AbortSignal): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pairAddress)}/ohlcv/${spec.timeframe}?aggregate=${spec.aggregate}&limit=300&currency=usd&token=base`
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (response.status === 429) throw new BusyError('GeckoTerminal is busy. Retrying shortly.')
  if (response.status === 404) throw new Error('GeckoTerminal has no candles for this pool yet.')
  if (!response.ok) throw new Error('Candles are unavailable right now.')
  const body = await response.json() as { data?: { attributes?: { ohlcv_list?: unknown } } }
  const rows = Array.isArray(body.data?.attributes?.ohlcv_list) ? body.data.attributes.ohlcv_list as unknown[] : []
  return rows
    .filter((row): row is number[] => Array.isArray(row) && row.length >= 6 && row.slice(0, 6).every(value => typeof value === 'number' && Number.isFinite(value)))
    .map(([t, open, high, low, close, volume]) => ({ t: t * 1000, open, high, low, close, volume }))
    .sort((first, second) => first.t - second.t)
}

function withLivePrice(candles: Candle[], price: number | null, seconds: number, now: number) {
  if (!candles.length || price === null || !(price > 0)) return candles
  const period = seconds * 1000
  const bucket = Math.floor(now / period) * period
  const last = candles[candles.length - 1]
  if (last.t === bucket) return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }]
  if (bucket > last.t) return [...candles, { t: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }]
  return candles
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.round(entries[0].contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function timeLabel(t: number, seconds: number) {
  const date = new Date(t)
  if (seconds >= 86_400) return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (seconds >= 3_600) return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const changeOf = (candle: Candle) => candle.open > 0 ? candle.close / candle.open - 1 : 0

export function CandleChart({ pairAddress, livePrice, marketCap, symbol }: { pairAddress: string; livePrice: number | null; marketCap: number | null; symbol: string }) {
  const [interval, setIntervalId] = useState<CandleInterval>('m1')
  const [zoom, setZoom] = useState(2)
  const [logScale, setLogScale] = useState(true)
  const [showPrice, setShowPrice] = useState(false)
  const supply = livePrice !== null && livePrice > 0 && marketCap !== null && marketCap > 0 ? marketCap / livePrice : null
  const asMarketCap = supply !== null && !showPrice
  const factor = asMarketCap ? supply : 1
  const show = (value: number | null | undefined) => asMarketCap ? formatUsd(value) : formatPrice(value)
  const [candles, setCandles] = useState<Candle[] | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const { ref, width } = useWidth()
  const spec = intervals.find(item => item.id === interval) ?? intervals[0]

  useEffect(() => {
    const controller = new AbortController()
    const key = `${pairAddress}:${spec.id}`
    let timer: ReturnType<typeof setTimeout> | null = null
    setCandles(candleCache.get(key) ?? null)
    setError('')
    setActive(null)
    const load = async () => {
      let wait = spec.refreshMs
      try {
        const next = await fetchCandles(pairAddress, spec, controller.signal)
        candleCache.set(key, next)
        setCandles(next)
        setError('')
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof BusyError) wait = busyRetryMs
        setError(failure instanceof Error ? failure.message : 'Candles are unavailable right now.')
      }
      if (!controller.signal.aborted) timer = setTimeout(load, wait)
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [pairAddress, spec])

  const merged = useMemo(() => (candles ? withLivePrice(candles, livePrice, spec.seconds, Date.now()) : []).map(candle => factor === 1 ? candle : { ...candle, open: candle.open * factor, high: candle.high * factor, low: candle.low * factor, close: candle.close * factor }), [candles, livePrice, spec.seconds, factor])
  const visible = merged.slice(-zoomLevels[zoom])
  const plotWidth = width - axisWidth
  const step = visible.length ? plotWidth / visible.length : plotWidth
  const bodyWidth = Math.max(1, Math.min(14, step * 0.68))

  const scale = useMemo(() => {
    if (!visible.length) return null
    const low = Math.min(...visible.map(candle => candle.low))
    const high = Math.max(...visible.map(candle => candle.high))
    const useLog = logScale && low > 0
    const project = (value: number) => useLog ? Math.log(value) : value
    const bottom = project(low)
    const top = project(high)
    const pad = (top - bottom || Math.abs(top) * 0.02 || 1) * 0.06
    const min = bottom - pad
    const max = top + pad
    const y = (value: number) => 8 + (1 - (project(Math.max(value, useLog ? Number.MIN_VALUE : value)) - min) / (max - min)) * (priceBottom - 8)
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const projected = min + ((max - min) * (index + 0.5)) / 5
      return useLog ? Math.exp(projected) : projected
    })
    const maxVolume = Math.max(...visible.map(candle => candle.volume), 0)
    return { y, ticks, maxVolume }
  }, [visible, logScale])

  const focus = active !== null && active < visible.length ? visible[active] : visible.at(-1)
  const first = visible[0]
  const last = visible.at(-1)
  const rangeChange = first && last && first.open > 0 ? last.close / first.open - 1 : null

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * (width / bounds.width)
    if (x > plotWidth) return setActive(null)
    setActive(Math.max(0, Math.min(visible.length - 1, Math.floor(x / step))))
  }
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!visible.length) return
    const current = active ?? visible.length - 1
    if (event.key === 'ArrowLeft') { event.preventDefault(); setActive(Math.max(0, current - 1)) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setActive(Math.min(visible.length - 1, current + 1)) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End' || event.key === 'Escape') { event.preventDefault(); setActive(null) }
  }

  const labelEvery = Math.max(1, Math.ceil(90 / step))

  return <div className="radar-candles">
    <div className="radar-candle-toolbar">
      <div className="radar-window-picker" role="group" aria-label="Candle size">
        {intervals.map(item => <button key={item.id} type="button" aria-pressed={interval === item.id} className={interval === item.id ? 'active' : ''} onClick={() => setIntervalId(item.id)}>{item.label}</button>)}
      </div>
      <div className="radar-candle-tools">
        {supply !== null && <div className="radar-window-picker" role="group" aria-label="Chart value">
          <button type="button" aria-pressed={asMarketCap} className={asMarketCap ? 'active' : ''} onClick={() => setShowPrice(false)}>Market cap</button>
          <button type="button" aria-pressed={!asMarketCap} className={!asMarketCap ? 'active' : ''} onClick={() => setShowPrice(true)}>Price</button>
        </div>}
        <button type="button" className={`radar-toggle ${logScale ? 'on' : ''}`} aria-pressed={logScale} onClick={() => setLogScale(value => !value)}>Log scale</button>
        <button type="button" className="radar-icon-button" aria-label="Zoom out, show more candles" disabled={zoom === zoomLevels.length - 1} onClick={() => setZoom(value => Math.min(zoomLevels.length - 1, value + 1))}><Minus size={14}/></button>
        <button type="button" className="radar-icon-button" aria-label="Zoom in, show fewer candles" disabled={zoom === 0} onClick={() => setZoom(value => Math.max(0, value - 1))}><Plus size={14}/></button>
      </div>
    </div>

    {focus && <p className="radar-candle-readout tabular" aria-live="polite">
      <span>{timeLabel(focus.t, spec.seconds)}{active === null ? ' · live' : ''}</span>
      <span>O <strong>{show(focus.open)}</strong></span>
      <span>H <strong>{show(focus.high)}</strong></span>
      <span>L <strong>{show(focus.low)}</strong></span>
      <span>C <strong className={focus.close >= focus.open ? 'radar-delta up' : 'radar-delta down'}>{show(focus.close)}</strong></span>
      <span>{changeOf(focus) >= 0 ? '+' : ''}{(changeOf(focus) * 100).toFixed(1)}%</span>
      <span>Vol <strong>{formatUsd(focus.volume)}</strong></span>
    </p>}

    <div ref={ref} className="radar-candle-box">
      {!candles ? <p className="radar-muted">{error || <><LoaderCircle size={14} className="spin"/> Loading candles…</>}</p>
        : !visible.length || !scale ? <p className="radar-muted">No trades in this range yet.</p>
        : <svg width={width} height={chartHeight} viewBox={`0 0 ${width} ${chartHeight}`} role="img" tabIndex={0}
          aria-label={`${symbol} ${spec.label} ${asMarketCap ? 'market cap' : 'price'} candles, ${visible.length} shown. Latest ${show(last?.close)}${rangeChange === null ? '' : `, ${rangeChange >= 0 ? 'up' : 'down'} ${Math.abs(rangeChange * 100).toFixed(1)}% over the range`}. Use the left and right arrow keys to read each candle.`}
          onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)} onKeyDown={onKeyDown}>
          {scale.ticks.map(tick => <g key={tick}>
            <line x1={0} x2={plotWidth} y1={scale.y(tick)} y2={scale.y(tick)} className="radar-candle-grid"/>
            <text x={plotWidth + 6} y={scale.y(tick) + 3} className="radar-candle-axis">{show(tick)}</text>
          </g>)}
          {visible.map((candle, index) => {
            const x = index * step + step / 2
            const up = candle.close >= candle.open
            const top = scale.y(Math.max(candle.open, candle.close))
            const bottom = scale.y(Math.min(candle.open, candle.close))
            const volumeHeight = scale.maxVolume > 0 ? (candle.volume / scale.maxVolume) * (volumeBottom - volumeTop) : 0
            return <g key={candle.t} className={up ? 'up' : 'down'} opacity={active !== null && active !== index ? 0.55 : 1}>
              <line x1={x} x2={x} y1={scale.y(candle.high)} y2={scale.y(candle.low)} className="radar-candle-wick"/>
              <rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1, bottom - top)} className="radar-candle-body"/>
              <rect x={x - bodyWidth / 2} y={volumeBottom - volumeHeight} width={bodyWidth} height={volumeHeight} className="radar-candle-volume"/>
              {index % labelEvery === 0 && <text x={x} y={chartHeight - 6} textAnchor="middle" className="radar-candle-axis">{timeLabel(candle.t, spec.seconds)}</text>}
            </g>
          })}
          {last && <g>
            <line x1={0} x2={plotWidth} y1={scale.y(last.close)} y2={scale.y(last.close)} className="radar-candle-last"/>
            <rect x={plotWidth + 2} y={scale.y(last.close) - 8} width={axisWidth - 4} height={16} rx={3} className={last.close >= last.open ? 'radar-candle-tag up' : 'radar-candle-tag down'}/>
            <text x={plotWidth + 6} y={scale.y(last.close) + 4} className="radar-candle-tag-text">{show(last.close)}</text>
          </g>}
          {active !== null && visible[active] && <line x1={active * step + step / 2} x2={active * step + step / 2} y1={0} y2={volumeBottom} className="radar-candle-cross"/>}
        </svg>}
    </div>
    {candles && error && <p className="radar-muted" role="status">{error}</p>}
    <p className="radar-note">Candles from GeckoTerminal, with the tracker's live price merged into the newest candle. Gaps mean no trades in that period.</p>
  </div>
}
