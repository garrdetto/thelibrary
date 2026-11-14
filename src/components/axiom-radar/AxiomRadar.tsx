import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, Brain, ExternalLink, Radar, RefreshCw, Search } from 'lucide-react'
import type { RadarToken } from '@/lib/axiom-radar-types'
import { formatPercent, formatSigned, relativeSeconds } from './format'
import { PaperTrades } from './PaperTrades'
import { RadarTable, type RadarSort, type RadarSortKey } from './RadarTable'
import { TokenDrawer } from './TokenDrawer'
import { useRadarFeed } from './useRadarFeed'
import './axiom-radar.css'

type RadarFilter = 'all' | 'surge' | 'runners' | 'safe' | 'score80'

const filters: Array<{ id: RadarFilter; label: string; test: (token: RadarToken) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'surge', label: '🔥 Viewer Surge (+25/5m)', test: token => (token.viewersDelta5m ?? 0) >= 25 },
  { id: 'runners', label: '🐋 Runner Wallets', test: token => token.runnerWallets > 0 },
  { id: 'safe', label: '🛡️ Safe Only', test: token => token.safety.level === 'safe' },
  { id: 'score80', label: '⚡ Score 80+', test: token => token.score >= 80 },
]

const alertScore = 85

function sortValue(token: RadarToken, key: RadarSortKey) {
  const value = token[key]
  return typeof value === 'number' ? value : Number.NEGATIVE_INFINITY
}

