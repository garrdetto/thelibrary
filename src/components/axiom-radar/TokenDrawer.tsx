import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, X } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RadarToken, RadarTokenDetail } from '@/lib/axiom-radar-types'
import { axiomUrl, dexScreenerEmbedUrl, dexScreenerUrl, formatAge, formatClock, formatCount, formatPercent, formatPrice, formatSigned, formatUsd, relativeSeconds, rugCheckUrl, shortAddress, solscanAccountUrl } from './format'
import { SafetyBadge, ScoreBadge } from './RadarTable'
import { fetchTokenDetail } from './useRadarFeed'

const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const authorityLabel = (value: boolean | null) => value === null ? 'Unknown' : value ? 'Enabled' : 'Revoked'

export function TokenDrawer({ token, onClose }: { token: RadarToken; onClose: () => void }) {
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
      if (!controller.signal.aborted) timer = setTimeout(load, 10_000)
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [token.mint])

  const live = detail?.token ?? token
  const history = detail?.history ?? token.history
  return <div className="radar-drawer-layer">
    <button type="button" className="radar-drawer-backdrop" aria-label="Close details" tabIndex={-1} onClick={onClose}/>
    <aside ref={panelRef} className="radar-drawer" role="dialog" aria-modal="true" aria-labelledby="radar-drawer-title">
      <header className="radar-drawer-header">
        <div>
          <span className="section-eyebrow">INTELLIGENCE · {formatAge(live.ageMinutes)} OLD</span>
          <h2 id="radar-drawer-title">{live.symbol} <small>{live.name}</small></h2>
          <div className="radar-drawer-links">
            <a href={axiomUrl(live.pairAddress)} target="_blank" rel="noopener noreferrer">Axiom<ExternalLink size={11}/></a>
            <a href={dexScreenerUrl(live.pairAddress)} target="_blank" rel="noopener noreferrer">DexScreener<ExternalLink size={11}/></a>
            <a href={rugCheckUrl(live.mint)} target="_blank" rel="noopener noreferrer">RugCheck<ExternalLink size={11}/></a>
          </div>
        </div>
        <ScoreBadge token={live} large/>
        <button ref={closeRef} type="button" className="radar-icon-button radar-drawer-close" onClick={onClose} aria-label="Close details"><X size={18}/></button>
      </header>

      {error && <p role="alert" className="radar-inline-error">{error}</p>}

      <section className="radar-drawer-section">
        <h3>Price chart</h3>
        <div className="radar-chart-embed">
          <iframe title={`${live.symbol} DexScreener chart`} src={dexScreenerEmbedUrl(live.pairAddress)} loading="lazy" referrerPolicy="no-referrer"/>
        </div>
      </section>

      <section className="radar-drawer-section">
        <h3>Active viewers vs. market cap</h3>
        {history.filter(point => point.viewers !== null || point.marketCap !== null).length < 2
          ? <p className="radar-muted">{detail ? 'Not enough snapshots yet.' : <><LoaderCircle size={14} className="spin"/> Loading history…</>}</p>
          : <div className="radar-chart-box">
            <ResponsiveContainer width="100%" height={240}>
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
          <div><dt>Viewers</dt><dd className="tabular">{formatCount(live.viewers)}</dd></div>
          <div><dt>Δ 1m / 5m</dt><dd className="tabular">{formatSigned(live.viewersDelta1m)} / {formatSigned(live.viewersDelta5m)}</dd></div>
          <div><dt>Price</dt><dd className="tabular">{formatPrice(live.priceUsd)}</dd></div>
          <div><dt>Market cap</dt><dd className="tabular">{formatUsd(live.marketCap)}</dd></div>
          <div><dt>Liquidity</dt><dd className="tabular">{formatUsd(live.liquidityUsd)}</dd></div>
          <div><dt>5m buy ratio</dt><dd className="tabular">{formatPercent(live.buyRatio, 0)}</dd></div>
        </dl>
      </section>

      <section className="radar-drawer-section">
        <h3>RugCheck</h3>
        <dl className="radar-facts">
          <div><dt>Verdict</dt><dd><SafetyBadge level={live.safety.level}/></dd></div>
          <div><dt>Risk score</dt><dd className="tabular">{live.safety.rugScore ?? '—'}</dd></div>
          <div><dt>Mint authority</dt><dd className={live.safety.mintAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.mintAuthority)}</dd></div>
          <div><dt>Freeze authority</dt><dd className={live.safety.freezeAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.freezeAuthority)}</dd></div>
          <div><dt>Top 10 holders</dt><dd className="tabular">{live.safety.top10Pct === null ? '—' : `${live.safety.top10Pct.toFixed(1)}%`}</dd></div>
        </dl>
      </section>

      <section className="radar-drawer-section">
        <h3>Runner wallets in this coin</h3>
        {!detail ? <p className="radar-muted"><LoaderCircle size={14} className="spin"/> Loading wallets…</p>
          : detail.entries.length === 0 ? <p className="radar-muted">No tracked runner wallets have entered yet.</p>
          : <div className="radar-table-wrap">
            <table className="radar-mini-table">
              <thead><tr><th scope="col">Wallet</th><th scope="col">Runner hits</th><th scope="col">Entry MCap</th><th scope="col">Entered</th></tr></thead>
              <tbody>{detail.entries.map(entry => <tr key={entry.wallet}>
                <td><a href={solscanAccountUrl(entry.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(entry.wallet)}</a></td>
                <td className="tabular">🐋 {entry.runnerHits}</td>
                <td className="tabular">{formatUsd(entry.entryMcap)}</td>
                <td className="tabular">{relativeSeconds(entry.timestamp, Date.now())}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>
    </aside>
  </div>
}
