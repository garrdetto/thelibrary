import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { PersonAccess } from './admin/PersonAccess'
import type { Account } from './admin/PersonAccess'
import { MUSIC_GRANT, moduleGrants } from '@/lib/access'
import { MUSIC_ACCESS_EVENT } from '@/lib/music'

type Filter = 'all' | 'admins' | 'extra' | 'music' | 'reset'
const filters: { id: Filter; label: string }[] = [{ id: 'all', label: 'Everyone' }, { id: 'admins', label: 'Administrators' }, { id: 'extra', label: 'Extra access' }, { id: 'music', label: 'Music on' }, { id: 'reset', label: 'Password reset pending' }]

async function adminRequest(body: unknown) {
  const response = await fetch('/api/workspace-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Account management is temporarily unavailable.')
}

const hasExtra = (account: Account) => !account.isAdmin && (account.pages.length > 0 || account.grants.length > 0) || account.radar && !account.isOwner

function badges(account: Account) {
  const list: string[] = []
  if (account.isOwner) list.push('Owner')
  else if (account.isAdmin) list.push('Administrator')
  if (!account.isAdmin && account.pages.length) list.push(`${account.pages.length} studio${account.pages.length === 1 ? '' : 's'}`)
  if (account.grants.includes(MUSIC_GRANT)) list.push('Music')
  if (account.radar) list.push('Axiom Radar')
  const modules = moduleGrants(account.grants).length
  if (modules) list.push(`${modules} hidden module${modules === 1 ? '' : 's'}`)
  if (account.needsPassword) list.push('Reset pending')
  return list
}

export function WorkspaceAdmin({ person = null, onPerson }: { person?: string | null; onPerson?: (id: string | null) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [viewerIsOwner, setViewerIsOwner] = useState(false)
  const [localPerson, setLocalPerson] = useState<string | null>(person)
  useEffect(() => { setLocalPerson(person) }, [person])
  const selected = accounts.find(account => account.id === localPerson) ?? null

  function choose(id: string | null) {
    setLocalPerson(id); setNotice(''); setError('')
    onPerson?.(id)
    requestAnimationFrame(() => document.querySelector('.adm-main')?.scrollIntoView({ block: 'start' }))
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return accounts.filter(account => (!needle || account.username.toLowerCase().includes(needle))
      && (filter === 'all' || filter === 'admins' && account.isAdmin || filter === 'extra' && hasExtra(account) || filter === 'music' && account.grants.includes(MUSIC_GRANT) || filter === 'reset' && account.needsPassword))
  }, [accounts, query, filter])
  const counts: Record<Filter, number> = {
    all: accounts.length,
    admins: accounts.filter(account => account.isAdmin).length,
    extra: accounts.filter(hasExtra).length,
    music: accounts.filter(account => account.grants.includes(MUSIC_GRANT)).length,
    reset: accounts.filter(account => account.needsPassword).length,
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/workspace-admin')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setAccounts(result.users.map((account: Account) => ({ ...account, grants: account.grants ?? [] })))
      setViewerIsOwner(result.viewerIsOwner === true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load accounts.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function run(body: unknown, done: string, after?: () => void) {
    setBusy(true); setError(''); setNotice('')
    try {
      await adminRequest(body)
      after?.()
      await load()
      setNotice(done)
      window.dispatchEvent(new Event(MUSIC_ACCESS_EVENT))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save account.') }
    finally { setBusy(false) }
  }

  if (selected) return <section className="account-home adm-people">
    {error && <p role="alert" className="adm-error">{error}</p>}
    {notice && <p role="status" className="adm-notice">{notice}</p>}
    <PersonAccess key={`${selected.id}:${selected.username}:${selected.isAdmin}:${[...selected.pages, ...selected.grants].join(',')}`} account={selected} viewerIsOwner={viewerIsOwner} busy={busy} onBack={() => choose(null)}
      onSave={(username, grants) => run({ action: 'update', id: selected.id, username, pages: grants }, selected.isOwner && username !== selected.username ? `Saved. Sign in as ${username} from now on, with the same owner password.` : `Saved ${username}'s access.`)}
      onSetAdmin={admin => {
        const message = admin ? `Make ${selected.username} an administrator? They'll get the full admin console, every studio page and site changes.` : `Remove administrator access from ${selected.username}?`
        if (window.confirm(message)) void run({ action: 'set-admin', id: selected.id, admin }, admin ? `${selected.username} is now an administrator.` : `${selected.username} is no longer an administrator.`)
      }}
      onResetPassword={() => {
        if (window.confirm(`Reset the password for ${selected.username}? They'll be signed out, and the next password they sign in with becomes their new password.`)) void run({ action: 'reset-password', id: selected.id }, `Password reset for ${selected.username}.`)
      }}
      onDelete={() => {
        if (window.confirm(`Delete ${selected.username} and all of their saved settings, records and creations? This can't be undone.`)) void run({ action: 'delete', id: selected.id }, `Deleted ${selected.username}.`, () => choose(null))
      }}/>
  </section>

  return <section className="account-home adm-people">
    <div className="adm-toolbar">
      <label className="adm-search"><Search size={16} aria-hidden/><span className="adm-sr">Search accounts</span><input type="search" value={query} placeholder="Search by username" onChange={event => setQuery(event.target.value)}/></label>
      <div className="adm-segment" role="group" aria-label="Show accounts">
        {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label} <span>{counts[item.id]}</span></button>)}
      </div>
    </div>
    <p className="adm-help">Pool, Racing and the visible modules are open to everyone with an account. Click a person to give them studios, the music player, Axiom Radar or hidden modules.{viewerIsOwner ? ' As the owner you can also make other accounts administrators.' : ' Only the owner can change administrators or share Axiom Radar.'}</p>
    {loading && !accounts.length && <p role="status">Loading accounts…</p>}
    {error && <p role="alert" className="adm-error">{error} <button type="button" className="adm-link" onClick={() => void load()}>Reload accounts</button></p>}
    {notice && <p role="status" className="adm-notice">{notice}</p>}
    {!loading && !accounts.length && !error && <p className="adm-empty">No accounts yet.</p>}
    {!loading && accounts.length > 0 && !shown.length && <p className="adm-empty">No accounts match. <button type="button" className="adm-link" onClick={() => { setQuery(''); setFilter('all') }}>Clear search</button></p>}
    {shown.length > 0 && <ul className="adm-person-list">{shown.map(account => <li key={account.id}>
      <button type="button" className="adm-person-row" onClick={() => choose(account.id)}>
        <span className="adm-person-avatar" aria-hidden>{account.username.slice(0, 1).toUpperCase()}</span>
        <span className="adm-person-name"><strong>{account.username}</strong><small>Joined {new Date(account.createdAt).toLocaleDateString()}</small></span>
        <span className="adm-person-badges">{badges(account).map(label => <i key={label}>{label}</i>)}</span>
        <ChevronRight size={18} aria-hidden/>
      </button>
    </li>)}</ul>}
  </section>
}
