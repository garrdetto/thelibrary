import { ExternalLink, ListChecks, Rocket, Timer, Users } from 'lucide-react'
import type { RadarPayload, RadarToken } from '@/lib/axiom-radar-types'
import { AxiomLink } from './AxiomLink'
import { formatClock, formatUsd, relativeSeconds, shortAddress, solscanAccountUrl } from './format'
import { LearnStat, LearnedCoin, chanceLabel } from './LearnedCoin'

type ViewProps = { payload: RadarPayload; tokens: RadarToken[]; now: number; onOpen: (mint: string) => void }

const byMint = (tokens: RadarToken[]) => new Map(tokens.map(token => [token.mint, token]))
const listed = (mints: string[] | undefined, tokens: RadarToken[]) => {
  const lookup = byMint(tokens)
  return (mints ?? []).map(mint => lookup.get(mint)).filter((token): token is RadarToken => token !== undefined)
}
const starting = 'Starts a minute or two after the tracker on your PC restarts with this update.'
const hitRateNote = (hit: number | null, base: number | null, what: string) => hit === null || base === null ? 'Still measuring how often its flags are right.' : `In its own test on coins it had not seen, flagged coins ${what} ${Math.round(hit * 100)}% of the time, against ${Math.round(base * 100)}% for all coins.`

