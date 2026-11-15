import type { RadarToken } from '@/lib/axiom-radar-types'
import { changeClass, formatChange } from './RadarTable'

const moveWindows = [['s5', '5s'], ['s30', '30s'], ['m1', '1m'], ['m5', '5m']] as const

/** Every rule behind a coin's DexScreener score, with the reading it used. */
export function DexScoreBreakdown({ token }: { token: RadarToken }) {
  const dex = token.dex
  if (!dex) return <p className="radar-muted">The tracker has not sent a DexScreener score for this coin yet. It appears after the tracker update that adds it.</p>
  return <>
    <dl className="radar-facts">
      {moveWindows.map(([key, label]) => <div key={key}><dt>Price, {label}</dt><dd className={`tabular radar-delta ${changeClass(dex.moves[key])}`}>{formatChange(dex.moves[key])}</dd></div>)}
    </dl>
    <ul className="radar-factors">
      {dex.checks.map(item => <li key={item.label} className={item.points < 0 ? 'radar-factor-penalty' : ''}>
        <span>{item.label}</span>
        <span className="radar-penalty-reasons">{item.reading}</span>
        <span className="tabular">{item.max ? `${item.points.toFixed(1)} / ${item.max}` : item.points}</span>
      </li>)}
      {dex.cuts.length > 0 && <li className="radar-factor-penalty"><span>Cuts and caps</span><span className="radar-penalty-reasons">{dex.cuts.join(' · ')}</span><span className="tabular">{dex.score}</span></li>}
    </ul>
  </>
}
