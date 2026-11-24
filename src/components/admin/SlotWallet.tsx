import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

const QUICK_AMOUNTS = [100, 500, 1000, 5000]
const money = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  return cents >= 1 && cents <= 100_000_000 ? cents : null
}

export function SlotWallet({ userId, username }: { userId: string; username: string }) {
  const [balance, setBalance] = useState<number | null>(null)
  const [canChange, setCanChange] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/slot-wallet?id=${encodeURIComponent(userId)}`, { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error ?? 'The balance is unavailable right now.')
        if (active) { setBalance(result.balance); setCanChange(Boolean(result.canChange)) }
      })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'The balance is unavailable right now.') })
    return () => { active = false }
  }, [userId])

  async function add(cents: number | null) {
    setNotice('')
    if (cents === null) { setError('Enter an amount from $0.01 to $1,000,000.'); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/slot-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', id: userId, cents }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? 'The money could not be added.')
      setBalance(result.balance)
      setAmount('')
      setNotice(`Added ${money(cents)} to ${username}.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The money could not be added.')
    } finally {
      setBusy(false)
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!busy) void add(parseDollars(amount))
  }

  return <div className="adm-wallet">
    <p className="adm-wallet-balance" role="status">{balance === null ? (error ? '' : 'Loading balance…') : <>Balance <strong>{money(balance)}</strong></>}</p>
    {balance !== null && canChange && <>
      <div className="adm-wallet-quick" role="group" aria-label="Quick add">
        {QUICK_AMOUNTS.map(dollars => <button key={dollars} type="button" className="adm-btn" disabled={busy} onClick={() => add(dollars * 100)}>+{money(dollars * 100).replace(/\.00$/, '')}</button>)}
      </div>
      <div className="adm-wallet-custom">
        <label className="adm-field">Other amount ($)<input inputMode="decimal" placeholder="250.00" value={amount} disabled={busy} onKeyDown={onKey} onChange={event => setAmount(event.target.value)}/></label>
        <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !amount.trim()} onClick={() => add(parseDollars(amount))}>{busy ? 'Adding…' : 'Add money'}</button>
      </div>
    </>}
    {balance !== null && !canChange && <p className="adm-muted">Only the owner can change another administrator’s balance.</p>}
    {notice && <p className="adm-muted" role="status">{notice} If they have a slot machine open, it shows the new balance after their next spin or a reload.</p>}
    {error && <p role="alert" className="adm-error">{error}</p>}
  </div>
}
