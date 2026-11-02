import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { HOTELS, HOTEL_ADDONS, hotelSpec, formatMoney } from '../../../server/park/index.mjs'
import type { Entity, Park } from '../../../server/park/index.mjs'

const money = (v: number) => formatMoney(v)
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
const ROOF_NAMES: Record<string, string> = { flat: 'Flat', gable: 'Gable', crown: 'Crown', spire: 'Spire', thatch: 'Thatch', hip: 'Hip', battlement: 'Battlements', cone: 'Cone towers', sign: 'Rooftop sign' }

export function ResortCards({ selected, onPick }: { selected: string | null; onPick: (kind: string) => void }) {
  return <div className="pk-cards">{Object.entries(HOTELS).map(([id, def]) => {
    const low = hotelSpec(id, def.min, def.floors[0])!, high = hotelSpec(id, def.max, def.floors[1])!
    return <button key={id} className={`pk-card ${selected === id ? 'on' : ''}`} onClick={() => onPick(id)}>
      <strong><i className="pk-swatch" style={{ background: hex(def.colors.secondary) }} />{def.name}</strong>
      <span>{money(low.cost)} to {money(high.cost)} · {def.floors[0] === def.floors[1] ? `${def.floors[0]} floor` : `${def.floors[0]}–${def.floors[1]} floors`}</span>
      <small>{def.description}</small>
      <em>{low.rooms}–{high.rooms} rooms · up to +{high.guestBonus.toLocaleString()} guests</em>
    </button>
  })}</div>
}

export function ResortSummary({ park }: { park: Park }) {
  return <p className="pk-hint">Drag out a lot next to a footpath, then set floors in the bar below. Two hotels beside a pool within 10 squares form a resort district and raise your park rating.{park.resortHotels ? ` ${park.resortHotels} hotels are in a resort district now.` : ''}</p>
}

export function HotelWindowBody({ hotel, readOnly, run, onDemolish }: { hotel: Entity; readOnly: boolean; run: (cmd: { t: string; [k: string]: unknown }, success?: string) => Promise<{ ok: boolean }>; onDemolish: () => void }) {
  const def = HOTELS[hotel.kind as string]
  const [name, setName] = useState(hotel.name ?? '')
  const [editing, setEditing] = useState(false)
  if (!def) return null
  const spec = hotelSpec(hotel.kind as string, hotel.size ?? def.min, hotel.floors ?? 1, hotel.addons)!
  const occ = Math.round((hotel.occupancy ?? 0) * 100)
  const colors = hotel.colors ?? def.colors
  const set = (fields: Record<string, unknown>) => void run({ t: 'hotelSet', id: hotel.id, ...fields })
  return <>
    {editing ? <form className="pk-chat-form" onSubmit={e => { e.preventDefault(); set({ name }); setEditing(false) }}><input value={name} maxLength={32} onChange={e => setName(e.target.value)} aria-label="Hotel name" /><button className="pk-btn">Rename</button></form>
      : <p className="pk-hint">{def.name}{!readOnly && <> · <button className="pk-inline" onClick={() => { setName(hotel.name ?? ''); setEditing(true) }}>rename</button></>}{hotel.district ? ' · Resort district' : ''}</p>}
    <dl className="pk-dl">
      <dt>Size</dt><dd>{hotel.size?.[0]}×{hotel.size?.[1]} squares · {hotel.floors} {hotel.floors === 1 ? 'floor' : 'floors'}</dd>
      <dt>Rooms</dt><dd>{spec.rooms.toLocaleString()}</dd>
      <dt>Occupancy</dt><dd>{occ}%</dd>
      <dt>Last night</dt><dd>{money(hotel.lastNight ?? 0)}</dd>
      <dt>Total income</dt><dd>{money(hotel.revenue ?? 0)}</dd>
      <dt>Upkeep</dt><dd>{money(spec.upkeep)} a day</dd>
      <dt>Extra guests</dt><dd>+{spec.guestBonus.toLocaleString()} to the park cap</dd>
      <dt>Value</dt><dd>{money(spec.cost)}</dd>
    </dl>
    {!readOnly && <>
      <p className="pk-label">Colors</p>
      <div className="pk-ride-colors">
        {(['primary', 'secondary', 'trim'] as const).map(key => <label key={key} className="pk-field"><span>{key === 'primary' ? 'Walls' : key === 'secondary' ? 'Roof and accents' : 'Trim'}</span><input type="color" value={hex(colors[key])} onChange={e => set({ [key]: Number.parseInt(e.target.value.slice(1), 16) })} /></label>)}
      </div>
      {def.roofs.length > 1 && <><p className="pk-label" id={`pk-roof-${hotel.id}`}>Roof</p>
        <div className="pk-chips" role="radiogroup" aria-labelledby={`pk-roof-${hotel.id}`}>{def.roofs.map(roof => <button key={roof} role="radio" aria-checked={hotel.roof === roof} className={hotel.roof === roof ? 'on' : ''} onClick={() => set({ roof })}>{ROOF_NAMES[roof] ?? roof}</button>)}</div></>}
      <p className="pk-label">Add-ons</p>
      <div className="pk-chips">{Object.entries(HOTEL_ADDONS).map(([id, addon]) => { const on = Boolean(hotel.addons?.[id]); return <button key={id} aria-pressed={on} className={on ? 'on' : ''} onClick={() => set({ addon: id, on: !on })}>{addon.name}{on ? ' ✓' : ` · ${money(addon.cost)}`}</button> })}</div>
      <p className="pk-hint">Loud roller coasters within 6 squares cut occupancy. Scenery, water rides and add-ons raise it.</p>
      <button className="pk-btn pk-danger" onClick={onDemolish}><Trash2 size={14} /> Demolish hotel</button>
    </>}
  </>
}
