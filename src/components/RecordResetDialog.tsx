import { useId, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

export function RecordResetDialog({ buttonLabel, title, description, confirmLabel, disabled = false, onReset }: { buttonLabel: string; title: string; description: string; confirmLabel: string; disabled?: boolean; onReset: (password: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [resetting, setResetting] = useState(false)
  async function submit() {
    if (resetting) return
    setResetting(true); setError('')
    try { await onReset(password); dialog.current?.close() } catch (failure) { setError((failure as Error).message) } finally { setResetting(false); setPassword('') }
  }
  return <>
    <footer className="race-reset-footer"><button type="button" className="race-reset-button" disabled={disabled} onClick={() => { setPassword(''); setError(''); dialog.current?.showModal() }}><RotateCcw size={14}/> {buttonLabel}</button></footer>
    <dialog ref={dialog} className="race-ready-dialog race-reset-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { if (resetting) event.preventDefault() }} onClose={() => { setPassword(''); setError('') }}>
      <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p>
      <form onSubmit={event => { event.preventDefault(); void submit() }} aria-busy={resetting}>
        <label htmlFor={`${id}-password`}>Reset password</label><input id={`${id}-password`} type="password" autoComplete="off" autoFocus required maxLength={128} value={password} disabled={resetting} onChange={event => setPassword(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}/>
        {error && <p id={`${id}-error`} className="race-error" role="alert">{error}</p>}
        <div className="race-reset-actions"><button type="button" disabled={resetting} onClick={() => dialog.current?.close()}>Cancel</button><button className="race-primary" type="submit" disabled={resetting || !password}>{resetting ? 'Clearing records…' : confirmLabel}</button></div>
      </form>
    </dialog>
  </>
}
