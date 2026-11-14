import { AxiomLink, CoinName, onActivate } from './AxiomLink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, Brain, ChevronDown, Flame, FlaskConical, Gem, List, ListChecks, Radar, Rocket, RefreshCw, Search, Settings2, Sparkles, TrendingUp, Wallet, X } from 'lucide-react'
import { defaultRadarSettings, type RadarSettings, type RadarTheme } from '@/lib/axiom-radar-settings'
import type { RadarGainWindow, RadarToken } from '@/lib/axiom-radar-types'
import { formatCount, formatPercent, formatSigned, holderCount, relativeSeconds } from './format'
import { EarlyRunners, ExplodeView, WatchListView } from './LearnedViews'
import { MakerView, type MakerSort } from './MakerView'
import { ResearchView } from './ResearchView'
import { MoversView } from './MoversView'
import { PaperTrades } from './PaperTrades'
import { PicksView } from './PicksView'
import { ChartWindowPicker, PriceSpark, sparkPoints, type ChartWindow } from './PriceSpark'
import { applyRadarTheme } from './theme'
import { RadarTable, TokenIcon, sortValue, type RadarSort, type RadarSortKey } from './RadarTable'
import { SettingsView } from './SettingsView'
import { TokenDrawer } from './TokenDrawer'
import { saveRadarSettings, useRadarFeed } from './useRadarFeed'
import { WalletsView } from './WalletsView'
import './axiom-radar.css'

type RadarTab = 'picks' | 'coins' | 'explode' | 'maker' | 'watchlist' | 'research' | 'movers' | 'wallets' | 'paper' | 'settings'
type RadarFilter = 'all' | 'surge' | 'buy' | 'watch' | 'holders' | 'clean' | 'pinned'
type RadarToast = { id: string; kind: 'surge' | 'buy'; mint: string; text: string; at: number }

const tabs: Array<{ id: RadarTab; label: string; icon: typeof Radar }> = [
  { id: 'picks', label: 'Picks', icon: Sparkles },
  { id: 'coins', label: 'All coins', icon: List },
  { id: 'explode', label: 'Could explode', icon: Rocket },
  { id: 'maker', label: 'Millionaire Maker', icon: Gem },
  { id: 'watchlist', label: 'Watch List', icon: ListChecks },
  { id: 'research', label: 'Research Info', icon: FlaskConical },
  { id: 'movers', label: 'Top movers', icon: TrendingUp },
  { id: 'wallets', label: 'Smart wallets', icon: Wallet },
  { id: 'paper', label: 'Paper trades', icon: Brain },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const filters: Array<{ id: RadarFilter; label: string; test: (token: RadarToken) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'surge', label: '🔥 Gaining viewers', test: token => token.viewerSurge },
  { id: 'buy', label: '🟢 Buy', test: token => token.signal === 'buy' },
  { id: 'watch', label: '👀 Watch', test: token => token.signal === 'watch' },
  { id: 'holders', label: '🐋 Smart holders', test: token => token.runnerWallets > 0 },
  { id: 'clean', label: '🛡️ No red flags', test: token => token.quality.score !== null && !token.alerts.length && !token.quality.checks.some(check => check.status === 'fail') },
  { id: 'pinned', label: '⭐ Pinned', test: token => token.pinned },
]

const gainWindows: Array<{ id: RadarGainWindow; label: string; spoken: string; suffix: string }> = [
  { id: 's5', label: '5s', spoken: '5 seconds', suffix: ' in 5s' },
  { id: 's15', label: '15s', spoken: '15 seconds', suffix: ' in 15s' },
  { id: 's30', label: '30s', spoken: '30 seconds', suffix: ' in 30s' },
  { id: 'm1', label: '1m', spoken: 'minute', suffix: '/min' },
]

const alertCooldownMs = { surge: 120_000, buy: 300_000 }
const toastLifetimeMs = 25_000

