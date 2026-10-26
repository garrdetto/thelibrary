import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowLeft, Check, Gamepad2, Lock, MessageCircle, Plus, Send, Trash2, Users, X } from 'lucide-react'
import { useBlinkingFavicon } from '@/lib/use-blinking-favicon'

export type ChatInvite = { module: string; label: string; code: string | null }
export type InviteKind = 'room' | 'pool' | 'link'
export type ChatModule = { id: string; label: string; invite: InviteKind | null }

type ChatMessage = { id: number; username: string; text: string; at: number; thread: string | null; meta: { invite?: ChatInvite } | null }
type OnlineUser = { username: string; activity: string | null }
type Pane = { kind: 'list' } | { kind: 'online' } | { kind: 'new' } | { kind: 'thread'; key: string }

const GROUP = ''
const seenKey = (user: string) => `tl_chat_seen:${user}`
function loadSeen(user: string): Record<string, number> | null {
  try { const raw = localStorage.getItem(seenKey(user)); return raw ? JSON.parse(raw) as Record<string, number> : null } catch { return null }
}
function saveSeen(user: string, seen: Record<string, number>) {
  try { localStorage.setItem(seenKey(user), JSON.stringify(seen)) } catch { /* storage unavailable */ }
}

function timeLabel(at: number) {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function hueFor(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

const threadKey = (members: string[]) => [...new Set(members)].sort().join(',')
const othersIn = (key: string, me: string) => key.split(',').filter(name => name && name !== me)

export function GroupChat({ username, onSignIn, module, activityLabels, requestRoom, onPoolInvite, onJoinInvite }: {
  username: string | null
  onSignIn: () => void
  module: ChatModule | null
  activityLabels: Record<string, string>
  requestRoom: () => Promise<string | null>
  onPoolInvite: (username: string) => void
  onJoinInvite: (invite: ChatInvite) => void
}) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>({ kind: 'list' })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [online, setOnline] = useState<OnlineUser[]>([])
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [typedName, setTypedName] = useState('')
  const lastId = useRef(0)
  const loaded = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const openRef = useRef(open)
  openRef.current = open
  const activity = module?.id ?? 'home'
  const activityRef = useRef(activity)
  activityRef.current = activity

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return
    setMessages(current => {
      const map = new Map(current.map(item => [item.id, item]))
      for (const item of incoming) map.set(item.id, item)
      const next = [...map.values()].sort((a, b) => a.id - b.id).slice(-600)
      lastId.current = Math.max(lastId.current, next[next.length - 1].id)
      return next
    })
  }, [])

  const poll = useCallback(async () => {
    if (!username) return
    try {
      const params = new URLSearchParams({ activity: activityRef.current })
      if (lastId.current) params.set('after', String(lastId.current))
      const response = await fetch(`/api/group-chat?${params}`, { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { messages: ChatMessage[]; isAdmin: boolean; online: OnlineUser[] }
      if (!loaded.current) {
        loaded.current = true
        const stored = loadSeen(username)
        if (stored) setSeen(stored)
        else {
          const baseline: Record<string, number> = {}
          for (const item of data.messages) baseline[item.thread ?? GROUP] = Math.max(baseline[item.thread ?? GROUP] ?? 0, item.id)
          setSeen(baseline)
          saveSeen(username, baseline)
        }
      }
      merge(data.messages)
      setOnline(data.online)
      setIsAdmin(data.isAdmin)
    } catch { /* offline: try again next tick */ }
  }, [username, merge])

  useEffect(() => {
    setMessages([]); setOnline([]); setSeen({}); lastId.current = 0; loaded.current = false
    if (!username) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await poll()
      if (stopped) return
      timer = setTimeout(() => void tick(), document.hidden ? 30000 : openRef.current ? 2500 : 8000)
    }
    void tick()
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void tick() } }
    document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [username, poll])

  useEffect(() => { if (open && username) void poll() }, [open, username, poll])
  useEffect(() => { if (username) void poll() }, [activity, username, poll])

  const threads = useMemo(() => {
    const map = new Map<string, { key: string; last: ChatMessage | null; unread: number }>()
    map.set(GROUP, { key: GROUP, last: null, unread: 0 })
    for (const key of drafts) if (!map.has(key)) map.set(key, { key, last: null, unread: 0 })
    for (const item of messages) {
      const key = item.thread ?? GROUP
      const entry = map.get(key) ?? { key, last: null, unread: 0 }
      entry.last = item
      if (item.id > (seen[key] ?? 0) && item.username !== username) entry.unread += 1
      map.set(key, entry)
    }
    const list = [...map.values()]
    return [list[0], ...list.slice(1).sort((a, b) => (b.last?.id ?? Number.MAX_SAFE_INTEGER) - (a.last?.id ?? Number.MAX_SAFE_INTEGER))]
  }, [messages, seen, username, drafts])

  const activeKey = pane.kind === 'thread' ? pane.key : null
  const shown = activeKey === null ? [] : messages.filter(item => (item.thread ?? GROUP) === activeKey)

  useEffect(() => {
    if (!open || activeKey === null || !username || !shown.length) return
    const top = shown[shown.length - 1].id
    if ((seen[activeKey] ?? 0) >= top) return
    const next = { ...seen, [activeKey]: top }
    setSeen(next)
    saveSeen(username, next)
  }, [open, activeKey, shown, seen, username])

  useEffect(() => {
    const list = listRef.current
    if (open && list && stickBottom.current) list.scrollTop = list.scrollHeight
  }, [shown.length, open, activeKey])

  useEffect(() => { setError(''); setNotice(''); stickBottom.current = true }, [pane])

  const unreadTotal = threads.reduce((sum, item) => sum + item.unread, 0)
  useBlinkingFavicon(unreadTotal > 0)
  const others = online.filter(item => item.username !== username)
  const label = (name: string | null) => !name || name === 'home' ? 'Browsing' : activityLabels[name] ?? 'Browsing'
  const titleFor = (key: string) => key === GROUP ? 'Everyone' : othersIn(key, username ?? '').join(', ') || 'Just you'

  function openThread(members: string[]) {
    if (!username) return
    const key = members.length ? threadKey([username, ...members]) : GROUP
    if (key !== GROUP) setDrafts(current => current.includes(key) ? current : [...current, key])
    setPane({ kind: 'thread', key })
  }

  async function postJson(body: unknown) {
    const response = await fetch('/api/group-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({})) as { message?: ChatMessage; error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Message not sent.')
    if (data.message) merge([data.message])
    return data
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || sending || activeKey === null || !username) return
    setSending(true); setError('')
    try {
      await postJson({ action: 'send', text, ...(activeKey === GROUP ? {} : { to: othersIn(activeKey, username) }) })
      setDraft('')
      stickBottom.current = true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Message not sent.')
    } finally {
      setSending(false)
    }
  }

  async function invite(names: string[]) {
    if (!module?.invite || !names.length || sending) return
    setSending(true); setError(''); setNotice('')
    try {
      let code: string | null = null
      if (module.invite === 'room') {
        setNotice(`Opening a ${module.label} room…`)
        code = await requestRoom()
        if (!code) throw new Error(`Couldn't open an online room in ${module.label}. Check your connection and try again.`)
      }
      if (module.invite === 'pool') for (const name of names) onPoolInvite(name)
      await postJson({ action: 'invite', to: names, module: module.id, label: module.label, ...(code ? { code } : {}) })
      setNotice(module.invite === 'room' ? `Invite sent. Room ${code} is open and waiting.` : 'Invite sent.')
    } catch (failure) {
      setNotice('')
      setError(failure instanceof Error ? failure.message : 'Invite not sent.')
    } finally {
      setSending(false)
    }
  }

  async function remove(id: number) {
    const response = await fetch('/api/group-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) }).catch(() => null)
    if (response?.ok) setMessages(current => current.filter(item => item.id !== id))
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
  }

  const knownNames = [...new Set([...others.map(item => item.username), ...messages.map(item => item.username), ...messages.flatMap(item => item.thread ? item.thread.split(',') : [])])].filter(name => name && name !== username).sort()
  const canInvite = Boolean(module?.invite)
  const inviteNote = module?.invite ? `Invite to ${module.label}` : ''

  const header = pane.kind === 'thread'
    ? <><button type="button" className="gc-icon" aria-label="Back to chats" onClick={() => setPane({ kind: 'list' })}><ArrowLeft size={16}/></button><span className="gc-title">{pane.key === GROUP ? <Users size={14}/> : <Lock size={13}/>}{titleFor(pane.key)}</span></>
    : pane.kind === 'new'
      ? <><button type="button" className="gc-icon" aria-label="Back to chats" onClick={() => setPane({ kind: 'list' })}><ArrowLeft size={16}/></button><span className="gc-title">New private chat</span></>
      : <span className="gc-title"><MessageCircle size={15}/> Chat</span>

  return <div className={`group-chat${open ? ' is-open' : ''}`}>
    {open && <section className="group-chat-panel" role="dialog" aria-label="Chat">
      <header>
        {header}
        <button type="button" className="gc-icon gc-close" aria-label="Close chat" onClick={() => setOpen(false)}><X size={16}/></button>
      </header>
      {!username ? <div className="group-chat-empty">
        <p>Sign in to chat, see who's online and send invites.</p>
        <button type="button" className="group-chat-signin" onClick={() => { setOpen(false); onSignIn() }}>Sign in</button>
      </div> : <>
        {(pane.kind === 'list' || pane.kind === 'online') && <div className="gc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={pane.kind === 'list'} className={pane.kind === 'list' ? 'is-active' : ''} onClick={() => setPane({ kind: 'list' })}>Chats{unreadTotal > 0 && <b>{unreadTotal}</b>}</button>
          <button type="button" role="tab" aria-selected={pane.kind === 'online'} className={pane.kind === 'online' ? 'is-active' : ''} onClick={() => setPane({ kind: 'online' })}><span className="gc-live"/>Online <em>{online.length}</em></button>
        </div>}

        {pane.kind === 'list' && <div className="gc-scroll">
          {threads.map(item => <button type="button" key={item.key || 'group'} className={`gc-row${item.unread ? ' has-unread' : ''}`} onClick={() => setPane({ kind: 'thread', key: item.key })}>
            <span className="gc-avatar" style={item.key === GROUP ? undefined : { background: `hsl(${hueFor(item.key)} 55% 45%)` }}>{item.key === GROUP ? <Users size={15}/> : othersIn(item.key, username).length > 1 ? othersIn(item.key, username).length : othersIn(item.key, username)[0]?.[0]?.toUpperCase()}</span>
            <span className="gc-row-text">
              <strong>{titleFor(item.key)}{item.key !== GROUP && <Lock size={10}/>}</strong>
              <small>{item.last ? `${item.last.username === username ? 'You' : item.last.username}: ${item.last.meta?.invite ? `invite to ${item.last.meta.invite.label}` : item.last.text}` : item.key === GROUP ? 'Everyone signed in can see this' : 'No messages yet'}</small>
            </span>
            {item.unread > 0 && <b className="gc-count">{item.unread}</b>}
          </button>)}
          <button type="button" className="gc-new" onClick={() => { setPicked([]); setTypedName(''); setPane({ kind: 'new' }) }}><Plus size={14}/> New private chat</button>
        </div>}

        {pane.kind === 'online' && <div className="gc-scroll">
          {canInvite && <p className="gc-hint">You're in <b>{module!.label}</b>. Invite someone to join you.</p>}
          {!others.length ? <p className="gc-hint">No one else is online right now.</p> : others.map(item => <div key={item.username} className="gc-person">
            <span className="gc-avatar" style={{ background: `hsl(${hueFor(item.username)} 55% 45%)` }}>{item.username[0].toUpperCase()}<i/></span>
            <span className="gc-row-text"><strong>{item.username}</strong><small>{label(item.activity)}</small></span>
            <button type="button" className="gc-mini" onClick={() => openThread([item.username])} aria-label={`Message ${item.username}`}><MessageCircle size={13}/> Message</button>
            {canInvite && <button type="button" className="gc-mini is-accent" disabled={sending} onClick={() => { openThread([item.username]); void invite([item.username]) }} aria-label={`${inviteNote}: ${item.username}`}><Gamepad2 size={13}/> Invite</button>}
          </div>)}
          {error && <small className="group-chat-error">{error}</small>}
        </div>}

        {pane.kind === 'new' && <div className="gc-scroll">
          <p className="gc-hint">Pick one or more people. Only the people in a private chat can read it.</p>
          <form className="gc-add" onSubmit={event => { event.preventDefault(); const name = typedName.trim().toLowerCase(); if (/^[a-z0-9_-]{3,20}$/.test(name) && name !== username && !picked.includes(name)) setPicked(current => [...current, name]); setTypedName('') }}>
            <input value={typedName} onChange={event => setTypedName(event.target.value)} placeholder="Add a username" aria-label="Add a username" maxLength={20}/>
            <button type="submit" aria-label="Add">Add</button>
          </form>
          {[...new Set([...picked, ...knownNames])].map(name => {
            const on = picked.includes(name)
            const isOnline = others.some(item => item.username === name)
            return <button type="button" key={name} className={`gc-pick${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setPicked(current => on ? current.filter(item => item !== name) : current.length >= 7 ? current : [...current, name])}>
              <span className="gc-check">{on && <Check size={12}/>}</span>{name}{isOnline && <span className="gc-live"/>}
            </button>
          })}
          <button type="button" className="group-chat-signin gc-start" disabled={!picked.length} onClick={() => openThread(picked)}>Start chat{picked.length > 1 ? ` with ${picked.length} people` : ''}</button>
        </div>}

        {pane.kind === 'thread' && <>
          {pane.key !== GROUP && canInvite && <div className="gc-invitebar"><span>{module!.label}</span><button type="button" className="gc-mini is-accent" disabled={sending} onClick={() => void invite(othersIn(pane.key, username))}><Gamepad2 size={13}/> {inviteNote}</button></div>}
          <div className="group-chat-list" ref={listRef} onScroll={event => { const el = event.currentTarget; stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
            {!shown.length ? <p className="group-chat-hint">{pane.key === GROUP ? 'No messages yet. Say hi!' : `Private chat with ${titleFor(pane.key)}. Only you ${othersIn(pane.key, username).length > 1 ? 'all' : 'two'} can see it.`}</p> : shown.map((item, index) => {
              const mine = item.username === username
              const grouped = index > 0 && shown[index - 1].username === item.username && item.at - shown[index - 1].at < 180000 && !item.meta?.invite
              const card = item.meta?.invite
              return <div key={item.id} className={`group-chat-msg${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}`}>
                {!grouped && <div className="group-chat-meta"><strong style={{ color: mine ? undefined : `hsl(${hueFor(item.username)} 75% var(--gc-name-l))` }}>{mine ? 'You' : item.username}</strong><time>{timeLabel(item.at)}</time></div>}
                {card ? <div className="gc-card">
                  <span><Gamepad2 size={14}/> {mine ? `You sent an invite to ${card.label}` : `${item.username} invited you to ${card.label}`}</span>
                  {card.code && <small>Room {card.code}</small>}
                  {!mine && <button type="button" onClick={() => { onJoinInvite(card); setOpen(false) }}>Join</button>}
                </div> : <p>{item.text}</p>}
                {(isAdmin || mine) && <button type="button" className="group-chat-del" aria-label="Remove message" title="Remove message" onClick={() => void remove(item.id)}><Trash2 size={12}/></button>}
              </div>
            })}
          </div>
          {notice && !error && <small className="gc-notice">{notice}</small>}
          <form className="group-chat-form" onSubmit={send}>
            <textarea value={draft} maxLength={500} rows={1} placeholder={pane.key === GROUP ? 'Message everyone…' : `Message ${titleFor(pane.key)}…`} aria-label="Message" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={onKey}/>
            <button type="submit" aria-label="Send" disabled={!draft.trim() || sending}><Send size={15}/></button>
          </form>
          {error && <small className="group-chat-error">{error}</small>}
        </>}
      </>}
    </section>}
    <button type="button" className={`group-chat-toggle${unreadTotal ? ' has-unread' : ''}${unreadTotal && !open ? ' is-blinking' : ''}`} aria-label={unreadTotal ? `Chat, ${unreadTotal} unread` : 'Chat'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <X size={20}/> : <MessageCircle size={21}/>}
      {!open && unreadTotal > 0 && <i aria-hidden="true"/>}
      {!open && username && others.length > 0 && <em className="gc-online-count" aria-hidden="true">{others.length}</em>}
    </button>
  </div>
}
