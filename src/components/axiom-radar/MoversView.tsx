import type { RadarToken } from '@/lib/axiom-radar-types'
import { formatCount, formatSigned, formatUsd } from './format'
import { TokenIcon, changeClass, formatChange } from './RadarTable'

const boards = [
  { key: 's30', label: 'Last 30 seconds' },
  { key: 'm1', label: 'Last 1 minute' },
  { key: 'm5', label: 'Last 5 minutes' },
  { key: 'm10', label: 'Last 10 minutes' },
] as const

function Board({ title, caption, rows, onOpen }: { title: string; caption: string; rows: Array<{ token: RadarToken; value: string; tone: string }>; onOpen: (mint: string) => void }) {
  return <section className="radar-card radar-board">
    <div className="panel-heading"><h2>{title}</h2><span className="panel-caption">{caption}</span></div>
    {rows.length === 0 ? <p className="radar-muted">Not enough data yet.</p> : <ol>
      {rows.map(({ token, value, tone }, index) => <li key={token.mint}>
        <button type="button" onClick={() => onOpen(token.mint)} aria-label={`${token.symbol} ${value}. Open details`}>
          <span className="radar-rank tabular">{index + 1}</span>
          <TokenIcon token={token}/>
          <span className="radar-board-name"><strong>{token.symbol}</strong><small className="tabular">{formatCount(token.viewers)} watching · {formatUsd(token.marketCap)}</small></span>
          <strong className={`tabular radar-delta ${tone}`}>{value}</strong>
        </button>
      </li>)}
    </ol>}
  </section>
}

export function MoversView({ tokens, onOpen }: { tokens: RadarToken[]; onOpen: (mint: string) => void }) {
  const viewerGainers = tokens.filter(token => (token.viewersPerMin ?? 0) > 0).sort((first, second) => (second.viewersPerMin ?? 0) - (first.viewersPerMin ?? 0)).slice(0, 8)
  return <div className="radar-movers">
    {boards.map(board => {
      const rows = tokens
        .filter(token => (token.priceChange[board.key] ?? 0) > 0)
        .sort((first, second) => (second.priceChange[board.key] ?? 0) - (first.priceChange[board.key] ?? 0))
        .slice(0, 8)
        .map(token => ({ token, value: formatChange(token.priceChange[board.key]), tone: changeClass(token.priceChange[board.key]) }))
      return <Board key={board.key} title={board.label} caption="BIGGEST PRICE GAIN" rows={rows} onOpen={onOpen}/>
    })}
    <Board title="Viewers gained per minute" caption="ATTENTION" rows={viewerGainers.map(token => ({ token, value: `${formatSigned(token.viewersPerMin)}/min`, tone: 'up' }))} onOpen={onOpen}/>
  </div>
}