function playChime(context: AudioContext, high: boolean) {
  const start = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(high ? 990 : 740, start)
  oscillator.frequency.exponentialRampToValueAtTime(high ? 1480 : 1110, start + 0.14)
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

export function AxiomRadar() {
  const { payload, connection, error, receivedAt, applySavedSettings, retry } = useRadarFeed()
  const now = useNow(1000)
  const [tab, setTab] = useState<RadarTab>('picks')
  const [filter, setFilter] = useState<RadarFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RadarSort>({ key: 'viewers', direction: 'desc' })
  const [selected, setSelected] = useState<string | null>(null)
  const [sound, setSound] = useState(false)
  const [desktopAlerts, setDesktopAlerts] = useState(false)
  const [toasts, setToasts] = useState<RadarToast[]>([])
  const [draft, setDraft] = useState<RadarSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [chartWindow, setChartWindow] = useState<ChartWindow>('m5')
  const [previewTheme, setPreviewTheme] = useState<RadarTheme | null>(null)
  const [showHealth, setShowHealth] = useState(false)
  const [gainMode, setGainMode] = useState<'viewers' | 'holders'>('viewers')
  const [gainWindow, setGainWindow] = useState<RadarGainWindow>('m1')
  const [makerFilters, setMakerFilters] = useState<string[] | null>(null)
  const [makerSort, setMakerSort] = useState<MakerSort>('match')
  const audioRef = useRef<AudioContext | null>(null)
  const seededRef = useRef(false)
  const previousRef = useRef({ surge: new Set<string>(), buy: new Set<string>() })
  const alertedRef = useRef(new Map<string, number>())
  const lastSelectedRef = useRef<RadarToken | null>(null)

  const settings = draft ?? payload?.savedSettings ?? payload?.settings ?? defaultRadarSettings
  const tokens = useMemo(() => (payload?.tokens ?? []).map(token => token.pinned === settings.pinned.includes(token.mint) ? token : { ...token, pinned: settings.pinned.includes(token.mint) }), [payload, settings.pinned])

  const themeKey = JSON.stringify(previewTheme ?? settings.theme)
  useEffect(() => applyRadarTheme(JSON.parse(themeKey) as RadarTheme), [themeKey])

  const persist = useCallback(async (next: RadarSettings) => {
    setDraft(next)
    setSaving(true)
    setSaveError('')
    try {
      applySavedSettings(await saveRadarSettings(next))
      setDraft(null)
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }, [applySavedSettings])

  const onTogglePin = useCallback((mint: string) => {
    const pinned = settings.pinned.includes(mint) ? settings.pinned.filter(item => item !== mint) : [...settings.pinned, mint].slice(-50)
    void persist({ ...settings, pinned })
  }, [persist, settings])

  useEffect(() => {
    if (!payload) return
    const surging = tokens.filter(token => token.viewerSurge)
    const buys = tokens.filter(token => token.signal === 'buy')
    const previous = previousRef.current
    previousRef.current = { surge: new Set(surging.map(token => token.mint)), buy: new Set(buys.map(token => token.mint)) }
    if (!seededRef.current) {
      seededRef.current = true
      return
    }
    const stamp = Date.now()
    const fresh: RadarToast[] = []
    const consider = (kind: 'surge' | 'buy', token: RadarToken, text: string) => {
      const key = `${kind}:${token.mint}`
      if (previous[kind].has(token.mint) || stamp - (alertedRef.current.get(key) ?? 0) < alertCooldownMs[kind]) return
      alertedRef.current.set(key, stamp)
      fresh.push({ id: `${key}:${stamp}`, kind, mint: token.mint, text, at: stamp })
    }
    for (const token of surging) consider('surge', token, `${token.symbol} is gaining viewers quickly: ${formatSigned(token.viewersPerMin)}/min, ${formatCount(token.viewers)} watching`)
    for (const token of buys) consider('buy', token, `${token.symbol} is now a recommended buy (score ${token.score})`)
    if (!fresh.length) return
    setToasts(current => [...fresh, ...current].slice(0, 6))
    if (sound && audioRef.current) {
      const context = audioRef.current
      void context.resume().then(() => playChime(context, fresh.some(toast => toast.kind === 'buy'))).catch(() => undefined)
    }
    if (desktopAlerts && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const toast of fresh) {
        try { new Notification('Axiom Radar', { body: toast.text, tag: toast.id }) } catch { }
      }
    }
  }, [payload, tokens, sound, desktopAlerts])

  useEffect(() => () => { void audioRef.current?.close().catch(() => undefined) }, [])

  function toggleSound() {
    if (!sound) {
      try {
        audioRef.current ??= new AudioContext()
        void audioRef.current.resume()
        playChime(audioRef.current, false)
      } catch { }
    }
    setSound(value => !value)
  }

  async function toggleDesktopAlerts() {
    if (desktopAlerts) return setDesktopAlerts(false)
    if (typeof Notification === 'undefined') return
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setDesktopAlerts(permission === 'granted')
  }

  const onSort = useCallback((key: RadarSortKey) => {
    setSort(current => current.key === key ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: key === 'ageMinutes' ? 'asc' : 'desc' })
  }, [])
  const onOpen = useCallback((mint: string) => setSelected(mint), [])
  const onClose = useCallback(() => setSelected(null), [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const test = filters.find(item => item.id === filter)?.test ?? (() => true)
    const multiplier = sort.direction === 'asc' ? 1 : -1
    return tokens
      .filter(token => test(token) && (!needle || token.symbol.toLowerCase().includes(needle) || token.name.toLowerCase().includes(needle) || token.mint.toLowerCase().includes(needle)))
      .sort((first, second) => Number(second.pinned) - Number(first.pinned) || (sortValue(first, sort.key) - sortValue(second, sort.key)) * multiplier || second.score - first.score)
  }, [tokens, filter, query, sort])

  const buyCount = tokens.filter(token => token.signal === 'buy').length
  const watchCount = tokens.filter(token => token.signal === 'watch').length
  const found = selected ? tokens.find(token => token.mint === selected) ?? null : null
  if (found) lastSelectedRef.current = found
  const selectedToken = selected ? found ?? (lastSelectedRef.current?.mint === selected ? lastSelectedRef.current : null) : null
  const liveToasts = toasts.filter(toast => now - toast.at < toastLifetimeMs)

  const workerStatus = payload?.status ?? 'offline'
  const fresh = receivedAt > 0 && now - receivedAt < 10_000
  const badge = connection === 'error' ? { tone: 'down', label: 'Disconnected' }
    : connection === 'connecting' ? { tone: 'idle', label: 'Connecting…' }
    : !fresh ? { tone: 'warn', label: 'Reconnecting…' }
    : workerStatus === 'live' ? { tone: 'up', label: 'Live' }
    : workerStatus === 'stale' ? { tone: 'warn', label: 'Tracker stale' }
    : { tone: 'down', label: 'Tracker offline' }
  const cadence = connection === 'local' ? 'every second, direct from this PC' : connection === 'streaming' ? 'viewers every second, through the site' : connection === 'polling' ? 'every 3 seconds' : ''
  const hasViewerData = tokens.some(token => token.viewers !== null)
  const hasHolderData = tokens.some(token => holderCount(token) !== null)
  const gainSpan = gainWindows.find(item => item.id === gainWindow) ?? gainWindows[3]
  const topGainers = useMemo(() => {
    const gainOf = (token: RadarToken) => {
      const measured = token.gains?.[gainMode][gainWindow]
      if (measured !== undefined && measured !== null) return measured
      return gainWindow === 'm1' ? (gainMode === 'viewers' ? token.viewersPerMin : token.holdersPerMin) ?? null : null
    }
    return tokens.map(token => ({ token, gain: gainOf(token) })).filter(entry => (entry.gain ?? 0) > 0).sort((first, second) => (second.gain ?? 0) - (first.gain ?? 0)).slice(0, 3)
  }, [tokens, gainMode, gainWindow])
  const components = payload?.components ?? []
  const componentState = (component: (typeof components)[number]) => component.status === 'disabled' ? 'off' : now - component.updatedAt > 90_000 ? 'stale' : component.status === 'ok' ? 'ok' : 'warn'
  const problems = components.filter(component => ['stale', 'warn'].includes(componentState(component)))

  return <section className="radar-page-body">
    <div className="radar-controls">
      <span className={`radar-live ${badge.tone}`} role="status">
        <span className="radar-live-dot" aria-hidden="true"/>
        <strong>{badge.label}</strong>
        <small className="tabular">{receivedAt ? `updated ${relativeSeconds(receivedAt, now)}` : 'waiting for data'}{cadence ? ` · ${cadence}` : ''}</small>
      </span>
      {connection === 'error' && <button type="button" className="secondary-button" onClick={retry}><RefreshCw size={13}/> Retry</button>}
      {components.length > 0 && <button type="button" className={`radar-health ${problems.length ? 'warn' : 'ok'}`} aria-expanded={showHealth} aria-controls="radar-health-list" onClick={() => setShowHealth(value => !value)}>
        <span className="radar-live-dot" aria-hidden="true"/>{problems.length ? `${problems.length} tracker ${problems.length === 1 ? 'issue' : 'issues'}` : 'Tracker healthy'}<ChevronDown size={13} aria-hidden="true" className={showHealth ? 'open' : ''}/>
      </button>}
      <span className="radar-controls-spacer" aria-hidden="true"/>
      <button type="button" className={`radar-icon-toggle ${sound ? 'on' : ''}`} aria-pressed={sound} aria-label="Sound alerts" title="Sound alerts" onClick={toggleSound}>{sound ? <Bell size={15}/> : <BellOff size={15}/>}</button>
      <button type="button" className={`radar-icon-toggle ${desktopAlerts ? 'on' : ''}`} aria-pressed={desktopAlerts} aria-label="Desktop alerts" title="Desktop alerts" onClick={() => void toggleDesktopAlerts()}><BellRing size={15}/></button>
    </div>

    {showHealth && components.length > 0 && <ul id="radar-health-list" className="radar-components" aria-label="Tracker components">
      {components.map(component => <li key={component.component} className={componentState(component)}>
        <span aria-hidden="true"/>{component.component}<small>{component.detail ?? component.status}</small>
      </li>)}
    </ul>}

    {error && <p role="alert" className="radar-inline-error">{error}</p>}
    {saveError && tab !== 'settings' && <p role="alert" className="radar-inline-error">{saveError}</p>}
    {payload?.message && <p className="radar-notice" role="note">{payload.message}</p>}
    {!payload && !error && <div className="radar-skeleton" aria-busy="true" aria-label="Loading Axiom Radar"><span/><span/><span/><span/></div>}

    <div className="radar-toasts" role="log" aria-live="assertive" aria-label="Alerts">
      {liveToasts.map(toast => <div key={toast.id} className={`radar-toast ${toast.kind}`}>
        <button type="button" className="radar-toast-body" onClick={() => onOpen(toast.mint)}>{toast.kind === 'surge' ? '🔥' : '🟢'} {toast.text}</button>
        <AxiomLink pairAddress={tokens.find(token => token.mint === toast.mint)?.pairAddress} symbol={toast.text.split(' ')[0]} size={16}/>
        <button type="button" className="radar-icon-button" aria-label="Dismiss alert" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><X size={14}/></button>
      </div>)}
    </div>

    {payload && <>
      <section className="radar-top3" aria-labelledby="radar-top3-title">
        <div className="radar-top3-head">
          <h2 id="radar-top3-title"><Flame size={16} aria-hidden="true"/> {gainMode === 'viewers' ? 'Gaining viewers fastest' : 'Gaining holders fastest'}</h2>
          <div className="radar-top3-pickers">
            <div className="radar-window-picker" role="group" aria-label="Rank the fastest gainers by">
              <button type="button" aria-pressed={gainMode === 'viewers'} className={gainMode === 'viewers' ? 'active' : ''} onClick={() => setGainMode('viewers')}>Viewers</button>
              <button type="button" aria-pressed={gainMode === 'holders'} className={gainMode === 'holders' ? 'active' : ''} onClick={() => setGainMode('holders')}>Holders</button>
            </div>
            <div className="radar-window-picker" role="group" aria-label="Measure the gain over">
              <span>Gain over</span>
              {gainWindows.map(item => <button key={item.id} type="button" aria-pressed={gainWindow === item.id} className={gainWindow === item.id ? 'active' : ''} onClick={() => setGainWindow(item.id)}>{item.label}</button>)}
            </div>
          </div>
        </div>
        {topGainers.length === 0 ? <p className="radar-empty-line">{gainMode === 'holders'
          ? hasHolderData ? `No tracked coin gained holders in the last ${gainSpan.spoken}.` : 'Waiting for holder counts. They arrive within a few seconds of a coin being tracked.'
          : hasViewerData ? `No tracked coin gained viewers in the last ${gainSpan.spoken}.` : 'Waiting for viewer counts. Keep Axiom Pulse open in Chrome with the Axiom Radar Bridge extension.'}</p>
          : <ol>{topGainers.map(({ token, gain }, index) => <li key={token.mint}>
            <div role="button" tabIndex={0} className={`radar-row-button ${gainMode === 'viewers' && token.viewerSurge ? 'surging' : ''}`} onClick={() => onOpen(token.mint)} onKeyDown={onActivate(() => onOpen(token.mint))} aria-label={gainMode === 'viewers'
              ? `${token.symbol}, ${token.viewers} viewers, ${formatSigned(gain)} in the last ${gainSpan.spoken}. Open details`
              : `${token.symbol}, ${holderCount(token) ?? 'unknown'} holders, ${formatSigned(gain)} in the last ${gainSpan.spoken}. Open details`}>
              <span className="radar-top3-rank tabular">{index + 1}</span>
              <TokenIcon token={token}/>
              <span className="radar-top3-name"><CoinName pairAddress={token.pairAddress} symbol={token.symbol}/><small>{gainMode === 'holders' ? `${formatCount(token.viewers)} watching` : token.viewerSurge ? 'This coin is gaining viewers quickly' : 'Viewers rising'}</small></span>
              <PriceSpark points={sparkPoints(token, chartWindow)} width={84} height={30}/>
              <span className="radar-top3-count"><strong className="tabular">{formatCount(gainMode === 'viewers' ? token.viewers : holderCount(token))}</strong><small className="tabular radar-delta up">{formatSigned(gain)}{gainSpan.suffix}</small></span>
            </div>
            <AxiomLink pairAddress={token.pairAddress} symbol={token.symbol} size={16}/>
          </li>)}</ol>}
      </section>

      <p className="radar-stats" aria-label="Radar summary">
        <span><strong className="tabular">{tokens.length}</strong> coins</span>
        <span><strong className="tabular">{tokens.filter(token => token.onPulse).length}</strong> on Pulse</span>
        <span><strong className="tabular">{buyCount}</strong> buy · <strong className="tabular">{watchCount}</strong> watch</span>
        <span>Paper win rate <strong className="tabular">{formatPercent(payload.kpis.winRate, 0)}</strong> of {payload.kpis.completedTrades}</span>
      </p>

      <div className="radar-tabbar">
      <div className="radar-tabs" role="tablist" aria-label="Axiom Radar views">
        {tabs.map(item => <button key={item.id} type="button" role="tab" id={`radar-tab-${item.id}`} aria-controls="radar-panel" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
          <item.icon size={14} aria-hidden="true"/> {item.label}{item.id === 'picks' && buyCount > 0 && <span className="radar-tab-count tabular">{buyCount}</span>}{item.id === 'explode' && (payload.explosions?.candidates.length ?? 0) > 0 && <span className="radar-tab-count tabular">{payload.explosions?.candidates.length}</span>}
        </button>)}
      </div>
      <ChartWindowPicker value={chartWindow} onChange={setChartWindow} label="Chart previews"/>
      </div>

      <div id="radar-panel" role="tabpanel" aria-labelledby={`radar-tab-${tab}`}>
        {tab === 'picks' && <div className="radar-picks"><EarlyRunners payload={payload} tokens={tokens} onOpen={onOpen}/><PicksView tokens={tokens} chartWindow={chartWindow} onOpen={onOpen} onTogglePin={onTogglePin}/></div>}
        {tab === 'explode' && <ExplodeView payload={payload} tokens={tokens} now={now} onOpen={onOpen}/>}
        {tab === 'maker' && <MakerView payload={payload} tokens={tokens} onOpen={onOpen} filters={makerFilters} onFilters={setMakerFilters} sort={makerSort} onSort={setMakerSort}/>}
        {tab === 'research' && <ResearchView payload={payload} tokens={tokens} onOpen={onOpen}/>}
        {tab === 'watchlist' && <WatchListView payload={payload} tokens={tokens} now={now} onOpen={onOpen}/>}
        {tab === 'coins' && <>
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
            ? <RadarTable tokens={visible} chartWindow={chartWindow} sort={sort} onSort={onSort} onOpen={onOpen} onTogglePin={onTogglePin} selected={selected}/>
            : <div className="radar-empty">
              <Radar size={36} strokeWidth={1}/>
              <h3>{tokens.length ? 'No coins match these filters.' : workerStatus === 'offline' ? 'The radar is quiet.' : 'Scanning for coins…'}</h3>
              <p>{tokens.length ? 'Clear the search or choose another filter.' : workerStatus === 'offline' ? 'Start the tracker on your PC to begin collecting coins.' : 'Coins appear once they pass the requirements in Settings or show on your Axiom Pulse.'}</p>
              {tokens.length > 0 && <button type="button" className="secondary-button" onClick={() => { setFilter('all'); setQuery('') }}>Show all coins</button>}
            </div>}
        </>}
        {tab === 'movers' && <MoversView tokens={tokens} onOpen={onOpen}/>}
        {tab === 'wallets' && <WalletsView payload={payload} now={now} onOpen={onOpen}/>}
        {tab === 'paper' && <PaperTrades payload={payload} now={now}/>}
        {tab === 'settings' && <SettingsView settings={settings} activeUpdatedAt={payload.settings.updatedAt} saving={saving} error={saveError} now={now} onSave={next => void persist(next)} onPreviewTheme={setPreviewTheme}/>}
      </div>
    </>}

    {selectedToken && <TokenDrawer token={selectedToken} chartWindow={chartWindow} fast={connection === 'local'} onClose={onClose} onTogglePin={onTogglePin}/>}
  </section>
}

export default AxiomRadar
