import { useState } from 'react'
import type { FormEvent } from 'react'
import { LoaderCircle, RotateCcw, UserRound } from 'lucide-react'

const ENDPOINT = '/api/rackreel?game=foxlake'

type Result = { reset?: boolean; message?: string; error?: string }

async function resetCharacter(username?: string): Promise<Result> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(username ? { action: 'reset-character', username } : { action: 'reset-character' }),
  })
  let body: Result = {}
  try { body = await response.json() as Result } catch { body = {} }
  if (!response.ok) return { error: body.error ?? 'Something went wrong. Please try again.' }
  return body
}

export default function ResetCharacter() {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState<'me' | 'other' | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const name = username.trim().toLowerCase()
  const valid = /^[a-z0-9_-]{3,20}$/.test(name)

  async function run(who: 'me' | 'other') {
    const label = who === 'me' ? 'your own' : `${name}'s`
    if (!window.confirm(`Reset ${label} Life Sim character? Face, hair and build go back to the defaults and the character creator opens on the next Head out. Cash, gear and clothes are kept.`)) return
    setBusy(who)
    setStatus('')
    setError('')
    const result = await resetCharacter(who === 'me' ? undefined : name)
    setBusy(null)
    if (result.error) setError(result.error)
    else {
      setStatus(result.message ?? 'Done.')
      if (who === 'other' && result.reset) setUsername('')
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (valid && !busy) void run('other')
  }

  return <div className="lsr">
    <p className="adm-help">Resetting a character sends that player back to the character creator the next time they press Head out in Life Sim, so they can pick a new face, hair, build and starting outfit. Their cash, owned gear and clothes, stats and tasks stay as they are. Anyone playing at the moment sees the creator after reloading the page.</p>
    <section className="adm-card">
      <div className="adm-card-head"><h3>Your character</h3></div>
      <button type="button" className="adm-btn adm-btn-primary" disabled={busy !== null} onClick={() => void run('me')}>
        {busy === 'me' ? <LoaderCircle className="spin" size={16} aria-hidden/> : <RotateCcw size={16} aria-hidden/>} Reset my character
      </button>
    </section>
    <section className="adm-card">
      <div className="adm-card-head"><h3>Another player</h3></div>
      <form className="lsr-form" onSubmit={submit}>
        <label className="adm-search">
          <UserRound size={16} aria-hidden/>
          <span className="adm-sr">Username</span>
          <input type="text" value={username} onChange={event => setUsername(event.target.value)} placeholder="Username" autoComplete="off" spellCheck={false} maxLength={20}/>
        </label>
        <button type="submit" className="adm-btn" disabled={!valid || busy !== null}>
          {busy === 'other' ? <LoaderCircle className="spin" size={16} aria-hidden/> : <RotateCcw size={16} aria-hidden/>} Reset character
        </button>
      </form>
    </section>
    <p className="lsr-status" role="status" aria-live="polite">{status}</p>
    {error && <p className="adm-error" role="alert">{error}</p>}
  </div>
}
