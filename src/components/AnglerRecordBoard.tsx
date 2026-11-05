import { Fragment, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { LAKES, SPECIES, fetchAnglerHall, formatCatchLength, formatCatchWeight, formatCaught, isAnglerSpecies, speciesIds } from '@/lib/angler'
import type { AnglerHallEntry, SpeciesId } from '@/lib/angler'

type View = 'all' | SpeciesId

const PLACES = ['1st', '2nd', '3rd']

export function AnglerRecordBoard() {
  const [view, setView] = useState<View>('all')
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
    fetchAnglerHall()
      .then(next => { if (live) setHall(next) })
      .catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : 'The record book is unavailable right now.') })
    return () => { live = false }
  }, [version])

  useRecordResetTarget(view === 'all' ? null : {
    key: `angler:${view}`,
    label: `Northwoods Angler ${SPECIES[view].name.toLowerCase()} records`,
    description: `Every saved ${SPECIES[view].name.toLowerCase()} catch in Northwoods Angler will be deleted for all anglers. Other species keep their records.`,
    reset: async () => { await postReset('/api/angler', 'POST', { action: 'reset-records', species: view }); setVersion(value => value + 1) },
  })

  const pick = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    setView(isAnglerSpecies(value) ? value : 'all')
  }
  const ids = view === 'all' ? speciesIds : [view]
  const topOf = (id: SpeciesId) => (hall ?? []).filter(entry => entry.species === id).sort((a, b) => b.weight - a.weight).slice(0, 3)

  return (
    <section className="lap-board" aria-labelledby="angler-board-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="angler-board-title">Northwoods Angler records</h2>
          <p>The three biggest fish of every species landed on the library, and when they were caught (central time).</p>
        </div>
      </div>
      <div className="lap-board-tabs angler-board-filters">
        <select aria-label="Species" value={view} onChange={pick}>
          <option value="all">Every species</option>
          {speciesIds.map(id => <option key={id} value={id}>{SPECIES[id].name}</option>)}
        </select>
      </div>
      {error && <p className="lap-board-note" role="status">{error}</p>}
      {hall === null
        ? <p className="lap-board-note" role="status">Loading records…</p>
        : <div className="lap-board-scroll"><table>
            <thead><tr><th scope="col">Species</th><th scope="col">Place</th><th scope="col">Weight</th><th scope="col">Length</th><th scope="col">Angler</th><th scope="col">Lake</th><th scope="col">Caught</th></tr></thead>
            <tbody>{ids.map(id => {
              const top = topOf(id)
              if (!top.length) return <tr key={id}><th scope="row">{SPECIES[id].name}</th><td colSpan={6}>Unclaimed</td></tr>
              return (
                <Fragment key={id}>
                  {top.map((entry, index) => (
                    <tr key={entry.id} className={`podium-${index + 1}`}>
                      {index === 0 && <th scope="rowgroup" rowSpan={top.length}>{SPECIES[id].name}</th>}
                      <td>{PLACES[index]}</td><td>{formatCatchWeight(entry.weight)}</td><td>{formatCatchLength(entry.length)}</td><td>{entry.username}</td><td>{LAKES[entry.lake]?.name}</td><td><time dateTime={entry.date}>{formatCaught(entry.date)}</time></td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}</tbody>
          </table></div>}
    </section>
  )
}
