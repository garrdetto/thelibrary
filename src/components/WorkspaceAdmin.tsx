import { useEffect, useState } from 'react'

type Account = { id: string; username: string; pages: string[]; isAdmin: boolean; originalUsername: string }
const pages = [{ id: 'chat', label: 'AI chat' }, { id: 'image', label: 'Image studio' }, { id: 'lyrics', label: 'Lyric studio' }]

export function WorkspaceAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
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
  async function save(account: Account) {
    setBusy(account.id); setError(''); setNotice('')
    try {
      const response = await fetch('/api/workspace-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: account.id, username: account.username, pages: account.pages }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setNotice(`Saved access for ${account.username}.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save account.') }
    finally { setBusy(null) }
  }
  return <section className="account-home"><span className="section-eyebrow">WORKSPACE ADMINISTRATION</span><h1>People & permissions</h1><p>Choose who can use each studio. Pool and Racing are visible to everyone. Passwords are private and are never displayed here.</p>
    {loading && <p role="status">Loading accounts…</p>}
    {error && <p role="alert" className="pool-account-error">{error} <button onClick={() => void load()}>Reload accounts</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !accounts.length && !error && <p>No accounts yet.</p>}
    <div className="admin-accounts">{accounts.map(account => <form key={account.id} className="admin-account" onSubmit={event => { event.preventDefault(); void save(account) }}>
      <label>Username<input aria-label={`Username for ${account.username}`} value={account.username} minLength={3} maxLength={20} pattern="[a-zA-Z0-9_-]{3,20}" required disabled={account.isAdmin || busy !== null || account.originalUsername === 'test'} onChange={event => change(account.id, { username: event.target.value })}/></label>
      <fieldset disabled={account.isAdmin || busy !== null}><legend>Studio access</legend>{pages.map(page => <label key={page.id}><input type="checkbox" checked={account.pages.includes(page.id)} onChange={event => change(account.id, { pages: event.target.checked ? [...account.pages, page.id] : account.pages.filter(id => id !== page.id) })}/>{page.label}</label>)}</fieldset>
      {account.isAdmin ? <strong>Administrator · all pages</strong> : <button disabled={busy !== null} type="submit">{busy === account.id ? 'Saving…' : 'Save changes'}</button>}
    </form>)}</div>
  </section>
}
