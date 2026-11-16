import { useId } from 'react'
import type { ReactNode } from 'react'

export function Num({ label, value, onChange, min, max, step = 0.1, unit, slider = true, log = false, hint }: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  slider?: boolean
  log?: boolean
  hint?: string
}) {
  const id = useId()
  const toSlider = (v: number) => (log ? Math.log(Math.max(min, v) / min) / Math.log(max / min) : (v - min) / (max - min))
  const fromSlider = (t: number) => (log ? min * Math.pow(max / min, t) : min + t * (max - min))
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const snap = (v: number) => Math.round(v / step) * step
  return <div className="we-field">
    <label htmlFor={id}>{label}{hint && <small>{hint}</small>}</label>
    <div className="we-num">
      {slider && <input type="range" aria-label={`${label} slider`} min={0} max={1000} value={Math.round(toSlider(value) * 1000)} onChange={(e) => onChange(clamp(Number(snap(fromSlider(Number(e.target.value) / 1000)).toFixed(4))))} />}
      <input id={id} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(clamp(v)) }} />
      {unit && <span className="we-unit">{unit}</span>}
    </div>
  </div>
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return <label className="we-check">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}{hint && <small>{hint}</small>}</span>
  </label>
}

export function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  return <div className="we-field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={String(value)} onChange={(e) => {
      const hit = options.find((o) => String(o.value) === e.target.value)
      if (hit) onChange(hit.value)
    }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  </div>
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="we-field">
    <span className="we-label">{label}</span>
    <div className="we-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  </div>
}

export function Text({ label, value, onChange, placeholder, max = 60 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number }) {
  const id = useId()
  return <div className="we-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </div>
}

export function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return <div className="we-field">
    <label htmlFor={id}>{label}</label>
    <div className="we-num"><input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} /><code>{value}</code></div>
  </div>
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="we-section">
    <header><h3>{title}</h3>{actions}</header>
    {children}
  </section>
}
