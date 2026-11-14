import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RadarToken, RadarTokenDetail } from '@/lib/axiom-radar-types'
import { axiomUrl, dexScreenerEmbedUrl, dexScreenerUrl, formatAge, formatClock, formatCount, formatPercent, formatPrice, formatSigned, formatUsd, relativeSeconds, rugCheckUrl, shortAddress, solscanAccountUrl } from './format'
import { ChartWindowPicker, chartWindowMs, type ChartWindow } from './PriceSpark'
import { PinButton, QualityBadge, ScoreBadge, SignalBadge, changeClass, formatChange } from './RadarTable'
import { fetchTokenDetail } from './useRadarFeed'

const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const authorityLabel = (value: boolean | null) => value === null ? 'Unknown' : value ? 'Enabled' : 'Revoked'
const percentLabel = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toFixed(0)}%`
const windows = [['s30', '30 seconds'], ['m1', '1 minute'], ['m5', '5 minutes'], ['m10', '10 minutes']] as const
const clockWithSeconds = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

type TokenDrawerProps = { token: RadarToken; chartWindow: ChartWindow; fast: boolean; onClose: () => void; onTogglePin: (mint: string) => void }

export function TokenDrawer({ token, chartWindow, fast, onClose, onTogglePin }: TokenDrawerProps) {
  const [span, setSpan] = useState<ChartWindow>(chartWindow)
  const [detail, setDetail] = useState<RadarTokenDetail | null>(null)
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    setDetail(null)
    setError('')
    const load = async () => {
      try {
        setDetail(await fetchTokenDetail(token.mint, controller.signal))
        setError('')
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Token details are unavailable.')
      }
      if (!controller.signal.aborted) timer = setTimeout(load, fast ? 1_000 : 5_000)
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [token.mint, fast])

  const live = fast && detail ? { ...detail.token, pinned: token.pinned } : token
  const history = detail?.history ?? token.history
  const allTicks = (detail?.live ?? []).filter(point => point.price !== null || point.viewers !== null)
  const newest = allTicks.at(-1)?.t ?? 0
  const ticks = allTicks.filter(point => point.t >= newest - chartWindowMs[span])
  const pulse = live.pulse
  return <div className="radar-drawer-layer">
    <button type="button" className="radar-drawer-backdrop" aria-label="Close details" tabIndex={-1} onClick={onClose}/>
    <aside ref={panelRef} className="radar-drawer" role="dialog" aria-modal="true" aria-labelledby="radar-drawer-title">
      <header className="radar-drawer-header">
        <div>
          <span className="section-eyebrow">{formatAge(live.ageMinutes).toUpperCase()} OLD{live.viewerRank ? ` · #${live.viewerRank} BY VIEWERS` : ''}</span>
          <h2 id="radar-drawer-title">{live.symbol} <small>{live.name}</small></h2>
          <div className="radar-drawer-links">
            <a href={axiomUrl(live.pairAddress)} target="_blank" rel="noopener noreferrer">Axiom<ExternalLink size={11}/></a>
            <a href={dexScreenerUrl(live.pairAddress)} target="_blank" rel="noopener noreferrer">DexScreener<ExternalLink size={11}/></a>
            <a href={rugCheckUrl(live.mint)} target="_blank" rel="noopener noreferrer">RugCheck<ExternalLink size={11}/></a>
          </div>
        </div>
        <SignalBadge token={live}/>
        <ScoreBadge token={live} large/>
        <PinButton token={live} onTogglePin={onTogglePin}/>
        <button ref={closeRef} type="button" className="radar-icon-button radar-drawer-close" onClick={onClose} aria-label="Close details"><X size={18}/></button>
      </header>

      {error && <p role="alert" className="radar-inline-error">{error}</p>}
      {live.viewerSurge && <p className="radar-surge-banner" role="status">🔥 This coin is gaining viewers quickly: {formatSigned(live.viewersPerMin)} per minute, {formatCount(live.viewers)} watching now.</p>}
      {live.alerts.length > 0 && <p className="radar-pick-alert" role="alert"><TriangleAlert size={14} aria-hidden="true"/>{live.alerts.join(' · ')}</p>}
      {live.signalReasons.length > 0 && <ul className="radar-pick-reasons">{live.signalReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}

      <section className="radar-drawer-section">
        <h3>Live now</h3>
        <dl className="radar-facts">
          <div><dt>Viewers</dt><dd className="tabular">{formatCount(live.viewers)} <small className={`radar-delta ${changeClass(live.viewersPerMin)}`}>{formatSigned(live.viewersPerMin)}/min</small></dd></div>
          <div><dt>Price</dt><dd className="tabular">{formatPrice(live.priceUsd)}</dd></div>
          <div><dt>Market cap</dt><dd className="tabular">{formatUsd(live.marketCap)}</dd></div>
          {windows.map(([key, label]) => <div key={key}><dt>Price, {label}</dt><dd className={`tabular radar-delta ${changeClass(live.priceChange[key])}`}>{formatChange(live.priceChange[key])}</dd></div>)}
          <div><dt>Liquidity</dt><dd className="tabular">{formatUsd(live.liquidityUsd)}</dd></div>
          <div><dt>5m buy share</dt><dd className="tabular">{formatPercent(live.buyRatio, 0)}</dd></div>
        </dl>
      </section>

      <section className="radar-drawer-section">
        <h3>Live chart <small>price and viewers{fast ? ', updating every second' : ''}</small></h3>
        <ChartWindowPicker value={span} onChange={setSpan} label="Show the last"/>
        {ticks.length < 2
          ? <p className="radar-muted">{detail ? 'Collecting live ticks. The line appears within a few seconds.' : <><LoaderCircle size={14} className="spin"/> Loading the live chart…</>}</p>
          : <div className="radar-chart-box">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={ticks} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={clockWithSeconds} stroke="var(--muted)" fontSize={10} tickLine={false} minTickGap={50}/>
                <YAxis yAxisId="price" stroke="var(--muted)" fontSize={10} tickLine={false} width={64} domain={['auto', 'auto']} tickFormatter={value => formatPrice(Number(value))}/>
                <YAxis yAxisId="viewers" orientation="right" stroke="var(--muted)" fontSize={10} tickLine={false} width={40} allowDecimals={false} domain={['auto', 'auto']}/>
                <Tooltip contentStyle={tooltipStyle} labelFormatter={value => clockWithSeconds(Number(value))} formatter={(value, name) => [name === 'Price' ? formatPrice(Number(value)) : formatCount(Number(value)), name]}/>
                <Legend wrapperStyle={{ fontSize: 11 }}/>
                <Line yAxisId="price" type="monotone" dataKey="price" name="Price" stroke="var(--radar-accent)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false}/>
                <Line yAxisId="viewers" type="monotone" dataKey="viewers" name="Viewers" stroke="var(--green)" strokeWidth={1.6} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>}
      </section>

      <section className="radar-drawer-section">
        <h3>Candles <small>DexScreener, live</small></h3>
        <div className="radar-chart-embed">
          <iframe title={`${live.symbol} DexScreener chart`} src={dexScreenerEmbedUrl(live.pairAddress)} loading="lazy" referrerPolicy="no-referrer"/>
        </div>
      </section>

      <section className="radar-drawer-section">
        <h3>Quality checklist <QualityBadge token={live}/></h3>
        {live.quality.checks.length === 0 ? <p className="radar-muted">No checks yet. Holder data arrives when the coin shows on your Axiom Pulse, and RugCheck within a minute or two.</p>
          : <ul className="radar-checks">{live.quality.checks.map(check => <li key={check.label} className={check.status}>
            <span aria-hidden="true">{check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗'}</span>
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </li>)}</ul>}
        {pulse && <dl className="radar-facts">
          <div><dt>Holders</dt><dd className="tabular">{formatCount(pulse.holders)} {live.holdersChange5m !== null && <small className={`radar-delta ${changeClass(live.holdersChange5m)}`}>{formatSigned(live.holdersChange5m)} in 5m</small>}</dd></div>
          <div><dt>Fees paid</dt><dd className="tabular">{pulse.feesSol === null ? '—' : `${pulse.feesSol.toFixed(1)} SOL`}</dd></div>
          <div><dt>Trades</dt><dd className="tabular">{formatCount(pulse.txCount)}</dd></div>
          <div><dt>Top 10 / dev</dt><dd className="tabular">{percentLabel(pulse.top10Pct)} / {pulse.devSold ? 'sold' : percentLabel(pulse.devPct)}</dd></div>
          <div><dt>Snipers / insiders</dt><dd className="tabular">{percentLabel(pulse.snipersPct)} / {percentLabel(pulse.insidersPct)}</dd></div>
          <div><dt>Bundlers</dt><dd className="tabular">{percentLabel(pulse.bundlersPct)}</dd></div>
        </dl>}
      </section>

      <section className="radar-drawer-section">
        <h3>Viewers vs. market cap <small>since tracking began</small></h3>
        {history.filter(point => point.viewers !== null || point.marketCap !== null).length < 2
          ? <p className="radar-muted">{detail ? 'Not enough history yet.' : <><LoaderCircle size={14} className="spin"/> Loading history…</>}</p>
          : <div className="radar-chart-box">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={history} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatClock} stroke="var(--muted)" fontSize={10} tickLine={false}/>
                <YAxis yAxisId="viewers" stroke="var(--muted)" fontSize={10} tickLine={false} width={44} allowDecimals={false}/>
                <YAxis yAxisId="mcap" orientation="right" stroke="var(--muted)" fontSize={10} tickLine={false} width={58} tickFormatter={value => formatUsd(Number(value))}/>
                <Tooltip contentStyle={tooltipStyle} labelFormatter={value => formatClock(Number(value))} formatter={(value, name) => [name === 'Market cap' ? formatUsd(Number(value)) : formatCount(Number(value)), name]}/>
                <Legend wrapperStyle={{ fontSize: 11 }}/>
                <Line yAxisId="viewers" type="monotone" dataKey="viewers" name="Active viewers" stroke="var(--green)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false}/>
                <Line yAxisId="mcap" type="monotone" dataKey="marketCap" name="Market cap" stroke="var(--radar-accent)" strokeWidth={1.6} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>}
      </section>

      <section className="radar-drawer-section">
        <h3>Score breakdown</h3>
        <ul className="radar-factors">
          {live.factors.map(factor => <li key={factor.key} className={factor.available ? '' : 'muted'}>
            <span>{factor.label}</span>
            <span className="radar-factor-bar" aria-hidden="true"><span style={{ width: `${Math.round(factor.value * 100)}%` }}/></span>
            <span className="tabular">{factor.available ? `+${factor.contribution.toFixed(1)}` : 'no data'}</span>
          </li>)}
        </ul>
        <dl className="radar-facts">
          <div><dt>RugCheck risk score</dt><dd className="tabular">{live.safety.rugScore ?? '—'}</dd></div>
          <div><dt>Mint authority</dt><dd className={live.safety.mintAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.mintAuthority)}</dd></div>
          <div><dt>Freeze authority</dt><dd className={live.safety.freezeAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.freezeAuthority)}</dd></div>
        </dl>
      </section>

      <section className="radar-drawer-section">
        <h3>Smart holders in this coin</h3>
        {!detail ? <p className="radar-muted"><LoaderCircle size={14} className="spin"/> Loading wallets…</p>
          : detail.entries.length === 0 ? <p className="radar-muted">No smart holders found in this coin yet.</p>
          : <div className="radar-table-wrap">
            <table className="radar-mini-table">
              <thead><tr><th scope="col">Wallet</th><th scope="col">Good coins</th><th scope="col">Holds</th><th scope="col">Seen</th></tr></thead>
              <tbody>{detail.entries.map(entry => <tr key={`${entry.wallet}-${entry.timestamp}`}>
                <td><a href={solscanAccountUrl(entry.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(entry.wallet)}</a></td>
                <td className="tabular">🐋 {entry.runnerHits}</td>
                <td className="tabular">{entry.pct !== null && entry.pct !== undefined ? `${entry.pct.toFixed(1)}%` : entry.entryMcap !== null ? `in at ${formatUsd(entry.entryMcap)}` : '—'}</td>
                <td className="tabular">{relativeSeconds(entry.timestamp, Date.now())}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>
    </aside>
  </div>
}
