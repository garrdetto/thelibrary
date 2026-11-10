import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { AVERAGE_MIN_DARTS, BOARD_KINDS, BOARD_NAMES, MODE_NAMES, RECORD_LIMITS, RECORD_MODES, averageUnit, formatAverage, isAverageMode, isBoardKind, isRecordMode } from '../../modules-src/darts/shared/Records'
import type { RecordMode } from '../../modules-src/darts/shared/Records'
import type { BoardKind } from '../../modules-src/darts/shared/interfaces'

type BookEntry = { username: string; value: number; times: number; date: string }
type AverageEntry = { username: string; darts: number; total: number; matches: number; average: number }
type BookData = {
  records: BookEntry[]
  averages: AverageEntry[]
  you: { best: number | null; times: number; darts: number; total: number; matches: number } | null
  signedIn: boolean
  username: string | null
}

async function fetchBook(board: BoardKind, mode: RecordMode): Promise<BookData> {
  const response = await fetch(`/api/darts-records?board=${board}&mode=${mode}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The record book is unavailable right now. Try again in a moment.')
  return await response.json() as BookData
}

function recordText(mode: RecordMode, value: number) {
  return mode === 'countup' ? `${value.toLocaleString()} pts` : `${value} darts`
}

/** The Darts record book under the module frame: one tab per board, then one per format, with the best of every player and the top five all-time averages. */
export function DartsRecordBoard() {
  const [board, setBoard] = useState<BoardKind>('spider')
  const [mode, setMode] = useState<RecordMode>('501')
  const [result, setResult] = useState<BookData | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tl-darts') return
      const nextBoard = isBoardKind(event.data.board) ? event.data.board : board
      const nextMode = isRecordMode(event.data.mode) ? event.data.mode : mode
      if (nextBoard === board && nextMode === mode) {
        if (event.data.saved) setVersion(value => value + 1)
        return
      }
      setBoard(nextBoard)
      setMode(nextMode)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [board, mode])

  useEffect(() => {
    let live = true
    setError('')
    setResult(null)
    fetchBook(board, mode)
      .then(next => { if (live) setResult(next) })
      .catch((failure: unknown) => {
        if (!live) return
        setResult({ records: [], averages: [], you: null, signedIn: false, username: null })
        setError(failure instanceof Error ? failure.message : 'The record book is unavailable right now.')
      })
    return () => { live = false }
  }, [board, mode, version])

  const label = `${MODE_NAMES[mode]} · ${BOARD_NAMES[board]}`
  useRecordResetTarget({
    key: `darts:${board}:${mode}`,
    label: `Darts ${label} records`,
    description: `Every saved ${label} record and average in Darts will be deleted for all players. The other boards and formats keep theirs.`,
    reset: async () => { await postReset('/api/darts-records', 'POST', { action: 'reset-records', board, mode }); setVersion(value => value + 1) },
  })

  function moveTab<T extends string>(event: KeyboardEvent<HTMLDivElement>, list: readonly T[], current: T, pick: (next: T) => void, attr: string) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = list.indexOf(current)
    const next = list[(index + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]
    pick(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[${attr}="${next}"]`)?.focus()
  }

  const fewest = RECORD_LIMITS[mode].order === 'asc'
  const average = isAverageMode(mode) ? mode : null
  const rows = result?.records ?? null
  const you = result?.you ?? null
  return (
    <section className="lap-board" aria-labelledby="darts-board-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="darts-board-title">Darts records</h2>
          <p>Each board keeps its own book: fewest darts to finish 501, 301 or Cricket and the best eight-round Count Up, from any leg played alone, against anyone or in a tournament (team matches don't count). Averages count when two people play each other or against the Pro computer.</p>
        </div>
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Board" onKeyDown={event => moveTab(event, BOARD_KINDS, board, setBoard, 'data-board')}>
        {BOARD_KINDS.map(item => (
          <button key={item} type="button" role="tab" data-board={item} aria-selected={item === board} tabIndex={item === board ? 0 : -1} className={item === board ? 'is-active' : ''} onClick={() => setBoard(item)}>{BOARD_NAMES[item]}</button>
        ))}
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Format" onKeyDown={event => moveTab(event, RECORD_MODES, mode, setMode, 'data-mode')}>
        {RECORD_MODES.map(item => (
          <button key={item} type="button" role="tab" data-mode={item} aria-selected={item === mode} tabIndex={item === mode ? 0 : -1} className={item === mode ? 'is-active' : ''} onClick={() => setMode(item)}>{MODE_NAMES[item]}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${label} records`}>
        {error && <p className="lap-board-note" role="status">{error}</p>}
        {result && !error && (you
          ? <p className="lap-board-note">
              {you.best !== null ? `Your best: ${recordText(mode, you.best)}${you.times > 1 ? ` (×${you.times})` : ''}` : 'No best saved yet'}
              {average && (you.darts ? ` · your average ${formatAverage(average, you.darts, you.total)} ${averageUnit(average)} over ${you.darts.toLocaleString()} darts` : ' · no counted average yet')}
            </p>
          : !result.signedIn && <p className="lap-board-note">Sign in to the library to put your legs in the record book.</p>)}
        <div className="darts-board-cols">
          <div>
            <h3 className="darts-board-sub">{fewest ? 'Fewest darts' : 'Highest totals'}</h3>
            {rows === null
              ? <p className="lap-board-note" role="status">Loading records…</p>
              : rows.length
                ? <div className="lap-board-scroll"><table>
                    <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Result</th><th scope="col">Times</th><th scope="col">Date</th></tr></thead>
                    <tbody>{rows.map((row, index) => (
                      <tr key={`${row.username}:${row.date}:${index}`} className={index < 3 ? `podium-${index + 1}` : undefined}>
                        <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{recordText(mode, row.value)}</td><td>{row.times > 1 ? `×${row.times}` : '×1'}</td><td>{new Date(row.date).toISOString().slice(0, 10)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                : !error && <p className="lap-board-note">{fewest ? 'No legs saved yet. Finish one to set the mark.' : 'No totals saved yet. Set the first one.'}</p>}
          </div>
          {average && (
            <div>
              <h3 className="darts-board-sub">All-time averages ({averageUnit(average)})</h3>
              {rows === null
                ? <p className="lap-board-note" role="status">Loading averages…</p>
                : result?.averages.length
                  ? <div className="lap-board-scroll"><table>
                      <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">{averageUnit(average)}</th><th scope="col">Darts</th></tr></thead>
                      <tbody>{result.averages.map((row, index) => (
                        <tr key={row.username} className={index < 3 ? `podium-${index + 1}` : undefined}>
                          <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{row.average.toFixed(2)}</td><td title={`${row.darts.toLocaleString()} darts over ${row.matches} ${row.matches === 1 ? 'match' : 'matches'}`}>{row.darts.toLocaleString()}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  : !error && <p className="lap-board-note">No one has {AVERAGE_MIN_DARTS} counted darts here yet.</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
