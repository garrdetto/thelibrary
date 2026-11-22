import { TrendingUp } from 'lucide-react'
import type { RadarClimber, RadarClimberMilestone } from '@/lib/axiom-radar-learner'
import { AxiomLink, CoinName } from './AxiomLink'
import { formatClock, formatUsd } from './format'

const outcomeLabels: Record<string, string> = { open: 'Still tracked', survived: 'Holding', faded: 'Faded', rug: 'Crashed' }
const dash = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US')
const pct = (value: number | null) => value === null ? '—' : `${value}%`
const hours = (minutes: number) => minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`

function Curve({ shape }: { shape: Array<number | null> }) {
  const values = shape.filter((value): value is number => value !== null && value > 0)
  if (values.length < 2) return null
  const low = Math.log(Math.min(...values))
  const high = Math.log(Math.max(...values))
  const span = high - low || 1
  const points = shape.map((value, index) => value === null || value <= 0 ? null : `${(index / (shape.length - 1)) * 100},${30 - ((Math.log(value) - low) / span) * 28 - 1}`).filter(Boolean).join(' ')
  return <svg className="radar-climber-curve" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>
}

function Milestones({ marks }: { marks: RadarClimberMilestone[] }) {
  return <div className="radar-table-wrap">
    <table className="radar-mini-table">
      <thead><tr><th scope="col">Point</th><th scope="col">Market cap</th><th scope="col">5m volume</th><th scope="col">Liquidity</th><th scope="col">Buy share</th><th scope="col">Holders</th><th scope="col">Viewers</th><th scope="col">Top 10</th><th scope="col">Bundlers</th><th scope="col">Snipers</th><th scope="col">Fresh</th></tr></thead>
      <tbody>{marks.map(mark => <tr key={mark.label}>
        <th scope="row">{mark.label === 'start' ? 'Start' : mark.label === 'peak' ? 'Peak' : `+${mark.label}`}</th>
        <td className="tabular">{mark.marketCap === null ? 'No reading' : formatUsd(mark.marketCap)}</td>
        <td className="tabular">{mark.volume5m === null ? '—' : formatUsd(mark.volume5m)}</td>
        <td className="tabular">{mark.liquidity === null ? '—' : formatUsd(mark.liquidity)}</td>
        <td className="tabular">{mark.buyRatio === null ? '—' : `${Math.round(mark.buyRatio * 100)}%`}</td>
        <td className="tabular">{dash(mark.holders)}</td>
        <td className="tabular">{dash(mark.viewers)}</td>
        <td className="tabular">{pct(mark.top10)}</td>
        <td className="tabular">{pct(mark.bundlers)}</td>
        <td className="tabular">{pct(mark.snipers)}</td>
        <td className="tabular">{pct(mark.fresh)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

/** The saved steady climbers: coins that rose for an hour or more with real volume and liquidity to $200K or more, with their numbers along the way. */
export function ClimbersSection({ climbers }: { climbers: RadarClimber[] }) {
  return <section className="radar-card radar-climbers" aria-labelledby="radar-climbers-title">
    <div className="panel-heading">
      <h2 id="radar-climbers-title"><TrendingUp size={15} aria-hidden="true"/> Steady climbers saved <span className="tabular">{climbers.length}</span></h2>
      <span className="panel-caption">KEPT PERMANENTLY · USED TO FIND SIMILAR COINS</span>
    </div>
    <p className="radar-note">A coin is saved when it rises for an hour or more, up in most 5-minute steps and never more than 40% off its high on the way, with $5K+ average 5-minute volume and $30K+ liquidity, to a peak of $200K or more. Its chart, its numbers at the start, 15, 30, 60 and 120 minutes in and at the peak, and the wallets that bought before the peak are kept, and it counts as a positive winner for the match above.</p>
    {climbers.length === 0 ? <p className="radar-muted">No coin has climbed like this since the tracker started saving them. They are saved the moment one qualifies.</p>
      : <ul className="radar-climber-list">{climbers.map(climber => <li key={climber.mint}>
        <details>
          <summary>
            <span className="radar-climber-name"><CoinName pairAddress={climber.pairAddress} symbol={climber.symbol}/> <AxiomLink pairAddress={climber.pairAddress} symbol={climber.symbol}/></span>
            <Curve shape={climber.shape}/>
            <span className="tabular">{formatUsd(climber.startMcap)} → <strong>{formatUsd(climber.peakMcap)}</strong></span>
            <span className="tabular">{climber.gain.toFixed(1)}x in {hours(climber.minutes)}</span>
            <span className="tabular radar-muted">up {Math.round(climber.upShare * 100)}% · vol {climber.averageVolume5m === null ? '—' : formatUsd(climber.averageVolume5m)} · liq {climber.maxLiquidity === null ? '—' : formatUsd(climber.maxLiquidity)}</span>
            <span className="radar-muted">{climber.outcome ? outcomeLabels[climber.outcome] ?? climber.outcome : ''}{climber.wallets ? ` · ${climber.wallets} early buyer${climber.wallets === 1 ? '' : 's'}` : ''}</span>
          </summary>
          <p className="radar-note">Climb started {formatClock(climber.startAt)}, peaked {formatClock(climber.peakAt)}{climber.holdersPeak ? `, ${climber.holdersPeak.toLocaleString('en-US')} holders at most` : ''}.</p>
          <Milestones marks={climber.milestones}/>
        </details>
      </li>)}</ul>}
  </section>
}
