import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { ARENA_ACCURACY_MIN_SHOTS, arenaDuelSortNames, arenaDuelSorts, fetchArenaDuelBoard, formatAccuracy, formatKd } from '@/lib/arena-duel'
import type { ArenaDuelBoardResult, ArenaDuelSort } from '@/lib/arena-duel'

const sortNotes: Record<ArenaDuelSort, string> = {
  kd: 'Sorted by K/D ratio: eliminations divided by times eliminated, over every 1v1 Duel played.',
  accuracy: `Sorted by accuracy: rounds that hit out of rounds fired in 1v1 Duels (players with ${ARENA_ACCURACY_MIN_SHOTS} rounds or more).`,
}

export function ArenaDuelBoard() {
  const [sort, setSort] = useState<ArenaDuelSort>('kd')
  const [result, setResult] = useState<ArenaDuelBoardResult | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'tl-arena-duel') setVersion(value => value + 1)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [])

  useEffect(() => {
    let live = true
    setError('')
    setResult(null)
    fetchArenaDuelBoard(sort)
      .then(next => { if (live) setResult(next) })
      .catch((failure: unknown) => {
        if (!live) return
        setResult({ sort, rows: [], mine: null, signedIn: false })
        setError(failure instanceof Error ? failure.message : 'The 1v1 record book is unavailable right now.')
      })
    return () => { live = false }
  }, [sort, version])

  useRecordResetTarget({
    key: 'arena:duel',
    label: 'Vector Arena 1v1 Duel records',
    description: 'Every player\'s 1v1 Duel K/D ratio and accuracy in Vector Arena will be cleared for all players. The Training Range and Rolling Siege boards keep their scores.',
    reset: async () => { await postReset('/api/arena-stats', 'POST', { action: 'reset-records' }); setVersion(value => value + 1) },
  })

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = sort === 'kd' ? 'accuracy' : 'kd'
    setSort(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-sort="${next}"]`)?.focus()
  }

  const rows = result?.rows ?? null
  const mine = result?.mine ?? null
  return (
    <section className="lap-board" aria-labelledby="arena-duel-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="arena-duel-title">1v1 Duel records</h2>
          <p>{sortNotes[sort]} Signed-in players' results are saved when each duel ends.</p>
        </div>
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Sort the 1v1 records by" onKeyDown={moveTab}>
        {arenaDuelSorts.map(item => (
          <button key={item} type="button" role="tab" data-sort={item} aria-selected={item === sort} tabIndex={item === sort ? 0 : -1} className={item === sort ? 'is-active' : ''} onClick={() => setSort(item)}>{arenaDuelSortNames[item]}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`1v1 records by ${arenaDuelSortNames[sort]}`}>
        {error && <p className="lap-board-note" role="status">{error}</p>}
        {mine && <p className="lap-board-note">You: K/D {formatKd(mine)} · accuracy {formatAccuracy(mine)} · {mine.kills} eliminations, {mine.deaths} deaths over {mine.matches} {mine.matches === 1 ? 'duel' : 'duels'}</p>}
        {rows === null
          ? <p className="lap-board-note" role="status">Loading records…</p>
          : rows.length
            ? <div className="lap-board-scroll"><table>
                <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" aria-sort={sort === 'kd' ? 'descending' : undefined}>K/D</th><th scope="col" aria-sort={sort === 'accuracy' ? 'descending' : undefined}>Accuracy</th><th scope="col">Eliminations</th><th scope="col">Deaths</th><th scope="col">Duels</th><th scope="col">Wins</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={row.username} className={index < 3 ? `podium-${index + 1}` : undefined}>
                    <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{formatKd(row)}</td><td>{formatAccuracy(row)}</td><td>{row.kills}</td><td>{row.deaths}</td><td>{row.matches}</td><td>{row.wins}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            : !error && <p className="lap-board-note">No 1v1 Duels saved yet. Win the first one.</p>}
      </div>
    </section>
  )
}
