import type { KeyboardEvent, ReactNode } from 'react'
import { Eye } from 'lucide-react'
import type { RadarOutlookReason } from '@/lib/axiom-radar-learner'
import { radarOutlookPhaseLabels } from '@/lib/axiom-radar-learner'
import type { RadarToken } from '@/lib/axiom-radar-types'
import { AxiomLink } from './AxiomLink'
import { formatAge, formatCount, formatSigned, formatUsd } from './format'
import { TokenIcon, changeClass } from './RadarTable'

export const chanceLabel = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`

export function ReasonChips({ reasons }: { reasons: RadarOutlookReason[] }) {
  if (!reasons.length) return null
  return <ul className="radar-learn-reasons">{reasons.map(reason => <li key={reason.label} className={reason.good ? 'good' : 'bad'}>{reason.good ? '▲' : '▼'} {reason.label}</li>)}</ul>
}

export function outlookLine(token: RadarToken) {
  const outlook = token.outlook
  if (!outlook || outlook.expectedLifeMinutes === null) return null
  const left = outlook.minutesLeft ?? 0
  return `${outlook.phase ? radarOutlookPhaseLabels[outlook.phase] : 'Run timing'}: similar coins crashed about ${outlook.expectedLifeMinutes} min after launch${left > 0 ? `, roughly ${left} min from now` : ''}`
}

export function LearnedCoin({ token, headline, headlineLabel, reasons, onOpen, children }: { token: RadarToken; headline: string; headlineLabel: string; reasons: RadarOutlookReason[]; onOpen: (mint: string) => void; children?: ReactNode }) {
  const open = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(token.mint)
  }
  const timing = outlookLine(token)
  return <article className="radar-learn-coin" tabIndex={0} role="button" aria-label={`${token.symbol}, ${headlineLabel} ${headline}. Open details`} onClick={() => onOpen(token.mint)} onKeyDown={open}>
    <header>
      <TokenIcon token={token}/>
      <div className="radar-pick-name"><strong>{token.symbol} <AxiomLink pairAddress={token.pairAddress} symbol={token.symbol}/></strong><small className="tabular">{formatAge(token.ageMinutes)} old · {formatUsd(token.marketCap)} mc</small></div>
      <div className="radar-learn-headline"><strong className="tabular">{headline}</strong><small>{headlineLabel}</small></div>
    </header>
    <div className="radar-pick-stats">
      <span><Eye size={13} aria-hidden="true"/><strong className="tabular">{formatCount(token.viewers)}</strong></span>
      <span className={`tabular radar-delta ${changeClass(token.viewersPerMin)}`}>{formatSigned(token.viewersPerMin)}/min</span>
      <span className="tabular">{formatCount(token.buys5m)} buys 5m</span>
    </div>
    {children}
    <ReasonChips reasons={reasons}/>
    {timing && <p className="radar-learn-timing">{timing}</p>}
  </article>
}

export function LearnStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="radar-learn-stat"><span>{label}</span><strong className="tabular">{value}</strong>{note && <small>{note}</small>}</div>
}
