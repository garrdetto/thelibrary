export function NumberField({ id, label, hint, value, step = 1, min = 0, max, disabled, onChange }: { id: string; label: string; hint?: string; value: number; step?: number; min?: number; max?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="radar-field" htmlFor={id}>
    <span>{label}{hint && <small>{hint}</small>}</span>
    <input id={id} type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} disabled={disabled} onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}/>
  </label>
}

export function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="radar-toggle-row" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>
    <span>{label}{hint && <small>{hint}</small>}</span>
  </label>
}
