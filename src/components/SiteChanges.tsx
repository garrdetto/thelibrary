import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ExternalLink, Laptop, LoaderCircle, Plus, RotateCcw, Send, Trash2, Undo2, Wallet } from 'lucide-react'
import { Streamdown } from 'streamdown'

type Status = 'queued' | 'running' | 'merged' | 'review' | 'answered' | 'failed' | 'reverted'
type ChangeMessage = {
  id: string
  threadId: string
  mode: 'change' | 'revert'
  request: string
  target: string | null
  autoMerge: boolean
  status: Status
  progress: string | null
  reply: string | null
  costUsd: number | null
  billing: 'api' | 'subscription' | null
  commit: string | null
  prUrl: string | null
  runUrl: string | null
  runner: 'github' | 'laptop'
  createdAt: number
  updatedAt: number
}
type Thread = { id: string; title: string; updatedAt: number; turns: number; status: Status }
type Credits = {
  balanceCents: number | null
  balanceSetAt: number | null
  spentCents: number
  runs: number
  remainingCents: number | null
  monthCents: number
  billing: 'api' | 'subscription' | null
  organizationMonthCents: number | null
  organizationCheckedAt: number | null
}
type LaptopStatus = 'online' | 'busy' | 'offline' | 'missing' | 'unknown'
type RunnerInfo = { choice: 'github' | 'laptop'; laptop: LaptopStatus; label: string }
type Overview = { configured: { github: boolean; secret: boolean; adminKey: boolean; repo: string }; threads: Thread[]; credits: Credits; runner?: RunnerInfo }
type Queued = { message: ChangeMessage | null; notice?: string | null }

const ACTIVE: Status[] = ['queued', 'running']
const POLL_MS = 5000
const STALE_QUEUE_MS = 10 * 60 * 1000
const statusLabels: Record<Status, string> = {
  queued: 'Waiting to start',
  running: 'Working',
  merged: 'Live',
  review: 'Ready for review',
  answered: 'Answered',
  failed: "Didn't finish",
  reverted: 'Undone',
}
const laptopLabels: Record<LaptopStatus, string> = {
  online: 'online',
  busy: 'online, busy with another job',
  offline: 'offline — requests run on GitHub until it reconnects',
  missing: 'not set up yet — requests run on GitHub',
  unknown: 'status unknown',
}
const examples = [
  'Add a "Featured" badge to the Chess card in the module library',
  'Make the sign-in ribbon say "Welcome to the library — sign in to save your progress"',
  'Which files control the racing leaderboard?',
]

const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`
const when = (time: number) => new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function api<T>(body?: unknown, query = ''): Promise<T> {
  const response = await fetch(`/api/site-changes${query}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Site changes are unavailable right now.')
  return result as T
}

