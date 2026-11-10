import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { CATEGORY_BY_ID, categoriesFor, formatRecord, measureSummary } from '../../modules-src/rackreel/shared/Records'
import { SIZE_CLASS_LABEL, SPECIES } from '../../modules-src/rackreel/systems/LootTableManager'
import type { Measures, SizeClass, SpeciesId } from '../../modules-src/rackreel/systems/LootTableManager'

type BoardRow = { username: string; value: number; detail: { size?: SizeClass; m?: Measures } | null; date: string }
type BoardResult = { category: string; records: BoardRow[]; personalBest: number | null; signedIn: boolean }

const speciesIds = SPECIES.map(s => s.id)

async function fetchBoard(category: string): Promise<BoardResult> {
  const response = await fetch(`/api/rackreel?board=${encodeURIComponent(category)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The record book is unavailable right now. Try again in a moment.')
  return await response.json() as BoardResult
}

function detailText(category: string, detail: BoardRow['detail']) {
  if (!detail) return ''
  const size = detail.size && SIZE_CLASS_LABEL[detail.size] ? SIZE_CLASS_LABEL[detail.size] : ''
  const others = detail.m ? measureSummary(category, detail.m) : ''
  return [size, others].filter(Boolean).join(' · ')
}

/** Rack & Reel's record board under the module frame: one tab per species, then its categories. */
export function RackReelRecordBoard() {
  const [species, setSpecies] = useState<SpeciesId>('whitetail')
  const [category, setCategory] = useState('whitetail.score')
  const [result, setResult] = useState<BoardResult | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const info = CATEGORY_BY_ID[category]
  const speciesName = SPECIES.find(s => s.id === species)?.name ?? species

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tl-rackreel') return
      if (!event.data.species || event.data.species === species) setVersion(value => value + 1)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [species])

  useEffect(() => {
    let live = true
    setError('')
    setResult(null)
    fetchBoard(category)
      .then(next => { if (live) setResult(next) })
      .catch((failure: unknown) => {
        if (!live) return
        setResult({ category, records: [], personalBest: null, signedIn: false })
        setError(failure instanceof Error ? failure.message : 'The record book is unavailable right now.')
      })
    return () => { live = false }
  }, [category, version])

  useRecordResetTarget({
    key: `rackreel:${category}`,
    label: `Rack & Reel ${speciesName.toLowerCase()} ${info.label.toLowerCase()} records`,
    description: `Every saved ${speciesName.toLowerCase()} ${info.label.toLowerCase()} result in Rack & Reel will be deleted for all players. The other categories keep their records.`,
    reset: async () => { await postReset('/api/rackreel', 'POST', { action: 'reset-records', category }); setVersion(value => value + 1) },
  })

  function pickSpecies(next: SpeciesId) {
    setSpecies(next)
    setCategory(categoriesFor(next)[0].id)
  }

  function moveTab<T extends string>(event: KeyboardEvent<HTMLDivElement>, list: readonly T[], current: T, pick: (next: T) => void, attr: string) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = list.indexOf(current)
    const next = list[(index + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]
    pick(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[${attr}="${next}"]`)?.focus()
  }

  const categories = categoriesFor(species)
  const rows = result?.records ?? null
  return (
    <section className="lap-board" aria-labelledby="rackreel-board-title">
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id="rackreel-board-title">Rack &amp; Reel records</h2>
          <p>The top 20 fish, bucks and bears ever landed or tagged in each category, by the player who took them; one player can hold several places. Fish count once reeled in, bucks and bears once you walk within 10 yards.</p>
        </div>
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Species" onKeyDown={event => moveTab(event, speciesIds, species, pickSpecies, 'data-species')}>
        {SPECIES.map(item => (
          <button key={item.id} type="button" role="tab" data-species={item.id} aria-selected={item.id === species} tabIndex={item.id === species ? 0 : -1} className={item.id === species ? 'is-active' : ''} onClick={() => pickSpecies(item.id)}>{item.name}</button>
        ))}
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label={`${speciesName} categories`} onKeyDown={event => moveTab(event, categories.map(c => c.id), category, setCategory, 'data-category')}>
        {categories.map(item => (
          <button key={item.id} type="button" role="tab" data-category={item.id} aria-selected={item.id === category} tabIndex={item.id === category ? 0 : -1} className={item.id === category ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${speciesName} ${info.label.toLowerCase()} records`}>
        <p className="lap-board-note">For reference, the real Wisconsin mark: {formatRecord(category, info.state.value)} ({info.state.note}).</p>
        {error && <p className="lap-board-note" role="status">{error}</p>}
        {result?.personalBest !== null && result?.personalBest !== undefined && <p className="lap-board-note">Your best: {formatRecord(category, result.personalBest)}</p>}
        {rows === null
          ? <p className="lap-board-note" role="status">Loading records…</p>
          : rows.length
            ? <div className="lap-board-scroll"><table>
                <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Result</th><th scope="col">Detail</th><th scope="col">Date</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.username}:${row.date}:${index}`} className={index < 3 ? `podium-${index + 1}` : undefined}>
                    <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{formatRecord(category, row.value)}</td><td>{detailText(category, row.detail)}</td><td>{new Date(row.date).toISOString().slice(0, 10)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            : !error && <p className="lap-board-note">No {speciesName.toLowerCase()} {info.label.toLowerCase()} results yet. Set the first one.</p>}
      </div>
    </section>
  )
}
