import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { LoaderCircle, RefreshCw, Trophy } from 'lucide-react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { learningModules } from '@/lib/modules'
import { formatScore, scoredModules } from '@/lib/module-scores'
import type { ModuleScoreBoard, ScoredModuleId } from '@/lib/module-scores'

type LoadState = 'loading' | 'ready' | 'error'

export function ModuleScoreboard({ module, username }: { module: ScoredModuleId; username: string | null }) {
  const config = scoredModules[module]
  const info = learningModules.find(item => item.id === module)
  const [board, setBoard] = useState<ModuleScoreBoard | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setState('loading')
    try {
      const response = await fetch(`/api/module-scores?module=${encodeURIComponent(module)}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('unavailable')
      setBoard(await response.json() as ModuleScoreBoard)
      setState('ready')
    } catch {
      setState(current => current === 'ready' ? 'ready' : 'error')
    } finally {
      setRefreshing(false)
    }
  }, [module])

  useEffect(() => { void load() }, [load, username])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; module?: string } | null
      if (data?.type === 'tl-score-saved' && data.module === module) void load(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [load, module])

  useRecordResetTarget({
    key: `scores:${module}`,
    label: `${info?.title ?? 'module'} leaderboard`,
    description: `Every saved ${info?.title ?? ''} result will be deleted for all players.`,
    reset: async () => { await postReset('/api/module-scores', 'POST', { action: 'reset-records', module }); await load(true) },
  })


  const records = board?.records ?? []
  const mine = username?.toLowerCase()
  const myRank = mine ? records.findIndex(record => record.username.toLowerCase() === mine) : -1

  return <section className="module-scores" style={{ '--module-accent': info?.accent ?? 'var(--lib-accent)' } as CSSProperties} aria-labelledby={`scores-${module}-title`} aria-busy={state === 'loading' || refreshing}>
    <header className="module-scores-head">
      <div>
        <span className="module-scores-eyebrow"><Trophy size={13}/> {info?.title.toUpperCase()} LEADERBOARD</span>
        <h2 id={`scores-${module}-title`}>{config.title} <small>Top 10 · every result counts</small></h2>
        <p>{config.note}{config.order === 'asc' ? ' Lower is better.' : ''}</p>
      </div>
      <div className="module-scores-side">
        {username
          ? <div className="module-scores-best"><small>YOUR BEST</small><strong>{board?.personalBest != null ? formatScore(module, board.personalBest) : '—'}</strong><span>{myRank >= 0 ? `#${myRank + 1} on the board` : board?.personalBest != null ? 'Outside the top 10' : 'No saved result yet'}</span></div>
          : <p className="module-scores-signin">Sign in to put your results on the board.</p>}
        <button type="button" className="module-scores-refresh" onClick={() => void load(true)} disabled={state === 'loading' || refreshing} aria-label="Refresh leaderboard"><RefreshCw size={14} className={refreshing ? 'spin' : undefined}/> Refresh</button>
      </div>
    </header>
    {state === 'loading' && <p className="module-scores-status" role="status"><LoaderCircle size={16} className="spin"/> Loading the leaderboard…</p>}
    {state === 'error' && <p className="module-scores-status is-error" role="alert">The leaderboard is unavailable right now. <button type="button" onClick={() => void load()}>Try again</button></p>}
    {state === 'ready' && (records.length
      ? <div className="module-scores-scroll"><table>
          <thead><tr><th scope="col">Rank</th><th scope="col">Username</th><th scope="col">{config.metric}</th><th scope="col">Date (UTC)</th></tr></thead>
          <tbody>{records.map((record, index) => <tr key={`${record.username}:${record.date}:${index}`} className={mine && record.username.toLowerCase() === mine ? 'is-mine' : undefined}><td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{record.username}</th><td>{formatScore(module, record.value)}</td><td>{record.date.slice(0, 10)}</td></tr>)}</tbody>
        </table></div>
      : <p className="module-scores-status">No results on the board yet. {username ? 'Yours could be the first.' : 'Sign in and set the first one.'}</p>)}
  </section>
}
