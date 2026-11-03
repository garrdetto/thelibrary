import { useEffect, useState } from 'react'
import { Minus, Plus, Trash2, Wrench } from 'lucide-react'
import { HOTELS, HOTEL_ADDONS, HOTEL_SERVICE, hotelSpec, hotelNight, hotelOccupancy, hotelRateLimits, hotelResizeCost, hotelRefurbishCost, hotelOrientedFits, hotelPortfolio, rateFactor, amenityBooks, addonCost, formatMoney } from '../../../server/park/index.mjs'
import type { Entity, Park, ParkState } from '../../../server/park/index.mjs'

const money = (v: number) => formatMoney(v)
const signed = (v: number) => (v < 0 ? `−${money(-v)}` : money(v))
const tone = (v: number) => (v < 0 ? 'pk-neg' : v > 0 ? 'pk-pos' : '')
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
const ROOF_NAMES: Record<string, string> = { flat: 'Flat', gable: 'Gable', crown: 'Crown', spire: 'Spire', thatch: 'Thatch', hip: 'Hip', battlement: 'Battlements', cone: 'Cone towers', sign: 'Rooftop sign' }
type Run = (cmd: { t: string; [k: string]: unknown }, success?: string) => Promise<{ ok: boolean; cost?: number; refund?: number; error?: string }>

export function ResortCards({ selected, onPick }: { selected: string | null; onPick: (kind: string) => void }) {
  return <div className="pk-cards">{Object.entries(HOTELS).map(([id, def]) => {
    const low = hotelSpec(id, def.min, def.floors[0])!, high = hotelSpec(id, def.max, def.floors[1])!
    return <button key={id} className={`pk-card ${selected === id ? 'on' : ''}`} onClick={() => onPick(id)}>
      <strong><i className="pk-swatch" style={{ background: hex(def.colors.secondary) }} />{def.name}</strong>
      <span>{money(low.cost)} to {money(high.cost)} · {def.min.join('×')} to {def.max.join('×')} · {def.floors[0] === def.floors[1] ? `${def.floors[0]} floor` : `${def.floors[0]}–${def.floors[1]} floors`}</span>
      <small>{def.description}</small>
      <em>{low.rooms}–{high.rooms.toLocaleString()} rooms · {money(def.rate)} a night · up to +{high.guestBonus.toLocaleString()} guests</em>
    </button>
  })}</div>
}

export function ResortSummary({ park }: { park: Park }) {
  return <p className="pk-hint">Drag out any size of lot next to a footpath, then set floors in the bar below; the price follows the size. Two hotels beside a pool within 10 squares form a resort district, which raises your park rating and adds a resort fee to every booked room.{park.resortHotels ? ` ${park.resortHotels} hotels are in a resort district now.` : ''}</p>
}

// Every hotel's latest night side by side, with totals, so the player can see which ones carry the resort.
export function ResortPortfolio({ state, park, onSelect }: { state: ParkState; park: Park; onSelect: (id: number) => void }) {
  const hotels = Object.values(state.entities).filter(e => e.type === 'hotel' && e.park === park.id)
  if (!hotels.length) return null
  const total = hotelPortfolio(state, park.id)
  const m = park.month
  return <>
    <p className="pk-label">Your hotels</p>
    <div className="pk-hotel-table" role="table" aria-label="Hotel portfolio">
      <div role="row" className="pk-hotel-head"><span role="columnheader">Hotel</span><span role="columnheader">Rooms</span><span role="columnheader">Booked</span><span role="columnheader">Rate</span><span role="columnheader">Last night</span><span role="columnheader">Lifetime</span></div>
      {hotels.map(h => {
        const spec = hotelSpec(h.kind as string, h.size!, h.floors ?? 1, h.addons)!
        return <button role="row" key={h.id} onClick={() => onSelect(h.id)}>
          <span role="cell">{h.name}{h.district ? ' ★' : ''}</span>
          <span role="cell">{spec.rooms.toLocaleString()}</span>
          <span role="cell">{Math.round((h.occupancy ?? 0) * 100)}%</span>
          <span role="cell">{money(h.rate ?? HOTELS[h.kind as string].rate)}</span>
          <span role="cell" className={tone(h.night?.profit ?? 0)}>{signed(h.night?.profit ?? 0)}</span>
          <span role="cell" className={tone(h.profit ?? 0)}>{signed(Math.round(h.profit ?? 0))}</span>
        </button>
      })}
      <div role="row" className="pk-hotel-foot"><span role="cell">All hotels</span><span role="cell">{total.rooms.toLocaleString()}</span><span role="cell">{total.rooms ? Math.round(total.occupied / total.rooms * 100) : 0}%</span><span role="cell" /><span role="cell" className={tone(total.profit)}>{signed(total.profit)}</span><span role="cell" className={tone(total.lifetime)}>{signed(Math.round(total.lifetime))}</span></div>
    </div>
    <dl className="pk-dl">
      <dt>Rooms this month</dt><dd className="pk-pos">{money(m.hotels ?? 0)}</dd>
      <dt>Amenities and resort fees</dt><dd className="pk-pos">{money(m.hotelAmenities ?? 0)}</dd>
      <dt>Hotel staff</dt><dd className="pk-neg">{money(m.hotelStaff ?? 0)}</dd>
      <dt>Utilities, upkeep, amenity running</dt><dd className="pk-neg">{money(m.hotelUpkeep ?? 0)}</dd>
      <dt>Invested so far</dt><dd>{money(Math.round(total.invested))}</dd>
      <dt>Return on investment</dt><dd className={tone(total.lifetime)}>{total.invested ? `${Math.round(total.lifetime / total.invested * 1000) / 10}%` : '—'}</dd>
    </dl>
  </>
}

