import { AxiomLink, CoinName } from './AxiomLink'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RadarToken, RadarTokenDetail } from '@/lib/axiom-radar-types'
import { axiomUrl, dexScreenerEmbedUrl, dexScreenerUrl, formatAge, formatClock, formatCount, formatPercent, formatPrice, formatSigned, formatUsd, holderCount, largestHoldingsFirst, relativeSeconds, rugCheckUrl, shortAddress, solscanAccountUrl } from './format'
import { ReasonChips, chanceLabel, outlookLine } from './LearnedCoin'
import { ChartWindowPicker, chartWindowMs, type ChartWindow } from './PriceSpark'
import { PinButton, QualityBadge, ScoreBadge, SignalBadge, WindowChange, changeClass, windowSourceNote } from './RadarTable'
import { ScoreLedger } from './ScoreLedger'
import { DexScoreBreakdown } from './DexScoreBreakdown'
import { useScoreMode } from './score-mode'
import { fetchTokenDetail } from './useRadarFeed'

const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const authorityLabel = (value: boolean | null) => value === null ? 'Unknown' : value ? 'Enabled' : 'Revoked'
const percentLabel = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toFixed(0)}%`
const windows = [['s5', '5 seconds'], ['s30', '30 seconds'], ['m1', '1 minute'], ['m5', '5 minutes'], ['m10', '10 minutes']] as const
const clockWithSeconds = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

type TokenDrawerProps = { token: RadarToken; chartWindow: ChartWindow; fast: boolean; onClose: () => void; onTogglePin: (mint: string) => void }

const formatSol = (value: number) => `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)} SOL`

const walletVerdict = { good: 'Winning', bad: 'Coins died', mixed: 'Mixed', new: 'No record' } as const

export function TokenDrawer({ token, chartWindow, fast, onClose, onTogglePin }: TokenDrawerProps) {
  const [span, setSpan] = useState<ChartWindow>(chartWindow)
  const { mode: scoreMode } = useScoreMode()
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
          <h2 id="radar-drawer-title"><CoinName pairAddress={live.pairAddress} symbol={live.symbol}/> <AxiomLink pairAddress={live.pairAddress} symbol={live.symbol} size={18}/> <small>{live.name}</small></h2>
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
          {windows.map(([key, label]) => <div key={key}><dt>Price, {label}</dt><dd><WindowChange token={live} window={key}/>{live.priceChangeSources?.[key] && <small className="radar-window-note">{windowSourceNote(live.priceChangeSources[key])}</small>}</dd></div>)}
          <div><dt>Liquidity</dt><dd className="tabular">{formatUsd(live.liquidityUsd)}</dd></div>
          <div><dt>5m buy share</dt><dd className="tabular">{formatPercent(live.buyRatio, 0)}</dd></div>
        </dl>
      </section>

      {scoreMode.dex && <section className="radar-drawer-section" aria-labelledby="radar-dex-title">
        <h3 id="radar-dex-title">DexScreener score {live.dex?.score ?? '—'} <small>movement over 5s, 30s, 1m and 5m (longer windows weigh more), backed by liquidity and volume</small></h3>
        <DexScoreBreakdown token={live}/>
      </section>}

      {scoreMode.runner && live.scoreLedger && <section className="radar-drawer-section" aria-labelledby="radar-ledger-title">
        <h3 id="radar-ledger-title">Why it scores {live.score} <small>every rule, reading and cap behind the runner score</small></h3>
        <ScoreLedger token={live}/>
      </section>}

      <section className="radar-drawer-section">
        <h3>Candles <small>DexScreener, live</small></h3>
        <div className="radar-chart-embed">
          <iframe title={`${live.symbol} DexScreener chart`} src={dexScreenerEmbedUrl(live.pairAddress)} loading="lazy" referrerPolicy="no-referrer"/>
        </div>
      </section>

      <section className="radar-drawer-section">
        <h3>Live viewers <small>with price{fast ? ', updating every second' : ''}</small></h3>
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
                <Line yAxisId="viewers" type="stepAfter" dataKey="viewers" name="Viewers" stroke="var(--green)" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false}/>
                <Line yAxisId="price" type="monotone" dataKey="price" name="Price" stroke="var(--radar-accent)" strokeWidth={1.4} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>}
      </section>

      {live.advice && <section className={`radar-drawer-section radar-advice ${live.advice.exit}`}>
        <h3>Exit and rebuy advice <small>from tested warning signs</small></h3>
        <dl className="radar-facts">
          <div><dt>If you hold it</dt><dd>{live.advice.exit === 'exit' ? 'Get out' : live.advice.exit === 'tighten' ? 'Be careful, tighten up' : 'No warning signs'}</dd></div>
          <div><dt>Buying again</dt><dd>{live.advice.rebuy === 'never' ? 'Do not rebuy' : live.advice.rebuy === 'wait' ? 'Wait' : 'No reason not to'}</dd></div>
          <div><dt>Below its high</dt><dd className="tabular">{live.advice.drawdownPct === null ? '—' : `${live.advice.drawdownPct}%`}</dd></div>
        </dl>
        {live.advice.exitReasons.length > 0 && <ul className="radar-learn-list">{live.advice.exitReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {live.advice.rebuyReasons.length > 0 && <ul className="radar-learn-list">{live.advice.rebuyReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </section>}

      {(live.outlook || live.explode || live.maker) && <section className="radar-drawer-section radar-drawer-learned">
        <h3>What the learner sees <small>from past coins like this one</small></h3>
        <dl className="radar-facts">
          <div><dt>Chance to double</dt><dd className="tabular">{chanceLabel(live.outlook?.runnerChance)}</dd></div>
          <div><dt>Usual crash time</dt><dd className="tabular">{live.outlook?.expectedLifeMinutes == null ? '—' : `${live.outlook.expectedLifeMinutes} min after launch`}</dd></div>
          <div><dt>Typical peak</dt><dd className="tabular">{live.outlook?.expectedPeakMultiple == null ? '—' : `${live.outlook.expectedPeakMultiple}x from first sight`}</dd></div>
          <div><dt>Chance to explode</dt><dd className="tabular">{live.explode ? chanceLabel(live.explode.chance) : '—'}</dd></div>
          <div><dt>Match to past winners</dt><dd className="tabular">{chanceLabel(live.maker?.chance)}</dd></div>
          <div><dt>Winner wallets in</dt><dd className="tabular">{live.maker?.winnerWallets ?? '—'}</dd></div>
        </dl>
        {outlookLine(live) && <p className="radar-learn-timing">{outlookLine(live)}</p>}
        <ReasonChips reasons={live.outlook?.reasons ?? []}/>
      </section>}

      <section className="radar-drawer-section">
        <h3>Quality checklist <QualityBadge token={live}/></h3>
        {live.quality.checks.length === 0 ? <p className="radar-muted">No checks yet. Holder data arrives when the coin shows on your Axiom Pulse, and RugCheck within a minute or two.</p>
          : <ul className="radar-checks">{live.quality.checks.map(check => <li key={check.label} className={check.status}>
            <span aria-hidden="true">{check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗'}</span>
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </li>)}</ul>}
        {(live.holderTraits || pulse) && <dl className="radar-facts">
          <div><dt>Holders</dt><dd className="tabular">{formatCount(holderCount(live))} {live.holdersPerMin !== null && live.holdersPerMin !== undefined && <small className={`radar-delta ${changeClass(live.holdersPerMin)}`}>{formatSigned(live.holdersPerMin)}/min</small>}</dd></div>
          <div><dt>Top 10 / dev</dt><dd className="tabular">{percentLabel(live.holderTraits?.top10 ?? pulse?.top10Pct)} / {pulse?.devSold ? 'sold' : percentLabel(live.holderTraits?.dev ?? pulse?.devPct)}</dd></div>
          <div><dt>Snipers / insiders</dt><dd className="tabular">{percentLabel(live.holderTraits?.snipers ?? pulse?.snipersPct)} / {percentLabel(live.holderTraits?.insiders ?? pulse?.insidersPct)}</dd></div>
          <div><dt>Bundlers</dt><dd className="tabular">{percentLabel(live.holderTraits?.bundlers ?? pulse?.bundlersPct)}</dd></div>
          <div><dt>Linked wallet groups</dt><dd className="tabular">{percentLabel(live.holderTraits?.linked)}</dd></div>
          {pulse && <div><dt>Fees paid</dt><dd className="tabular">{pulse.feesSol === null ? '—' : `${pulse.feesSol.toFixed(1)} SOL`}</dd></div>}
          {pulse && <div><dt>Trades</dt><dd className="tabular">{formatCount(pulse.txCount)}</dd></div>}
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
        <h3>{live.scoreLedger ? 'Safety plan and token settings' : 'Score breakdown'}</h3>
        {!live.scoreLedger && <>
        {live.scoreParts && <p className="radar-note">Runner score, re-checked every second from Axiom's figures: holder percentages (20), Axiom demand and growth (45: viewers, viewers and holders gained a minute, buy share, holders, volume), chart and liquidity (25) and hype (15), raised by a quarter. A top 10 up to 35% costs nothing unless it is dropping fast while the price falls, and market cap or distance to migration never costs points. Mint or freeze authority, dev over 5%, top 10 over 35%, bundles over 35%, a serial launcher with under 10 graduated coins or a copied launch, a dead chart, fresh wallets over 10%, a bot-driven climb or holders selling score 0.</p>}
        <ul className="radar-factors">
          {live.scoreParts
            ? live.scoreParts.map(part => <li key={`${part.key}:${part.label}`} className={part.available ? '' : 'muted'}>
              <span>{part.label}<small className="radar-part-detail">{part.detail}</small></span>
              <span className="radar-factor-bar" aria-hidden="true"><span style={{ width: `${part.max > 0 ? Math.max(0, Math.min(100, Math.round((part.points / part.max) * 100))) : 0}%` }}/></span>
              <span className="tabular">{part.key === 'penalty' || part.key === 'learned' ? `${part.points > 0 ? '+' : ''}${part.points}` : part.available ? `${part.points.toFixed(0)} of ${part.max}` : 'no data'}</span>
            </li>)
            : live.factors.map(factor => <li key={factor.key} className={factor.available ? '' : 'muted'}>
              <span>{factor.label}</span>
              <span className="radar-factor-bar" aria-hidden="true"><span style={{ width: `${Math.round(factor.value * 100)}%` }}/></span>
              <span className="tabular">{factor.available ? `+${factor.contribution.toFixed(1)}` : 'no data'}</span>
            </li>)}
          {live.rawScore !== undefined && live.score < live.rawScore && <li className="radar-factor-penalty">
            <span>{live.scoreParts ? (live.holderRisk?.blocked ? 'Scored 0' : `Capped at ${live.score}`) : 'Score cuts'}</span>
            <span className="radar-penalty-reasons">{(live.scoreParts ? live.scoreCuts ?? [] : [...(live.holderRisk?.reasons ?? []), ...(live.scoreCuts ?? [])]).join(' · ')}</span>
            <span className="tabular">{live.score - live.rawScore}</span>
          </li>}
        </ul>
        </>}
        {live.holderRisk?.blocked && <p className="radar-pick-alert" role="note">Scores 0 and stays out of every recommendation while this lasts.</p>}
        {live.safetyPlan && <div className={`radar-safety-plan ${live.safetyPlan.level}`}>
          <h4>Safety plan{live.safetyPlan.level === 'exit' ? ': get out' : live.safetyPlan.level === 'watch' ? ': dump risk' : ''}</h4>
          <p>{live.safetyPlan.summary}</p>
          {(live.safetyPlan.bundleDumpPct !== null || live.safetyPlan.topDumpPct !== null) && <p className="radar-note tabular">{live.safetyPlan.bundleDumpPct !== null ? `If bundlers sold everything: about -${live.safetyPlan.bundleDumpPct}%. ` : ''}{live.safetyPlan.topDumpPct !== null ? `If the top 10 sold half: about -${live.safetyPlan.topDumpPct}%.` : ''}</p>}
          <ul className="radar-learn-list">{live.safetyPlan.triggers.map(trigger => <li key={trigger}>{trigger}</li>)}</ul>
        </div>}
        {live.holderTraits?.checkedAt && <p className="radar-note">Holder numbers last checked {relativeSeconds(live.holderTraits.checkedAt, Date.now())}.</p>}
        <dl className="radar-facts">
          <div><dt>RugCheck risk score</dt><dd className="tabular">{live.safety.rugScore ?? '—'}</dd></div>
          <div><dt>Mint authority</dt><dd className={live.safety.mintAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.mintAuthority)}</dd></div>
          <div><dt>Freeze authority</dt><dd className={live.safety.freezeAuthority ? 'radar-bad' : ''}>{authorityLabel(live.safety.freezeAuthority)}</dd></div>
        </dl>
      </section>

      {live.wallets && <section className="radar-drawer-section" aria-labelledby="radar-wallets-title">
        <h3 id="radar-wallets-title">Wallet Score {live.wallets.score} <small>who holds it, how much, how their earlier coins ended and what they made trading them</small></h3>
        <p className="radar-note">{live.wallets.summary}. 50 means no holder with a real stake has a record yet; holders under $100 or 0.3% of supply are left out.</p>
        {live.wallets.top.length > 0 && <div className="radar-table-wrap">
          <table className="radar-mini-table">
            <thead><tr><th scope="col">Wallet</th><th scope="col">Holds</th><th scope="col">Earlier coins</th><th scope="col">Their trades</th><th scope="col">Record</th></tr></thead>
            <tbody>{live.wallets.top.map(holder => <tr key={holder.wallet}>
              <td><a href={solscanAccountUrl(holder.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(holder.wallet)}</a>{holder.whale && <span className="radar-tag" title="$1,000 or more in this coin">whale</span>}</td>
              <td className="tabular">{holder.pct.toFixed(1)}%{holder.usd !== null ? ` · ${formatUsd(holder.usd)}` : ''}</td>
              <td className="tabular">{holder.wins} grew 3x · {holder.losses} died</td>
              <td className="tabular">{holder.pricedCoins && holder.buyInSol != null && holder.profitSol != null ? <>{formatSol(holder.buyInSol)} in · <span className={holder.profitSol > 0 ? 'radar-delta up' : holder.profitSol < 0 ? 'radar-delta down' : ''}>{holder.profitSol > 0 ? '+' : ''}{formatSol(holder.profitSol)}</span>{live.wallets?.solUsd ? <small className="radar-muted"> ({formatUsd(holder.profitSol * live.wallets.solUsd)})</small> : null}<small className="radar-muted"> on {holder.pricedCoins}</small></> : '—'}</td>
              <td className={holder.verdict === 'good' ? 'radar-delta up' : holder.verdict === 'bad' ? 'radar-delta down' : 'radar-muted'}>{walletVerdict[holder.verdict]}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>}

      <section className="radar-drawer-section">
        <h3>Smart holders in this coin</h3>
        {!detail ? <p className="radar-muted"><LoaderCircle size={14} className="spin"/> Loading wallets…</p>
          : largestHoldingsFirst(detail.entries).length === 0 ? <p className="radar-muted">No smart holders found in this coin yet.</p>
          : <div className="radar-table-wrap">
            <table className="radar-mini-table">
              <thead><tr><th scope="col">Wallet</th><th scope="col">Good coins</th><th scope="col">Holds</th><th scope="col">Seen</th></tr></thead>
              <tbody>{largestHoldingsFirst(detail.entries).map(entry => <tr key={`${entry.wallet}-${entry.timestamp}`}>
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
