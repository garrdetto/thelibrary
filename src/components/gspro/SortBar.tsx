import type { ReactNode } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { clubLabel, clubOrder } from '@/lib/gspro/clubs'
import type { SortState } from '@/lib/gspro/sorting'

export function SortBar<K extends string>({ keys, state, onChange, clubs, count }: {
  keys: Record<K, { label: string; first: 'asc' | 'desc' }>
  state: SortState<K>
  onChange: (state: SortState<K>) => void
  clubs: (string | null)[]
  count: number
}) {
  const present = [...new Set(clubs.map(club => club ?? ''))].sort((a, b) => clubOrder(a || null) - clubOrder(b || null))
  return <div className="gs-sortbar" role="group" aria-label="Sort and filter shots">
    <label className="gs-field"><span>Sort by</span>
      <select value={state.key} onChange={event => { const key = event.target.value as K; onChange({ ...state, key, direction: keys[key].first }) }}>
        {(Object.keys(keys) as K[]).map(key => <option key={key} value={key}>{keys[key].label}</option>)}
      </select>
    </label>
    <button type="button" className="gs-button ghost" onClick={() => onChange({ ...state, direction: state.direction === 'asc' ? 'desc' : 'asc' })} aria-label={`Order: ${state.direction === 'asc' ? 'lowest or oldest first' : 'highest or newest first'}. Click to reverse.`}>
      {state.direction === 'asc' ? <ArrowUpNarrowWide size={15} aria-hidden/> : <ArrowDownWideNarrow size={15} aria-hidden/>}
      {state.direction === 'asc' ? 'Low to high' : 'High to low'}
    </button>
    <label className="gs-check"><input type="checkbox" checked={state.byClub} onChange={event => onChange({ ...state, byClub: event.target.checked })}/> Group by club</label>
    <label className="gs-field"><span>Club</span>
      <select value={state.club} onChange={event => onChange({ ...state, club: event.target.value })}>
        <option value="all">All clubs</option>
        {present.map(club => <option key={club} value={club}>{club ? clubLabel(club) : 'Unknown club'}</option>)}
      </select>
    </label>
    <span className="gs-muted gs-count">{count} shot{count === 1 ? '' : 's'}</span>
  </div>
}

export function SortHeader<K extends string>({ sortKey, state, onChange, first, children }: { sortKey: K; state: SortState<K>; onChange: (state: SortState<K>) => void; first: 'asc' | 'desc'; children: ReactNode }) {
  const active = state.key === sortKey
  return <th scope="col" aria-sort={active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={`gs-sort ${active ? 'is-active' : ''}`} onClick={() => onChange({ ...state, key: sortKey, direction: active ? (state.direction === 'asc' ? 'desc' : 'asc') : first })}>
      {children}<span aria-hidden>{active ? (state.direction === 'asc' ? '▲' : '▼') : ''}</span>
    </button>
  </th>
}
