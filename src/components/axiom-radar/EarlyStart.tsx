import type { RadarEarlyRecord, RadarEarlyStart, RadarEarlySummary, RadarScoreStatus } from '@/lib/axiom-radar-types'
import { CoinName } from './AxiomLink'
import { formatClock, formatUsd } from './format'
import { LearnStat } from './LearnedCoin'

const statusMark: Record<RadarScoreStatus, string> = { earned: '✓', partial: '½', missed: '✗', unknown: '?' }
const statusText: Record<RadarScoreStatus, string> = { earned: 'earned', partial: 'part earned', missed: 'not earned', unknown: 'no reading yet' }
const multiple = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}x`
const resultLabels: Record<NonNullable<RadarEarlyRecord['result']>, string> = { win: '+50% first', loss: '-35% first', flat: 'Neither' }
const nearlyOn = 70

function stateLine(early: RadarEarlyStart) {
  if (early.firing) return 'The whole pattern is on: crowd and trading are building and the price has not left its range.'
  if (early.blockedBy) return `Not firing: ${early.blockedBy}.`
  if (early.missing.length) return `Not firing. Still needs: ${early.missing.join('; ')}.`
  return 'Not firing.'
}

/** A small tag on the coin's row: bright while the whole pattern is on, quiet when the reading is high but a part is missing. */
export function EarlyTag({ early }: { early: RadarEarlyStart | null | undefined }) {
  if (!early || early.blockedBy || (!early.firing && early.score < nearlyOn)) return null
  const title = early.firing
    ? `Early-start pattern on (${early.score} of 100): crowd and trading building before the price has moved. The paper bot does not buy on this.`
    : `Early-start reading ${early.score} of 100, pattern not complete`
  return <span className={`radar-tag radar-early-tag${early.firing ? ' on' : ''}`} title={title}>Early {early.score}</span>
}

/** The early-start reading in full: whether the pattern is on, what is missing and every sign with its reading. */
export function EarlySigns({ early }: { early: RadarEarlyStart }) {
  return <div className="radar-early">
    <p className={`radar-early-state${early.firing ? ' on' : ''}`} role="status">{stateLine(early)}</p>
    {early.signs.length > 0 && <ul className="radar-ledger-list">{early.signs.map(sign => <li key={sign.label} className={`radar-ledger-row ${sign.status}`}>
      <span className="radar-ledger-mark" role="img" aria-label={statusText[sign.status]}>{statusMark[sign.status]}</span>
      <span className="radar-ledger-label">{sign.label}<small>{sign.reading}</small></span>
      <span className="radar-ledger-points tabular">{sign.points} / {sign.max}</span>
    </li>)}</ul>}
    {early.fading && <p className="radar-note">{early.fading}: 15 points off the reading.</p>}
    <p className="radar-note">This reading only watches. It adds up to 20 points to the runner score, and every time the whole pattern comes on it is recorded and followed for 15 minutes on the Runners tab. The paper bot does not buy on it.</p>
  </div>
}

/** How the early-start pattern has done: every time it fired, followed for 15 minutes. */
export function EarlyResults({ summary }: { summary: RadarEarlySummary | null | undefined }) {
  const decided = summary?.decided ?? 0
  return <section className="radar-card" aria-labelledby="radar-early-results">
    <div className="panel-heading"><h2 id="radar-early-results">Early starts</h2><span className="panel-caption">{summary?.fired ?? 0} IN 7 DAYS</span></div>
    <p className="radar-note">The early-start pattern looks for a coin about to move, not one that already has: 15 minutes old or less, 100+ watching with 8+ viewers per $1K of market cap, 5-minute volume at least its market cap, trades up 15% in a minute, viewers up 5% in 30 seconds, and a price within 35% of its 3-minute low. Each time it comes on the coin is followed for 15 minutes. The paper bot does not buy on it: in the tracker's history 3 in 10 of these doubled, but most of the rest were dumped first, so this table is here to show whether it earns its place. Times the pattern was complete while a gate held the coin at 0 are listed too, with the gate named, and counted separately.</p>
    <div className="radar-learn-stats">
      <LearnStat label="Reached +50% first" value={decided ? `${Math.round(((summary?.wins ?? 0) / decided) * 100)}%` : '—'} note={decided ? `${summary?.wins} of ${decided} finished` : 'none finished yet'}/>
      <LearnStat label="Fell 35% first" value={decided ? `${Math.round(((summary?.losses ?? 0) / decided) * 100)}%` : '—'} note={decided ? `${summary?.losses} of ${decided}, coins that vanished included` : 'none finished yet'}/>
      <LearnStat label="Typical best in 15 min" value={multiple(summary?.medianPeak ?? null)} note="middle of the finished ones"/>
      <LearnStat label="Held at 0 by a gate" value={String(summary?.blocked.fired ?? 0)} note={summary?.blocked.decided ? `${summary.blocked.wins} of ${summary.blocked.decided} finished reached +50% first` : 'pattern complete, a gate failing; not counted above'}/>
    </div>
    {!summary?.recent.length ? <p className="radar-muted">The pattern has not come on yet.</p> : <div className="radar-table-wrap"><table className="radar-mini-table">
      <thead><tr><th scope="col">Coin</th><th scope="col">Came on</th><th scope="col">Market cap</th><th scope="col">Early</th><th scope="col">Score</th><th scope="col">Best 15m</th><th scope="col">Worst 15m</th><th scope="col">After 15m</th><th scope="col">Result</th><th scope="col">Gate</th></tr></thead>
      <tbody>{summary.recent.map(record => <tr key={record.id}>
        <td><CoinName pairAddress={record.pairAddress} symbol={record.symbol}/></td>
        <td className="tabular">{formatClock(record.firedAt)}</td>
        <td className="tabular">{formatUsd(record.marketCap)}</td>
        <td className="tabular">{record.score}</td>
        <td className="tabular">{record.runnerScore ?? '—'}</td>
        <td className="tabular">{multiple(record.peak15m)}</td>
        <td className="tabular">{multiple(record.low15m)}</td>
        <td className="tabular">{multiple(record.end15m)}</td>
        <td className={record.result === 'win' ? 'radar-delta up' : record.result === 'loss' ? 'radar-delta down' : ''}>{record.result ? resultLabels[record.result] : 'Following'}</td>
        <td className={record.blockedBy ? 'radar-muted' : ''}>{record.blockedBy ?? 'clear'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}
