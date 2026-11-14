import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, ExternalLink, Globe, Send, Twitter } from 'lucide-react'
import { Line, LineChart, YAxis } from 'recharts'
import type { RadarHistoryPoint, RadarSafetyLevel, RadarToken } from '@/lib/axiom-radar-types'
import { axiomUrl, dexScreenerUrl, formatAge, formatCount, formatSigned, formatUsd } from './format'

export type RadarSortKey = 'score' | 'viewers' | 'viewersDelta5m' | 'runnerWallets' | 'marketCap' | 'volume5m' | 'ageMinutes'
export type RadarSort = { key: RadarSortKey; direction: 'asc' | 'desc' }

const safetyLabels: Record<RadarSafetyLevel, string> = { safe: 'Safe', caution: 'Caution', risky: 'Risky', unknown: 'Unchecked' }

export function scoreTier(score: number) {
  return score >= 85 ? 'hot' : score >= 75 ? 'strong' : score >= 50 ? 'mid' : 'low'
}

export const ViewerSparkline = memo(function ViewerSparkline({ history }: { history: RadarHistoryPoint[] }) {
  const data = history.filter(point => point.viewers !== null)
  if (data.length < 2) return <span className="radar-spark-empty" aria-hidden="true">—</span>
  return <LineChart width={84} height={26} data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }} aria-hidden="true">
    <YAxis hide domain={['dataMin', 'dataMax']}/>
    <Line type="monotone" dataKey="viewers" stroke="var(--green)" strokeWidth={1.6} dot={false} isAnimationActive={false}/>
  </LineChart>
})

export function ScoreBadge({ token, large = false }: { token: RadarToken; large?: boolean }) {
  const tooltipId = `score-tip-${token.mint}`
  return <span className={`radar-score ${scoreTier(token.score)} ${large ? 'large' : ''}`} tabIndex={0} aria-describedby={tooltipId} onClick={event => event.stopPropagation()}>
    <strong className="tabular">{token.score}</strong>
    <span role="tooltip" id={tooltipId} className="radar-tooltip">
      <b>Setup score {token.score}/100</b>
      {token.factors.map(factor => <span key={factor.key} className={factor.available ? '' : 'muted'}>
        <span>{factor.label}</span>
        <span className="tabular">{factor.available ? `${Math.round(factor.value * 100)}% × ${factor.weight.toFixed(2)} → ${factor.contribution.toFixed(1)}` : 'no data'}</span>
      </span>)}
    </span>
  </span>
}

export function SafetyBadge({ level }: { level: RadarSafetyLevel }) {
  return <span className={`radar-safety ${level}`}>{safetyLabels[level]}</span>
}

function TokenIcon({ token }: { token: RadarToken }) {
  const [failed, setFailed] = useState(false)
  if (!token.imageUrl || failed) return <span className="radar-token-icon fallback" aria-hidden="true">{token.symbol.slice(0, 2)}</span>
  return <img className="radar-token-icon" src={token.imageUrl} alt="" loading="lazy" width={30} height={30} onError={() => setFailed(true)}/>
}

function CopyMint({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(event: MouseEvent) {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(mint)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { }
  }
  return <button type="button" className="radar-icon-button" onClick={copy} aria-label={copied ? 'Mint address copied' : `Copy mint address ${mint}`} title="Copy mint address">
    {copied ? <Check size={13}/> : <Copy size={13}/>}
  </button>
}

const stop = (event: MouseEvent) => event.stopPropagation()

function ExternalIcon({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <a className="radar-icon-button" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} onClick={stop}>{children}</a>
}

function BuySellBar({ buys, sells }: { buys: number | null; sells: number | null }) {
  const total = (buys ?? 0) + (sells ?? 0)
  if (!total) return <span className="radar-muted">—</span>
  const share = Math.round(((buys ?? 0) / total) * 100)
  return <span className="radar-buysell" role="img" aria-label={`${buys} buys, ${sells} sells, ${share}% buys`}>
    <span className="radar-buysell-track"><span style={{ width: `${share}%` }}/></span>
    <span className="radar-buysell-label tabular">{buys}/{sells}</span>
  </span>
}

function SortHeader({ label, sortKey, sort, onSort, className }: { label: string; sortKey: RadarSortKey; sort: RadarSort; onSort: (key: RadarSortKey) => void; className?: string }) {
  const active = sort.key === sortKey
  return <th scope="col" className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`radar-sort ${active ? 'active' : ''}`} onClick={() => onSort(sortKey)}>
      {label}{active ? sort.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/> : <ArrowUpDown size={12} className="radar-sort-idle"/>}
    </button>
  </th>
}

