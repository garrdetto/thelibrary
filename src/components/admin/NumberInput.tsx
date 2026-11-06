import { useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes, KeyboardEvent } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number | 'any'
  integer?: boolean
}

const shown = (value: number) => Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : ''

/**
 * A number field you can type into freely: it keeps what you type, applies it as soon as it is a
 * valid number in range, and only clamps (or restores the last good value) when you leave the field
 * or press Enter. Focusing selects the whole number so typing replaces it.
 */
export function NumberInput({ value, onChange, min = -Infinity, max = Infinity, step, integer, onBlur, onFocus, onKeyDown, ...rest }: Props) {
  const [text, setText] = useState(shown(value))
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) { setText(shown(value)); return }
    setText(current => { const n = Number(current); return current.trim() !== '' && Number.isFinite(n) && Math.abs(n - value) < 1e-9 ? current : shown(value) })
  }, [value])

  const fit = (n: number) => { const clamped = Math.min(max, Math.max(min, n)); return integer ? Math.round(clamped) : clamped }

  function commit() {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) { setText(shown(value)); return }
    const next = fit(n)
    setText(shown(next))
    if (next !== value) onChange(next)
  }

  return <input
    {...rest}
    type="number"
    inputMode={integer ? 'numeric' : 'decimal'}
    min={Number.isFinite(min) ? min : undefined}
    max={Number.isFinite(max) ? max : undefined}
    step={step ?? (integer ? 1 : 'any')}
    value={text}
    onFocus={event => { editing.current = true; event.currentTarget.select(); onFocus?.(event) }}
    onChange={event => {
      const raw = event.target.value
      setText(raw)
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n) || n < min || n > max) return
      if (integer && !Number.isInteger(n)) return
      if (n !== value) onChange(n)
    }}
    onBlur={event => { editing.current = false; commit(); onBlur?.(event) }}
    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); commit() } onKeyDown?.(event) }}
  />
}
