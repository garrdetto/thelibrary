import { identityPassword } from '@/lib/account-password'
import { AuthError, login, logout } from '@netlify/identity'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

function getAuthStatus(error: AuthError): number | undefined {
  if (typeof error.status === 'number') return error.status
  const cause: unknown = error.cause
  if (typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number') return cause.status
  return undefined
}

export function PoolAccount({ username, ready, disabled, beforeChange, onFailure, actions, intro }: { username: string | null; ready: boolean; disabled: boolean; beforeChange: () => Promise<void>; onFailure: () => void; actions?: ReactNode; intro?: string }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy || disabled) return
    setBusy(true); setError('')
    let accountCreated = false
    try {
      await beforeChange()
      if (username) {
        await logout()
      } else {
        const status = await fetch('/api/pool-account')
        if (!status.ok) throw new Error('Accounts are being prepared. Please try again shortly.')
        const email = `${name.trim().toLowerCase()}@players.invalid`
        try {
          await login(email, identityPassword(password))
        } catch (failure) {
          if (!(failure instanceof AuthError) || ![400, 401].includes(getAuthStatus(failure) ?? 0)) throw failure
          const response = await fetch('/api/pool-account', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'connect', username: name, password }),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error ?? 'Unable to continue. Check your username and password.')
          accountCreated = true
          await login(email, identityPassword(password))
        }
      }
      setPassword('')
      window.location.reload()
    } catch (failure) {
      setPassword(''); setBusy(false); onFailure()
      if (accountCreated) { setError('Your account was created. Sign in with your username and password to continue.'); return }
      setError(failure instanceof AuthError ? getAuthStatus(failure) === 429 ? 'Too many attempts. Wait a minute and try again.' : [400, 401].includes(getAuthStatus(failure) ?? 0) ? 'Unable to sign in. Check your username and password, then try again.' : 'Sign-in is temporarily unavailable. Please try again shortly.' : failure instanceof Error ? failure.message : 'Unable to connect. Try again.')
    }
  }

  return <section className="pool-account" aria-label="Workspace account" aria-busy={busy}>
    {intro ? <div>{username ? <h2>Welcome, {username}</h2> : <p className="pool-account-intro">{intro}</p>}</div> : <div><span className="section-eyebrow">YOUR WORKSPACE ACCOUNT</span><h2>{username ? `Welcome, ${username}` : 'Your workspace, wherever you are.'}</h2><p>{username ? 'Your saved personalization follows your workspace account.' : 'Enter your username and password. New usernames create an account; existing usernames restore your saved settings.'}</p></div>}
    {!ready ? <p role="status">Verifying workspace clearance…</p> : username ? <div className="pool-account-actions">{actions}<button type="button" disabled={busy || disabled} onClick={() => void submit()}>{busy ? 'Signing out…' : 'Sign out'}</button></div> : <form onSubmit={event => void submit(event)}>
      <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={20} pattern="[a-zA-Z0-9_-]{3,20}" title="3–20 letters, numbers, underscores or hyphens" value={name} onChange={event => setName(event.target.value)} disabled={busy || disabled} required/></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" minLength={4} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy || disabled} required/></label>
      <button type="submit" disabled={busy || disabled}>{busy ? 'Connecting…' : 'Continue'}</button>
      <small>Use any password with 4 or more characters for your password. No email is collected, so keep your password safe: email recovery is unavailable. No verification is required.</small>
    </form>}
    {error && <p className="pool-account-error" role="alert">{error}</p>}
  </section>
}
