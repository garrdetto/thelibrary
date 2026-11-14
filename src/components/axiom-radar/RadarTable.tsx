import { memo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, ExternalLink, Globe, Send, Star, TriangleAlert, Twitter } from 'lucide-react'
import { Line, LineChart, YAxis } from 'recharts'
import type { RadarHistoryPoint, RadarSafetyLevel, RadarToken } from '@/lib/axiom-radar-types'
import { axiomUrl, dexScreenerUrl, formatAge, formatCount, formatSigned, formatUsd } from './format'

export type RadarSortKey = 'score' | 'viewers' | 'viewersPerMin' | 's30' | 'm1' | 'm5' | 'm10' | 'marketCap' | 'volume5m' | 'ageMinutes'
export type RadarSort = { key: RadarSortKey; direction: 'asc' | 'desc' }

const safetyLabels: Record<RadarSafetyLevel, string> = { safe: 'Safe', caution: 'Caution', risky: 'Risky', unknown: 'Unchecked' }

export function sortValue(token: RadarToken, key: RadarSortKey) {
  const value = key === 's30' || key === 'm1' || key === 'm5' || key === 'm10' ? token.priceChange[key] : token[key]
  return typeof value === 'number' ? value : Number.NEGATIVE_INFINITY
}

export function scoreTier(score: number) {
  return score >= 85 ? 'hot' : score >= 75 ? 'strong' : score >= 50 ? 'mid' : 'low'
}

export function formatChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}%`
}

export function changeClass(value: number | null) {
  return value === null ? '' : value > 0 ? 'up' : value < 0 ? 'down' : ''
}

const sameHistory = (previous: { history: RadarHistoryPoint[]; field?: string }, next: { history: RadarHistoryPoint[]; field?: string }) =>
  previous.field === next.field && previous.history.length === next.history.length && previous.history.at(-1)?.t === next.history.at(-1)?.t

export const ViewerSparkline = memo(function ViewerSparkline({ history, field = 'viewers' }: { history: RadarHistoryPoint[]; field?: 'viewers' | 'priceUsd' }) {
  const data = history.filter(point => point[field] !== null)
  if (data.length < 2) return <span className="radar-spark-empty" aria-hidden="true">—</span>
  const rising = (data.at(-1)?.[field] ?? 0) >= (data[0][field] ?? 0)
  return <LineChart width={72} height={24} data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }} aria-hidden="true">
    <YAxis hide domain={['dataMin', 'dataMax']}/>
    <Line type="monotone" dataKey={field} stroke={field === 'viewers' ? 'var(--green)' : rising ? 'var(--radar-up)' : 'var(--radar-down)'} strokeWidth={1.6} dot={false} isAnimationActive={false}/>
  </LineChart>
}, sameHistory)

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

export function SignalBadge({ token }: { token: RadarToken }) {
  if (!token.signal) return <span className="radar-muted">—</span>
  return <span className={`radar-signal ${token.signal}`} title={token.signalReasons.join(' · ')}>{token.signal === 'buy' ? 'Buy' : 'Watch'}</span>
}

export function SafetyBadge({ level }: { level: RadarSafetyLevel }) {
  return <span className={`radar-safety ${level}`}>{safetyLabels[level]}</span>
}

export function QualityBadge({ token }: { token: RadarToken }) {
  if (token.quality.score === null) return <SafetyBadge level={token.safety.level}/>
  const flags = token.quality.checks.filter(check => check.status === 'fail').length
  const tone = flags ? 'risky' : token.quality.score >= 70 ? 'safe' : 'caution'
  const summary = token.quality.checks.map(check => `${check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗'} ${check.label}: ${check.detail}`).join('\n')
  return <span className={`radar-safety ${tone}`} title={summary}>{token.quality.score}{flags ? ` · ${flags} flag${flags === 1 ? '' : 's'}` : ''}</span>
}

export function TokenIcon({ token }: { token: RadarToken }) {
  const [failed, setFailed] = useState(false)
  if (!token.imageUrl || failed) return <span className="radar-token-icon fallback" aria-hidden="true">{token.symbol.slice(0, 2)}</span>
  return <img className="radar-token-icon" src={token.imageUrl} alt="" loading="lazy" width={30} height={30} onError={() => setFailed(true)}/>
}

export function PinButton({ token, onTogglePin }: { token: RadarToken; onTogglePin: (mint: string) => void }) {
  return <button type="button" className={`radar-icon-button radar-pin ${token.pinned ? 'on' : ''}`} aria-pressed={token.pinned} aria-label={token.pinned ? `Unpin ${token.symbol}` : `Pin ${token.symbol}`} title={token.pinned ? 'Pinned: always tracked' : 'Pin: always track this coin'} onClick={event => { event.stopPropagation(); onTogglePin(token.mint) }}>
    <Star size={14} fill={token.pinned ? 'currentColor' : 'none'}/>
  </button>
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
    <span className="radar-buysell-label tabular">{share}%</span>
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

export function LaunchLinks({ token }: { token: RadarToken }) {
  return <div className="radar-launch">
    <a href={axiomUrl(token.pairAddress)} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Open ${token.symbol} on Axiom`}>Axiom<ExternalLink size={11}/></a>
    <a href={dexScreenerUrl(token.pairAddress)} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Open ${token.symbol} on DexScreener`}>Dex<ExternalLink size={11}/></a>
  </div>
}

