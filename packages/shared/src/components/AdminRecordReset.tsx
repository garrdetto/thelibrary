import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

export type RecordResetTarget = {
  key: string
  label: string
  description: string
  reset: () => Promise<void>
}

type Registry = {
  target: RecordResetTarget | null
  register: (owner: symbol, target: RecordResetTarget | null) => void
}

const RecordResetContext = createContext<Registry | null>(null)

export function RecordResetProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ owner: symbol; target: RecordResetTarget } | null>(null)
  const register = useRef((owner: symbol, target: RecordResetTarget | null) => {
    setEntry(current => target ? { owner, target } : current?.owner === owner ? null : current)
  }).current
  return <RecordResetContext.Provider value={{ target: entry?.target ?? null, register }}>{children}</RecordResetContext.Provider>
}

export function useRecordResetTarget(target: RecordResetTarget | null) {
  const registry = useContext(RecordResetContext)
  const owner = useRef(Symbol('record-board')).current
  const resetRef = useRef(target?.reset)
  resetRef.current = target?.reset
  const key = target?.key ?? '', label = target?.label ?? '', description = target?.description ?? ''
  const active = Boolean(target)
  useEffect(() => {
    if (!registry) return
    registry.register(owner, active ? { key, label, description, reset: () => resetRef.current?.() ?? Promise.resolve() } : null)
  }, [registry?.register, owner, active, key, label, description])
  useEffect(() => () => registry?.register(owner, null), [registry?.register, owner])
}

export function AdminRecordResetButton({ isAdmin }: { isAdmin: boolean }) {
  const registry = useContext(RecordResetContext)
  const target = registry?.target ?? null
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('')
  useEffect(() => { setDone(''); setError('') }, [target?.key])
  if (!isAdmin || !target) return null
  async function confirm() {
    if (!target || busy) return
    setBusy(true); setError('')
    try {
      await target.reset()
      setDone(`${target.label} cleared.`)
      dialog.current?.close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The records could not be reset. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return <footer className="admin-record-reset">
    {done && <span role="status">{done}</span>}
    <button type="button" onClick={() => { setError(''); dialog.current?.showModal() }}><RotateCcw size={14}/> Reset {target.label}</button>
    <dialog ref={dialog} className="admin-reset-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { if (busy) event.preventDefault() }}>
      <h2 id={`${id}-title`}>Reset {target.label}?</h2>
      <p id={`${id}-description`}>{target.description} This cannot be undone.</p>
      {error && <p className="admin-reset-error" role="alert">{error}</p>}
      <div className="admin-reset-actions">
        <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => void confirm()} autoFocus>{busy ? 'Clearing…' : 'Clear records'}</button>
      </div>
    </dialog>
  </footer>
}

export async function postReset(url: string, method: 'POST' | 'DELETE', body: Record<string, unknown>) {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'The records could not be reset. Try again.')
}
