import { useEffect, useMemo, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { clubLabel } from '@/lib/gspro/clubs'
import { fmt, signed, summarizeByClub, type ClubSummary, type EnrichedShot, type Metric } from '@/lib/gspro/stats'
import type { GsproSession, GsproShot } from '@/lib/gspro/types'
import { DispersionChart, GappingChart, TrendChart } from './Charts'
import { ScopePicker } from './ScopePicker'
import { ShotTable } from './ShotTable'
import { scopeLabel, type Scope } from './GsproApp'

function cell(metric: Metric | null, places = 1, sign = false) {
  if (!metric) return '—'
  return `${sign ? signed(metric.mean, places) : fmt(metric.mean, places)}`
}

function spread(metric: Metric | null, places = 0) {
  return metric && metric.n > 1 ? `±${fmt(metric.sd, places)}` : ''
}

function exportCsv(shots: EnrichedShot[], name: string) {
  const header = ['Date', 'Club', 'Handed', 'Carry (yd)', 'Carry estimated', 'Total (yd, est)', 'Offline (yd, est)', 'Ball speed (mph)', 'Club speed (mph)', 'Smash', 'Launch (deg)', 'Direction (deg)', 'Total spin (rpm)', 'Spin axis (deg)', 'Apex (ft, est)', 'Landing angle (deg, est)', 'Attack angle', 'Path', 'Face to target', 'Face to path', 'Dynamic loft', 'Impact H (mm)', 'Impact V (mm)', 'Excluded']
  const value = (v: number | null, places = 1) => v === null || !Number.isFinite(v) ? '' : v.toFixed(places)
  const lines = shots.map(shot => [new Date(shot.createdAt).toISOString(), shot.club ?? '', shot.handed, value(shot.carryYards), shot.carryEstimated ? 'yes' : 'no', value(shot.totalYards), value(shot.offline), value(shot.ballSpeed), value(shot.clubSpeed), value(shot.smash, 3), value(shot.launch), value(shot.direction), value(shot.totalSpin, 0), value(shot.spinAxis), value(shot.apex, 0), value(shot.descent), value(shot.attackAngle), value(shot.path), value(shot.face), value(shot.faceToPath), value(shot.dynamicLoft), value(shot.impactH), value(shot.impactV), shot.excluded ? 'yes' : 'no'].join(','))
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `gspro-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function ClubTable({ summaries, selected, onSelect }: { summaries: ClubSummary[]; selected: string | null; onSelect: (club: string | null) => void }) {
  return <div className="gs-table-wrap" tabIndex={0} aria-label="Averages by club">
    <table className="gs-table gs-club-table">
      <thead><tr>
        <th scope="col">Club</th><th scope="col">Shots</th><th scope="col">Carry</th><th scope="col">Total</th><th scope="col">Offline</th><th scope="col">Ball</th><th scope="col">Club spd</th>
        <th scope="col">Smash</th><th scope="col">Launch</th><th scope="col">Spin</th><th scope="col">Axis</th><th scope="col">Apex</th><th scope="col">Landing</th><th scope="col">AoA</th><th scope="col">Path</th><th scope="col">F2P</th>
      </tr></thead>
      <tbody>
        {summaries.map(summary => <tr key={summary.club ?? 'none'} className={summary.club === selected ? 'is-selected' : ''}>
          <th scope="row"><button type="button" className="gs-link" aria-pressed={summary.club === selected} onClick={() => onSelect(summary.club)}>{clubLabel(summary.club)}</button></th>
          <td>{summary.shots}</td>
          <td>{cell(summary.carry, 0)}<small>{spread(summary.carry)}</small>{summary.carryEstimated ? <sup title="Includes estimated carries">e</sup> : null}</td>
          <td>{cell(summary.total, 0)}</td>
          <td>{summary.offline ? `${fmt(Math.abs(summary.offline.mean), 0)}${summary.offline.mean >= 0 ? 'R' : 'L'}` : '—'}<small>{spread(summary.offline)}</small></td>
          <td>{cell(summary.ballSpeed)}</td>
          <td>{cell(summary.clubSpeed)}</td>
          <td>{cell(summary.smash, 2)}</td>
          <td>{cell(summary.launch)}</td>
          <td>{cell(summary.spin, 0)}</td>
          <td>{cell(summary.spinAxis, 1, true)}</td>
          <td>{cell(summary.apex, 0)}</td>
          <td>{cell(summary.descent, 0)}</td>
          <td>{cell(summary.attackAngle, 1, true)}</td>
          <td>{cell(summary.path, 1, true)}</td>
          <td>{cell(summary.faceToPath, 1, true)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

export function AnalyzeView({ scope, sessions, shots, error, onScope, onShot }: { scope: Scope; sessions: GsproSession[]; shots: EnrichedShot[] | null; error: string | null; onScope: (scope: Scope) => void; onShot: (shot: GsproShot) => void }) {
  const summaries = useMemo(() => shots ? summarizeByClub(shots) : [], [shots])
  const [club, setClub] = useState<string | null>(null)
  const [showShots, setShowShots] = useState(false)
  useEffect(() => {
    if (!summaries.length) return
    if (!summaries.some(summary => summary.club === club)) setClub([...summaries].sort((a, b) => b.shots - a.shots)[0].club)
  }, [summaries, club])
  const clubShots = useMemo(() => shots?.filter(shot => shot.club === club) ?? [], [shots, club])
  const counted = shots?.filter(shot => !shot.excluded) ?? []
  const label = scopeLabel(scope, sessions)

  return <div className="gs-stack">
    <div className="gs-toolbar">
      <ScopePicker scope={scope} sessions={sessions} onScope={onScope}/>
      {shots && shots.length > 0 && <button type="button" className="gs-button ghost" onClick={() => exportCsv(shots, label)}><Download size={15} aria-hidden/>Export CSV</button>}
    </div>
    {error && <p className="gs-notice" role="alert">{error}</p>}
    {!shots && !error && <p className="gs-muted" role="status"><LoaderCircle size={16} className="spin" aria-hidden/> Loading shots…</p>}
    {shots && !shots.length && <p className="gs-muted">No shots in this selection yet. Stream some from GSPro or import a CSV on the Bridge & import tab.</p>}
    {shots && shots.length > 0 && <>
      <dl className="gs-kpis">
        <div><dt>Shots</dt><dd>{counted.length}<small>{shots.length - counted.length ? ` (${shots.length - counted.length} excluded)` : ''}</small></dd></div>
        <div><dt>Clubs</dt><dd>{summaries.length}</dd></div>
        <div><dt>Longest carry</dt><dd>{fmt(Math.max(0, ...counted.map(shot => shot.carryYards ?? 0)), 0)} <small>yd</small></dd></div>
        <div><dt>Fastest ball</dt><dd>{fmt(Math.max(0, ...counted.map(shot => shot.ballSpeed)), 1)} <small>mph</small></dd></div>
      </dl>
      <section className="gs-panel">
        <header className="gs-panel-head"><div><h2>By club</h2><p>Averages with ± one standard deviation. Angles are shown for a right-handed player; pick a club to chart it.</p></div></header>
        <ClubTable summaries={summaries} selected={club} onSelect={setClub}/>
      </section>
      {clubShots.length > 0 && <section className="gs-panel">
        <header className="gs-panel-head"><div><h2>{clubLabel(club)}</h2><p>{clubShots.length} shots in this selection.</p></div></header>
        <div className="gs-chart-grid">
          <DispersionChart shots={clubShots} club={club}/>
          <div className="gs-stack">
            <TrendChart shots={clubShots} label="Carry" unit="yd" value={shot => shot.carryYards}/>
            <TrendChart shots={clubShots} label="Ball speed" unit="mph" value={shot => shot.ballSpeed} places={1}/>
          </div>
        </div>
      </section>}
      <section className="gs-panel">
        <header className="gs-panel-head"><div><h2>Gapping</h2><p>Even steps of 10–15 yards mean a full swing for every number.</p></div></header>
        <GappingChart summaries={summaries}/>
      </section>
      <section className="gs-panel">
        <header className="gs-panel-head">
          <div><h2>Every shot</h2><p>Fix a club or exclude a mis-hit; the averages update straight away.</p></div>
          <button type="button" className="gs-button ghost" aria-expanded={showShots} onClick={() => setShowShots(value => !value)}>{showShots ? 'Hide shots' : `Show ${shots.length} shots`}</button>
        </header>
        {showShots && <ShotTable shots={[...shots].reverse()} onShot={onShot} dated/>}
      </section>
    </>}
  </div>
}
