import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

async function accountRequest(body: unknown) {
  const response = await fetch('/api/pool-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Sign-in is temporarily unavailable. Please try again shortly.')
  return result
}

export function PoolAccount({ username, ready, disabled, beforeChange, onFailure, actions, intro, className, heading }: { username: string | null; ready: boolean; disabled: boolean; beforeChange: () => Promise<void>; onFailure: () => void; actions?: ReactNode; intro?: string; className?: string; heading?: string }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy || disabled) return
    setBusy(true); setError('')
    try {
      await beforeChange()
      if (username) await accountRequest({ action: 'logout' })
      else await accountRequest({ action: 'login', username: name.trim(), password })
      setPassword('')
      window.location.reload()
    } catch (failure) {
      setPassword(''); setBusy(false); onFailure()
      setError(failure instanceof Error ? failure.message : 'Unable to connect. Try again.')
    }
  }

  return <section className={`pool-account${className ? ` ${className}` : ''}`} aria-label="Account" aria-busy={busy}>
    {intro ? <div>{username ? <h2>Welcome, {username}</h2> : <>{heading && <h2>{heading}</h2>}<p className="pool-account-intro">{intro}</p></>}</div> : <div><span className="section-eyebrow">YOUR ACCOUNT</span><h2>{username ? `Welcome, ${username}` : 'Your workspace, wherever you are.'}</h2><p>{username ? 'Your saved personalization follows your account.' : 'Enter any username and a password of 3 or more characters. A new username creates your account; an existing one signs you back in.'}</p></div>}
    {!ready ? <p role="status">Checking your account…</p> : username ? <div className="pool-account-actions">{actions}<button type="button" disabled={busy || disabled} onClick={() => void submit()}>{busy ? 'Signing out…' : 'Sign out'}</button></div> : <form onSubmit={event => void submit(event)}>
      <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={20} pattern="[a-zA-Z0-9_-]{3,20}" title="3–20 letters, numbers, underscores or hyphens" value={name} onChange={event => setName(event.target.value)} disabled={busy || disabled} required/></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" minLength={3} maxLength={128} title="3 or more characters" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || disabled} required/></label>
      <button type="submit" disabled={busy || disabled}>{busy ? 'Connecting…' : 'Continue'}</button>
      <small>Your password can be anything 3 characters or longer. There's no email and no recovery, so remember it. If you forget it, ask the administrator to reset it.</small>
    </form>}
    {error && <p className="pool-account-error" role="alert">{error}</p>}
  </section>
}
