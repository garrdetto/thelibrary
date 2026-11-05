import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Eye, LoaderCircle, RefreshCw, Timer, Trophy } from 'lucide-react'
import { postReset, useRecordResetTarget } from '../AdminRecordReset'
import { ParkShotDialog } from './ParkShotDialog'
import { parkApi } from '@/lib/park/api'
import type { ParkMillionScore, ParkScore, ParkScoreBoard } from '@/lib/park/api'
import { DAY_SECONDS, MILLION_RATING, MILLION_VALUE, MONTHS, SCENARIOS, formatMoney } from '../../../server/park/index.mjs'

// In-game days since the park opened (the first day starts 30% in).
const dashDays = (m: ParkMillionScore) => m.seconds / DAY_SECONDS + 0.3
const dashDate = (m: ParkMillionScore) => `${MONTHS[m.month]?.slice(0, 3) ?? '?'} ${m.day + 1}, Year ${m.year}`
type Viewing = { kind: 'value'; record: ParkScore } | { kind: 'million'; record: ParkMillionScore }

export const SCORED_MAPS = Object.entries(SCENARIOS).filter(([id, s]) => !s.versus && id !== 'sandbox').map(([id, s]) => ({ id, name: s.name }))

export function ParkScoreboard({ username, initial, refreshKey, onExplore, exploreBusy }: { username: string | null; initial?: string; refreshKey?: number; onExplore?: (scenario: string, parkId: string) => void; exploreBusy?: string }) {
  const [map, setMap] = useState(initial && SCORED_MAPS.some(m => m.id === initial) ? initial : SCORED_MAPS[0].id)
  const [board, setBoard] = useState<ParkScoreBoard | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const closeView = useCallback(() => setViewing(null), [])
  const name = SCORED_MAPS.find(m => m.id === map)?.name ?? map

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setState('loading')
    try { setBoard(await parkApi.scores(map)); setState('ready') }
    catch { setState(current => current === 'ready' ? 'ready' : 'error') }
    finally { setRefreshing(false) }
  }, [map])

  useEffect(() => { void load() }, [load, username, refreshKey])

  useRecordResetTarget({
    key: `park-scores:${map}`,
    label: `Thrill Park ${name} leaderboard`,
    description: `Current ${name} Richest Parks and Million Dollar Dash entries will be cleared. Saved parks reappear after the next save or autosave.`,
    reset: async () => { await postReset('/api/park', 'POST', { action: 'reset-scores', scenario: map }); await load(true) },
  })

  const records = board?.records ?? []
  const million = board?.million ?? []
  const mine = username?.toLowerCase()
  return <section className="module-scores pk-scores" style={{ '--module-accent': '#ffcf4a' } as CSSProperties} aria-labelledby="park-scores-title" aria-busy={state === 'loading' || refreshing}>
    <header className="module-scores-head">
      <div>
        <span className="module-scores-eyebrow"><Trophy size={13}/> THRILL PARK LEADERBOARD</span>
        <h2 id="park-scores-title">Richest Parks <small>Top 10 per map</small></h2>
        <p>Each named park has its own entry, so one player can rank more than once. Parks are ranked by company value (park value plus cash, minus loans), and every save or autosave updates the park's value and screenshot.</p>
      </div>
      <div className="module-scores-side">
        {username
          ? <div className="module-scores-best"><small>SCORING</small><strong>Per park</strong><span>Multiple entries per player</span></div>
          : <p className="module-scores-signin">Sign in to put your parks on the board.</p>}
        <button type="button" className="module-scores-refresh" onClick={() => void load(true)} disabled={state === 'loading' || refreshing} aria-label="Refresh leaderboard"><RefreshCw size={14} className={refreshing ? 'spin' : undefined}/> Refresh</button>
      </div>
    </header>
    <div className="pk-score-tabs" role="tablist" aria-label="Map">{SCORED_MAPS.map(m => <button key={m.id} role="tab" aria-selected={m.id === map} className={m.id === map ? 'on' : ''} onClick={() => { setMap(m.id); setViewing(null) }}>{m.name}</button>)}</div>
    {state === 'loading' && <p className="module-scores-status" role="status"><LoaderCircle size={16} className="spin"/> Loading the leaderboard…</p>}
    {state === 'error' && <p className="module-scores-status is-error" role="alert">The leaderboard is unavailable right now. <button type="button" onClick={() => void load()}>Try again</button></p>}
    {state === 'ready' && (records.length
      ? <div className="module-scores-scroll"><table>
          <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Park</th><th scope="col">Company value</th><th scope="col">Saved</th><th scope="col" aria-label="Screenshot"></th></tr></thead>
          <tbody>{records.map((record, index) => {
            return <tr key={record.parkId} className={mine && record.username.toLowerCase() === mine ? 'is-mine' : undefined}><td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{record.username}</th><td>{record.parkName}</td><td>{formatMoney(record.value)}</td><td><time dateTime={record.savedAt}>{new Date(record.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></td><td><button type="button" className="pk-score-view" onClick={() => setViewing({ kind: 'value', record })} aria-label={`View a screenshot of ${record.parkName}`}><Eye size={13}/> View</button></td></tr>
          })}</tbody>
        </table></div>
      : <p className="module-scores-status">No parks on {name} yet. {username ? 'Save a park here to be the first.' : 'Sign in and be the first.'}</p>)}
    {state === 'ready' && <section className="pk-dash" aria-labelledby="park-dash-title">
      <header className="pk-dash-head">
        <span className="module-scores-eyebrow"><Timer size={13}/> MILLION DOLLAR DASH</span>
        <h3 id="park-dash-title">Quickest to {formatMoney(MILLION_VALUE)} <small>Top 10 on {name}</small></h3>
        <p>Ranked by in-game time from opening day until the park value reached {formatMoney(MILLION_VALUE)} while the park rating was {MILLION_RATING} or higher at the same moment. Each park keeps its fastest time.</p>
      </header>
      {million.length
        ? <div className="module-scores-scroll"><table>
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Park</th><th scope="col">In-game time</th><th scope="col">Reached</th><th scope="col">Rating</th><th scope="col" aria-label="Screenshot"></th></tr></thead>
            <tbody>{million.map((record, index) => <tr key={record.parkId} className={mine && record.username.toLowerCase() === mine ? 'is-mine' : undefined}>
              <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{record.username}</th><td>{record.parkName}</td>
              <td title={record.approx ? 'Recovered from monthly history, so the true moment may have been earlier that month.' : undefined}>{record.approx ? '≈ ' : ''}{dashDays(record).toFixed(1)} days</td>
              <td>{dashDate(record)}</td><td>{record.rating}</td>
              <td>{record.shot ? <button type="button" className="pk-score-view" onClick={() => setViewing({ kind: 'million', record })} aria-label={`View a screenshot of ${record.parkName}`}><Eye size={13}/> View</button> : null}</td>
            </tr>)}</tbody>
          </table></div>
        : <p className="module-scores-status">No park on {name} has reached {formatMoney(MILLION_VALUE)} with a {MILLION_RATING} rating yet.</p>}
    </section>}
    {viewing && <ParkShotDialog
      record={viewing.kind === 'value' ? viewing.record : { ...viewing.record, savedAt: viewing.record.reachedAt }}
      mapName={name}
      detail={viewing.kind === 'million' ? <>Reached {formatMoney(viewing.record.value)} park value with a {viewing.record.rating} rating in <strong>{viewing.record.approx ? '≈ ' : ''}{dashDays(viewing.record).toFixed(1)} in-game days</strong> ({dashDate(viewing.record)}). Screenshot shows the park as last saved.</> : undefined}
      onClose={closeView}
      onExplore={onExplore ? () => onExplore(map, viewing.record.parkId) : undefined}
      exploreBusy={exploreBusy === `${map}:${viewing.record.parkId}`} />}
  </section>
}
