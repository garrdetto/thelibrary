import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'

type Account = { id: string; username: string; pages: string[]; isAdmin: boolean; needsPassword: boolean; originalUsername: string }
type Filter = 'all' | 'studio' | 'reset'
const filters: { id: Filter; label: string }[] = [{ id: 'all', label: 'Everyone' }, { id: 'studio', label: 'Studio access' }, { id: 'reset', label: 'Password reset pending' }]
const pages = [{ id: 'chat', label: 'AI chat' }, { id: 'image', label: 'Image studio' }, { id: 'lyrics', label: 'Lyric studio' }]

async function adminRequest(body: unknown) {
  const response = await fetch('/api/workspace-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Account management is temporarily unavailable.')
}

export function WorkspaceAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return accounts.filter(account => (!needle || account.originalUsername.toLowerCase().includes(needle))
      && (filter === 'all' || filter === 'studio' && !account.isAdmin && account.pages.length > 0 || filter === 'reset' && account.needsPassword))
  }, [accounts, query, filter])
  const counts: Record<Filter, number> = { all: accounts.length, studio: accounts.filter(account => !account.isAdmin && account.pages.length > 0).length, reset: accounts.filter(account => account.needsPassword).length }
  async function load() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/workspace-admin')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setAccounts(result.users.map((account: Account) => ({ ...account, originalUsername: account.username })))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load accounts.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  function change(id: string, values: Partial<Account>) {
    setAccounts(current => current.map(account => account.id === id ? { ...account, ...values } : account))
  }
  async function run(account: Account, body: unknown, done: string, reload = false) {
    setBusy(account.id); setError(''); setNotice('')
    try {
      await adminRequest(body)
      setNotice(done)
      if (reload) await load()
      else change(account.id, { originalUsername: account.username })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save account.') }
    finally { setBusy(null) }
  }
  function resetPassword(account: Account) {
    if (!window.confirm(`Reset the password for ${account.originalUsername}? They'll be signed out, and the next password they sign in with becomes their new password.`)) return
    void run(account, { action: 'reset-password', id: account.id }, `Password reset for ${account.originalUsername}.`, true)
  }
  function remove(account: Account) {
    if (!window.confirm(`Delete ${account.originalUsername} and all of their saved settings, records and creations? This can't be undone.`)) return
    void run(account, { action: 'delete', id: account.id }, `Deleted ${account.originalUsername}.`, true)
  }
  return <section className="account-home adm-people">
    <div className="adm-toolbar">
      <label className="adm-search"><Search size={16} aria-hidden/><span className="adm-sr">Search accounts</span><input type="search" value={query} placeholder="Search by username" onChange={event => setQuery(event.target.value)}/></label>
      <div className="adm-segment" role="group" aria-label="Show accounts">
        {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label} <span>{counts[item.id]}</span></button>)}
      </div>
    </div>
    <p className="adm-help">Pool and Racing are open to everyone with an account. Studio pages need a grant here.</p>
    {loading && <p role="status">Loading accounts…</p>}
    {error && <p role="alert" className="pool-account-error">{error} <button onClick={() => void load()}>Reload accounts</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !accounts.length && !error && <p>No accounts yet.</p>}
    {!loading && accounts.length > 0 && !shown.length && <p className="adm-empty">No accounts match. <button type="button" className="adm-link" onClick={() => { setQuery(''); setFilter('all') }}>Clear search</button></p>}
    <div className="admin-accounts">{shown.map(account => <form key={account.id} className="admin-account" onSubmit={event => { event.preventDefault(); void run(account, { action: 'update', id: account.id, username: account.username, pages: account.pages }, `Saved changes for ${account.username}.`) }}>
      <label>Username<input aria-label={`Username for ${account.originalUsername}`} value={account.username} minLength={3} maxLength={20} pattern="[a-zA-Z0-9_-]{3,20}" required disabled={account.isAdmin || busy !== null} onChange={event => change(account.id, { username: event.target.value })}/></label>
      <fieldset disabled={account.isAdmin || busy !== null}><legend>Studio access</legend>{pages.map(page => <label key={page.id}><input type="checkbox" checked={account.pages.includes(page.id)} onChange={event => change(account.id, { pages: event.target.checked ? [...account.pages, page.id] : account.pages.filter(id => id !== page.id) })}/>{page.label}</label>)}</fieldset>
      {account.isAdmin ? <strong>Administrator · all pages</strong> : <div className="admin-account-actions">
        {account.needsPassword && <small>Password reset — waiting for next sign-in</small>}
        <button disabled={busy !== null} type="submit">{busy === account.id ? 'Saving…' : 'Save changes'}</button>
        <button disabled={busy !== null} type="button" onClick={() => resetPassword(account)}>Reset password</button>
        <button disabled={busy !== null} type="button" onClick={() => remove(account)}>Delete</button>
      </div>}
    </form>)}</div>
  </section>
}
