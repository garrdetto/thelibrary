import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, Cloud, KeyRound, LoaderCircle, Lock, Trophy, Users } from 'lucide-react'

const highlights = [
  { icon: Trophy, title: 'Your records, kept', text: 'Scores, saves and settings follow your account on any device.' },
  { icon: Users, title: 'Learn together', text: 'Chat, see who is online and join live sessions with friends.' },
  { icon: Cloud, title: 'Nothing to install', text: 'Every module runs right in your browser.' },
]

export function SignInGate({ brand }: { brand: ReactNode }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/pool-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: name.trim(), password, ...(accessCode.trim() ? { accessCode: accessCode.trim() } : {}) }) })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Sign-in is temporarily unavailable. Please try again shortly.')
      window.location.reload()
    } catch (failure) {
      setPassword(''); setBusy(false)
      setError(failure instanceof Error ? failure.message : 'Unable to connect. Try again.')
    }
  }

  return <main className="signin-gate">
    <div className="signin-gate-card">
      <section className="signin-gate-intro">
        <div className="signin-gate-brand">{brand}<span><span className="brand-name"><em>the</em>library</span><small>LEARNING MODULES</small></span></div>
        <h1>Welcome to <em>the library.</em></h1>
        <p>Hands-on learning modules in strategy, physics, math and precision. Create a free account or sign in to continue.</p>
        <ul>
          {highlights.map(({ icon: Icon, title, text }) => <li key={title}><span aria-hidden="true"><Icon size={17}/></span><div><strong>{title}</strong><small>{text}</small></div></li>)}
        </ul>
      </section>
      <section className="signin-gate-form" aria-labelledby="signin-gate-title">
        <h2 id="signin-gate-title">Sign in or create an account</h2>
        <p>Choose any username. A new username creates your account with the access code; an existing one signs you back in.</p>
        <form onSubmit={event => void submit(event)} aria-busy={busy}>
          <label>Username<input name="username" autoComplete="username" autoFocus minLength={3} maxLength={20} pattern="[a-zA-Z0-9_\-]{3,20}" title="3–20 letters, numbers, underscores or hyphens" value={name} onChange={event => setName(event.target.value)} disabled={busy} required/></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" minLength={3} maxLength={128} title="3 or more characters" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required/></label>
          <label><span className="signin-gate-label">Access code <small>Needed to create a new account</small></span><span className="signin-gate-code"><KeyRound size={15} aria-hidden="true"/><input name="access-code" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={64} value={accessCode} onChange={event => setAccessCode(event.target.value)} disabled={busy}/></span></label>
          <button type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17}/> Signing in…</> : <>Continue <ArrowRight size={17}/></>}</button>
          {error && <p className="signin-gate-error" role="alert">{error}</p>}
        </form>
        <small className="signin-gate-note"><Lock size={12} aria-hidden="true"/> Usernames are 3–20 letters, numbers, _ or -. Passwords need 3 or more characters. There's no email or recovery, so keep your password safe; the administrator can reset it if you forget.</small>
      </section>
    </div>
  </main>
}