type RadarTableProps = {
  tokens: RadarToken[]
  sort: RadarSort
  onSort: (key: RadarSortKey) => void
  onOpen: (mint: string) => void
  onTogglePin: (mint: string) => void
  selected: string | null
}

export function RadarTable({ tokens, sort, onSort, onOpen, onTogglePin, selected }: RadarTableProps) {
  const openWithKeyboard = (event: KeyboardEvent<HTMLTableRowElement>, mint: string) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(mint)
    }
  }
  return <div className="radar-table-wrap">
    <table className="radar-table">
      <caption className="sr-only">Tracked coins ranked by Axiom viewers. Select a row for details.</caption>
      <thead>
        <tr>
          <SortHeader label="Token" sortKey="ageMinutes" sort={sort} onSort={onSort} className="radar-col-token"/>
          <th scope="col">Signal</th>
          <SortHeader label="Score" sortKey="score" sort={sort} onSort={onSort}/>
          <SortHeader label="Viewers" sortKey="viewers" sort={sort} onSort={onSort}/>
          <SortHeader label="Viewers / min" sortKey="viewersPerMin" sort={sort} onSort={onSort}/>
          <SortHeader label="30s" sortKey="s30" sort={sort} onSort={onSort} className="radar-col-change"/>
          <SortHeader label="1m" sortKey="m1" sort={sort} onSort={onSort} className="radar-col-change"/>
          <SortHeader label="5m" sortKey="m5" sort={sort} onSort={onSort} className="radar-col-change"/>
          <SortHeader label="10m" sortKey="m10" sort={sort} onSort={onSort} className="radar-col-change"/>
          <SortHeader label="MCap / Liq" sortKey="marketCap" sort={sort} onSort={onSort}/>
          <SortHeader label="5m vol · buys" sortKey="volume5m" sort={sort} onSort={onSort}/>
          <th scope="col">Quality</th>
          <th scope="col"><span className="sr-only">Launch links</span></th>
        </tr>
      </thead>
      <tbody>
        {tokens.map(token => <tr key={token.mint} tabIndex={0} className={`${selected === token.mint ? 'selected' : ''} ${token.alerts.length ? 'alerting' : ''}`} onClick={() => onOpen(token.mint)} onKeyDown={event => openWithKeyboard(event, token.mint)} aria-label={`${token.symbol}, ${token.viewers ?? 'no'} viewers, score ${token.score}. Open details`}>
          <td className="radar-col-token">
            <div className="radar-token">
              <PinButton token={token} onTogglePin={onTogglePin}/>
              <TokenIcon token={token}/>
              <div className="radar-token-text">
                <div className="radar-token-line"><strong>{token.symbol}</strong><span className="radar-age tabular">{formatAge(token.ageMinutes)}</span>{token.onPulse && <span className="radar-tag" title="On your Axiom Pulse">Pulse</span>}{token.runnerWallets > 0 && <span className="radar-tag" title="Smart wallets holding">🐋 {token.runnerWallets}</span>}{token.alerts.length > 0 && <span className="radar-alert-icon" title={token.alerts.join(' · ')}><TriangleAlert size={13}/></span>}</div>
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
          <td><SignalBadge token={token}/></td>
          <td><ScoreBadge token={token}/></td>
          <td><div className="radar-viewers">{token.viewerRank && <span className="radar-rank-chip tabular">#{token.viewerRank}</span>}<span className="tabular">{formatCount(token.viewers)}</span>{token.viewerSurge && <span className="radar-surge" title="Gaining viewers quickly" role="img" aria-label="Gaining viewers quickly">🔥</span>}<ViewerSparkline history={token.history}/></div></td>
          <td><div className="radar-stack tabular"><strong className={`radar-delta ${changeClass(token.viewersPerMin)}`}>{formatSigned(token.viewersPerMin)}</strong><small>{formatSigned(token.viewersDelta5m)} in 5m</small></div></td>
          {(['s30', 'm1', 'm5', 'm10'] as const).map(window => <td key={window} className="radar-col-change"><span className={`radar-delta tabular ${changeClass(token.priceChange[window])}`}>{formatChange(token.priceChange[window])}</span></td>)}
          <td><div className="radar-stack tabular"><strong>{formatUsd(token.marketCap)}</strong><small>{formatUsd(token.liquidityUsd)} liq</small></div></td>
          <td><div className="radar-stack tabular"><strong>{formatUsd(token.volume5m)}</strong><BuySellBar buys={token.buys5m} sells={token.sells5m}/></div></td>
          <td><QualityBadge token={token}/></td>
          <td><LaunchLinks token={token}/></td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
