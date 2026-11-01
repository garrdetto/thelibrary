import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Eye, LoaderCircle, RefreshCw, Trophy } from 'lucide-react'
import { postReset, useRecordResetTarget } from '../AdminRecordReset'
import { parkApi } from '@/lib/park/api'
import type { ParkScoreBoard } from '@/lib/park/api'
import { SCENARIOS, formatMoney } from '../../../server/park/index.mjs'

export const SCORED_MAPS = Object.entries(SCENARIOS).filter(([id, s]) => !s.versus && id !== 'sandbox').map(([id, s]) => ({ id, name: s.name }))

export function ParkScoreboard({ username, initial, refreshKey, onView, viewBusy }: { username: string | null; initial?: string; refreshKey?: number; onView?: (scenario: string, player: string) => void; viewBusy?: string }) {
  const [map, setMap] = useState(initial && SCORED_MAPS.some(m => m.id === initial) ? initial : SCORED_MAPS[0].id)
  const [board, setBoard] = useState<ParkScoreBoard | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refreshing, setRefreshing] = useState(false)
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
    description: `Every saved ${name} result will be deleted for all players.`,
    reset: async () => { await postReset('/api/park', 'POST', { action: 'reset-scores', scenario: map }); await load(true) },
  })

  const records = board?.records ?? []
  const mine = username?.toLowerCase()
  const myRank = mine ? records.findIndex(record => record.username.toLowerCase() === mine) : -1

  return <section className="module-scores pk-scores" style={{ '--module-accent': '#ffcf4a' } as CSSProperties} aria-labelledby="park-scores-title" aria-busy={state === 'loading' || refreshing}>
    <header className="module-scores-head">
      <div>
        <span className="module-scores-eyebrow"><Trophy size={13}/> THRILL PARK LEADERBOARD</span>
        <h2 id="park-scores-title">Richest Tycoons <small>Top 10 per map</small></h2>
        <p>Net worth is your cash minus everything you still owe the bank. Your best is saved with every save and autosave.</p>
      </div>
      <div className="module-scores-side">
        {username
          ? <div className="module-scores-best"><small>YOUR BEST</small><strong>{board?.personalBest != null ? formatMoney(board.personalBest) : '—'}</strong><span>{myRank >= 0 ? `#${myRank + 1} on the board` : board?.personalBest != null ? 'Outside the top 10' : 'Save a park on this map'}</span></div>
          : <p className="module-scores-signin">Sign in to put your parks on the board.</p>}
        <button type="button" className="module-scores-refresh" onClick={() => void load(true)} disabled={state === 'loading' || refreshing} aria-label="Refresh leaderboard"><RefreshCw size={14} className={refreshing ? 'spin' : undefined}/> Refresh</button>
      </div>
    </header>
    <div className="pk-score-tabs" role="tablist" aria-label="Map">{SCORED_MAPS.map(m => <button key={m.id} role="tab" aria-selected={m.id === map} className={m.id === map ? 'on' : ''} onClick={() => setMap(m.id)}>{m.name}</button>)}</div>
    {state === 'loading' && <p className="module-scores-status" role="status"><LoaderCircle size={16} className="spin"/> Loading the leaderboard…</p>}
    {state === 'error' && <p className="module-scores-status is-error" role="alert">The leaderboard is unavailable right now. <button type="button" onClick={() => void load()}>Try again</button></p>}
    {state === 'ready' && (records.length
      ? <div className="module-scores-scroll"><table>
          <thead><tr><th scope="col">Rank</th><th scope="col">Username</th><th scope="col">Net worth</th><th scope="col">Best set (UTC)</th><th scope="col">Last saved</th>{onView && <th scope="col" aria-label="View park"></th>}</tr></thead>
          <tbody>{records.map((record, index) => <tr key={`${record.username}:${index}`} className={mine && record.username.toLowerCase() === mine ? 'is-mine' : undefined}><td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{record.username}</th><td>{formatMoney(record.value)}</td><td>{record.date.slice(0, 10)}</td><td><time dateTime={record.savedAt}>{new Date(record.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></td>{onView && <td>{record.viewable ? <button type="button" className="pk-score-view" disabled={Boolean(viewBusy)} onClick={() => onView(map, record.username)} aria-label={`View ${record.username}'s park`}>{viewBusy === `${map}:${record.username}` ? <LoaderCircle size={13} className="spin"/> : <Eye size={13}/>} View</button> : <small>—</small>}</td>}</tr>)}</tbody>
        </table></div>
      : <p className="module-scores-status">No tycoons on {name} yet. {username ? 'Save a park here to be the first.' : 'Sign in and be the first.'}</p>)}
  </section>
}
