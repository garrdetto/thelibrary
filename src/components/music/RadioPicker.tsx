import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { radioAreas, radioStations } from '@/lib/radio-stations'
import type { RadioStation } from '@/lib/radio-stations'

export function RadioPicker({ current, onPick, onClose }: { current: string; onPick: (station: RadioStation) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    search.current?.focus()
    list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const match = (station: RadioStation) => !needle || [station.name, station.dial, station.city, station.format, station.id].some(value => value.toLowerCase().includes(needle))
    return radioAreas.map(area => ({ area, stations: radioStations.filter(station => station.area === area && match(station)) })).filter(group => group.stations.length)
  }, [query])

  return <div className="radio-picker" role="dialog" aria-label="Choose a radio station" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="radio-picker-head">
      <label className="radio-search"><Search size={14} aria-hidden/><span className="adm-sr">Search stations</span>
        <input ref={search} type="text" enterKeyHint="search" autoComplete="off" value={query} placeholder="Station, city or style" onChange={event => setQuery(event.target.value)}/>
      </label>
      <button type="button" className="music-icon" aria-label="Close the station list" onClick={onClose}><X size={16}/></button>
    </div>
    <div className="radio-list" ref={list}>
      {groups.map(group => <section key={group.area} aria-label={group.area}>
        <h3>{group.area}</h3>
        <ul>{group.stations.map(station => <li key={station.id}>
          <button type="button" aria-current={station.id === current ? 'true' : undefined} onClick={() => onPick(station)}>
            <span className="radio-dial">{station.dial.replace(/ (FM|AM)$/, '')}<small>{/ (FM|AM)$/.exec(station.dial)?.[1] ?? ''}</small></span>
            <span className="radio-name"><strong>{station.name}</strong><small>{station.format} · {station.city}</small></span>
          </button>
        </li>)}</ul>
      </section>)}
      {!groups.length && <p className="music-hint">No stations match “{query}”.</p>}
    </div>
  </div>
}