function playChime(context: AudioContext) {
  const start = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, start)
  oscillator.frequency.exponentialRampToValueAtTime(1320, start + 0.14)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + 0.5)
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function AxiomRadar({ embedded = false }: { embedded?: boolean }) {
  const { payload, connection, error, receivedAt, retry } = useRadarFeed()
  const now = useNow(1000)
  const [tab, setTab] = useState<'radar' | 'paper'>('radar')
  const [filter, setFilter] = useState<RadarFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RadarSort>({ key: 'score', direction: 'desc' })
  const [selected, setSelected] = useState<string | null>(null)
  const [sound, setSound] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const audioRef = useRef<AudioContext | null>(null)
  const alertedRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!payload) return
    const hot = payload.tokens.filter(token => token.score >= alertScore)
    if (!alertedRef.current) {
      alertedRef.current = new Set(hot.map(token => token.mint))
      return
    }
    const fresh = hot.filter(token => !alertedRef.current?.has(token.mint))
    for (const token of fresh) alertedRef.current.add(token.mint)
    if (!fresh.length) return
    setAnnouncement(`${fresh.map(token => `${token.symbol} reached score ${token.score}`).join('. ')}.`)
    if (sound && audioRef.current) {
      void audioRef.current.resume().then(() => audioRef.current && playChime(audioRef.current)).catch(() => undefined)
    }
  }, [payload, sound])

  useEffect(() => () => { void audioRef.current?.close().catch(() => undefined) }, [])

  function toggleSound() {
    if (!sound) {
      try {
        audioRef.current ??= new AudioContext()
        void audioRef.current.resume()
        playChime(audioRef.current)
      } catch { }
    }
    setSound(value => !value)
  }

  const onSort = useCallback((key: RadarSortKey) => {
    setSort(current => current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'ageMinutes' ? 'asc' : 'desc' })
  }, [])
  const onOpen = useCallback((mint: string) => setSelected(mint), [])
  const onClose = useCallback(() => setSelected(null), [])

  const tokens = useMemo(() => payload?.tokens ?? [], [payload])
  const ranks = useMemo(() => new Map(tokens.map((token, index) => [token.mint, index + 1])), [tokens])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const test = filters.find(item => item.id === filter)?.test ?? (() => true)
    const multiplier = sort.direction === 'asc' ? 1 : -1
    return tokens
      .filter(token => test(token) && (!needle || token.symbol.toLowerCase().includes(needle) || token.name.toLowerCase().includes(needle) || token.mint.toLowerCase().includes(needle)))
      .sort((first, second) => (sortValue(first, sort.key) - sortValue(second, sort.key)) * multiplier || second.score - first.score)
  }, [tokens, filter, query, sort])
  const lastSelectedRef = useRef<RadarToken | null>(null)
  const found = selected ? tokens.find(token => token.mint === selected) ?? null : null
  if (found) lastSelectedRef.current = found
  const selectedToken = selected ? found ?? (lastSelectedRef.current?.mint === selected ? lastSelectedRef.current : null) : null

  const workerStatus = payload?.status ?? 'offline'
  const fresh = receivedAt > 0 && now - receivedAt < 10_000
  const badge = connection === 'error' ? { tone: 'down', label: 'Disconnected' }
    : connection === 'connecting' ? { tone: 'idle', label: 'Connecting…' }
    : !fresh ? { tone: 'warn', label: 'Reconnecting…' }
    : workerStatus === 'live' ? { tone: 'up', label: 'Live' }
    : workerStatus === 'stale' ? { tone: 'warn', label: 'Worker stale' }
    : { tone: 'down', label: 'Worker offline' }

  return <section className={`radar-page-body ${embedded ? 'radar-embedded' : ''}`}>
    {embedded
      ? <p className="radar-embedded-note">Signals only: nothing here places a trade. <a href="/admin/axiom-radar">Open full screen<ExternalLink size={11}/></a></p>
      : <header className="radar-heading">
        <span className="section-eyebrow">ADMIN · MARKET INTELLIGENCE</span>
        <h1>Axiom Radar</h1>
        <p>Live viewer momentum, runner-wallet entries and safety checks for Solana launches under five hours old, plus a paper-trading loop that tunes its own scoring weights. Signals only. Nothing here places a trade.</p>
      </header>}

    <div className="radar-controls">
      <span className={`radar-live ${badge.tone}`} role="status" aria-live="polite">
        <span className="radar-live-dot" aria-hidden="true"/>
        <strong>{badge.label}</strong>
        <small className="tabular">{receivedAt ? `updated ${relativeSeconds(receivedAt, now)}` : 'waiting for data'}{connection === 'polling' ? ' · polling 3s' : connection === 'streaming' ? ' · stream 3s' : ''}</small>
      </span>
      {connection === 'error' && <button type="button" className="secondary-button" onClick={retry}><RefreshCw size={13}/> Retry</button>}
      <button type="button" className={`radar-toggle ${sound ? 'on' : ''}`} aria-pressed={sound} onClick={toggleSound}>
        {sound ? <Bell size={14}/> : <BellOff size={14}/>} Sound alert · score ≥ {alertScore}
      </button>
      <div className="radar-subtabs" role="tablist" aria-label="Axiom Radar views">
        <button type="button" role="tab" id="radar-tab-radar" aria-controls="radar-panel" aria-selected={tab === 'radar'} className={tab === 'radar' ? 'active' : ''} onClick={() => setTab('radar')}><Radar size={14}/> Radar</button>
        <button type="button" role="tab" id="radar-tab-paper" aria-controls="radar-panel" aria-selected={tab === 'paper'} className={tab === 'paper' ? 'active' : ''} onClick={() => setTab('paper')}><Brain size={14}/> Paper trades & learning</button>
      </div>
    </div>

    {payload && payload.components.length > 0 && <ul className="radar-components" aria-label="Worker components">
      {payload.components.map(component => <li key={component.component} className={now - component.updatedAt > 60_000 ? 'stale' : component.status === 'ok' ? 'ok' : 'warn'} title={component.detail ?? undefined}>
        <span aria-hidden="true"/>{component.component}: {component.status}<small>{relativeSeconds(component.updatedAt, now)}</small>
      </li>)}
    </ul>}

    <p className="sr-only" aria-live="assertive">{announcement}</p>
    {error && <p role="alert" className="radar-inline-error">{error}</p>}
    {payload?.message && <p className="radar-notice" role="note">{payload.message}</p>}

    {!payload && !error && <div className="radar-skeleton" aria-busy="true" aria-label="Loading Axiom Radar"><span/><span/><span/><span/></div>}

    {payload && <div id="radar-panel" role="tabpanel" aria-labelledby={tab === 'radar' ? 'radar-tab-radar' : 'radar-tab-paper'}>
      {tab === 'radar' ? <>
        <div className="radar-kpis">
          <div className="radar-kpi"><span>Tracked &lt;5h coins</span><strong className="tabular">{payload.kpis.tracked}</strong><small>Passing the launch filter</small></div>
          <div className="radar-kpi"><span>Fastest viewer surge</span><strong className="tabular radar-delta up">{payload.kpis.fastestSurge ? `${formatSigned(payload.kpis.fastestSurge.delta)}/5m` : '—'}</strong><small>{payload.kpis.fastestSurge ? payload.kpis.fastestSurge.symbol : 'No viewer data yet'}</small></div>
          <div className="radar-kpi"><span>Runner wallet signals</span><strong className="tabular">🐋 {payload.kpis.runnerSignals}</strong><small>Entries in the last hour</small></div>
          <div className="radar-kpi"><span>Paper-trade win rate</span><strong className="tabular">{formatPercent(payload.kpis.winRate, 0)}</strong><small>{payload.kpis.completedTrades} completed trades</small></div>
        </div>

        <div className="radar-filters">
          <div className="radar-chips" role="group" aria-label="Quick filters">
            {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>
              {item.label}<span className="tabular">{tokens.filter(item.test).length}</span>
            </button>)}
          </div>
          <label className="radar-search">
            <Search size={14} aria-hidden="true"/>
            <span className="sr-only">Search by symbol, name or mint</span>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search symbol or mint…" maxLength={64} spellCheck={false} autoComplete="off"/>
          </label>
        </div>

        {visible.length > 0
          ? <RadarTable tokens={visible} ranks={ranks} sort={sort} onSort={onSort} onOpen={onOpen} selected={selected}/>
          : <div className="radar-empty">
            <Radar size={36} strokeWidth={1}/>
            <h3>{tokens.length ? 'No coins match these filters.' : workerStatus === 'offline' ? 'The radar is quiet.' : 'Scanning for launches…'}</h3>
            <p>{tokens.length ? 'Clear the search or choose another filter.' : workerStatus === 'offline' ? 'Start the tracker worker to begin collecting launches.' : 'Coins appear here once they pass the 5-minute volume, activity, liquidity and buy-pressure filter.'}</p>
            {tokens.length > 0 && <button type="button" className="secondary-button" onClick={() => { setFilter('all'); setQuery('') }}>Show all coins</button>}
          </div>}
      </> : <PaperTrades payload={payload} now={now}/>}
    </div>}

    {selectedToken && <TokenDrawer token={selectedToken} onClose={onClose}/>}
  </section>
}

export default AxiomRadar
