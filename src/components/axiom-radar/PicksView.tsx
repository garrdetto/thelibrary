import type { KeyboardEvent } from 'react'
import { Eye, Sparkles, TriangleAlert } from 'lucide-react'
import type { RadarToken } from '@/lib/axiom-radar-types'
import { formatCount, formatSigned, formatUsd } from './format'
import { LaunchLinks, PinButton, QualityBadge, ScoreBadge, TokenIcon, ViewerSparkline, changeClass, formatChange } from './RadarTable'

const windows = [['s30', '30s'], ['m1', '1m'], ['m5', '5m'], ['m10', '10m']] as const

type CardProps = { token: RadarToken; onOpen: (mint: string) => void; onTogglePin: (mint: string) => void }

export function PickCard({ token, onOpen, onTogglePin }: CardProps) {
  const open = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onOpen(token.mint)
  }
  return <article className={`radar-pick ${token.signal ?? ''} ${token.alerts.length ? 'alerting' : ''}`} tabIndex={0} role="button" aria-label={`${token.symbol}. Open details`} onClick={() => onOpen(token.mint)} onKeyDown={open}>
    <header>
      <TokenIcon token={token}/>
      <div className="radar-pick-name"><strong>{token.symbol}</strong><small title={token.name}>{token.name}</small></div>
      <ScoreBadge token={token}/>
      <PinButton token={token} onTogglePin={onTogglePin}/>
    </header>
    <div className="radar-pick-stats">
      <span><Eye size={13} aria-hidden="true"/><strong className="tabular">{formatCount(token.viewers)}</strong>{token.viewerRank && <small className="tabular">#{token.viewerRank}</small>}</span>
      <span className={`tabular radar-delta ${changeClass(token.viewersPerMin)}`}>{formatSigned(token.viewersPerMin)}/min{token.viewerSurge ? ' 🔥' : ''}</span>
      <span className="tabular">{formatUsd(token.marketCap)} mc</span>
      <QualityBadge token={token}/>
    </div>
    <div className="radar-pick-changes">
      {windows.map(([key, label]) => <span key={key}><small>{label}</small><strong className={`tabular radar-delta ${changeClass(token.priceChange[key])}`}>{formatChange(token.priceChange[key])}</strong></span>)}
      <ViewerSparkline history={token.history} field="priceUsd"/>
    </div>
    {token.signalReasons.length > 0 && <ul className="radar-pick-reasons">{token.signalReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {token.alerts.length > 0 && <p className="radar-pick-alert"><TriangleAlert size={13} aria-hidden="true"/>{token.alerts.join(' · ')}</p>}
    <LaunchLinks token={token}/>
  </article>
}

export function PicksView({ tokens, onOpen, onTogglePin }: { tokens: RadarToken[]; onOpen: (mint: string) => void; onTogglePin: (mint: string) => void }) {
  const buys = tokens.filter(token => token.signal === 'buy').sort((first, second) => second.score - first.score)
  const watch = tokens.filter(token => token.signal === 'watch').sort((first, second) => Number(second.viewerSurge) - Number(first.viewerSurge) || second.score - first.score).slice(0, 12)
  const warnings = tokens.filter(token => token.alerts.length > 0 && token.signal !== 'watch').slice(0, 6)
  return <div className="radar-picks">
    <section aria-labelledby="radar-buys-title">
      <div className="radar-section-head"><h2 id="radar-buys-title"><Sparkles size={16} aria-hidden="true"/> Recommended buys <span className="tabular">{buys.length}</span></h2><p>Coins that pass every buy rule in Settings right now. These are signals from your rules, not financial advice.</p></div>
      {buys.length ? <div className="radar-pick-grid">{buys.map(token => <PickCard key={token.mint} token={token} onOpen={onOpen} onTogglePin={onTogglePin}/>)}</div>
        : <p className="radar-empty-line">No coin passes every buy rule at the moment. Loosen the rules in Settings, or check Coins to watch.</p>}
    </section>
    <section aria-labelledby="radar-watch-title">
      <div className="radar-section-head"><h2 id="radar-watch-title"><Eye size={16} aria-hidden="true"/> Coins to watch <span className="tabular">{watch.length}</span></h2><p>Gaining viewers quickly, scoring well, moving up, or held by smart holders, but not yet passing every buy rule.</p></div>
      {watch.length ? <div className="radar-pick-grid">{watch.map(token => <PickCard key={token.mint} token={token} onOpen={onOpen} onTogglePin={onTogglePin}/>)}</div>
        : <p className="radar-empty-line">Nothing stands out yet. Keep Axiom Pulse open so viewer counts keep flowing.</p>}
    </section>
    {warnings.length > 0 && <section aria-labelledby="radar-warn-title">
      <div className="radar-section-head"><h2 id="radar-warn-title"><TriangleAlert size={16} aria-hidden="true"/> Warnings <span className="tabular">{warnings.length}</span></h2><p>Tracked coins showing rug-style behaviour: liquidity pulled, a sharp dump, or risky token authorities.</p></div>
      <div className="radar-pick-grid">{warnings.map(token => <PickCard key={token.mint} token={token} onOpen={onOpen} onTogglePin={onTogglePin}/>)}</div>
    </section>}
  </div>
}