type RadarTableProps = {
  tokens: RadarToken[]
  ranks: Map<string, number>
  sort: RadarSort
  onSort: (key: RadarSortKey) => void
  onOpen: (mint: string) => void
  selected: string | null
}

export function RadarTable({ tokens, ranks, sort, onSort, onOpen, selected }: RadarTableProps) {
  const openWithKeyboard = (event: KeyboardEvent<HTMLTableRowElement>, mint: string) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(mint)
    }
  }
  return <div className="radar-table-wrap">
    <table className="radar-table">
      <caption className="sr-only">Tracked tokens under five hours old. Select a row for details.</caption>
      <thead>
        <tr>
          <SortHeader label="Token" sortKey="ageMinutes" sort={sort} onSort={onSort} className="radar-col-token"/>
          <SortHeader label="Score" sortKey="score" sort={sort} onSort={onSort}/>
          <SortHeader label="Viewers" sortKey="viewers" sort={sort} onSort={onSort}/>
          <SortHeader label="5m rise" sortKey="viewersDelta5m" sort={sort} onSort={onSort}/>
          <SortHeader label="Runners" sortKey="runnerWallets" sort={sort} onSort={onSort}/>
          <SortHeader label="MCap / Liq" sortKey="marketCap" sort={sort} onSort={onSort}/>
          <SortHeader label="5m vol · B/S" sortKey="volume5m" sort={sort} onSort={onSort}/>
          <th scope="col">Safety</th>
          <th scope="col"><span className="sr-only">Launch links</span></th>
        </tr>
      </thead>
      <tbody>
        {tokens.map(token => <tr key={token.mint} tabIndex={0} className={selected === token.mint ? 'selected' : ''} onClick={() => onOpen(token.mint)} onKeyDown={event => openWithKeyboard(event, token.mint)} aria-label={`${token.symbol}, score ${token.score}. Open details`}>
          <td className="radar-col-token">
            <div className="radar-token">
              <span className="radar-rank tabular">{ranks.get(token.mint) ?? '·'}</span>
              <TokenIcon token={token}/>
              <div className="radar-token-text">
                <div className="radar-token-line"><strong>{token.symbol}</strong><span className="radar-age tabular">{formatAge(token.ageMinutes)}</span>{token.isBoosted && <span className="radar-boost" title="DexScreener boosted">⚡</span>}</div>
                <div className="radar-token-line radar-token-actions">
                  <span className="radar-token-name" title={token.name}>{token.name}</span>
                  <CopyMint mint={token.mint}/>
                  {token.socials.twitter && <ExternalIcon href={token.socials.twitter} label={`${token.symbol} on X`}><Twitter size={13}/></ExternalIcon>}
                  {token.socials.telegram && <ExternalIcon href={token.socials.telegram} label={`${token.symbol} on Telegram`}><Send size={13}/></ExternalIcon>}
                  {token.socials.website && <ExternalIcon href={token.socials.website} label={`${token.symbol} website`}><Globe size={13}/></ExternalIcon>}
                </div>
              </div>
            </div>
          </td>
          <td><ScoreBadge token={token}/></td>
          <td><div className="radar-viewers"><span className="tabular">{formatCount(token.viewers)}</span><ViewerSparkline history={token.history}/></div></td>
          <td>
            <div className={`radar-delta tabular ${(token.viewersDelta5m ?? 0) > 0 ? 'up' : (token.viewersDelta5m ?? 0) < 0 ? 'down' : ''}`}>
              <strong>{formatSigned(token.viewersDelta5m)}</strong>
              <small>{formatSigned(token.viewersPct5m, '%')}</small>
            </div>
          </td>
          <td><span className={`radar-runners tabular ${token.runnerWallets ? 'active' : ''}`}>🐋 {token.runnerWallets}</span></td>
          <td><div className="radar-stack tabular"><strong>{formatUsd(token.marketCap)}</strong><small>{formatUsd(token.liquidityUsd)} liq</small></div></td>
          <td><div className="radar-stack tabular"><strong>{formatUsd(token.volume5m)}</strong><BuySellBar buys={token.buys5m} sells={token.sells5m}/></div></td>
          <td><SafetyBadge level={token.safety.level}/></td>
          <td>
            <div className="radar-launch">
              <a href={axiomUrl(token.pairAddress)} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Open ${token.symbol} on Axiom`}>Axiom<ExternalLink size={11}/></a>
              <a href={dexScreenerUrl(token.pairAddress)} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Open ${token.symbol} on DexScreener`}>Dex<ExternalLink size={11}/></a>
            </div>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