function CreditsCard({ credits, configured, onSaved }: { credits: Credits; configured: Overview['configured']; onSaved: (credits: Credits) => void }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars < 0) { setError('Enter your balance in dollars, like 25 or 18.40.'); return }
    setSaving(true); setError('')
    try {
      const result = await api<{ credits: Credits }>({ action: 'set-balance', dollars })
      onSaved(result.credits); setEditing(false); setAmount('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save your balance.') }
    finally { setSaving(false) }
  }
  const subscription = credits.billing === 'subscription'
  const low = credits.remainingCents !== null && credits.remainingCents < 500
  return <section className="change-credits" aria-label="Usage credits">
    <div className="change-credits-main">
      <Wallet size={18} aria-hidden="true"/>
      <div>
        <span className="change-credits-label">{subscription ? 'Usage' : 'Credits left'}</span>
        {subscription
          ? <strong>Claude subscription</strong>
          : credits.remainingCents === null
            ? <strong className="is-muted">Not set</strong>
            : <strong className={low ? 'is-low' : ''}>{money(credits.remainingCents)}</strong>}
      </div>
      {!subscription && !editing && <button type="button" onClick={() => { setEditing(true); setAmount(credits.remainingCents !== null ? (Math.max(credits.remainingCents, 0) / 100).toFixed(2) : '') }}>{credits.balanceCents === null ? 'Set balance' : 'Update balance'}</button>}
    </div>
    {editing && <form className="change-credits-form" onSubmit={save}>
      <label>Your current balance in the Claude Console<span className="change-dollar"><span aria-hidden="true">$</span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="25.00" autoFocus aria-label="Balance in dollars"/></span></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={() => { setEditing(false); setError('') }}>Cancel</button>
      <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener">Check it in the Console <ExternalLink size={12}/></a>
    </form>}
    {error && <p role="alert" className="change-error">{error}</p>}
    <dl className="change-credits-stats">
      {!subscription && credits.balanceSetAt !== null && <div><dt>Used since {when(credits.balanceSetAt)}</dt><dd>{money(credits.spentCents)} · {credits.runs} {credits.runs === 1 ? 'request' : 'requests'}</dd></div>}
      <div><dt>{subscription ? 'API-equivalent cost this month' : 'Site changes this month'}</dt><dd>{money(credits.monthCents)}</dd></div>
      {credits.organizationMonthCents !== null && <div><dt>All API spend this month</dt><dd>{money(credits.organizationMonthCents)}</dd></div>}
    </dl>
    <p className="change-credits-note">{subscription
      ? 'Requests run on your Claude subscription and count toward its usage limits instead of API credits. Check your remaining usage in Claude under Settings → Usage.'
      : `Anthropic doesn't share your prepaid balance with other apps, so this counts down from the balance you enter, using the exact cost of each request.${configured.adminKey ? ' "All API spend" also includes anything else using your API key and can lag a few minutes.' : ''}`}</p>
  </section>
}

function MessageView({ message, busy, onAction }: { message: ChangeMessage; busy: boolean; onAction: (action: 'revert' | 'retry' | 'stop', message: ChangeMessage) => void }) {
  const active = ACTIVE.includes(message.status)
  const stale = message.status === 'queued' && Date.now() - message.createdAt > STALE_QUEUE_MS
  return <li className="change-turn">
    <div className="change-bubble is-admin">
      <span className="change-author">You{message.mode === 'revert' ? ' · undo' : ''}{!message.autoMerge && message.mode === 'change' ? ' · review first' : ''}</span>
      <p>{message.request}</p>
    </div>
    <div className={`change-bubble is-claude status-${message.status}`}>
      <span className="change-author">Claude <span className="change-status">{active && <LoaderCircle className="spin" size={12} aria-hidden="true"/>}{statusLabels[message.status]}</span></span>
      {active && <p className="change-progress" role="status">{message.status === 'queued'
        ? message.runner === 'laptop'
          ? (stale ? "Your laptop hasn't picked this up yet. Check that it's awake and the runner is started, or stop waiting and try again with the laptop box unticked." : 'Waiting for your laptop to pick it up…')
          : (stale ? "This hasn't started yet. GitHub may be busy, or the workflow may be turned off — check the run log." : 'Waiting for GitHub to start…')
        : `${message.progress ?? 'Working'}…`}</p>}
      {message.reply && <div className="change-reply"><Streamdown>{message.reply}</Streamdown></div>}
      <div className="change-meta">
        {message.costUsd !== null && <span>{message.billing === 'subscription' ? '≈' : ''}${message.costUsd.toFixed(2)}</span>}
        <span>{when(message.updatedAt)}</span>
        <span>{message.runner === 'laptop' ? 'On your laptop' : 'On GitHub'}</span>
        {message.commit && message.status !== 'review' && <span>Commit {message.commit.slice(0, 7)}</span>}
        {message.prUrl && <a href={message.prUrl} target="_blank" rel="noopener">Review changes <ExternalLink size={12}/></a>}
        {message.runUrl && <a href={message.runUrl} target="_blank" rel="noopener">Run log <ExternalLink size={12}/></a>}
      </div>
      {(message.status === 'merged' || message.status === 'failed' || active) && <div className="change-actions">
        {message.status === 'merged' && <button type="button" disabled={busy} onClick={() => onAction('revert', message)}><Undo2 size={14}/> Undo this change</button>}
        {message.status === 'failed' && <button type="button" disabled={busy} onClick={() => onAction('retry', message)}><RotateCcw size={14}/> Try again</button>}
        {active && <button type="button" disabled={busy} onClick={() => onAction('stop', message)}>Stop waiting</button>}
      </div>}
    </div>
  </li>
}

