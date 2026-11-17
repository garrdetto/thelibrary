import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Copy, LoaderCircle, Play, Plug, PlugZap, ShieldAlert, Square } from 'lucide-react'
import { SolanaBotClient, SolanaBotError, normalizeBaseUrl } from '../../lib/solana-bot-client'
import type { BotEvent, BotMode, BotStatus, StreamStatus } from '../../lib/solana-bot-client'
import { AxiomBotFeed, shorten } from './AxiomBotFeed'

const URL_KEY = 'tl-axiom-bot-url'
const PASSWORD_KEY = 'tl-axiom-bot-password'
const MAX_EVENTS = 300
const STATUS_POLL_MS = 10_000

function readStore(store: 'local' | 'session', key: string) {
  try { return (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key) ?? '' } catch { return '' }
}

function writeStore(store: 'local' | 'session', key: string, value: string | null) {
  try {
    const target = store === 'local' ? window.localStorage : window.sessionStorage
    if (value === null) target.removeItem(key)
    else target.setItem(key, value)
  } catch { /* storage unavailable */ }
}

const streamLabels: Record<StreamStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live feed on',
  reconnecting: 'Reconnecting…',
  closed: 'Feed off',
  unauthorized: 'Password rejected',
}

function formatUptime(seconds: number) {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

export default function AxiomBot() {
  const [urlDraft, setUrlDraft] = useState('')
  const [passwordDraft, setPasswordDraft] = useState('')
  const [connection, setConnection] = useState<{ url: string; password: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [stream, setStream] = useState<StreamStatus>('closed')
  const [events, setEvents] = useState<BotEvent[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  const [copied, setCopied] = useState(false)

  const [mode, setMode] = useState<BotMode>('sniper')
  const [targetWallet, setTargetWallet] = useState('')
  const [buyAmount, setBuyAmount] = useState('0.01')
  const [slippage, setSlippage] = useState('3')
  const [dryRun, setDryRun] = useState(true)
  const [liveConfirmed, setLiveConfirmed] = useState(false)
  const formSynced = useRef(false)

  const client = useMemo(() => connection ? new SolanaBotClient(connection.url, connection.password) : null, [connection])

  const disconnect = useCallback((message = '') => {
    writeStore('session', PASSWORD_KEY, null)
    setConnection(null)
    setStatus(null)
    setStream('closed')
    setEvents([])
    formSynced.current = false
    setError(message)
  }, [])

  useEffect(() => {
    const savedUrl = readStore('local', URL_KEY)
    setUrlDraft(savedUrl || 'http://localhost:8000')
    const savedPassword = readStore('session', PASSWORD_KEY)
    if (savedUrl && savedPassword) setConnection({ url: savedUrl, password: savedPassword })
  }, [])

  const applyStatus = useCallback((next: BotStatus) => {
    setStatus(previous => next.wallet || !previous ? next : { ...next, wallet: previous.wallet })
    if (next.running || !formSynced.current) {
      formSynced.current = true
      setMode(next.settings.mode)
      setTargetWallet(next.settings.target_wallet)
      setBuyAmount(String(next.settings.buy_amount_sol))
      setSlippage(String(next.settings.slippage_bps / 100))
      setDryRun(next.settings.dry_run)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!client) return
    try {
      applyStatus(await client.getStatus())
    } catch (caught) {
      if (caught instanceof SolanaBotError && caught.status === 401) disconnect('The dashboard password was rejected. Connect again.')
    }
  }, [client, applyStatus, disconnect])

  useEffect(() => {
    if (!client) return
    let alive = true
    void refresh()
    const timer = window.setInterval(() => { if (alive) void refresh() }, STATUS_POLL_MS)
    const handle = client.connectStream(event => {
      if (!alive) return
      setEvents(previous => [event, ...previous].slice(0, MAX_EVENTS))
      if (event.event_type === 'status' || event.event_type === 'trade') void refresh()
    }, {
      onHello: hello => {
        if (!alive) return
        setEvents(hello.backlog.slice(0, MAX_EVENTS))
        setStatus(previous => previous ? { ...previous, running: hello.running, settings: hello.settings, trades_executed: hello.trades_executed } : previous)
      },
      onStatusChange: next => {
        if (!alive) return
        setStream(next)
        if (next === 'unauthorized') disconnect('The dashboard password was rejected. Connect again.')
      },
    })
    return () => { alive = false; window.clearInterval(timer); handle.close() }
  }, [client, refresh, disconnect])

  async function connect(event: FormEvent) {
    event.preventDefault()
    const url = normalizeBaseUrl(urlDraft)
    if (!url) { setError('Enter the bot API address, for example https://bot.example.com'); return }
    if (window.location.protocol === 'https:' && url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
      setError('This page is served over HTTPS, so the bot API must be HTTPS too (http:// only works for localhost).')
      return
    }
    setConnecting(true)
    setError('')
    try {
      const probe = new SolanaBotClient(url, passwordDraft)
      const first = await probe.getStatus()
      writeStore('local', URL_KEY, url)
      writeStore('session', PASSWORD_KEY, passwordDraft)
      formSynced.current = false
      applyStatus(first)
      setUrlDraft(url)
      setPasswordDraft('')
      setConnection({ url, password: passwordDraft })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.')
    } finally {
      setConnecting(false)
    }
  }

  const running = status?.running ?? false
  const maxBuy = status?.max_buy_amount_sol ?? 0
  const buyValue = Number(buyAmount)
  const slippageValue = Number(slippage)
  const walletOk = mode === 'sniper' || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(targetWallet.trim())
  const buyOk = Number.isFinite(buyValue) && buyValue > 0 && (!maxBuy || buyValue <= maxBuy)
  const slippageOk = Number.isFinite(slippageValue) && slippageValue >= 0.01 && slippageValue <= 50
  const canStart = Boolean(client) && !running && busy === null && walletOk && buyOk && slippageOk && (dryRun || liveConfirmed)

  async function start(event: FormEvent) {
    event.preventDefault()
    if (!client || !canStart) return
    setBusy('start')
    setError('')
    try {
      applyStatus(await client.startBot({ mode, targetWallet, buyAmountSol: buyValue, slippagePercent: slippageValue, dryRun }))
      setLiveConfirmed(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The bot did not start.')
    } finally {
      setBusy(null)
    }
  }

  async function stop() {
    if (!client) return
    setBusy('stop')
    setError('')
    try {
      applyStatus(await client.stopBot())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The stop request failed. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function copyWallet(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  if (!client) {
    return <div className="axb">
      <p className="adm-help">Control the Solana bot (sniper and copy-trade) running on your machine or server through its web API. Start it with <code>uvicorn api:app</code> from <code>scripts/solana-bot-api</code> (see its DEPLOYMENT.md), set <code>ALLOWED_ORIGINS</code> to this site, then connect here. The password stays in this tab only.</p>
      <form className="adm-card axb-connect" onSubmit={connect}>
        <div className="adm-card-head"><h3>Connect to the bot</h3></div>
        <label className="axb-field">
          <span>Bot API address</span>
          <input type="url" inputMode="url" value={urlDraft} onChange={event => setUrlDraft(event.target.value)} placeholder="https://bot.example.com" required spellCheck={false} autoComplete="off"/>
        </label>
        <label className="axb-field">
          <span>Dashboard password</span>
          <input type="password" value={passwordDraft} onChange={event => setPasswordDraft(event.target.value)} required autoComplete="off"/>
        </label>
        <button type="submit" className="adm-btn adm-btn-primary" disabled={connecting}>
          {connecting ? <LoaderCircle className="spin" size={16} aria-hidden/> : <Plug size={16} aria-hidden/>} Connect
        </button>
        {error && <p className="adm-error" role="alert">{error}</p>}
      </form>
    </div>
  }

  const live = running && status?.settings.dry_run === false
  const wallet = status?.wallet?.address ?? ''
  const balance = status?.wallet?.balance_sol

  return <div className="axb">
    <section className="adm-card axb-status" aria-label="Bot status">
      <span className={`axb-badge ${running ? (live ? 'is-live' : 'is-dry') : ''}`} role="status">
        {running ? (live ? 'Live' : 'Live · dry run') : 'Offline'}
      </span>
      {running && status && <span className="axb-chip">{status.settings.mode === 'copytrade' ? `Copying ${shorten(status.settings.target_wallet)}` : 'Sniper'} · {formatUptime(status.uptime_s)}</span>}
      <div className="axb-stat">
        <span>Wallet</span>
        <code title={wallet || undefined}>{wallet ? shorten(wallet, 6) : status?.wallet?.error ?? '—'}</code>
        {wallet && <button type="button" className="adm-btn adm-btn-ghost axb-icon" onClick={() => void copyWallet(wallet)} aria-label="Copy wallet address">
          {copied ? <Check size={15} aria-hidden/> : <Copy size={15} aria-hidden/>}
        </button>}
      </div>
      <div className="axb-stat"><span>Balance</span><strong>{typeof balance === 'number' ? `${balance.toFixed(4)} SOL` : '—'}</strong></div>
      <div className="axb-stat"><span>Trades</span><strong>{status?.trades_executed ?? 0}</strong></div>
      <div className="axb-stat axb-stream"><PlugZap size={15} aria-hidden/><span className={stream === 'open' ? 'is-on' : ''}>{streamLabels[stream]}</span></div>
      <button type="button" className="adm-btn adm-btn-ghost" onClick={() => disconnect()}>Disconnect</button>
    </section>

    <div className="axb-grid">
      <form className="adm-card axb-controls" onSubmit={start} aria-label="Bot controls">
        <div className="adm-card-head"><h3>Controls</h3></div>
        <fieldset className="axb-mode" disabled={running}>
          <legend>Mode</legend>
          <div role="radiogroup" aria-label="Mode">
            {(['sniper', 'copytrade'] as const).map(option => <label key={option} className={mode === option ? 'is-active' : ''}>
              <input type="radio" name="axb-mode" value={option} checked={mode === option} onChange={() => setMode(option)}/>
              <span>{option === 'sniper' ? 'Sniper' : 'Copy-Trade'}</span>
            </label>)}
          </div>
        </fieldset>
        {mode === 'copytrade' && <label className="axb-field">
          <span>Target wallet</span>
          <input value={targetWallet} onChange={event => setTargetWallet(event.target.value)} disabled={running} maxLength={44} spellCheck={false} autoComplete="off" placeholder="Wallet address to copy" aria-invalid={!walletOk}/>
          {!walletOk && targetWallet && <small className="axb-warn">That doesn't look like a Solana address.</small>}
        </label>}
        <div className="axb-row">
          <label className="axb-field">
            <span>Buy amount (SOL)</span>
            <input type="number" inputMode="decimal" min={0.0001} step={0.0001} max={maxBuy || undefined} value={buyAmount} onChange={event => setBuyAmount(event.target.value)} disabled={running} aria-invalid={!buyOk}/>
            {maxBuy > 0 && <small>Max {maxBuy} SOL</small>}
          </label>
          <label className="axb-field">
            <span>Slippage (%)</span>
            <input type="number" inputMode="decimal" min={0.01} max={50} step={0.01} value={slippage} onChange={event => setSlippage(event.target.value)} disabled={running} aria-invalid={!slippageOk}/>
          </label>
        </div>
        <div className={`axb-dry ${dryRun ? '' : 'is-live'}`}>
          <label className="axb-switch">
            <input type="checkbox" role="switch" checked={dryRun} disabled={running} onChange={event => { setDryRun(event.target.checked); setLiveConfirmed(false) }}/>
            <span aria-hidden/>
            <strong>Dry Run Mode</strong>
          </label>
          <p>{dryRun ? 'Simulates every trade. Nothing is signed or sent.' : 'LIVE: real transactions will be signed and sent with real SOL.'}</p>
          {!dryRun && !running && <label className="axb-confirm">
            <input type="checkbox" checked={liveConfirmed} onChange={event => setLiveConfirmed(event.target.checked)}/>
            <span><ShieldAlert size={14} aria-hidden/> I understand this trades real SOL.</span>
          </label>}
        </div>
        <div className="axb-actions">
          <button type="submit" className={`adm-btn ${dryRun ? 'adm-btn-primary' : 'axb-btn-live'}`} disabled={!canStart}>
            {busy === 'start' ? <LoaderCircle className="spin" size={16} aria-hidden/> : <Play size={16} aria-hidden/>} {dryRun ? 'Start (dry run)' : 'Start LIVE'}
          </button>
          <button type="button" className="adm-btn axb-btn-stop" disabled={!running || busy !== null} onClick={() => void stop()}>
            {busy === 'stop' ? <LoaderCircle className="spin" size={16} aria-hidden/> : <Square size={16} aria-hidden/>} Emergency stop
          </button>
        </div>
        {error && <p className="adm-error" role="alert">{error}</p>}
      </form>
      <AxiomBotFeed events={events} onClear={() => setEvents([])}/>
    </div>
  </div>
}
