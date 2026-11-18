'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { SolanaBotClient } from './solana-bot-client.js'
import type { BotEvent, BotMode, BotStatus, StreamStatus } from './solana-bot-client.js'

const PASSWORD_KEY = 'axiomBot.password'
const MAX_EVENTS = 200

const ui: Record<string, CSSProperties> = {
  shell: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#0b1018', color: '#e2e8f0', borderRadius: 16, border: '1px solid #1e293b', padding: 16, display: 'grid', gap: 14 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  input: { background: '#020617', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', font: 'inherit', minWidth: 0 },
  button: { border: 0, borderRadius: 10, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' },
  feed: { listStyle: 'none', margin: 0, padding: 0, maxHeight: 360, overflowY: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 },
  item: { display: 'grid', gridTemplateColumns: '72px 90px 1fr 60px', gap: 10, padding: '6px 4px', borderBottom: '1px solid #1e293b' },
  muted: { color: '#64748b' },
}

const short = (value: string, n = 4) => (value.length > n * 2 + 3 ? `${value.slice(0, n)}…${value.slice(-n)}` : value)

/**
 * Drop-in Axiom Bot controls + live feed.
 *
 *   <SolanaBotWidget baseUrl="https://bot.example.com" />
 *
 * The admin types the dashboard password into the widget; it is kept in
 * sessionStorage for the tab only. Never pass a hardcoded password from a public bundle.
 */
export default function SolanaBotWidget({ baseUrl }: { baseUrl: string }) {
  const [password, setPassword] = useState(() => (typeof window === 'undefined' ? '' : sessionStorage.getItem(PASSWORD_KEY) ?? ''))
  const [draft, setDraft] = useState('')
  const client = useMemo(() => (password ? new SolanaBotClient(baseUrl, password) : null), [baseUrl, password])
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [stream, setStream] = useState<StreamStatus>('closed')
  const [events, setEvents] = useState<BotEvent[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<BotMode>('sniper')
  const [target, setTarget] = useState('')
  const [buy, setBuy] = useState(0.01)
  const [slippage, setSlippage] = useState(3)
  const [dryRun, setDryRun] = useState(true)
  const [liveAck, setLiveAck] = useState(false)
  const refreshRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!client) return
    let alive = true
    const refresh = () => client.getStatus().then(s => { if (alive) { setStatus(s); setError('') } }).catch(err => {
      if (!alive) return
      if (err.status === 401) { sessionStorage.removeItem(PASSWORD_KEY); setPassword(''); setError('Wrong password.') }
      else setError(err.message)
    })
    refreshRef.current = refresh
    refresh()
    const timer = setInterval(refresh, 10_000)
    const handle = client.connectStream(evt => {
      setEvents(prev => [evt, ...prev].slice(0, MAX_EVENTS))
      if (evt.event_type === 'status' || evt.event_type === 'trade') refresh()
    }, {
      onHello: hello => setEvents(hello.backlog.slice(0, MAX_EVENTS)),
      onStatusChange: setStream,
    })
    return () => { alive = false; clearInterval(timer); handle.close() }
  }, [client])

  function login(event: FormEvent) {
    event.preventDefault()
    sessionStorage.setItem(PASSWORD_KEY, draft)
    setPassword(draft)
    setDraft('')
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    if (!client) return
    if (!dryRun && !liveAck) { setError('Confirm LIVE mode first.'); return }
    setBusy(true)
    setError('')
    try {
      setStatus(await client.startBot({ mode, targetWallet: mode === 'copytrade' ? target.trim() : null, buyAmountSol: buy, slippagePercent: slippage, dryRun }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!client) return
    setBusy(true)
    try { setStatus(await client.stopBot()) } catch (err) { setError((err as Error).message) } finally { setBusy(false); refreshRef.current() }
  }

  if (!client) {
    return <form style={ui.shell} onSubmit={login}>
      <strong>Axiom Bot</strong>
      <input style={ui.input} type="password" placeholder="Dashboard password" value={draft} onChange={e => setDraft(e.target.value)} required aria-label="Dashboard password"/>
      {error && <p role="alert" style={{ color: '#fca5a5', margin: 0 }}>{error}</p>}
      <button style={{ ...ui.button, background: '#10b981', color: '#022c22' }}>Connect</button>
    </form>
  }

  const running = status?.running ?? false
  const live = running && status?.settings.dry_run === false
  const wallet = status?.wallet?.address ?? ''

  return <section style={ui.shell} aria-label="Axiom Bot">
    <div style={ui.row}>
      <strong>Axiom Bot</strong>
      <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: running ? (live ? '#dc2626' : '#10b981') : '#334155', color: running && !live ? '#022c22' : '#fff' }}>
        {running ? (live ? 'LIVE' : 'LIVE · DRY RUN') : 'OFFLINE'}
      </span>
      <span style={ui.muted}>Wallet</span>
      <code title={wallet}>{wallet ? short(wallet, 6) : '—'}</code>
      {wallet && <button type="button" style={{ ...ui.button, padding: '2px 8px', background: '#1e293b', color: '#e2e8f0' }} onClick={() => void navigator.clipboard?.writeText(wallet)}>Copy</button>}
      <span style={ui.muted}>Balance</span>
      <span>{typeof status?.wallet?.balance_sol === 'number' ? `${status.wallet.balance_sol.toFixed(4)} SOL` : '—'}</span>
      <span style={{ ...ui.muted, marginLeft: 'auto' }}>stream: {stream}</span>
    </div>

    <form style={{ ...ui.row, alignItems: 'end' }} onSubmit={start}>
      <label style={{ display: 'grid', gap: 4 }}>Mode
        <select style={ui.input} value={mode} disabled={running} onChange={e => setMode(e.target.value as BotMode)}>
          <option value="sniper">Sniper</option>
          <option value="copytrade">Copy-Trade</option>
        </select>
      </label>
      {mode === 'copytrade' && <label style={{ display: 'grid', gap: 4, flex: '1 1 240px' }}>Target wallet
        <input style={ui.input} value={target} disabled={running} onChange={e => setTarget(e.target.value)} required maxLength={44} spellCheck={false}/>
      </label>}
      <label style={{ display: 'grid', gap: 4 }}>Buy (SOL)
        <input style={{ ...ui.input, width: 110 }} type="number" min={0.0001} step={0.0001} max={status?.max_buy_amount_sol} value={buy} disabled={running} onChange={e => setBuy(Number(e.target.value))}/>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>Slippage (%)
        <input style={{ ...ui.input, width: 90 }} type="number" min={0.01} max={50} step={0.01} value={slippage} disabled={running} onChange={e => setSlippage(Number(e.target.value))}/>
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={dryRun} disabled={running} onChange={e => { setDryRun(e.target.checked); setLiveAck(false) }}/> Dry run
      </label>
      {!dryRun && <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#fca5a5' }}>
        <input type="checkbox" checked={liveAck} onChange={e => setLiveAck(e.target.checked)}/> Real transactions
      </label>}
      <button style={{ ...ui.button, background: dryRun ? '#10b981' : '#f59e0b', color: '#111' }} disabled={running || busy}>Start</button>
      <button type="button" style={{ ...ui.button, background: '#dc2626', color: '#fff' }} disabled={!running || busy} onClick={() => void stop()}>Emergency stop</button>
    </form>

    {error && <p role="alert" style={{ color: '#fca5a5', margin: 0 }}>{error}</p>}

    <ol style={ui.feed} aria-live="polite">
      {events.length === 0 && <li style={ui.muted}>No events yet.</li>}
      {events.map((evt, index) => <li key={`${evt.timestamp}-${index}`} style={ui.item}>
        <span style={ui.muted}>{new Date(evt.timestamp).toLocaleTimeString([], { hour12: false })}</span>
        <span>{evt.event_type}</span>
        <span style={{ overflowWrap: 'anywhere', color: evt.level === 'error' ? '#fca5a5' : undefined }}>
          {evt.message}
          {evt.mint && <> · <a href={`https://solscan.io/token/${evt.mint}`} target="_blank" rel="noopener noreferrer">{short(evt.mint)}</a></>}
          {evt.signature && <> · <a href={`https://solscan.io/tx/${evt.signature}`} target="_blank" rel="noopener noreferrer">tx {short(evt.signature, 6)}</a></>}
        </span>
        <span style={{ textAlign: 'right' }}>{evt.latency_ms != null ? `${Math.round(evt.latency_ms)} ms` : ''}</span>
      </li>)}
    </ol>
  </section>
}