export function SiteChanges() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChangeMessage[]>([])
  const [text, setText] = useState('')
  const [autoMerge, setAutoMerge] = useState(true)
  const [useLaptop, setUseLaptop] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  const loadOverview = useCallback(async () => {
    const result = await api<Overview>()
    setOverview(result)
    return result
  }, [])
  const laptopChoiceLoaded = useRef(false)
  useEffect(() => {
    if (!overview?.runner || laptopChoiceLoaded.current) return
    laptopChoiceLoaded.current = true
    setUseLaptop(overview.runner.choice === 'laptop')
  }, [overview])

  async function chooseLaptop(next: boolean) {
    setUseLaptop(next)
    try {
      const result = await api<{ runner: RunnerInfo }>({ action: 'set-runner', runner: next ? 'laptop' : 'github' })
      setOverview(current => current ? { ...current, runner: result.runner } : current)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save where requests run.') }
  }
  const loadThread = useCallback(async (id: string) => {
    const result = await api<{ messages: ChangeMessage[] }>(undefined, `?thread=${id}`)
    setMessages(result.messages)
    return result.messages
  }, [])

  useEffect(() => {
    loadOverview().catch(failure => setError(failure instanceof Error ? failure.message : 'Unable to load site changes.')).finally(() => setLoading(false))
  }, [loadOverview])

  const threadActive = messages.some(message => ACTIVE.includes(message.status))
  useEffect(() => {
    if (!threadId || !threadActive) return
    const timer = window.setInterval(() => {
      void loadThread(threadId).then(next => { if (!next.some(message => ACTIVE.includes(message.status))) void loadOverview() }).catch(() => {})
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [threadId, threadActive, loadThread, loadOverview])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length, messages[messages.length - 1]?.status])

  async function openThread(id: string | null) {
    setThreadId(id); setError(''); setNotice('')
    if (!id) { setMessages([]); composer.current?.focus(); return }
    try { await loadThread(id) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to open that conversation.') }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const prompt = text.trim()
    if (!prompt || sending || threadActive) return
    setSending(true); setError(''); setNotice('')
    try {
      const result = await api<{ thread: string } & Queued>({ action: 'send', text: prompt, autoMerge, runner: useLaptop ? 'laptop' : 'github', ...(threadId ? { thread: threadId } : {}) })
      setText('')
      setNotice(result.notice ?? '')
      setThreadId(result.thread)
      await Promise.all([loadThread(result.thread), loadOverview()])
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to send your message.') }
    finally { setSending(false) }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
  }

  async function act(action: 'revert' | 'retry' | 'stop', message: ChangeMessage) {
    if (action === 'revert' && !window.confirm('Undo this change on the live site? Claude will publish a commit that reverses it.')) return
    setSending(true); setError(''); setNotice('')
    try {
      const result = await api<Queued>({ action, id: message.id })
      setNotice(result.notice ?? '')
      await Promise.all([loadThread(message.threadId), loadOverview()])
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to do that right now.') }
    finally { setSending(false) }
  }

  async function removeThread(thread: Thread) {
    if (!window.confirm(`Delete the conversation "${thread.title.slice(0, 60)}"? Changes already published stay on the site.`)) return
    try {
      await api({ action: 'delete-thread', thread: thread.id })
      if (threadId === thread.id) { setThreadId(null); setMessages([]) }
      await loadOverview()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to delete that conversation.') }
  }

  const ready = overview?.configured.github && overview.configured.secret
  return <section className="account-home site-changes">
    <span className="section-eyebrow">WORKSPACE ADMINISTRATION</span>
    <h1>Site changes</h1>
    <p>Ask Claude to change the site, or ask questions about how it works. Each message runs on GitHub, or on your own laptop when <i>Run on my laptop</i> is ticked. Finished changes are built, checked and published to <code>main</code>, so they go live within a few minutes. Turn off auto-publish to review them as a pull request first.</p>
    {loading && <p role="status">Loading site changes…</p>}
    {error && <p role="alert" className="change-error">{error}</p>}
    {notice && <p role="status" className="change-notice">{notice}</p>}
    {overview && !ready && <div className="change-setup" role="note">
      <strong>Finish setup to start sending requests</strong>
      <p>Add these secrets, then send a message. The repository README has step-by-step instructions.</p>
      <ul>
        <li><b>Cloudflare</b> (Workers → thelibrary → Settings → Variables and Secrets): {!overview.configured.github && <code>SITE_CHANGES_GITHUB_TOKEN</code>} {!overview.configured.secret && <code>SITE_CHANGES_SECRET</code>}</li>
        <li><b>GitHub</b> ({overview.configured.repo} → Settings → Secrets → Actions): <code>SITE_CHANGES_SECRET</code> (the same value) and <code>ANTHROPIC_API_KEY</code> or <code>CLAUDE_CODE_OAUTH_TOKEN</code></li>
      </ul>
    </div>}
    {overview && <CreditsCard credits={overview.credits} configured={overview.configured} onSaved={credits => setOverview({ ...overview, credits })}/>}
    {overview && <div className="change-layout">
      <nav className="change-threads" aria-label="Conversations">
        <button type="button" className="change-new" onClick={() => void openThread(null)} aria-pressed={threadId === null}><Plus size={14}/> New conversation</button>
        {!overview.threads.length && <p className="change-empty">No conversations yet.</p>}
        <ul>{overview.threads.map(thread => <li key={thread.id} className={thread.id === threadId ? 'is-active' : ''}>
          <button type="button" className="change-thread" onClick={() => void openThread(thread.id)} aria-current={thread.id === threadId ? 'true' : undefined}>
            <span className={`change-dot status-${thread.status}`} aria-hidden="true"/>
            <span className="change-thread-title">{thread.title}</span>
            <span className="change-thread-meta">{statusLabels[thread.status]} · {when(thread.updatedAt)}</span>
          </button>
          <button type="button" className="change-thread-delete" onClick={() => void removeThread(thread)} aria-label={`Delete conversation: ${thread.title.slice(0, 60)}`}><Trash2 size={14}/></button>
        </li>)}</ul>
      </nav>
      <div className="change-chat">
        {threadId === null && !messages.length && <div className="change-welcome">
          <strong>What should change?</strong>
          <p>Describe it the way you'd tell a developer. Claude reads the code, makes the edit, builds the site and replies here with what it did.</p>
          <div className="change-examples">{examples.map(example => <button key={example} type="button" onClick={() => { setText(example); composer.current?.focus() }}>{example}</button>)}</div>
        </div>}
        <ol className="change-turns" aria-live="polite">{messages.map(message => <MessageView key={message.id} message={message} busy={sending} onAction={(action, item) => void act(action, item)}/>)}</ol>
        <div ref={bottom}/>
        <form className="change-composer" onSubmit={send}>
          <label className="visually-hidden" htmlFor="site-change-input">Message Claude</label>
          <textarea id="site-change-input" ref={composer} value={text} onChange={event => setText(event.target.value)} onKeyDown={onComposerKey} rows={3} maxLength={8000}
            placeholder={threadActive ? 'Claude is working on your last message…' : threadId ? 'Reply or ask for another change…' : 'Describe the change you want…'} disabled={!ready || sending || threadActive}/>
          <div className="change-composer-bar">
            <div className="change-toggles">
              <label className="change-toggle"><input type="checkbox" checked={autoMerge} onChange={event => setAutoMerge(event.target.checked)} disabled={!ready}/> Publish automatically when it builds</label>
              <label className="change-toggle" title={overview.runner ? `Runner label: ${overview.runner.label}` : undefined}>
                <input type="checkbox" checked={useLaptop} onChange={event => void chooseLaptop(event.target.checked)} disabled={!ready}/>
                <Laptop size={14} aria-hidden="true"/> Run on my laptop
                {useLaptop && overview.runner && <span className={`change-laptop-status is-${overview.runner.laptop}`}>({laptopLabels[overview.runner.laptop]})</span>}
              </label>
            </div>
            <button type="submit" disabled={!ready || sending || threadActive || !text.trim()}>{sending ? <LoaderCircle className="spin" size={14}/> : <Send size={14}/>} Send</button>
          </div>
        </form>
      </div>
    </div>}
  </section>
}