function Insights({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <section className="radar-card">
    <div className="panel-heading"><h2>{title}</h2></div>
    {items.length ? <ul className="radar-learn-list">{items.map(item => <li key={item}>{item}</li>)}</ul> : <p className="radar-muted">{empty}</p>}
  </section>
}

function WalletList({ title, note, wallets }: { title: string; note: string; wallets: Array<{ wallet: string; hits: number; averagePct?: number | null; coins: Array<{ mint: string; symbol: string; pairAddress: string | null }> }> }) {
  return <section className="radar-card">
    <div className="panel-heading"><h2><Users size={15} aria-hidden="true"/> {title}</h2><span className="panel-caption">{wallets.length} WALLETS</span></div>
    <p className="radar-note">{note}</p>
    {wallets.length === 0 ? <p className="radar-muted">No wallet has shown up in two of these coins yet.</p>
      : <ul className="radar-wallet-list">{wallets.map(wallet => <li key={wallet.wallet}>
        <div className="radar-wallet-head">
          <a href={solscanAccountUrl(wallet.wallet)} target="_blank" rel="noopener noreferrer" className="mono">{shortAddress(wallet.wallet)}<ExternalLink size={11}/></a>
          <strong className="tabular">in {wallet.hits} of them</strong>
          {wallet.averagePct !== null && wallet.averagePct !== undefined && <small className="tabular">held {wallet.averagePct.toFixed(2)}% of supply on average</small>}
        </div>
        <div className="radar-wallet-coins">{wallet.coins.map(coin => <span key={coin.mint} className="radar-wallet-coin"><span>{coin.symbol}</span><AxiomLink pairAddress={coin.pairAddress} symbol={coin.symbol}/></span>)}</div>
      </li>)}</ul>}
  </section>
}

export function ExplodeView({ payload, tokens, now, onOpen }: ViewProps) {
  const summary = payload.explosions
  if (!summary) return <p className="radar-empty-line">The explosion study has not reported yet. {starting}</p>
  const candidates = listed(summary.candidates, tokens)
  return <div className="radar-learn">
    <section aria-labelledby="radar-explode-title">
      <div className="radar-section-head"><h2 id="radar-explode-title"><Rocket size={16} aria-hidden="true"/> Could explode <span className="tabular">{candidates.length}</span></h2>
        <p>Coins showing the start of a jump right now, ranked by how often past jumps like theirs went on to 100+ viewers or doubled in price within 10 minutes. Estimates from past patterns, not promises.</p></div>
      {candidates.length ? <div className="radar-pick-grid">{candidates.map(token => {
        const explode = token.explode
        return <LearnedCoin key={token.mint} token={token} headline={chanceLabel(explode?.chance)} headlineLabel={explode?.learned ? 'chance to explode' : 'early estimate'} reasons={explode?.reasons ?? []} onOpen={onOpen}>
          {explode && <p className="radar-learn-fact tabular">
            {explode.burstStartedAt ? `Jumped ${relativeSeconds(explode.burstStartedAt, now)}: ` : ''}
            {explode.gain > 0 ? `+${explode.gain} viewers in ${Math.round(explode.seconds)}s` : 'Buys climbing fast'}
            {explode.earlyWallets > 0 ? ` · ${explode.earlyWallets} wallet${explode.earlyWallets === 1 ? '' : 's'} from past explosions` : ''}
          </p>}
        </LearnedCoin>
      })}</div> : <p className="radar-empty-line">No tracked coin is jumping right now. A coin appears here when it gains 20+ viewers within 30 seconds or its buys spike.</p>}
    </section>
    <div className="radar-learn-stats">
      <LearnStat label="Jumps studied" value={summary.bursts.toLocaleString()} note="20+ viewers in 30s, or 30+ extra buys in a minute"/>
      <LearnStat label="Went on to explode" value={summary.explodeRate === null ? '—' : `${Math.round(summary.explodeRate * 100)}%`} note={`${summary.exploded} coins`}/>
      <LearnStat label="Time to 100 viewers" value={summary.medianSecondsTo100 === null ? '—' : `${Math.round(summary.medianSecondsTo100)}s`} note="typical, after the jump"/>
      <LearnStat label="Typical price peak" value={summary.medianPriceMultiple === null ? '—' : `${summary.medianPriceMultiple.toFixed(1)}x`} note="for coins that exploded"/>
    </div>
    <p className="radar-note">{hitRateNote(summary.flaggedHitRate, summary.explodeRate, 'exploded')}</p>
    <div className="radar-learn-columns">
      <Insights title="What exploding coins had in common" items={summary.insights} empty="Not enough finished jumps to compare yet."/>
      <section className="radar-card">
        <div className="panel-heading"><h2>Recent explosions</h2><span className="panel-caption">{summary.recent.length} SHOWN</span></div>
        {summary.recent.length === 0 ? <p className="radar-muted">None recorded yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
          <thead><tr><th scope="col">Coin</th><th scope="col">When</th><th scope="col">Viewers</th><th scope="col">To 100</th><th scope="col">Price peak</th></tr></thead>
          <tbody>{summary.recent.map(item => <tr key={`${item.mint}-${item.startedAt}`}>
            <td><strong>{item.symbol}</strong> <AxiomLink pairAddress={item.pairAddress} symbol={item.symbol}/></td>
            <td className="tabular">{formatClock(item.startedAt)}</td>
            <td className="tabular">{item.startViewers} → {item.peakViewers}</td>
            <td className="tabular">{item.secondsTo100 === null ? '—' : `${item.secondsTo100}s`}</td>
            <td className="tabular">{item.priceMultiple === null ? '—' : `${item.priceMultiple}x`}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>
    <WalletList title="Wallets holding coins before they exploded" note="Top holders of two or more coins at the moment each one started jumping. Liquidity pools are filtered out. Exact buy sizes need a Helius key." wallets={summary.wallets}/>
  </div>
}

const statusLabels = { running: 'Still running', crashed: 'Crashed', faded: 'Faded out', holding: 'Held up' } as const

export function WatchListView({ payload, tokens, onOpen }: ViewProps) {
  const summary = payload.winners
  if (!summary) return <p className="radar-empty-line">The winners study has not reported yet. {starting}</p>
  const live = byMint(tokens)
  return <div className="radar-learn">
    <section aria-labelledby="radar-watchlist-title">
      <div className="radar-section-head"><h2 id="radar-watchlist-title"><ListChecks size={16} aria-hidden="true"/> Watch List <span className="tabular">{summary.top.length}</span></h2>
        <p>The coins this tracker watched grow the most: at least {summary.minimumMultiple}x from where it first saw them, ranked by the biggest market cap they reached.</p></div>
      {summary.top.length === 0 ? <p className="radar-empty-line">No tracked coin has grown that much yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table radar-watchlist">
        <thead><tr><th scope="col">Coin</th><th scope="col">First seen at</th><th scope="col">Peak</th><th scope="col">Growth</th><th scope="col">Time to peak</th><th scope="col">What happened</th><th scope="col">Shared wallets</th></tr></thead>
        <tbody>{summary.top.map(coin => <tr key={coin.mint}>
          <td>{live.has(coin.mint) ? <button type="button" className="radar-link-button" onClick={() => onOpen(coin.mint)}><strong>{coin.symbol}</strong></button> : <strong>{coin.symbol}</strong>} <AxiomLink pairAddress={coin.pairAddress} symbol={coin.symbol}/></td>
          <td className="tabular">{formatUsd(coin.firstMcap)} <small>{formatClock(coin.firstSeenAt)}</small></td>
          <td className="tabular"><strong>{formatUsd(coin.peakMcap)}</strong></td>
          <td className="tabular radar-delta up">{coin.multiple}x</td>
          <td className="tabular">{coin.minutesToPeak} min</td>
          <td>{statusLabels[coin.status]}{coin.lifeMinutes !== null ? ` at ${coin.lifeMinutes} min` : ''}</td>
          <td className="tabular">{coin.winnerWallets || '—'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <div className="radar-learn-columns">
      <Insights title="Why these coins took off" items={summary.story} empty="Nothing to summarise yet."/>
      <Insights title="What they had in common early" items={summary.traits} empty="Not enough winners to compare yet."/>
    </div>
    <WalletList title="Wallets behind the winners" note="Top holders found in two or more Watch List coins, with the share of supply they held. Liquidity pools are filtered out. Exact buy amounts and times need a Helius key." wallets={summary.wallets}/>
  </div>
}

export function RunTimingPanel({ payload }: { payload: RadarPayload }) {
  const learner = payload.learner
  if (!learner) return null
  return <section className="radar-card radar-learn-timing-panel">
    <div className="panel-heading"><h2><Timer size={15} aria-hidden="true"/> How long coins run before they crash</h2><span className="panel-caption">{learner.samples.toLocaleString()} COINS STUDIED</span></div>
    <div className="radar-learn-stats">
      <LearnStat label="Typical time to crash" value={learner.medianLifeMinutes === null ? '—' : `${learner.medianLifeMinutes} min`} note="after launch, for coins that crashed"/>
      <LearnStat label="Crashed" value={learner.samples ? `${Math.round((learner.rugs / learner.samples) * 100)}%` : '—'} note="fell 75% from the top or had liquidity pulled"/>
      <LearnStat label="At least doubled" value={learner.runnerRate === null ? '—' : `${Math.round(learner.runnerRate * 100)}%`} note={learner.medianTimeToPeakMinutes === null ? undefined : `peaking about ${learner.medianTimeToPeakMinutes} min in`}/>
      <LearnStat label="Being watched now" value={String(learner.watching)}/>
    </div>
    {learner.survival.length > 0 && <div className="radar-survival" role="img" aria-label={`Share of coins not yet crashed: ${learner.survival.map(point => `${point.alivePct}% at ${point.minutes} minutes`).join(', ')}`}>
      {learner.survival.map(point => <div key={point.minutes}><span style={{ height: `${Math.max(2, point.alivePct)}%` }}/><strong className="tabular">{Math.round(point.alivePct)}%</strong><small className="tabular">{point.minutes >= 60 ? `${point.minutes / 60}h` : `${point.minutes}m`}</small></div>)}
    </div>}
    <p className="radar-note">Bars show the share of coins that had not crashed yet at each age. {hitRateNote(learner.flaggedHitRate, learner.runnerRate, 'at least doubled')}</p>
    {learner.insights.length > 0 && <ul className="radar-learn-list">{learner.insights.map(item => <li key={item}>{item}</li>)}</ul>}
  </section>
}

export function EarlyRunners({ payload, tokens, onOpen }: Omit<ViewProps, 'now'>) {
  const picks = listed(payload.learner?.earlyPicks, tokens)
  if (!picks.length) return null
  return <section aria-labelledby="radar-early-title">
    <div className="radar-section-head"><h2 id="radar-early-title"><Rocket size={16} aria-hidden="true"/> Earliest runners <span className="tabular">{picks.length}</span></h2>
      <p>Coins under 30 minutes old that look most like past coins that at least doubled, judged on who is in them, buys and viewers.</p></div>
    <div className="radar-pick-grid">{picks.map(token => <LearnedCoin key={token.mint} token={token} headline={chanceLabel(token.outlook?.runnerChance)} headlineLabel="chance to double" reasons={token.outlook?.reasons ?? []} onOpen={onOpen}/>)}</div>
  </section>
}
