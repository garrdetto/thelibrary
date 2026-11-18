import { useEffect, useMemo, useState } from 'react'
import { Flag, LoaderCircle, Play, Trash2 } from 'lucide-react'
import { clubLabel } from '@/lib/gspro/clubs'
import { courseName, roundPlayers, roundReport, surfaceName, type CourseRound, type CourseShot, type HoleCard, type ShotAnalysis } from '@/lib/gspro/course'
import { enrichShot, fmt, type EnrichedShot } from '@/lib/gspro/stats'
import type { GsproShot } from '@/lib/gspro/types'
import { gsproApi } from './api'
import { useReplay } from './ReplayContext'

const PLAYER_KEY = 'gs-course-player'

function readPlayer() {
  try { return window.localStorage.getItem(PLAYER_KEY) } catch { return null }
}

function savePlayer(name: string) {
  try { window.localStorage.setItem(PLAYER_KEY, name) } catch { /* storage unavailable */ }
}

function roundLabel(round: CourseRound) {
  return `${courseName(round.course)} · ${new Date(round.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${round.shotCount} shots`
}

function toReplayShot(item: ShotAnalysis): EnrichedShot {
  const { shot } = item
  const base: GsproShot = {
    id: shot.id, sessionId: shot.roundId, createdAt: shot.seenAt, source: 'bridge', club: item.club, handed: 'RH',
    ballSpeed: shot.ball.speed, launch: shot.ball.launch, direction: shot.ball.direction, totalSpin: Math.abs(shot.ball.totalSpin), spinAxis: shot.ball.spinAxis,
    carry: item.carry, clubSpeed: null, attackAngle: null, path: null, face: null, dynamicLoft: null, lie: null, impactH: null, impactV: null, excluded: false,
  }
  const landing = item.path[item.landingIndex]
  const before = item.path[Math.max(0, item.landingIndex - 1)]
  const descent = landing && before && landing.x !== before.x ? (Math.atan2((before.y - landing.y) / 3, landing.x - before.x) * 180) / Math.PI : null
  return {
    ...enrichShot(base),
    carryYards: item.carry,
    carryEstimated: false,
    totalYards: shot.total,
    offline: item.offline,
    apex: item.apex,
    descent,
    actualPath: item.path,
    landingIndex: item.landingIndex,
    context: `Hole ${shot.hole + 1}, shot ${shot.holeShot}${item.before !== null ? ` · ${fmt(item.before, 0)} yd to the pin` : ''} · ${surfaceName(shot.startSurface)} → ${shot.final ? 'holed' : surfaceName(shot.endSurface)}`,
  }
}

function scoreName(score: number, par: number) {
  const diff = score - par
  return diff <= -2 ? 'Eagle or better' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : 'Double bogey or worse'
}

function Scorecard({ holes }: { holes: HoleCard[] }) {
  const sum = (list: HoleCard[], key: 'par' | 'score' | 'putts') => list.reduce((total, hole) => total + hole[key], 0)
  const front = holes.filter(hole => hole.hole < 9)
  const back = holes.filter(hole => hole.hole >= 9)
  const columns: (HoleCard | { label: string; list: HoleCard[] })[] = [...front, ...(front.length ? [{ label: 'Out', list: front }] : []), ...back, ...(back.length ? [{ label: 'In', list: back }] : []), { label: 'Total', list: holes }]
  const isTotal = (column: HoleCard | { label: string; list: HoleCard[] }): column is { label: string; list: HoleCard[] } => 'label' in column
  return <div className="gs-table-wrap" tabIndex={0} aria-label="Scorecard">
    <table className="gs-table gs-scorecard">
      <tbody>
        <tr><th scope="row">Hole</th>{columns.map((column, index) => <th key={index} scope="col" className={isTotal(column) ? 'gs-total' : ''}>{isTotal(column) ? column.label : column.hole + 1}</th>)}</tr>
        <tr><th scope="row">Par</th>{columns.map((column, index) => <td key={index} className={isTotal(column) ? 'gs-total' : ''}>{isTotal(column) ? sum(column.list, 'par') : column.par}</td>)}</tr>
        <tr><th scope="row">Score</th>{columns.map((column, index) => isTotal(column)
          ? <td key={index} className="gs-total"><b>{sum(column.list, 'score')}</b></td>
          : <td key={index}><span className={`gs-score d${Math.max(-2, Math.min(2, column.score - column.par))}`} title={scoreName(column.score, column.par)}>{column.score}</span></td>)}</tr>
        <tr><th scope="row">Putts</th>{columns.map((column, index) => <td key={index} className={isTotal(column) ? 'gs-total' : ''}>{isTotal(column) ? sum(column.list, 'putts') : column.putts}</td>)}</tr>
        <tr><th scope="row">Fairway</th>{columns.map((column, index) => <td key={index} className={isTotal(column) ? 'gs-total' : ''}>{isTotal(column) ? `${column.list.filter(hole => hole.fairway).length}/${column.list.filter(hole => hole.fairway !== null).length}` : column.fairway === null ? '–' : column.fairway ? '✓' : '✗'}</td>)}</tr>
        <tr><th scope="row">Green</th>{columns.map((column, index) => <td key={index} className={isTotal(column) ? 'gs-total' : ''}>{isTotal(column) ? `${column.list.filter(hole => hole.green).length}/${column.list.length}` : column.green ? '✓' : '✗'}</td>)}</tr>
      </tbody>
    </table>
  </div>
}

