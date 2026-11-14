import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { radarFeatureKeys, radarFeatureLabels, type RadarPayload } from '@/lib/axiom-radar-types'
import { formatClock, formatPercent, formatReturn, formatUsd, relativeSeconds } from './format'

const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const weightColors = ['var(--green)', 'var(--radar-accent)', 'var(--radar-up)', 'var(--radar-warn)', 'var(--muted)']

function returnClass(value: number | null) {
  return value === null ? '' : value >= 0 ? 'up' : 'down'
}

export function PaperTrades({ payload, now }: { payload: RadarPayload; now: number }) {
  const { paper, model } = payload
  const maxWeight = Math.max(...radarFeatureKeys.map(key => model.weights[key]), 1)
  const completed = paper.stats.wins + paper.stats.losses
  return <div className="radar-paper">
    <div className="radar-kpis">
      <div className="radar-kpi"><span>Open paper trades</span><strong className="tabular">{paper.stats.open}</strong><small>Opened on each Buy signal or score ≥ 75</small></div>
      <div className="radar-kpi"><span>Win rate (+15% at 15m)</span><strong className="tabular">{formatPercent(paper.stats.winRate, 0)}</strong><small>{paper.stats.wins} wins · {paper.stats.losses} losses</small></div>
      <div className="radar-kpi"><span>Average 15m return</span><strong className={`tabular radar-delta ${returnClass(paper.stats.averageReturn15m)}`}>{formatReturn(paper.stats.averageReturn15m)}</strong><small>Equal stake per trade</small></div>
      <div className="radar-kpi"><span>Model samples</span><strong className="tabular">{model.sampleCount}</strong><small>Next recalibration at {Math.floor(completed / 10) * 10 + 10} trades</small></div>
    </div>

    <div className="radar-paper-grid">
      <section className="radar-card">
        <div className="panel-heading"><span className="number-tag">01</span><h2>Cumulative paper PnL</h2><span className="panel-caption">15M RETURNS, % POINTS</span></div>
        {paper.pnl.length < 2 ? <p className="radar-muted">The PnL curve appears after two completed paper trades.</p>
          : <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={paper.pnl} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs><linearGradient id="radar-pnl-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity={0.35}/><stop offset="100%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatClock} stroke="var(--muted)" fontSize={10} tickLine={false}/>
              <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} tickFormatter={value => `${value}%`}/>
              <Tooltip contentStyle={tooltipStyle} labelFormatter={value => formatClock(Number(value))} formatter={(value, _name, item) => [`${Number(value).toFixed(1)}%`, `After ${(item.payload as { symbol: string }).symbol}`]}/>
              <Area type="monotone" dataKey="cumulative" stroke="var(--green)" strokeWidth={2} fill="url(#radar-pnl-fill)" isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer>}
      </section>

      <section className="radar-card">
        <div className="panel-heading"><span className="number-tag">02</span><h2>Adaptive feature weights</h2><span className="panel-caption">{model.updatedAt ? `UPDATED ${relativeSeconds(model.updatedAt, now).toUpperCase()}` : 'DEFAULTS'}</span></div>
        <ul className="radar-weights">
          {radarFeatureKeys.map(key => <li key={key}>
            <span>{radarFeatureLabels[key]}</span>
            <span className="radar-factor-bar" aria-hidden="true"><span style={{ width: `${(model.weights[key] / maxWeight) * 100}%` }}/></span>
            <span className="tabular">{model.weights[key].toFixed(2)}</span>
          </li>)}
        </ul>
        {model.history.length > 1 && <ResponsiveContainer width="100%" height={160}>
          <LineChart data={model.history} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="sampleCount" stroke="var(--muted)" fontSize={10} tickLine={false}/>
            <YAxis stroke="var(--muted)" fontSize={10} tickLine={false}/>
            <Tooltip contentStyle={tooltipStyle} labelFormatter={value => `${value} samples`} formatter={value => Number(value).toFixed(2)}/>
            <Legend wrapperStyle={{ fontSize: 10 }}/>
            {radarFeatureKeys.map((key, index) => <Line key={key} type="monotone" dataKey={key} name={radarFeatureLabels[key]} stroke={weightColors[index]} dot={false} strokeWidth={1.5} isAnimationActive={false}/>)}
          </LineChart>
        </ResponsiveContainer>}
        <p className="radar-note">Every 10 completed trades, weights shift toward the features that were stronger in winners than in losers.</p>
      </section>
    </div>

    <section className="radar-card">
      <div className="panel-heading"><span className="number-tag">03</span><h2>Simulated trade history</h2><span className="panel-caption">PAPER ONLY · NO ORDERS ARE PLACED</span></div>
      {paper.trades.length === 0 ? <p className="radar-muted">No paper trades yet. One opens automatically the first time a coin becomes a recommended buy or reaches a setup score of 75.</p>
        : <div className="radar-table-wrap">
          <table className="radar-mini-table">
            <thead><tr><th scope="col">Opened</th><th scope="col">Token</th><th scope="col">Score</th><th scope="col">Entry MCap</th><th scope="col">+5m</th><th scope="col">+15m</th><th scope="col">+30m</th><th scope="col">Result</th></tr></thead>
            <tbody>{paper.trades.map(trade => <tr key={trade.id}>
              <td className="tabular">{formatClock(trade.createdAt)}</td>
              <td><strong>{trade.symbol}</strong></td>
              <td className="tabular">{Math.round(trade.setupScore)}</td>
              <td className="tabular">{formatUsd(trade.entryMcap)}</td>
              <td className={`tabular radar-delta ${returnClass(trade.return5m)}`}>{formatReturn(trade.return5m)}</td>
              <td className={`tabular radar-delta ${returnClass(trade.return15m)}`}>{formatReturn(trade.return15m)}</td>
              <td className={`tabular radar-delta ${returnClass(trade.return30m)}`}>{formatReturn(trade.return30m)}</td>
              <td><span className={`radar-status ${trade.status}`}>{trade.status === 'open' ? 'Open' : trade.status === 'win' ? 'Win' : 'Loss'}</span></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </div>
}
