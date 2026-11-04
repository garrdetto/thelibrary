import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { fairwayBoardNames, fairwayBoards, fetchFairwayBoard, formatFairwayValue, isFairwayBoard } from '@/lib/fairway'
import type { FairwayBoard, FairwayBoardResult } from '@/lib/fairway'

const boardDescriptions: Record<FairwayBoard, string> = {
  round: 'Lowest nine-hole solo rounds, gross strokes.',
  pin: 'Closest tee shots to the pin, measured to the centimetre.',
  match: 'Finishing places from online rooms.',
}

function detailText(board: FairwayBoard, detail: Record<string, unknown> | null) {
  if (!detail) return ''
  if (board === 'pin') return [typeof detail.holeName === 'string' ? detail.holeName : '', detail.holeInOne === true ? 'Hole in one' : ''].filter(Boolean).join(' · ')
  if (board === 'match') {
    const placements = Array.isArray(detail.placements) ? detail.placements.length : 0
    const holes = Array.isArray(detail.holes) ? detail.holes.length : 0
    return [placements ? `${placements} players` : '', holes ? `${holes} holes` : ''].filter(Boolean).join(' · ')
  }
  return Array.isArray(detail.holes) ? `${detail.holes.length} holes` : ''
}

export function FairwayRecordBoard() {
  const [board, setBoard] = useState<FairwayBoard>('round')
  const [result, setResult] = useState<FairwayBoardResult | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tl-fairway' || !isFairwayBoard(event.data?.board)) return
      if (event.data.board === board) setVersion(value => value + 1)
      else setBoard(event.data.board)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [board])

  useEffect(() => {
    let live = true
    setError('')
    setResult(null)
    fetchFairwayBoard(board)
      .then(next => { if (live) setResult(next) })
      .catch((failure: unknown) => {
        if (!live) return
        setResult({ board, records: [], personalBest: null, signedIn: false })
        setError(failure instanceof Error ? failure.message : 'The record book is unavailable right now.')
      })
    return () => { live = false }
  }, [board, version])

  useRecordResetTarget({
    key: `fairway:${board}`,
    label: `Fairway Nine ${fairwayBoardNames[board].toLowerCase()} records`,
    description: `Every saved ${fairwayBoardNames[board].toLowerCase()} result in Fairway Nine will be deleted for all players. The other tabs keep their records.`,
    reset: async () => { await postReset('/api/fairway', 'POST', { action: 'reset-records', board }); setVersion(value => value + 1) },
  })

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = fairwayBoards.indexOf(board)
    const next = fairwayBoards[(index + (event.key === 'ArrowRight' ? 1 : fairwayBoards.length - 1)) % fairwayBoards.length]
    setBoard(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-board="${next}"]`)?.focus()
  }

  const rows = result?.records ?? null
  return (
    <section className="lap-board" aria-labelledby="fairway-board-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="fairway-board-title">Fairway Nine records</h2>
          <p>{boardDescriptions[board]} The top 20 results ever saved; one player can hold several places.</p>
        </div>
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Record book" onKeyDown={moveTab}>
        {fairwayBoards.map(item => (
          <button key={item} type="button" role="tab" data-board={item} aria-selected={item === board} tabIndex={item === board ? 0 : -1} className={item === board ? 'is-active' : ''} onClick={() => setBoard(item)}>{fairwayBoardNames[item]}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${fairwayBoardNames[board]} records`}>
        {error && <p className="lap-board-note" role="status">{error}</p>}
        {result?.personalBest !== null && result?.personalBest !== undefined && <p className="lap-board-note">Your best: {formatFairwayValue(board, result.personalBest)}</p>}
        {rows === null
          ? <p className="lap-board-note" role="status">Loading records…</p>
          : rows.length
            ? <div className="lap-board-scroll"><table>
                <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Result</th><th scope="col">Detail</th><th scope="col">Date</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.username}:${row.date}:${index}`} className={index < 3 ? `podium-${index + 1}` : undefined}>
                    <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{formatFairwayValue(board, row.value)}</td><td>{detailText(board, row.detail)}</td><td>{new Date(row.date).toISOString().slice(0, 10)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            : !error && <p className="lap-board-note">No {fairwayBoardNames[board].toLowerCase()} results yet. Set the first one.</p>}
      </div>
    </section>
  )
}
