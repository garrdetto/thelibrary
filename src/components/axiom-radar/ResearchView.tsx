import { FlaskConical } from 'lucide-react'
import type { RadarEarlyNumbers } from '@/lib/axiom-radar-learner'
import type { RadarPayload, RadarToken } from '@/lib/axiom-radar-types'
import { AxiomLink, CoinName } from './AxiomLink'
import { formatClock, formatCount, formatUsd } from './format'
import { LearnStat } from './LearnedCoin'
import { RunTimingPanel } from './LearnedViews'

const percent = (value: number) => `${Math.round(value * 100)}%`
const statusLabels = { running: 'Still running', crashed: 'Crashed', faded: 'Faded out', holding: 'Held up' } as const

function earlyLine(early: RadarEarlyNumbers) {
  const parts = [
    early.marketCap === null ? null : `${formatUsd(early.marketCap)} mc`,
    early.buys5m === null ? null : `${formatCount(Math.round(early.buys5m))} buys`,
    early.volume5m === null ? null : `${formatUsd(early.volume5m)} vol`,
    early.buyRatio === null ? null : `${percent(early.buyRatio)} buys`,
    early.viewers === null ? null : `${Math.round(early.viewers)} viewers`,
    early.ageAtSight === null ? null : `${Math.round(early.ageAtSight)} min old`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'No early numbers stored'
}

export function ResearchView({ payload, tokens, onOpen }: { payload: RadarPayload; tokens: RadarToken[]; onOpen: (mint: string) => void }) {
  const winners = payload.winners
  const explosions = payload.explosions
  const learner = payload.learner
  const advice = payload.adviceStudy
  if (!winners && !explosions && !learner) return <p className="radar-empty-line">Research has not reported yet. It starts a minute or two after the tracker on your PC restarts with this update.</p>
  const live = new Set(tokens.map(token => token.mint))
  return <div className="radar-learn">
    <div className="radar-section-head"><h2><FlaskConical size={16} aria-hidden="true"/> Research Info</h2>
      <p>Everything the tracker has learned from the coins it watched. It studies every tracked coin continuously and retrains every few minutes. These are statistics from its own history, not predictions it can guarantee.</p></div>

    <div className="radar-learn-stats">
      <LearnStat label="Coins studied start to finish" value={(learner?.samples ?? 0).toLocaleString()} note={learner ? `${learner.watching} being watched now` : undefined}/>
      <LearnStat label="Big winners found" value={String(winners?.winners ?? 0)} note={winners ? `grew ${winners.minimumMultiple}x+ to at least $50K` : undefined}/>
      <LearnStat label="Viewer and buy jumps studied" value={(explosions?.bursts ?? 0).toLocaleString()} note={explosions ? `${explosions.exploded} exploded` : undefined}/>
      <LearnStat label="Last retrained" value={winners ? formatClock(winners.updatedAt) : '—'}/>
    </div>

    {winners && winners.ladder.base > 0 && <section className="radar-card">
      <div className="panel-heading"><h2>From under {formatUsd(winners.ladder.start)} to the big caps</h2><span className="panel-caption">{winners.ladder.base.toLocaleString()} COINS STARTED THERE</span></div>
      <div className="radar-ladder" role="list">{winners.ladder.steps.map(step => <div key={step.target} role="listitem">
        <strong className="tabular">{step.count}</strong>
        <span>reached {formatUsd(step.target)}+</span>
        <small className="tabular">{step.count ? `1 in ${Math.max(1, Math.round(winners.ladder.base / step.count))}` : 'none yet'}</small>
      </div>)}</div>
      <p className="radar-note">How many coins first seen under {formatUsd(winners.ladder.start)} went on to each market cap while the tracker watched them.</p>
    </section>}

    {winners && <section className="radar-card">
      <div className="panel-heading"><h2>Why the winners took off</h2></div>
      {winners.story.length ? <ul className="radar-learn-list">{winners.story.map(item => <li key={item}>{item}</li>)}</ul> : <p className="radar-muted">Nothing to summarise yet.</p>}
    </section>}

    {winners && <section className="radar-card">
      <div className="panel-heading"><h2>Research findings</h2><span className="panel-caption">{winners.rules.length} FOUND</span></div>
      <p className="radar-note">Each finding compares coins on one early number. These are the same findings you can switch on as filters in Millionaire Maker.</p>
      {winners.rules.length === 0 ? <p className="radar-muted">No early number separates winners from the rest clearly enough yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
        <thead><tr><th scope="col">Early sign</th><th scope="col">Became big winners</th><th scope="col">Otherwise</th><th scope="col">Edge</th></tr></thead>
        <tbody>{winners.rules.map(rule => <tr key={rule.key}>
          <td>{rule.label}</td>
          <td className="tabular radar-delta up">{percent(rule.winnerRate)}</td>
          <td className="tabular">{percent(rule.otherRate)}</td>
          <td className="tabular">{rule.otherRate > 0 ? `${(rule.winnerRate / rule.otherRate).toFixed(1)}x` : '—'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    {winners && <section className="radar-card">
      <div className="panel-heading"><h2>Biggest jumps studied</h2><span className="panel-caption">{winners.jumps.length} COINS</span></div>
      <p className="radar-note">Kept permanently, including coins that later crashed. Open a coin to see what was recorded about it.</p>
      {winners.jumps.length === 0 ? <p className="radar-muted">No tracked coin has grown {winners.minimumMultiple}x yet.</p> : <ul className="radar-study-list">{winners.jumps.map(coin => <li key={coin.mint}>
        <details>
          <summary>
            <CoinName pairAddress={coin.pairAddress} symbol={coin.symbol}/>
            <span className="tabular radar-delta up">{coin.multiple}x</span>
            <span className="tabular">{formatUsd(coin.firstMcap)} → {formatUsd(coin.peakMcap)}</span>
            {coin.multiple >= 10 && coin.peakMcap >= 200_000 && <span className="radar-tag">10x to $200K+</span>}
            <span className={`radar-study-status ${coin.status}`}>{statusLabels[coin.status]}</span>
          </summary>
          <div className="radar-study-body">
            <p className="radar-study-links"><AxiomLink pairAddress={coin.pairAddress} symbol={coin.symbol} size={16}/>{live.has(coin.mint) && <button type="button" className="radar-link-button" onClick={() => onOpen(coin.mint)}>Open live details</button>}</p>
            <ul className="radar-learn-list">
              <li>First seen {formatClock(coin.firstSeenAt)} at {formatUsd(coin.firstMcap)}, peaked at {formatUsd(coin.peakMcap)} after {coin.minutesToPeak} minutes ({coin.multiple}x).</li>
              <li>One minute in: {earlyLine(coin.early)}.</li>
              <li>{coin.status === 'crashed' ? `Crashed${coin.lifeMinutes !== null ? ` ${coin.lifeMinutes} minutes after launch` : ''}${coin.crashKind ? ` (${coin.crashKind})` : ''}.` : coin.status === 'running' ? 'Still being tracked and has not crashed.' : coin.status === 'holding' ? 'Held its value for the 4 hours it was watched.' : 'Faded off the radar without a sharp crash.'}</li>
              <li>{coin.winnerWallets ? `${coin.winnerWallets} of its top holders also held another winner.` : 'None of its recorded top holders held another winner.'}</li>
              <li>{coin.matched.length ? `Research findings it matched early: ${coin.matched.join('; ')}.` : 'It matched none of the current research findings early on, so it is a pattern the research does not explain yet.'}</li>
            </ul>
          </div>
        </details>
      </li>)}</ul>}
    </section>}

    {advice && <section className="radar-card">
      <div className="panel-heading"><h2>When to get out, and when not to buy again</h2><span className="panel-caption">RE-TESTED {formatClock(advice.updatedAt)}</span></div>
      <p className="radar-note">Each warning sign is tested against what coins did in the next 5 minutes. A sign is only used for advice when the numbers back it. Normally {advice.baseline.fell20Pct}% of coins fall 20%+ within 5 minutes and {advice.baseline.rose20Pct}% rise 20%+.</p>
      <div className="radar-table-wrap"><table className="radar-mini-table">
        <thead><tr><th scope="col">Warning sign</th><th scope="col">Used as</th><th scope="col">Times seen</th><th scope="col">Fell 20%+</th><th scope="col">Rose 20%+</th><th scope="col">Typical next 5 min</th></tr></thead>
        <tbody>{advice.signs.map(sign => <tr key={sign.key}>
          <td>{sign.label}</td>
          <td className={sign.level === 'exit' ? 'radar-delta down' : sign.level === 'tighten' ? 'radar-delta warn' : 'radar-muted-cell'}>{sign.level === 'exit' ? 'Get out' : sign.level === 'tighten' ? 'Be careful' : sign.samples < 20 ? 'Not enough data' : 'Not used'}</td>
          <td className="tabular">{sign.samples}</td>
          <td className="tabular">{sign.fell20Pct === null ? '—' : `${sign.fell20Pct}%`}</td>
          <td className="tabular">{sign.rose20Pct === null ? '—' : `${sign.rose20Pct}%`}</td>
          <td className="tabular">{sign.medianNext5mPct === null ? '—' : `${sign.medianNext5mPct > 0 ? '+' : ''}${sign.medianNext5mPct}%`}</td>
        </tr>)}</tbody>
      </table></div>
      <ul className="radar-learn-list radar-rebuy-list">{advice.rebuy.map(entry => <li key={entry.dropPct}>After falling {entry.dropPct}% from its high: {entry.newHighPct === null ? 'not enough coins seen yet' : `${entry.newHighPct}% made a new high within 30 minutes`} ({entry.samples} coins).</li>)}</ul>
      <p className="radar-note">{advice.unknownSharePct}% of warning moments could not be scored because the coin left the radar before 5 minutes passed. The tracker now keeps following coins after they leave, so this shrinks and the results get more reliable over the next day.</p>
    </section>}

    <RunTimingPanel payload={payload}/>

    {explosions && <section className="radar-card">
      <div className="panel-heading"><h2>What exploding coins had in common</h2><span className="panel-caption">{explosions.bursts.toLocaleString()} JUMPS</span></div>
      {explosions.insights.length ? <ul className="radar-learn-list">{explosions.insights.map(item => <li key={item}>{item}</li>)}</ul> : <p className="radar-muted">Not enough finished jumps to compare yet.</p>}
    </section>}
  </div>
}