function Stepper({ label, value, min, max, onChange, suffix = '' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return <div className="pk-row"><span>{label}</span>
    <button aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={13} /></button>
    <strong>{value}{suffix}</strong>
    <button aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={13} /></button>
  </div>
}

function NightBars({ nights }: { nights: number[] }) {
  if (nights.length < 2) return null
  const peak = Math.max(1, ...nights.map(Math.abs))
  return <div className="pk-hotel-bars" role="img" aria-label={`Profit for the last ${nights.length} nights, from ${signed(Math.min(...nights))} to ${signed(Math.max(...nights))}`}>
    {nights.map((v, i) => <i key={i} className={v < 0 ? 'neg' : ''} style={{ height: `${Math.max(4, Math.abs(v) / peak * 100)}%` }} title={signed(v)} />)}
  </div>
}

export function HotelWindowBody({ hotel, state, readOnly, run, onDemolish }: { hotel: Entity; state: ParkState; readOnly: boolean; run: Run; onDemolish: () => void }) {
  const def = HOTELS[hotel.kind as string]
  const [name, setName] = useState(hotel.name ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ w: hotel.size?.[0] ?? 1, h: hotel.size?.[1] ?? 1, floors: hotel.floors ?? 1 })
  const [rate, setRate] = useState(hotel.rate ?? def?.rate ?? 0)
  useEffect(() => { setDraft({ w: hotel.size?.[0] ?? 1, h: hotel.size?.[1] ?? 1, floors: hotel.floors ?? 1 }) }, [hotel.id, hotel.size?.[0], hotel.size?.[1], hotel.floors])
  useEffect(() => { setRate(hotel.rate ?? def?.rate ?? 0) }, [hotel.id, hotel.rate])
  if (!def) return null
  const spec = hotelSpec(hotel.kind as string, hotel.size ?? def.min, hotel.floors ?? 1, hotel.addons)!
  const occ = Math.round((hotel.occupancy ?? 0) * 100)
  const colors = hotel.colors ?? def.colors
  const set = (fields: Record<string, unknown>) => run({ t: 'hotelSet', id: hotel.id, ...fields })
  const night = hotel.night ?? hotelNight(hotel, hotel.occupancy ?? 0.5, hotel.district)
  const nights = hotel.nights ?? []
  const avg = nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : night?.profit ?? 0
  const invested = hotel.invested ?? spec.cost
  const payback = avg > 0 ? Math.max(0, Math.ceil((invested - (hotel.profit ?? 0)) / avg)) : null
  const condition = Math.round(hotel.condition ?? 100)
  const refurb = hotelRefurbishCost(hotel)
  const [rateLo, rateHi] = hotelRateLimits(hotel.kind as string)
  // Preview a new rate the same way the simulation will price it tomorrow.
  const previewOcc = hotelOccupancy(state, { ...hotel, rate }, Boolean(hotel.district))
  const preview = hotelNight({ ...hotel, rate }, previewOcc, hotel.district)
  const resized = draft.w !== hotel.size?.[0] || draft.h !== hotel.size?.[1] || draft.floors !== hotel.floors
  const draftFits = hotelOrientedFits(def, draft.w, draft.h)
  const draftSpec = hotelSpec(hotel.kind as string, [draft.w, draft.h], draft.floors, hotel.addons)!
  const resizeCost = hotelResizeCost(hotel, [draft.w, draft.h], draft.floors)
  const maxSide = Math.max(def.max[0], def.max[1])
  const minSide = Math.min(def.min[0], def.min[1])
  return <>
    {editing ? <form className="pk-chat-form" onSubmit={e => { e.preventDefault(); void set({ name }); setEditing(false) }}><input value={name} maxLength={32} onChange={e => setName(e.target.value)} aria-label="Hotel name" /><button className="pk-btn">Rename</button></form>
      : <p className="pk-hint">{def.name}{!readOnly && <> · <button className="pk-inline" onClick={() => { setName(hotel.name ?? ''); setEditing(true) }}>rename</button></>}{hotel.district ? ' · Resort district' : ''}</p>}
    <dl className="pk-dl">
      <dt>Size</dt><dd>{hotel.size?.[0]}×{hotel.size?.[1]} squares · {hotel.floors} {hotel.floors === 1 ? 'floor' : 'floors'}</dd>
      <dt>Rooms</dt><dd>{spec.rooms.toLocaleString()} · {occ}% booked</dd>
      <dt>Condition</dt><dd className={condition < 60 ? 'pk-neg' : ''}>{condition}%</dd>
      <dt>Extra guests</dt><dd>+{spec.guestBonus.toLocaleString()} to the park cap</dd>
      <dt>Value</dt><dd>{money(spec.cost)}</dd>
    </dl>

    {night && <>
      <p className="pk-label">Last night's books</p>
      <dl className="pk-dl">
        <dt>Room sales ({night.occupied.toLocaleString()} × {money(night.rate)})</dt><dd className="pk-pos">{money(night.rooms)}</dd>
        <dt>Amenities{hotel.district ? ' and resort fee' : ''}</dt><dd className="pk-pos">{money(night.amenities)}</dd>
        <dt>Staff</dt><dd className="pk-neg">−{money(night.staff)}</dd>
        <dt>Utilities</dt><dd className="pk-neg">−{money(night.utilities)}</dd>
        <dt>Building upkeep</dt><dd className="pk-neg">−{money(night.maintenance)}</dd>
        {night.amenityCosts > 0 && <><dt>Running amenities</dt><dd className="pk-neg">−{money(night.amenityCosts)}</dd></>}
        <dt><strong>Profit</strong></dt><dd className={tone(night.profit)}><strong>{signed(night.profit)}</strong></dd>
      </dl>
      <NightBars nights={nights} />
      <dl className="pk-dl">
        <dt>Total takings</dt><dd>{money(Math.round(hotel.revenue ?? 0))}</dd>
        <dt>Lifetime profit</dt><dd className={tone(hotel.profit ?? 0)}>{signed(Math.round(hotel.profit ?? 0))}</dd>
        <dt>Invested</dt><dd>{money(Math.round(invested))}</dd>
        <dt>Return</dt><dd className={tone(hotel.profit ?? 0)}>{invested ? `${Math.round((hotel.profit ?? 0) / invested * 1000) / 10}%` : '—'}</dd>
        <dt>Pays for itself in</dt><dd>{payback === null ? 'not at this rate' : payback === 0 ? 'paid off' : `about ${payback.toLocaleString()} days`}</dd>
      </dl>
    </>}

    {!readOnly && <>
      <p className="pk-label">Room rate</p>
      <div className="pk-row"><span>Per night</span>
        <button aria-label="Lower rate" disabled={rate <= rateLo} onClick={() => setRate(r => Math.max(rateLo, r - Math.max(1, Math.round(def.rate * 0.05))))}><Minus size={13} /></button>
        <strong>{money(rate)}</strong>
        <button aria-label="Raise rate" disabled={rate >= rateHi} onClick={() => setRate(r => Math.min(rateHi, r + Math.max(1, Math.round(def.rate * 0.05))))}><Plus size={13} /></button>
        {rate !== (hotel.rate ?? def.rate) && <button className="pk-btn on" onClick={() => void set({ rate })}>Set rate</button>}
      </div>
      {preview && <p className="pk-hint">At {money(rate)}: about {Math.round(previewOcc * 100)}% booked, {money(preview.income)} in, {signed(preview.profit)} profit a night. Going rate for this style is {money(def.rate)}; {Math.round(rateFactor(def, rate) * 100)}% of bookings kept.</p>}

      <p className="pk-label" id={`pk-service-${hotel.id}`}>Service level</p>
      <div className="pk-chips" role="radiogroup" aria-labelledby={`pk-service-${hotel.id}`}>{Object.entries(HOTEL_SERVICE).map(([id, s]) => {
        const on = (hotel.service ?? 'standard') === id
        return <button key={id} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => void set({ service: id })}>{s.name} · {money(Math.round(spec.rooms * def.upkeep * s.staff))}/day</button>
      })}</div>
      <p className="pk-hint">Premium staff cost more but fill more rooms, lift amenity spending and wear the building more slowly. Budget saves wages at the cost of bookings and faster wear.</p>

      <p className="pk-label">Condition</p>
      <div className="pk-row"><span>{condition}%</span><button disabled={refurb <= 0} onClick={() => void set({ refurbish: true })}><Wrench size={13} /> Refurbish{refurb > 0 ? ` · ${money(refurb)}` : ''}</button></div>
      <p className="pk-hint">Rooms wear a little every night. Below 80% guests start booking elsewhere.</p>

      <p className="pk-label">Resize</p>
      <div className="pk-size">
        <Stepper label="Width" value={draft.w} min={minSide} max={maxSide} onChange={w => setDraft(d => ({ ...d, w }))} />
        <Stepper label="Depth" value={draft.h} min={minSide} max={maxSide} onChange={h => setDraft(d => ({ ...d, h }))} />
        <Stepper label="Floors" value={draft.floors} min={def.floors[0]} max={def.floors[1]} onChange={floors => setDraft(d => ({ ...d, floors }))} />
      </div>
      {resized && (draftFits
        ? <div className="pk-row"><span>{draftSpec.rooms.toLocaleString()} rooms · {resizeCost >= 0 ? `costs ${money(resizeCost)}` : `refunds ${money(-resizeCost)}`}</span>
          <button className="pk-btn on" onClick={() => void run({ t: 'hotelResize', id: hotel.id, ...draft })}>Renovate</button>
          <button onClick={() => setDraft({ w: hotel.size?.[0] ?? 1, h: hotel.size?.[1] ?? 1, floors: hotel.floors ?? 1 })}>Reset</button></div>
        : <p className="pk-hint pk-neg">{def.name} can be {def.min.join('×')} to {def.max.join('×')} squares.</p>)}
      <p className="pk-hint">The north-west corner stays put. New squares must be your land, clear and level with the hotel. Growing costs the difference plus 15% for the works; shrinking refunds half.</p>

      <p className="pk-label">Colors</p>
      <div className="pk-ride-colors">
        {(['primary', 'secondary', 'trim'] as const).map(key => <label key={key} className="pk-field"><span>{key === 'primary' ? 'Walls' : key === 'secondary' ? 'Roof and accents' : 'Trim'}</span><input type="color" value={hex(colors[key])} onChange={e => void set({ [key]: Number.parseInt(e.target.value.slice(1), 16) })} /></label>)}
      </div>
      {def.roofs.length > 1 && <><p className="pk-label" id={`pk-roof-${hotel.id}`}>Roof</p>
        <div className="pk-chips" role="radiogroup" aria-labelledby={`pk-roof-${hotel.id}`}>{def.roofs.map(roof => <button key={roof} role="radio" aria-checked={hotel.roof === roof} className={hotel.roof === roof ? 'on' : ''} onClick={() => void set({ roof })}>{ROOF_NAMES[roof] ?? roof}</button>)}</div></>}
      <p className="pk-label">Building add-ons</p>
      <div className="pk-chips">{Object.entries(HOTEL_ADDONS).filter(([, a]) => !a.amenity).map(([id, addon]) => { const on = Boolean(hotel.addons?.[id]); return <button key={id} aria-pressed={on} className={on ? 'on' : ''} onClick={() => void set({ addon: id, on: !on })}>{addon.name}{on ? ' ✓' : ` · ${money(addon.cost)}`}</button> })}</div>
      <p className="pk-label">Amenities</p>
      <div className="pk-chips">{Object.entries(HOTEL_ADDONS).filter(([, a]) => a.amenity).map(([id, addon]) => {
        const on = Boolean(hotel.addons?.[id])
        const books = amenityBooks(addon, def, spec.rooms, spec.rooms * (hotel.occupancy ?? 0.5), hotel.rate ?? def.rate, HOTEL_SERVICE[hotel.service ?? 'standard'])
        const running = Math.round(books.cost), net = Math.round(books.income - books.cost)
        return <button key={id} aria-pressed={on} className={on ? 'on' : ''} title={`Guests spend about ${money(Math.round((books.perGuest ?? 0) * 100) / 100)} per booked room; ${money(running)} a day to run; about ${signed(net)} a night at today's bookings`} onClick={() => void set({ addon: id, on: !on })}>{addon.name}{on ? ` ✓ · ${signed(net)}/night` : ` · ${money(addonCost(id, hotel.kind as string, spec.rooms))} · ~${signed(net)}/night`}</button>
      })}</div>
      <p className="pk-hint">Amenities earn from every booked room and cost a fixed amount a day to run, so they pay best in big, busy hotels. Loud roller coasters within 6 squares cut occupancy; scenery, water rides and add-ons raise it.</p>
      <button className="pk-btn pk-danger" onClick={onDemolish}><Trash2 size={14} /> Demolish hotel</button>
    </>}
  </>
}
