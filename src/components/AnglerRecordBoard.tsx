import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { LAKES, SPECIES, fetchAnglerBoard, fetchAnglerHall, formatCatchLength, formatCatchWeight, isAnglerSpecies, lakeIds, speciesIds } from '@/lib/angler'
import type { AnglerBoard, AnglerHallEntry, AnglerPeriod, LakeId, SpeciesId } from '@/lib/angler'

type View = 'hall' | SpeciesId

export function AnglerRecordBoard() {
  const [view, setView] = useState<View>('hall')
  const [lake, setLake] = useState<LakeId | 'all'>('all')
  const [period, setPeriod] = useState<AnglerPeriod>('all')
  const [board, setBoard] = useState<AnglerBoard | null>(null)
  const [hall, setHall] = useState<AnglerHallEntry[] | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tl-angler') return
      setVersion(value => value + 1)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [])

  useEffect(() => {
    let live = true
    setError('')
    const load = view === 'hall'
      ? fetchAnglerHall().then(next => { if (live) setHall(next) })
      : fetchAnglerBoard(view, lake, period).then(next => { if (live) setBoard(next) })
    load.catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : 'The record book is unavailable right now.') })
    return () => { live = false }
  }, [view, lake, period, version])

  useRecordResetTarget(view === 'hall' ? null : {
    key: `angler:${view}`,
    label: `Northwoods Angler ${SPECIES[view].name.toLowerCase()} records`,
    description: `Every saved ${SPECIES[view].name.toLowerCase()} catch in Northwoods Angler will be deleted for all anglers. Other species keep their records.`,
    reset: async () => { await postReset('/api/angler', 'POST', { action: 'reset-records', species: view }); setVersion(value => value + 1) },
  })

  const pick = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    setView(value === 'hall' || !isAnglerSpecies(value) ? 'hall' : value)
  }
  const bySpecies = new Map((hall ?? []).map(entry => [entry.species, entry]))

  return (
    <section className="lap-board" aria-labelledby="angler-board-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="angler-board-title">Northwoods Angler records</h2>
          <p>{view === 'hall' ? 'The heaviest fish of every species landed on the library.' : `${SPECIES[view].name}: the top 20 by weight. One angler can hold several places.`}</p>
        </div>
      </div>
      <div className="lap-board-tabs angler-board-filters">
        <select aria-label="Board" value={view} onChange={pick}>
          <option value="hall">Hall of Records</option>
          {speciesIds.map(id => <option key={id} value={id}>{SPECIES[id].name}</option>)}
        </select>
        {view !== 'hall' && <>
          <select aria-label="Lake" value={lake} onChange={event => setLake(event.target.value as LakeId | 'all')}>
            <option value="all">All lakes</option>
            {lakeIds.map(id => <option key={id} value={id}>{LAKES[id].name}</option>)}
          </select>
          <select aria-label="Period" value={period} onChange={event => setPeriod(event.target.value as AnglerPeriod)}>
            <option value="all">All time</option>
            <option value="month">This month</option>
          </select>
        </>}
      </div>
      {error && <p className="lap-board-note" role="status">{error}</p>}
      {view === 'hall'
        ? hall === null
          ? <p className="lap-board-note" role="status">Loading records…</p>
          : <div className="lap-board-scroll"><table>
              <thead><tr><th scope="col">Species</th><th scope="col">Angler</th><th scope="col">Weight</th><th scope="col">Length</th><th scope="col">Lake</th><th scope="col">Date</th></tr></thead>
              <tbody>{speciesIds.map(id => {
                const entry = bySpecies.get(id)
                return (
                  <tr key={id}>
                    <th scope="row"><button type="button" className="angler-board-link" onClick={() => setView(id)}>{SPECIES[id].name}</button></th>
                    {entry
                      ? <><td>{entry.username}</td><td>{formatCatchWeight(entry.weight)}</td><td>{formatCatchLength(entry.length)}</td><td>{LAKES[entry.lake]?.name}</td><td>{entry.date.slice(0, 10)}</td></>
                      : <td colSpan={5}>Unclaimed</td>}
                  </tr>
                )
              })}</tbody>
            </table></div>
        : board === null || board.species !== view
          ? <p className="lap-board-note" role="status">Loading records…</p>
          : <>
              {board.personalBest !== null && <p className="lap-board-note">Your best: {formatCatchWeight(board.personalBest)}</p>}
              {board.records.length
                ? <div className="lap-board-scroll"><table>
                    <thead><tr><th scope="col">Rank</th><th scope="col">Angler</th><th scope="col">Weight</th><th scope="col">Length</th><th scope="col">Lake</th><th scope="col">Date</th></tr></thead>
                    <tbody>{board.records.map((row, index) => (
                      <tr key={row.id} className={index < 3 ? `podium-${index + 1}` : undefined}>
                        <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{formatCatchWeight(row.weight)} · {row.tier}</td><td>{formatCatchLength(row.length)}</td><td>{LAKES[row.lake]?.name} · {row.spot}</td><td>{row.date.slice(0, 10)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                : <p className="lap-board-note">No {SPECIES[view].name.toLowerCase()} on this board yet. Set the first record.</p>}
            </>}
    </section>
  )
}
