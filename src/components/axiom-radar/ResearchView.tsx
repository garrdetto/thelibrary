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
      <p className="radar-note">Each finding compares coins on one early number. Only positive winners count as winners here and in the Millionaire Maker match score, so coins with bad holder numbers never teach it. These are the same findings you can switch on as filters in Millionaire Maker.</p>
      {winners.rules.length === 0 ? <p className="radar-muted">No early number separates winners from the rest clearly enough yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
        <thead><tr><th scope="col">Early sign</th><th scope="col">Became positive winners</th><th scope="col">Otherwise</th><th scope="col">Edge</th></tr></thead>
        <tbody>{winners.rules.map(rule => <tr key={rule.key}>
          <td>{rule.label}</td>
          <td className="tabular radar-delta up">{percent(rule.winnerRate)}</td>
          <td className="tabular">{percent(rule.otherRate)}</td>
          <td className="tabular">{rule.otherRate > 0 ? `${(rule.winnerRate / rule.otherRate).toFixed(1)}x` : '—'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    {winners && <section className="radar-card">
      <div className="panel-heading"><h2>Biggest jumps studied</h2><span className="panel-caption">{winners.positives} POSITIVE · {winners.negatives} NEGATIVE</span></div>
      <p className="radar-note">Every coin that grew {winners.minimumMultiple}x or more is kept permanently and sorted into two groups. Nearly every coin dumps in the end, good or bad, so an ordinary dump after the peak is not held against a coin: it is judged on the traits and the demand behind its run, read before its peak. A coin is negative if any of these is true, however big a gain it showed:</p>
      <ul className="radar-learn-list radar-verdict-rules">
        <li>Before its peak, its top 10 wallets held over 35%, fresh wallets (first used within a day of launch, with a short history) over 10%, the dev over 5%, bundlers or insiders over 25%, snipers over 20% or linked wallet groups over 25%.</li>
        <li>It fell half below its peak within 15 minutes of its breakout (a pump and dump).</li>
        <li>It climbed in an even, steady line and then slid down in an even, steady line (the rug pattern).</li>
        <li>Its run had no real demand behind it: holders did not grow by half again (to at least 100), or fewer than 50 different wallets traded it in any 5 minutes.</li>
        <li>Its dev had made 20 or more coins and fewer than 1 in 10 graduated (a serial launcher).</li>
        <li>Its holders, top 10 or fresh wallets were never checked before its peak, or it had risky token settings.</li>
      </ul>
      <p className="radar-note">Open a coin to see what was recorded about it.</p>
      {winners.negativeBreakdown.length > 0 && <p className="radar-verdict-breakdown">{winners.negativeBreakdown.map(item => <span key={item.label} className="radar-tag">{item.label} <strong className="tabular">{item.count}</strong></span>)}</p>}
      {winners.separators.length > 0 && <div className="radar-verdict-separators">
        <h3>What separated the positives from the negatives</h3>
        <ul className="radar-learn-list">{winners.separators.map(item => <li key={item}>{item}</li>)}</ul>
      </div>}
      <div className="radar-verdict-groups">
        {(['positive', 'negative'] as const).map(verdict => {
          const group = winners.jumps.filter(coin => coin.verdict === verdict)
          return <div key={verdict} className={`radar-verdict-group ${verdict}`}>
            <h3>{verdict === 'positive' ? 'Positive coins' : 'Negative coins'} <span className="tabular">{group.length}</span></h3>
            <p className="radar-note">{verdict === 'positive' ? 'Grew with clean holder numbers all the way to its peak. These are the patterns worth finding again, and the only ones the scores learn from.' : 'Grew, but with holder numbers or settings that mark a coin to avoid.'}</p>
            {group.length === 0 ? <p className="radar-muted">{verdict === 'positive' ? 'No studied coin has stayed clean yet.' : 'None yet.'}</p> : <ul className="radar-study-list">{group.map(coin => <li key={coin.mint}>
              <details>
                <summary>
                  <CoinName pairAddress={coin.pairAddress} symbol={coin.symbol}/>
                  <span className="tabular radar-delta up">{coin.multiple}x</span>
                  <span className="tabular">{formatUsd(coin.firstMcap)} → {formatUsd(coin.peakMcap)}</span>
                  {coin.multiple >= 10 && coin.peakMcap >= 200_000 && <span className="radar-tag">10x to $200K+</span>}
                  <span className={`radar-study-status ${coin.status}`}>{verdict === 'negative' ? coin.negatives[0] : statusLabels[coin.status]}</span>
                </summary>
                <div className="radar-study-body">
                  <p className="radar-study-links"><AxiomLink pairAddress={coin.pairAddress} symbol={coin.symbol} size={16}/>{live.has(coin.mint) && <button type="button" className="radar-link-button" onClick={() => onOpen(coin.mint)}>Open live details</button>}</p>
                  {coin.negatives.length > 0 && <ul className="radar-learn-list radar-negative-list">{coin.negatives.map(item => <li key={item}>{item}</li>)}</ul>}
                  <ul className="radar-learn-list">
                    <li>First seen {formatClock(coin.firstSeenAt)} at {formatUsd(coin.firstMcap)}, peaked at {formatUsd(coin.peakMcap)} after {coin.minutesToPeak} minutes ({coin.multiple}x).</li>
                    <li>One minute in: {earlyLine(coin.early)}.</li>
                    <li>{coin.holdersPeak ? `Most holders seen: ${formatCount(coin.holdersPeak)}.` : 'Holder count was not recorded (the coin was not on your Pulse).'}{coin.topHoldersPct !== null ? ` Before its peak its top 10 wallets held up to ${Math.round(coin.topHoldersPct)}% of supply.` : ''}{coin.freshPct !== null && coin.freshPct !== undefined ? ` Fresh wallets held ${Math.round(coin.freshPct)}%.` : ''}</li>
                    <li>{coin.status === 'crashed' ? `Crashed${coin.lifeMinutes !== null ? ` ${coin.lifeMinutes} minutes after launch` : ''}${coin.crashKind ? ` (${coin.crashKind})` : ''}.` : coin.status === 'running' ? 'Still being tracked and has not crashed.' : coin.status === 'holding' ? 'Held its value for the 4 hours it was watched.' : 'Faded off the radar without a sharp crash.'}</li>
                    <li>{coin.winnerWallets ? `${coin.winnerWallets} of its top holders also held another positive winner.` : 'None of its recorded top holders held another positive winner.'}</li>
                    <li>{coin.matched.length ? `Research findings it matched early: ${coin.matched.join('; ')}.` : 'It matched none of the current research findings early on, so it is a pattern the research does not explain yet.'}</li>
                  </ul>
                </div>
              </details>
            </li>)}</ul>}
          </div>
        })}
      </div>
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
