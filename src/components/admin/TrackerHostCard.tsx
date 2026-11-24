import { useCallback, useEffect, useState } from 'react'
import { Activity, ExternalLink, LoaderCircle, Play, RotateCcw, SquareArrowOutUpRight } from 'lucide-react'
import { hostActionLabels, pulseFeeding, type HostAction, type HostCommand, type HostView } from '@/lib/axiom-host'

const POLL_MS = 5000
const feedStaleMs = 60_000

type Health = { tone: 'good' | 'warn' | 'bad'; label: string; hint: string }

function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

function span(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} days`
}

function health(view: HostView): Health {
  const tracker = view.report?.apps.find(app => app.name === 'axiom-worker')
  const feedAge = view.feed.at === null ? Infinity : view.now - view.feed.at
  if (!view.online) return { tone: 'bad', label: 'PC not checking in', hint: 'The tracker PC has not checked in for a few minutes. It may be asleep, off, or offline; buttons here work again once it is back.' }
  if (!tracker || tracker.status !== 'online') return { tone: 'bad', label: 'Tracker off', hint: 'The tracker is not running. Turn on starts it and opens Axiom Pulse if it is not open.' }
  if (feedAge > feedStaleMs || !view.report?.probeAnswered) return { tone: 'bad', label: 'Tracker stuck', hint: 'The tracker is running but not answering or not sending to the site. Restart it.' }
  if (!pulseFeeding(view.feed.components, view.now)) return { tone: 'warn', label: 'Waiting for Axiom Pulse', hint: 'The tracker is running but no Axiom Pulse tab is open on that PC, so it has no coins. Open Pulse fixes it.' }
  return { tone: 'good', label: 'Running', hint: 'Every PC that opens the Radar sees this same live feed.' }
}

const commandStatus: Record<HostCommand['status'], string> = {
  pending: 'waiting for the PC to pick it up (up to 20 s)',
  running: 'running on the PC',
  done: 'done',
  failed: 'failed',
  expired: 'never picked up: the PC was not checking in',
}

export function TrackerHostCard() {
  const [view, setView] = useState<HostView | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState<HostAction | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/axiom/host', { headers: { Accept: 'application/json' } })
      if (response.status === 403) { setHidden(true); return }
      const result = await response.json().catch(() => ({ error: 'The tracker status could not be read.' }))
      if (!response.ok) throw new Error((result as { error?: string }).error ?? 'The tracker status is unavailable.')
      setView(result as HostView)
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The tracker status is unavailable.') }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const send = async (action: HostAction) => {
    setSending(action)
    try {
      const response = await fetch('/api/admin/axiom/host/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const result = await response.json().catch(() => ({ error: 'The command could not be sent.' }))
      if (!response.ok) throw new Error((result as { error?: string }).error ?? 'The command could not be sent.')
      setView(result as HostView)
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The command could not be sent.') }
    finally { setSending(null) }
  }

  if (hidden) return null
  if (!view) return <section className="change-credits tracker-host" aria-label="Axiom tracker">
    {error ? <p role="alert" className="change-error">{error}</p> : <p role="status">Checking the Axiom tracker…</p>}
  </section>

  const state = health(view)
  const tracker = view.report?.apps.find(app => app.name === 'axiom-worker')
  const command = view.command
  const busy = sending !== null || command?.status === 'pending' || command?.status === 'running'
  return <section className="change-credits tracker-host" aria-label="Axiom tracker">
    <div className="change-credits-main">
      <Activity size={18} aria-hidden="true"/>
      <div>
        <span className="change-credits-label">Axiom tracker</span>
        <strong className={`tracker-host-state is-${state.tone}`}>{state.label}</strong>
      </div>
      <div className="tracker-host-actions">
        <button type="button" onClick={() => void send('start')} disabled={busy}>{sending === 'start' ? <LoaderCircle className="spin" size={14}/> : <Play size={14}/>} {hostActionLabels.start}</button>
        <button type="button" onClick={() => void send('restart')} disabled={busy}>{sending === 'restart' ? <LoaderCircle className="spin" size={14}/> : <RotateCcw size={14}/>} {hostActionLabels.restart}</button>
        <button type="button" onClick={() => void send('open-pulse')} disabled={busy}>{sending === 'open-pulse' ? <LoaderCircle className="spin" size={14}/> : <SquareArrowOutUpRight size={14}/>} {hostActionLabels['open-pulse']}</button>
      </div>
    </div>
    <p className="change-credits-note">{state.hint}</p>
    {error && <p role="alert" className="change-error">{error}</p>}
    <dl className="change-credits-stats">
      <div><dt>Tracker PC</dt><dd>{view.report?.host ?? 'Never checked in'}{view.reportedAt !== null && ` · checked in ${ago(view.now - view.reportedAt)}`}</dd></div>
      <div><dt>Tracker</dt><dd>{tracker ? `${tracker.status}${tracker.status === 'online' ? `, up ${span(tracker.uptimeMs)}` : ''} · ${tracker.restarts} restarts${tracker.memoryMb !== null ? ` · ${tracker.memoryMb} MB` : ''}` : 'not in PM2'}</dd></div>
      <div><dt>Coins on the Radar</dt><dd>{view.feed.coins}{view.feed.at !== null && ` · sent ${ago(view.now - view.feed.at)}`}</dd></div>
      {view.report?.lastAction && <div><dt>Last fix</dt><dd>{view.report.lastAction.reason}: {view.report.lastAction.outcome} · {ago(view.now - view.report.lastAction.at)}</dd></div>}
    </dl>
    {command && <p className={`tracker-host-command is-${command.status}`} role="status">
      {busy && <LoaderCircle className="spin" size={14} aria-hidden="true"/>} {hostActionLabels[command.action]}, asked {ago(view.now - command.requestedAt)}: {commandStatus[command.status]}{command.output ? ` — ${command.output}` : ''}
    </p>}
    <a className="tracker-host-link" href="/axiom-radar">Open the Axiom Radar <ExternalLink size={12}/></a>
  </section>
}
