import { useEffect, useRef, useState } from 'react'
import { PRESETS, ROLES, ROLE_NAMES, colorsFromRoles, parkSchemes, rideColors, rideSlots, slotDefault } from '../../../server/park/index.mjs'
import type { ColorRole, ColorScheme, Entity, Park } from '../../../server/park/index.mjs'

type Run = (cmd: { t: string; [k: string]: unknown }, success?: string) => Promise<{ ok: boolean }>

function useThrottledRun(run: Run, delay = 120) {
  const pending = useRef(new Map<string, { cmd: { t: string; [k: string]: unknown }; timer: ReturnType<typeof setTimeout> }>())
  useEffect(() => () => { for (const p of pending.current.values()) { clearTimeout(p.timer); void run(p.cmd) } pending.current.clear() }, [run])
  return (key: string, cmd: { t: string; [k: string]: unknown }) => {
    const map = pending.current, old = map.get(key)
    if (old) clearTimeout(old.timer)
    map.set(key, { cmd, timer: setTimeout(() => { const next = map.get(key); map.delete(key); if (next) void run(next.cmd) }, delay) })
  }
}

/** Every recolorable part of a ride at once, with a combo picker for presets and the park's schemes. */
export function RideColors({ ride, park, run }: { ride: Entity; park: Park | undefined; run: Run }) {
  const slots = rideSlots(ride)
  const resolved = rideColors(ride, park)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const send = useThrottledRun(run)
  useEffect(() => setDraft({}), [ride.id, ride.scheme, JSON.stringify(ride.colors ?? null)])
  const schemes = parkSchemes(park)
  const value = Number.isInteger(ride.scheme) ? `scheme:${ride.scheme}` : 'custom'
  const choose = (next: string) => {
    if (next.startsWith('scheme:')) void run({ t: 'rideSet', id: ride.id, scheme: Number(next.slice(7)), colors: null })
    else if (next.startsWith('preset:')) void run({ t: 'rideSet', id: ride.id, scheme: null, colors: colorsFromRoles(ride, PRESETS[Number(next.slice(7))].colors) })
    else if (next === 'defaults') void run({ t: 'rideSet', id: ride.id, scheme: null, colors: Object.fromEntries(slots.map(s => [s.key, slotDefault(ride, s)])) })
  }
  return <div className="pk-colorpanel">
    <label className="pk-combo"><span>Color combo</span>
      <select value={value} onChange={event => choose(event.target.value)}>
        <option value="custom">{ride.colors || ride.color ? 'Custom colors' : 'Ride defaults'}</option>
        <optgroup label="Park color schemes">{schemes.map((s, i) => <option key={i} value={`scheme:${i}`}>{s.name}</option>)}</optgroup>
        <optgroup label="Presets">{PRESETS.map((p, i) => <option key={p.name} value={`preset:${i}`}>{p.name}</option>)}<option value="defaults">Ride defaults</option></optgroup>
      </select>
    </label>
    <div className="pk-slots">{slots.map((s, i) => {
      const color = draft[s.key] ?? resolved[i]
      return <label key={s.key} className={`pk-slot ${s.key === 'lights' || s.key === 'glow' ? 'pk-slot-light' : ''}`} title={s.name}>
        <input type="color" value={color} aria-label={s.name} onChange={event => { const v = event.target.value; setDraft(d => ({ ...d, [s.key]: v })); send(s.key, { t: 'rideSet', id: ride.id, colors: { [s.key]: v } }) }} />
        <span>{s.name}</span>
      </label>
    })}</div>
  </div>
}

/** The park's three named color schemes, editable in place. */
export function SchemeEditor({ park, run, readOnly }: { park: Park; run: Run; readOnly: boolean }) {
  const schemes = parkSchemes(park)
  const send = useThrottledRun(run)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [names, setNames] = useState<string[]>(schemes.map(s => s.name))
  useEffect(() => { setDraft({}); setNames(parkSchemes(park).map(s => s.name)) }, [JSON.stringify(park.schemes ?? null)])
  return <div className="pk-schemes">{schemes.map((scheme: ColorScheme, index) => <div key={index} className="pk-scheme">
    <input className="pk-scheme-name" value={names[index] ?? scheme.name} maxLength={24} disabled={readOnly} aria-label={`Scheme ${index + 1} name`}
      onChange={event => setNames(n => n.map((v, i) => i === index ? event.target.value : v))}
      onBlur={() => { const name = (names[index] ?? '').trim(); if (name && name !== scheme.name) void run({ t: 'park', scheme: { index, name } }) }} />
    <div className="pk-scheme-roles">{ROLES.map((role: ColorRole) => {
      const k = `${index}:${role}`
      return <label key={role} title={ROLE_NAMES[role]}><input type="color" disabled={readOnly} value={draft[k] ?? scheme.colors[role]} aria-label={`${scheme.name} ${ROLE_NAMES[role]}`}
        onChange={event => { const v = event.target.value; setDraft(d => ({ ...d, [k]: v })); send(k, { t: 'park', scheme: { index, colors: { [role]: v } } }) }} /><span>{ROLE_NAMES[role]}</span></label>
    })}</div>
  </div>)}</div>
}
