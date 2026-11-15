import { useEffect, useMemo, useRef, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RadarScoreCheck, RadarScoreLedger, RadarScoreStatus, RadarToken } from '@/lib/axiom-radar-types'

const flashMs = 2_500
const tooltipStyle = { background: 'var(--tone-82)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--tone-0)' }
const clock = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`
const statusMark: Record<RadarScoreStatus, string> = { earned: '✓', partial: '½', missed: '✗', unknown: '?' }
const statusText: Record<RadarScoreStatus, string> = { earned: 'earned', partial: 'part earned', missed: 'not earned', unknown: 'no reading yet' }
const gateMark = { pass: '✓', fail: '✗', unknown: '?' } as const
const gateText = { pass: 'passes', fail: 'fails', unknown: 'not read yet' } as const

function useTicker(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function ledgerValues(ledger: RadarScoreLedger) {
  const values = new Map<string, string>()
  for (const gate of ledger.gates) values.set(`gate:${gate.label}`, `${gate.status}|${gate.reading}`)
  for (const pillar of ledger.pillars) {
    values.set(`pillar:${pillar.key}`, String(pillar.points))
    for (const item of pillar.checks) values.set(`check:${pillar.key}:${item.label}`, `${item.points}|${item.reading}`)
  }
  for (const item of ledger.adjustments) values.set(`adjust:${item.label}`, `${item.points}|${item.reading}`)
  for (const cap of ledger.caps) values.set(`cap:${cap.label}`, `${cap.applies}|${cap.reading}`)
  values.set('score', String(ledger.score))
  return values
}

/** Remembers when each line of the ledger last changed, so a reading that just moved can be highlighted for a moment. */
function useChangedAt(ledger: RadarScoreLedger | null | undefined, mint: string) {
  const memory = useRef<{ mint: string; values: Map<string, string>; changedAt: Map<string, number> }>({ mint, values: new Map(), changedAt: new Map() })
  return useMemo(() => {
    const state = memory.current
    if (state.mint !== mint) { state.mint = mint; state.values = new Map(); state.changedAt = new Map() }
    if (!ledger) return state.changedAt
    const next = ledgerValues(ledger)
    if (state.values.size) for (const [key, value] of next) if (state.values.get(key) !== value) state.changedAt.set(key, Date.now())
    state.values = next
    return state.changedAt
  }, [ledger, mint])
}

function CheckRow({ item, flash }: { item: RadarScoreCheck; flash: boolean }) {
  const negative = item.max === 0
  return <li className={`radar-ledger-row ${item.status} ${flash ? 'flash' : ''}`}>
    <span className="radar-ledger-mark" aria-label={statusText[item.status]} role="img">{negative ? (item.points < 0 ? '−' : '✓') : statusMark[item.status]}</span>
    <span className="radar-ledger-label">{item.label}<small>{item.reading}</small></span>
    <span className="radar-ledger-points tabular">{negative ? (item.points ? signed(item.points) : '0') : `${item.points} / ${item.max}`}</span>
  </li>
}

export function ScoreLedger({ token }: { token: RadarToken }) {
  const ledger = token.scoreLedger
  const trail = token.scoreTrail
  const now = useTicker(1_000)
  const changedAt = useChangedAt(ledger, token.mint)
  const flashing = (key: string) => now - (changedAt.get(key) ?? 0) < flashMs
  if (!ledger) return null
  const adjustmentTotal = ledger.adjustments.reduce((total, item) => total + item.points, 0)
  const activeCaps = ledger.caps.filter(cap => cap.applies)
  const failed = ledger.gates.filter(gate => gate.status === 'fail').length
  const unknown = ledger.gates.filter(gate => gate.status === 'unknown').length
  const age = Math.max(0, Math.round((now - ledger.at) / 1000))
  const points = (trail?.points ?? []).map(([t, score]) => ({ t, score }))
  if (points.length && ledger.at > points[points.length - 1].t) points.push({ t: ledger.at, score: ledger.score })
  const changes = [...(trail?.changes ?? [])].reverse()
  return <div className="radar-ledger">
    <p className={`radar-ledger-live ${age > 10 ? 'stale' : ''}`} role="status" aria-live="off">
      <span className="radar-live-dot" aria-hidden="true"/>
      {age <= 1 ? 'Checked just now' : `Checked ${age}s ago`} · re-scored every second on the tracker
    </p>

    <ol className="radar-ledger-sum tabular" aria-label="How the score adds up">
      {ledger.pillars.map(pillar => <li key={pillar.key} className={flashing(`pillar:${pillar.key}`) ? 'flash' : ''}><span>{pillar.label.split(' ')[0].replace(/[^A-Za-z-]/g, '')}</span><strong>{pillar.points}</strong></li>)}
      {adjustmentTotal !== 0 && <li className={adjustmentTotal < 0 ? 'minus' : 'plus'}><span>Adjustments</span><strong>{signed(adjustmentTotal)}</strong></li>}
      <li className="total"><span>Before caps</span><strong>{ledger.beforeCaps}</strong></li>
      {activeCaps.map(cap => <li key={cap.label} className="cap"><span>{cap.cap === 0 ? 'Gate failed' : `Cap ${cap.cap}`}</span><strong>{Math.min(ledger.beforeCaps, cap.cap)}</strong></li>)}
      <li className={`final ${flashing('score') ? 'flash' : ''}`}><span>Score</span><strong>{ledger.score}</strong></li>
    </ol>

    <div className="radar-ledger-trail">
      <h4>Score over the last 15 minutes</h4>
      {points.length < 2
        ? <p className="radar-muted">The line fills in as the tracker re-scores the coin.</p>
        : <div className="radar-chart-box">
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={clock} stroke="var(--muted)" fontSize={10} tickLine={false} minTickGap={60}/>
              <YAxis domain={[0, 100]} ticks={[0, 50, 75, 100]} stroke="var(--muted)" fontSize={10} tickLine={false} width={40}/>
              <Tooltip contentStyle={tooltipStyle} labelFormatter={value => clock(Number(value))} formatter={value => [String(value), 'Score']}/>
              <Line type="stepAfter" dataKey="score" stroke="var(--radar-accent)" strokeWidth={2} dot={false} isAnimationActive={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>}
      <h4>What moved it</h4>
      {changes.length === 0
        ? <p className="radar-muted">No change since the tracker started following this score.</p>
        : <ul className="radar-ledger-changes">{changes.map(change => <li key={`${change.t}-${change.to}`} className={change.to > change.from ? 'up' : change.to < change.from ? 'down' : ''}>
          <span className="tabular">{clock(change.t)}</span>
          <strong className="tabular">{change.from} → {change.to}</strong>
          <span>{change.reasons.join(' · ')}</span>
        </li>)}</ul>}
    </div>

    <details className="radar-ledger-group" open>
      <summary><span>Instant disqualifiers</span><small>{failed ? `${failed} failing: score is 0` : `all clear${unknown ? `, ${unknown} not read yet` : ''}`}</small></summary>
      <ul className="radar-ledger-list">{ledger.gates.map(gate => <li key={gate.label} className={`radar-ledger-row gate ${gate.status} ${flashing(`gate:${gate.label}`) ? 'flash' : ''}`}>
        <span className="radar-ledger-mark" role="img" aria-label={gateText[gate.status]}>{gateMark[gate.status]}</span>
        <span className="radar-ledger-label">{gate.label}<small>{gate.reading}</small></span>
        <span className="radar-ledger-points">{gate.limit}</span>
      </li>)}</ul>
    </details>

    {ledger.pillars.map(pillar => <details key={pillar.key} className="radar-ledger-group" open>
      <summary>
        <span>{pillar.label}</span>
        <span className="radar-factor-bar" aria-hidden="true"><span style={{ width: `${pillar.max ? Math.round((pillar.points / pillar.max) * 100) : 0}%` }}/></span>
        <small className="tabular">{pillar.points} of {pillar.max}</small>
      </summary>
      <ul className="radar-ledger-list">{pillar.checks.map(item => <CheckRow key={item.label} item={item} flash={flashing(`check:${pillar.key}:${item.label}`)}/>)}</ul>
    </details>)}

    <details className="radar-ledger-group" open>
      <summary><span>Adjustments</span><small className="tabular">{signed(adjustmentTotal) || '0'}</small></summary>
      <ul className="radar-ledger-list">{ledger.adjustments.map(item => <CheckRow key={item.label} item={item} flash={flashing(`adjust:${item.label}`)}/>)}</ul>
    </details>

    <details className="radar-ledger-group" open>
      <summary><span>Caps</span><small>{activeCaps.length ? `${activeCaps.length} holding it down` : 'none applies'}</small></summary>
      <ul className="radar-ledger-list">{ledger.caps.map(cap => <li key={cap.label} className={`radar-ledger-row ${cap.applies ? 'missed' : 'earned'} ${flashing(`cap:${cap.label}`) ? 'flash' : ''}`}>
        <span className="radar-ledger-mark" role="img" aria-label={cap.applies ? 'applies' : 'does not apply'}>{cap.applies ? '↓' : '✓'}</span>
        <span className="radar-ledger-label">{cap.label}<small>{cap.reading}</small></span>
        <span className="radar-ledger-points tabular">{cap.applies ? `max ${cap.cap}` : 'no'}</span>
      </li>)}</ul>
    </details>
  </div>
}