function ratio(hit: number, chances: number) {
  return chances ? `${hit}/${chances} · ${Math.round((hit / chances) * 100)}%` : '—'
}

export function CourseView({ onSetup }: { onSetup: () => void }) {
  const [rounds, setRounds] = useState<CourseRound[] | null>(null)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [shots, setShots] = useState<CourseShot[] | null>(null)
  const [player, setPlayer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const openReplay = useReplay()

  useEffect(() => {
    gsproApi.rounds().then(result => {
      setRounds(result.rounds)
      setRoundId(current => current ?? result.rounds[0]?.id ?? null)
    }).catch(failure => setError(failure instanceof Error ? failure.message : 'Rounds could not be loaded.'))
  }, [])

  useEffect(() => {
    if (!roundId) return
    setShots(null)
    setError(null)
    gsproApi.round(roundId).then(result => {
      setShots(result.shots)
      const players = roundPlayers(result.shots)
      const remembered = readPlayer()
      setPlayer(remembered && players.includes(remembered) ? remembered : players[0] ?? null)
    }).catch(failure => setError(failure instanceof Error ? failure.message : 'The round could not be loaded.'))
  }, [roundId])

  const players = useMemo(() => shots ? roundPlayers(shots) : [], [shots])
  const report = useMemo(() => shots && player ? roundReport(shots, player) : null, [shots, player])
  const replayList = useMemo(() => report ? report.holes.flatMap(hole => hole.shots).map(toReplayShot) : [], [report])

  if (error) return <p className="gs-notice" role="alert">{error}</p>
  if (!rounds) return <p className="gs-muted" role="status"><LoaderCircle size={16} className="spin" aria-hidden/> Loading rounds…</p>
  if (!rounds.length) return <section className="gs-empty">
    <Flag size={28} aria-hidden/>
    <h2>No course rounds yet</h2>
    <p>With the bridge running on your simulator PC, every shot you play on a GSPro course uploads here with the hole, lie, distance to the pin and GSPro's own flight. The round already saved in GSPro uploads the first time the bridge starts.</p>
    <button type="button" className="gs-button" onClick={onSetup}>Open bridge setup</button>
  </section>

  const current = rounds.find(round => round.id === roundId)
  const replay = (shotId: number) => {
    const index = replayList.findIndex(item => item.id === shotId)
    if (index >= 0) openReplay(replayList, index)
  }

  return <div className="gs-stack">
    <div className="gs-toolbar">
      <label className="gs-field gs-scope"><span>Round</span>
        <select value={roundId ?? ''} onChange={event => { setRoundId(event.target.value); setConfirmDelete(false) }}>
          {rounds.map(round => <option key={round.id} value={round.id}>{roundLabel(round)}</option>)}
        </select>
      </label>
      {players.length > 1 && <div className="gs-segments" role="group" aria-label="Player">
        {players.map(name => <button key={name} type="button" aria-pressed={player === name} className={player === name ? 'is-active' : ''} onClick={() => { setPlayer(name); savePlayer(name) }}>{name}</button>)}
      </div>}
      {current && (confirmDelete
        ? <><button type="button" className="gs-button danger" onClick={() => gsproApi.deleteRound(current.id).then(() => { setRounds(list => list?.filter(round => round.id !== current.id) ?? list); setRoundId(rounds.find(round => round.id !== current.id)?.id ?? null); setConfirmDelete(false) })}>Delete this round</button><button type="button" className="gs-button ghost" onClick={() => setConfirmDelete(false)}>Keep</button></>
        : <button type="button" className="gs-icon-button" aria-label="Delete this round" onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden/></button>)}
    </div>
    {!report && <p className="gs-muted" role="status"><LoaderCircle size={16} className="spin" aria-hidden/> Loading the round…</p>}
    {report && <>
      <dl className="gs-kpis">
        <div><dt>Score</dt><dd>{report.score} <small>{report.score - report.par === 0 ? 'even' : `${report.score - report.par > 0 ? '+' : ''}${report.score - report.par}`} · {report.holes.length} holes</small></dd></div>
        <div><dt>Fairways</dt><dd>{ratio(report.fairways.hit, report.fairways.chances)}</dd></div>
        <div><dt>Greens in regulation</dt><dd>{ratio(report.greens.hit, report.greens.chances)}</dd></div>
        <div><dt>Putts</dt><dd>{report.putts} <small>{fmt(report.putts / Math.max(1, report.holes.length), 1)} a hole · {report.threePutts} three-putt{report.threePutts === 1 ? '' : 's'}</small></dd></div>
        <div><dt>Up and down</dt><dd>{ratio(report.scrambling.saved, report.scrambling.chances)}</dd></div>
        <div><dt>Average drive</dt><dd>{fmt(report.drive, 0)} <small>yd total</small></dd></div>
      </dl>

      <section className="gs-panel">
        <header className="gs-panel-head"><div><h2>Scorecard</h2><p>Circles are under par, squares over. Fairways count par 4s and 5s; a green in regulation is on the green in par minus two.</p></div></header>
        <Scorecard holes={report.holes}/>
      </section>

      <div className="gs-two">
        <section className="gs-panel">
          <header className="gs-panel-head"><div><h2>Approach shots</h2><p>How close full and partial shots finish, by distance to the pin. Tee shots on par 4s and 5s are left out.</p></div></header>
          {report.approach.length ? <div className="gs-table-wrap"><table className="gs-table gs-plain">
            <thead><tr><th scope="col">From</th><th scope="col">Shots</th><th scope="col">Avg finish</th><th scope="col">Greens hit</th></tr></thead>
            <tbody>{report.approach.map(band => <tr key={band.label}><th scope="row">{band.label}</th><td>{band.shots}</td><td>{fmt(band.averageFeet, 0)} ft</td><td>{band.greens}/{band.shots}</td></tr>)}</tbody>
          </table></div> : <p className="gs-muted">No approach shots in this round.</p>}
          {report.lies.length > 0 && <div className="gs-table-wrap gs-spaced"><table className="gs-table gs-plain">
            <thead><tr><th scope="col">From the</th><th scope="col">Shots</th><th scope="col">Avg finish</th></tr></thead>
            <tbody>{report.lies.map(lie => <tr key={lie.surface}><th scope="row">{lie.surface}</th><td>{lie.shots}</td><td>{fmt(lie.averageFeet, 0)} ft</td></tr>)}</tbody>
          </table></div>}
        </section>
        <section className="gs-panel">
          <header className="gs-panel-head"><div><h2>Putting</h2><p>Holes grouped by the length of the first putt.</p></div></header>
          {report.putting.length ? <div className="gs-table-wrap"><table className="gs-table gs-plain">
            <thead><tr><th scope="col">First putt</th><th scope="col">Holes</th><th scope="col">1-putts</th><th scope="col">3-putts</th><th scope="col">Avg putts</th></tr></thead>
            <tbody>{report.putting.map(band => <tr key={band.label}><th scope="row">{band.label}</th><td>{band.holes}</td><td>{band.onePutts}</td><td>{band.threePutts}</td><td>{fmt(band.averagePutts, 1)}</td></tr>)}</tbody>
          </table></div> : <p className="gs-muted">No putts recorded in this round.</p>}
        </section>
      </div>

      <section className="gs-panel">
        <header className="gs-panel-head"><div><h2>Shot by shot</h2><p>Click any shot to replay GSPro's own flight for it.</p></div></header>
        <div className="gs-holes">
          {report.holes.map(hole => <details key={hole.hole} className="gs-hole">
            <summary><b>Hole {hole.hole + 1}</b> <span>Par {hole.par} · {hole.score} ({scoreName(hole.score, hole.par).toLowerCase()}) · {hole.putts} putt{hole.putts === 1 ? '' : 's'}</span></summary>
            <ol>
              {hole.shots.map(item => <li key={item.shot.id}>
                <button type="button" className="gs-shot-line" onClick={() => replay(item.shot.id)}>
                  <Play size={12} aria-hidden/>
                  <span className="gs-shot-club">{item.shot.putt ? 'Putt' : clubLabel(item.club)}</span>
                  <span>{item.before !== null ? `${fmt(item.shot.putt ? item.before * 3 : item.before, 0)} ${item.shot.putt ? 'ft' : 'yd'} out` : ''}</span>
                  <span>{item.shot.putt ? `${fmt(item.shot.total * 3, 0)} ft` : `${fmt(item.carry, 0)} carry · ${fmt(item.shot.total, 0)} total`}</span>
                  <span>{surfaceName(item.shot.startSurface)} → {item.shot.final ? 'holed' : `${surfaceName(item.shot.endSurface)}${item.after !== null ? item.shot.endSurface === 5 || item.after < 10 ? `, ${fmt(item.after * 3, 0)} ft` : `, ${fmt(item.after, 0)} yd` : ''}`}</span>
                </button>
              </li>)}
            </ol>
          </details>)}
        </div>
      </section>
    </>}
  </div>
}
