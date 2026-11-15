import { Rocket } from 'lucide-react'
import type { RadarPayload, RadarRunnerAlert, RadarRunnerStats, RadarToken } from '@/lib/axiom-radar-types'
import { AxiomLink, CoinName } from './AxiomLink'
import { formatClock, formatCount, formatUsd } from './format'
import { LearnStat } from './LearnedCoin'

const share = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value < 1 ? value.toFixed(1) : Math.round(value)}%`
const multiple = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}x`
const outcomeLabels: Record<RadarRunnerAlert['outcome'], string> = { open: 'Following', 'false-positive': 'False positive', runner: 'Runner (2x+)', neither: 'Neither' }

function StatsLine({ stats }: { stats: RadarRunnerStats }) {
  return <p className="radar-runner-stats tabular">
    <b>Stage & Stats:</b> MC: {formatUsd(stats.marketCap)} | Liq: {formatUsd(stats.liquidity)} | Holders: {formatCount(stats.holders)} | Top 10: {share(stats.top10)} | Bundle: {share(stats.bundlers)} | Dev: {share(stats.dev)}
  </p>
}

function thesisOf(lines: string[] | undefined) {
  const picked = (lines ?? []).slice(0, 4)
  if (!picked.length) return 'Clean holder spread and steady demand.'
  const sentence = picked.join(', ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

function RunnerCard({ token, onOpen }: { token: RadarToken; onOpen: (mint: string) => void }) {
  const stats: RadarRunnerStats = { marketCap: token.marketCap, liquidity: token.liquidityUsd, holders: token.holderTraits?.holders ?? null, top10: token.holderTraits?.top10 ?? null, bundlers: token.holderTraits?.bundlers ?? null, dev: token.holderTraits?.dev ?? null }
  return <li className="radar-runner-card">
    <p className="radar-runner-head">
      <strong className="tabular">[SCORE: {token.score}/100]</strong>
      <span> | {token.name} (${token.symbol}) | CA: <code>{token.mint}</code></span>
    </p>
    <StatsLine stats={stats}/>
    <p><b>Runner Thesis:</b> {thesisOf(token.runnerThesis)}</p>
    {token.learnedEdge && <p><b>Learned Edge:</b> {token.learnedEdge}</p>}
    {token.safetyPlan && token.safetyPlan.level !== 'ok' && <p className={`radar-runner-risk ${token.safetyPlan.level}`}><b>Safety plan:</b> {token.safetyPlan.summary}</p>}
    <p className="radar-study-links"><AxiomLink pairAddress={token.pairAddress} symbol={token.symbol} size={16}/><button type="button" className="radar-link-button" onClick={() => onOpen(token.mint)}>Open live details</button></p>
  </li>
}

export function RunnersView({ payload, tokens, onOpen }: { payload: RadarPayload; tokens: RadarToken[]; onOpen: (mint: string) => void }) {
  const runner = payload.runner
  const threshold = runner?.threshold ?? 75
  const live = tokens.filter(token => token.score >= threshold && !token.holderRisk?.blocked).sort((first, second) => second.score - first.score)
  return <div className="radar-learn">
    <div className="radar-section-head"><h2><Rocket size={16} aria-hidden="true"/> Runners</h2>
      <p>Coins scoring {threshold} or more on the runner score: no step-one disqualifier (mint or freeze on, dev over 5%, top 10 over 25%, bundles over 15%, a serial or copied launch, a dead chart, fresh wallets over 10%, a bot-driven climb or holders selling), then distribution 30, multi-wave momentum 30, hype 25 and chart health 15, less a point for each point the top 10 hold above 15%. Scores and holder sells are re-checked every second.</p></div>

    <div className="radar-learn-stats">
      <LearnStat label="Alert threshold" value={String(threshold)} note={runner && threshold > runner.normalThreshold ? `raised: the last ${runner.rollingDecided} alerts won under 40%` : 'normal'}/>
      <LearnStat label="Rolling win rate" value={runner?.rollingWinRate === null || runner?.rollingWinRate === undefined ? '—' : `${Math.round(runner.rollingWinRate * 100)}%`} note={runner ? `last ${runner.rollingDecided} decided alerts (+50% before -30%)` : 'waiting for the tracker'}/>
      <LearnStat label="Runners now" value={String(live.length)} note={`of ${tokens.length} tracked`}/>
    </div>

    <section className="radar-card">
      <div className="panel-heading"><h2>Score {threshold}+ right now</h2><span className="panel-caption">LIVE</span></div>
      {live.length === 0 ? <p className="radar-muted">No coin scores {threshold} or more right now.</p> : <ul className="radar-runner-list">{live.map(token => <RunnerCard key={token.mint} token={token} onOpen={onOpen}/>)}</ul>}
    </section>

    <section className="radar-card">
      <div className="panel-heading"><h2>Alert results</h2><span className="panel-caption">{runner?.alerts.length ?? 0} RECENT</span></div>
      <p className="radar-note">Every alert is followed for 4 hours: its best multiple within 15 minutes, 1 hour and 4 hours, and how soon it fell 30% under the alert price. A 30% dump within 10 minutes is a false positive; 2x within 4 hours is a runner.</p>
      {!runner?.alerts.length ? <p className="radar-muted">No alerts yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
        <thead><tr><th scope="col">Coin</th><th scope="col">Alerted</th><th scope="col">Score</th><th scope="col">Best 15m</th><th scope="col">Best 1h</th><th scope="col">Best 4h</th><th scope="col">Dumped after</th><th scope="col">Outcome</th></tr></thead>
        <tbody>{runner.alerts.map(alert => <tr key={alert.id}>
          <td><CoinName pairAddress={alert.pairAddress} symbol={alert.symbol}/></td>
          <td className="tabular">{formatClock(alert.alertedAt)}</td>
          <td className="tabular">{alert.score}</td>
          <td className="tabular">{multiple(alert.peak15m)}</td>
          <td className="tabular">{multiple(alert.peak1h)}</td>
          <td className="tabular">{multiple(alert.peak4h)}</td>
          <td className="tabular">{alert.dumpedAfterMinutes === null ? '—' : `${alert.dumpedAfterMinutes} min`}</td>
          <td className={alert.outcome === 'runner' ? 'radar-delta up' : alert.outcome === 'false-positive' ? 'radar-delta down' : ''}>{outcomeLabels[alert.outcome]}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="radar-card">
      <div className="panel-heading"><h2>What past alerts taught</h2><span className="panel-caption">{runner?.patterns.filter(pattern => pattern.points !== 0).length ?? 0} IN USE</span></div>
      <p className="radar-note">Each scoring trait is graded on the alerts it was part of. A trait behind 3 or more false positives that make up half its alerts costs 10 points; one behind 3 runners in half its alerts earns 10, or 5 for 2 runners in 30%. A trait needs 5 finished alerts first.</p>
      {!runner?.patterns.length ? <p className="radar-muted">Nothing learned yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
        <thead><tr><th scope="col">Trait</th><th scope="col">Alerts</th><th scope="col">False positives</th><th scope="col">Runners</th><th scope="col">Points</th></tr></thead>
        <tbody>{runner.patterns.map(pattern => <tr key={pattern.tag}>
          <td>{pattern.label}</td>
          <td className="tabular">{pattern.count}</td>
          <td className="tabular">{pattern.falsePositives}</td>
          <td className="tabular">{pattern.runners}</td>
          <td className={`tabular ${pattern.points > 0 ? 'radar-delta up' : pattern.points < 0 ? 'radar-delta down' : ''}`}>{pattern.points > 0 ? `+${pattern.points}` : pattern.points || '—'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>
}
