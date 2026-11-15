import { Bot } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AxiomLink, CoinName } from './AxiomLink'
import { BotControls, botStatus, bracket, dollars, feeLine, headline, money, signedHeadline, signedMoney, signedPercent, solAmount, toneOf } from './BotControls'
import { formatClock, formatPrice } from './format'
import { useBot } from './useBot'
import './axiom-bot.css'

const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const heldFor = (minutes: number) => minutes < 90 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`
const adviceLabels: Record<string, string> = { tighten: 'Radar: fading', exit: 'Radar: exit', left: 'Left the Radar' }

export function BotAccount({ now }: { now: number }) {
  const bot = useBot()
  const { view, error, loading } = bot
  const report = view?.report ?? null
  const status = botStatus(bot, now)
  const sol = report?.accountSol
  const inSol = Boolean(report && report.equity.length && report.equity.every(point => point.sol !== undefined))

  return <>
    <div className="radar-section-head radar-bot-head">
      <h2><Bot size={17} aria-hidden="true"/> Paper-trading bot <span className={`radar-bot-chip ${status.tone}`}>{status.label}</span></h2>
      <p>The Python bot on your PC buys and sells the Radar's picks with pretend SOL, by the dials in the Trading bot tab. Results include fees, slippage and price impact. Nothing here places a real order.</p>
      <BotControls bot={bot}/>
    </div>

    {loading ? <p className="radar-empty-line" role="status">Loading the bot's account…</p>
      : error && !view ? <p className="radar-empty-line radar-bad" role="alert">{error}</p>
      : !report ? <div className="radar-empty">
        <h3>The bot has not reported yet</h3>
        <p>Start it on the PC that runs the tracker. It finds the site and its key in the tracker's <span className="mono">.env</span> file.</p>
        <code className="radar-bot-code">python scripts/axiom-paper-bot/run.py</code>
      </div>
      : <>
        <div className="radar-kpis">
          <div className="radar-kpi"><span>Account value</span><strong className="tabular">{headline(sol?.equity, report.account.equity)}</strong><small className={`radar-delta ${toneOf(report.account.totalPnl)}`}>{bracket(sol?.equity, report.account.equity)}{signedHeadline(sol?.totalPnl, report.account.totalPnl)} ({signedPercent(report.account.totalPnlPct)})</small></div>
          <div className="radar-kpi"><span>Today</span><strong className={`tabular radar-delta ${toneOf(report.account.dayPnl)}`}>{signedHeadline(sol?.dayPnl, report.account.dayPnl)}</strong><small>{bracket(sol?.dayPnl, Math.abs(report.account.dayPnl))}{signedPercent(report.account.dayPnlPct)} · drawdown {report.account.drawdownPct.toFixed(1)}%</small></div>
          <div className="radar-kpi"><span>In coins</span><strong className="tabular">{headline(sol?.exposure, report.account.exposure)}</strong><small>{bracket(sol?.exposure, report.account.exposure)}of {headline(sol?.exposureLimit, report.account.exposureLimit)} allowed · cash {headline(sol?.cash, report.account.cash)}</small></div>
          <div className="radar-kpi"><span>Win rate</span><strong className="tabular">{report.stats.winRate === null ? '—' : `${Math.round(report.stats.winRate * 100)}%`}</strong><small>{report.stats.wins} wins · {report.stats.losses} losses · fees {headline(report.stats.feesPaidSol, report.stats.feesPaid)}</small></div>
        </div>

        <div className="radar-paper-grid">
          <section className="radar-card">
            <div className="panel-heading"><span className="number-tag">01</span><h2>Account value</h2><span className="panel-caption">{inSol ? 'IN SOL · ' : ''}RISK STRENGTH {report.strength} OF 10</span></div>
            {report.equity.length < 2 ? <p className="radar-muted">The curve appears once the bot has run for a couple of minutes.</p>
              : <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={report.equity} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                  <defs><linearGradient id="radar-bot-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity={0.35}/><stop offset="100%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatClock} stroke="var(--muted)" fontSize={10} tickLine={false}/>
                  <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} domain={['auto', 'auto']} width={inSol ? 64 : 60} tickFormatter={value => inSol ? `${Number(Number(value).toFixed(3))}` : `$${Math.round(Number(value)).toLocaleString()}`}/>
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={value => formatClock(Number(value))} formatter={(value, _name, item) => [inSol ? money(Number(value), (item.payload as { equity: number }).equity) : dollars(Number(value)), 'Account value']}/>
                  <ReferenceLine y={inSol && sol ? sol.startingCash : report.account.startingCash} stroke="var(--muted)" strokeDasharray="4 4"/>
                  <Area type="monotone" dataKey={inSol ? 'sol' : 'equity'} stroke="var(--green)" strokeWidth={2} fill="url(#radar-bot-fill)" isAnimationActive={false}/>
                </AreaChart>
              </ResponsiveContainer>}
            <p className="radar-note">{report.stats.trades} closed trades · average {report.stats.averageReturnPct === null ? '—' : signedPercent(report.stats.averageReturnPct)} · best {report.stats.bestPct === null ? '—' : signedPercent(report.stats.bestPct)} · worst {report.stats.worstPct === null ? '—' : signedPercent(report.stats.worstPct)} · average hold {report.stats.averageHoldMinutes === null ? '—' : heldFor(report.stats.averageHoldMinutes)}{sol ? ` · started with ${solAmount(sol.startingCash)}` : ''}</p>
            {report.fees && <p className="radar-note">{feeLine(report)}</p>}
          </section>

          <section className="radar-card">
            <div className="panel-heading"><span className="number-tag">02</span><h2>Closest to a buy</h2><span className="panel-caption">WHAT IS HOLDING EACH COIN BACK</span></div>
            {report.candidates.length === 0 ? <p className="radar-muted">Nothing to show yet.</p>
              : <ul className="radar-bot-list">{report.candidates.map(candidate => <li key={candidate.mint}><strong>{candidate.symbol}</strong><span className="tabular" title={candidate.dex === undefined || candidate.dex === null ? 'Runner score' : 'Runner score / DexScreener score'}>{candidate.score}{candidate.dex === undefined || candidate.dex === null ? '' : ` / ${candidate.dex}`}</span><span>{candidate.reason}</span></li>)}</ul>}
            <h3 className="radar-bot-subhead">Activity</h3>
            {report.events.length === 0 ? <p className="radar-muted">Nothing has happened yet.</p>
              : <ul className="radar-bot-log">{report.events.slice(0, 8).map(event => <li key={event.id}><span className="tabular">{formatClock(event.t)}</span><span>{event.text}</span></li>)}</ul>}
          </section>
        </div>

        <section className="radar-card">
          <div className="panel-heading"><span className="number-tag">03</span><h2>Open positions</h2><span className="panel-caption">{report.positions.length} HELD · RADAR {report.feed.ageSeconds === null ? 'NOT RECEIVED' : `${report.feed.ageSeconds}S OLD`}</span></div>
          {report.positions.length === 0 ? <p className="radar-muted">The bot holds no coins right now.</p>
            : <div className="radar-table-wrap">
              <table className="radar-mini-table">
                <thead><tr><th scope="col">Token</th><th scope="col">Bought</th><th scope="col">Cost</th><th scope="col">Value</th><th scope="col">Profit</th><th scope="col">Price move</th><th scope="col">Best</th><th scope="col">Stop</th><th scope="col">Score</th></tr></thead>
                <tbody>{report.positions.map(position => <tr key={position.id}>
                  <td><CoinName pairAddress={position.pairAddress} symbol={position.symbol}/> <AxiomLink pairAddress={position.pairAddress} symbol={position.symbol}/>{position.targetDone && <span className="radar-bot-tag">{position.openPct}% left</span>}{position.advice && adviceLabels[position.advice] && <span className="radar-bot-tag warn">{adviceLabels[position.advice]}</span>}</td>
                  <td className="tabular">{formatClock(position.openedAt)}</td>
                  <td className="tabular">{money(position.costSol, position.costUsd)}</td>
                  <td className="tabular">{money(position.valueSol, position.valueUsd)}</td>
                  <td className={`tabular radar-delta ${toneOf(position.pnlUsd)}`}>{signedMoney(position.pnlSol, position.pnlUsd)} ({signedPercent(position.pnlPct)})</td>
                  <td className={`tabular radar-delta ${toneOf(position.gainPct)}`}>{signedPercent(position.gainPct)}</td>
                  <td className="tabular">{signedPercent(position.peakGainPct)}</td>
                  <td className="tabular">{formatPrice(position.stopPrice)}</td>
                  <td className="tabular">{position.score}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>

        <section className="radar-card">
          <div className="panel-heading"><span className="number-tag">04</span><h2>Closed trades</h2><span className="panel-caption">PAPER ONLY · AFTER FEES AND SLIPPAGE</span></div>
          {report.trades.length === 0 ? <p className="radar-muted">No closed trades yet.</p>
            : <div className="radar-table-wrap">
              <table className="radar-mini-table">
                <thead><tr><th scope="col">Sold</th><th scope="col">Token</th><th scope="col">Cost</th><th scope="col">Profit</th><th scope="col">Held</th><th scope="col">Score</th><th scope="col">Why it sold</th><th scope="col">Result</th></tr></thead>
                <tbody>{report.trades.map(trade => <tr key={trade.id}>
                  <td className="tabular">{trade.closedAt ? formatClock(trade.closedAt) : '—'}</td>
                  <td><CoinName pairAddress={trade.pairAddress} symbol={trade.symbol}/> <AxiomLink pairAddress={trade.pairAddress} symbol={trade.symbol}/></td>
                  <td className="tabular">{money(trade.costSol, trade.costUsd)}</td>
                  <td className={`tabular radar-delta ${toneOf(trade.pnlUsd)}`}>{signedMoney(trade.pnlSol, trade.pnlUsd)} ({signedPercent(trade.pnlPct)})</td>
                  <td className="tabular">{heldFor(trade.holdMinutes)}</td>
                  <td className="tabular">{trade.score}</td>
                  <td>{trade.reason ?? '—'}</td>
                  <td><span className={`radar-status ${trade.pnlUsd > 0 ? 'win' : 'loss'}`}>{trade.pnlUsd > 0 ? 'Win' : 'Loss'}</span></td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>
      </>}

    <div className="radar-section-head radar-bot-head">
      <h2>Signal scoring</h2>
      <p>The Radar's own check of every Buy signal: one equal stake per coin, graded at +15% after 15 minutes. These results tune the score weights the bot trades on.</p>
    </div>
  </>
}
