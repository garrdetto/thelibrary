import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeft, Check, CheckCheck, Gamepad2, Lock, MessageCircle, Minus, Plus, Send, Trash2, Users } from 'lucide-react'
import { useBlinkingFavicon } from '@/lib/use-blinking-favicon'
import { agoLabel, isTabActive, lastActiveLabel, placeLabel, presenceStatus } from '@/lib/chat-presence'
import type { ChatPresence, PresenceStatus } from '@/lib/chat-presence'

export type ChatInvite = { module: string; label: string; code: string | null }
export type InviteKind = 'room' | 'pool' | 'link'
export type ChatModule = { id: string; label: string; invite: InviteKind | null }

type ChatMessage = { id: number; username: string; text: string; at: number; thread: string | null; meta: { invite?: ChatInvite } | null }
type ReadMark = { username: string; thread: string | null; id: number }
type Removal = { thread: string | null; id: number | null; upTo: number | null }
type Pane = { kind: 'list' } | { kind: 'people' } | { kind: 'new' } | { kind: 'thread'; key: string }
type Thread = { key: string; last: ChatMessage | null; unread: number; lastUnread: ChatMessage | null }

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
const keepsFocus = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [data-gc-text]'))
const newestOf = (threads: Thread[]) => threads.reduce<ChatMessage | null>((best, item) => item.lastUnread && (!best || item.lastUnread.id > best.id) ? item.lastUnread : best, null)
const compactAgo = (at: number, now: number) => { const label = agoLabel(at, now); return label === 'just now' ? 'now' : label.replace(' ago', '') }

function Avatar({ name, status, group }: { name: string; status?: PresenceStatus; group?: number }) {
  const everyone = group === 0
  return <span className={`gc-avatar${everyone ? ' is-group' : ''}`} style={everyone ? undefined : { background: `hsl(${hueFor(name)} 38% 42%)` }} aria-hidden="true">
    {everyone ? <Users size={14}/> : group && group > 1 ? group : name[0]?.toUpperCase()}
    {status && status !== 'offline' && <i className={`gc-dot is-${status}`}/>}
  </span>
}

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
  const [online, setOnline] = useState<ChatPresence[]>([])
  const [recent, setRecent] = useState<ChatPresence[]>([])
  const [onlineLoaded, setOnlineLoaded] = useState(false)
  const [guestCount, setGuestCount] = useState<number | null>(null)
  const [reads, setReads] = useState<ReadMark[]>([])
  const [visible, setVisible] = useState(true)
  const [clockOffset, setClockOffset] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const reported = useRef<Record<string, number>>({})
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [typedName, setTypedName] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const lastInput = useRef(0)
  const lastId = useRef(0)
  const loaded = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const openRef = useRef(open)
  openRef.current = open
  const activity = module?.id ?? 'home'
  const activityRef = useRef(activity)
  activityRef.current = activity
  const now = clock + clockOffset

  const applyRemovals = useCallback((removed: Removal[]) => {
    if (!removed.length) return
    setMessages(current => {
      const next = current.filter(item => !removed.some(mark => (mark.thread ?? GROUP) === (item.thread ?? GROUP) && (mark.id === item.id || (mark.upTo !== null && item.id <= mark.upTo))))
      return next.length === current.length ? current : next
    })
  }, [])

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
      const params = new URLSearchParams({ activity: activityRef.current, active: isTabActive(lastInput.current) ? '1' : '0' })
      if (lastId.current) params.set('after', String(lastId.current))
      const response = await fetch(`/api/group-chat?${params}`, { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { messages: ChatMessage[]; isAdmin: boolean; online: ChatPresence[]; recent?: ChatPresence[]; reads?: ReadMark[]; removed?: Removal[]; now?: number }
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
      applyRemovals(data.removed ?? [])
      setOnline(data.online)
      setRecent(data.recent ?? [])
      setOnlineLoaded(true)
      setReads(data.reads ?? [])
      setIsAdmin(data.isAdmin)
      if (typeof data.now === 'number') setClockOffset(data.now - Date.now())
      setClock(Date.now())
    } catch { /* offline: try again next tick */ }
  }, [username, merge, applyRemovals])

  useEffect(() => {
    const mark = () => { lastInput.current = Date.now() }
    mark()
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    window.addEventListener('pointermove', mark, { passive: true })
    window.addEventListener('focus', mark)
    const timer = window.setInterval(() => setClock(Date.now()), 30000)
    return () => {
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
      window.removeEventListener('pointermove', mark)
      window.removeEventListener('focus', mark)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setMessages([]); setOnline([]); setRecent([]); setOnlineLoaded(false); setReads([]); setSeen({}); lastId.current = 0; loaded.current = false; reported.current = {}
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

  useEffect(() => {
    if (username) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const response = await fetch('/api/group-chat?count', { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json() as { count: number }
          if (!stopped) setGuestCount(data.count)
        }
      } catch { /* offline: try again next tick */ }
      if (!stopped) timer = setTimeout(() => void tick(), document.hidden ? 60000 : 30000)
    }
    void tick()
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void tick() } }
    document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [username])

  useEffect(() => { if (open && username) void poll() }, [open, username, poll])
  useEffect(() => { if (username) void poll() }, [activity, username, poll])

  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (event.target instanceof Element && !rootRef.current?.contains(event.target)) returnFocus.current = event.target
    }
    const rememberFrame = () => window.setTimeout(() => {
      const active = document.activeElement
      if (active instanceof HTMLIFrameElement && !rootRef.current?.contains(active)) returnFocus.current = active
    }, 0)
    document.addEventListener('focusin', remember)
    window.addEventListener('blur', rememberFrame)
    return () => { document.removeEventListener('focusin', remember); window.removeEventListener('blur', rememberFrame) }
  }, [])

  const minimize = useCallback((restore: boolean) => {
    setOpen(false)
    if (!restore || !rootRef.current?.contains(document.activeElement)) return
    const target = returnFocus.current
    if (target instanceof HTMLIFrameElement && target.isConnected) target.contentWindow?.focus()
    else if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur()
  }, [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close() }
    const frames = new Set<Document>()
    const watchFrames = () => {
      for (const frame of document.querySelectorAll('iframe')) {
        try {
          const doc = frame.contentDocument
          if (doc && !frames.has(doc)) { doc.addEventListener('pointerdown', close, true); frames.add(doc) }
        } catch { /* cross-origin frame: the window blur below covers it */ }
      }
    }
    const blurred = () => window.setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME') close() }, 0)
    watchFrames()
    const timer = window.setInterval(watchFrames, 1500)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', blurred)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', blurred)
      for (const doc of frames) { try { doc.removeEventListener('pointerdown', close, true) } catch { /* frame gone */ } }
    }
  }, [open])

  const threads = useMemo(() => {
    const map = new Map<string, Thread>()
    map.set(GROUP, { key: GROUP, last: null, unread: 0, lastUnread: null })
    for (const key of drafts) if (!map.has(key)) map.set(key, { key, last: null, unread: 0, lastUnread: null })
    for (const item of messages) {
      const key = item.thread ?? GROUP
      const entry = map.get(key) ?? { key, last: null, unread: 0, lastUnread: null }
      entry.last = item
      if (item.id > (seen[key] ?? 0) && item.username !== username) { entry.unread += 1; entry.lastUnread = item }
      map.set(key, entry)
    }
    const list = [...map.values()]
    return [list[0], ...list.slice(1).sort((a, b) => (b.last?.id ?? Number.MAX_SAFE_INTEGER) - (a.last?.id ?? Number.MAX_SAFE_INTEGER))]
  }, [messages, seen, username, drafts])

  const activeKey = pane.kind === 'thread' ? pane.key : null
  const shown = activeKey === null ? [] : messages.filter(item => (item.thread ?? GROUP) === activeKey)

  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (!open || activeKey === null || !username || !shown.length || !visible) return
    const top = shown[shown.length - 1].id
    if ((reported.current[activeKey] ?? 0) < top) {
      const key = activeKey
      reported.current[key] = top
      void fetch('/api/group-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', thread: key === GROUP ? null : key, id: top }) })
        .then(response => { if (!response.ok) reported.current[key] = 0 })
        .catch(() => { reported.current[key] = 0 })
    }
    if ((seen[activeKey] ?? 0) >= top) return
    const next = { ...seen, [activeKey]: top }
    setSeen(next)
    saveSeen(username, next)
  }, [open, activeKey, shown, seen, username, visible])

  useEffect(() => {
    const list = listRef.current
    if (open && list && stickBottom.current) list.scrollTop = list.scrollHeight
  }, [shown.length, open, activeKey])

  useEffect(() => { setError(''); setNotice(''); setConfirmClear(false); stickBottom.current = true }, [pane])

  const unreadTotal = threads.reduce((sum, item) => sum + item.unread, 0)
  const newest = newestOf(threads)
  const elsewhereNewest = newestOf(threads.filter(item => item.key !== activeKey))
  useBlinkingFavicon(unreadTotal > 0)
  const people = useMemo(() => new Map([...recent, ...online].map(item => [item.username, item])), [online, recent])
  const others = online.filter(item => item.username !== username)
  const recentOthers = recent.filter(item => item.username !== username)
  const onlineCount = username ? (onlineLoaded ? online.length : null) : guestCount
  const titleFor = (key: string) => key === GROUP ? 'Everyone' : othersIn(key, username ?? '').join(', ') || 'Just you'
  const lastMine = [...shown].reverse().find(item => item.username === username) ?? null
  const seenBy = lastMine && activeKey !== null ? [...new Set(reads.filter(mark => (mark.thread ?? GROUP) === activeKey && mark.id >= lastMine.id && mark.username !== username).map(mark => mark.username))].sort() : []
  const members = activeKey && activeKey !== GROUP ? othersIn(activeKey, username ?? '') : []
  const receipt = !seenBy.length ? 'Sent'
    : members.length === 1 ? 'Seen'
      : members.length > 1 && members.every(name => seenBy.includes(name)) ? 'Seen by everyone'
        : `Seen by ${seenBy.slice(0, 3).join(', ')}${seenBy.length > 3 ? ` +${seenBy.length - 3}` : ''}`

  function openThread(names: string[]) {
    if (!username) return
    const key = names.length ? threadKey([username, ...names]) : GROUP
    if (key !== GROUP) setDrafts(current => current.includes(key) ? current : [...current, key])
    setPane({ kind: 'thread', key })
  }

  function openNewest() {
    setOpen(true)
    if (username && newest) setPane({ kind: 'thread', key: newest.thread ?? GROUP })
  }

  async function postJson(body: unknown) {
    const response = await fetch('/api/group-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({})) as { message?: ChatMessage; error?: string }
    if (!response.ok) throw new Error(data.error ?? 'Request failed. Try again.')
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

  async function clearChat(key: string) {
    if (clearing) return
    setClearing(true); setError('')
    try {
      const data = await postJson({ action: 'clear', thread: key === GROUP ? null : key }) as { upTo?: number }
      const upTo = data.upTo ?? Number.MAX_SAFE_INTEGER
      setMessages(current => current.filter(item => (item.thread ?? GROUP) !== key || item.id > upTo))
      setDrafts(current => current.filter(item => item !== key))
      setPane({ kind: 'list' })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Chat not deleted.')
    } finally {
      setClearing(false)
    }
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
  }

  function onRootKey(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (event.key === 'Escape' && open) { event.preventDefault(); minimize(true) }
  }

  function onRootMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const active = document.activeElement
    if (active && active !== document.body && !event.currentTarget.contains(active)) returnFocus.current = active
    if (!keepsFocus(event.target)) event.preventDefault()
  }

  const knownNames = [...new Set([...others.map(item => item.username), ...recentOthers.map(item => item.username), ...messages.map(item => item.username), ...messages.flatMap(item => item.thread ? item.thread.split(',') : [])])].filter(name => name && name !== username).sort()
  const canInvite = Boolean(module?.invite)
  const inviteNote = module?.invite ? `Invite to ${module.label}` : ''

  function presenceLine(key: string) {
    if (key === GROUP) return onlineCount === null ? 'Everyone signed in' : `${onlineCount} online now`
    const names = othersIn(key, username ?? '')
    if (names.length > 1) {
      const here = names.filter(name => people.get(name)?.online).length
      return here ? `${names.length} people · ${here} online` : `${names.length} people`
    }
    const person = people.get(names[0])
    return person ? `${lastActiveLabel(person, now)} · ${placeLabel(person, activityLabels, now)}` : 'Not seen recently'
  }

  function personRow(person: ChatPresence) {
    const status = presenceStatus(person, now)
    return <div key={person.username} className="gc-person">
      <Avatar name={person.username} status={status}/>
      <span className="gc-row-text">
        <strong>{person.username}</strong>
        <small>{placeLabel(person, activityLabels, now)}</small>
      </span>
      <span className={`gc-when is-${status}`}>{status === 'offline' ? agoLabel(Math.max(person.activeAt, person.lastSeen), now) : lastActiveLabel(person, now)}</span>
      <span className="gc-person-actions">
        <button type="button" className="gc-icon" onClick={() => openThread([person.username])} aria-label={`Message ${person.username}`} title="Message"><MessageCircle size={15}/></button>
        {canInvite && person.online && <button type="button" className="gc-icon is-accent" disabled={sending} onClick={() => { openThread([person.username]); void invite([person.username]) }} aria-label={`${inviteNote}: ${person.username}`} title={inviteNote}><Gamepad2 size={15}/></button>}
      </span>
    </div>
  }

  const back = <button type="button" className="gc-icon" aria-label="Back to chats" onClick={() => setPane({ kind: 'list' })}><ArrowLeft size={16}/></button>
  const threadNames = pane.kind === 'thread' ? othersIn(pane.key, username ?? '') : []
  const header = pane.kind === 'thread'
    ? <>{back}<Avatar name={threadNames[0] ?? 'everyone'} group={pane.key === GROUP ? 0 : threadNames.length} status={threadNames.length === 1 ? presenceStatus(people.get(threadNames[0]), now) : undefined}/><span className="gc-heading"><strong>{titleFor(pane.key)}{pane.key !== GROUP && <Lock size={10} aria-label="Private"/>}</strong><small>{presenceLine(pane.key)}</small></span>{(pane.key !== GROUP || isAdmin) && <button type="button" className={`gc-icon gc-clear${confirmClear ? ' is-on' : ''}`} aria-label={pane.key === GROUP ? 'Clear the Everyone chat' : 'Delete this chat'} title={pane.key === GROUP ? 'Clear chat' : 'Delete chat'} aria-expanded={confirmClear} onClick={() => setConfirmClear(value => !value)}><Trash2 size={15}/></button>}</>
    : pane.kind === 'new'
      ? <>{back}<span className="gc-heading"><strong>New private chat</strong><small>Up to 8 people</small></span></>
      : <span className="gc-heading"><strong>Messages</strong><small>{onlineCount === null ? 'Connecting…' : `${onlineCount} online now`}</small></span>

  const alerting = unreadTotal > 0 && !open

  return <div ref={rootRef} className={`group-chat ribbon-item${open ? ' is-open' : ''}`} onKeyDown={onRootKey} onKeyUp={event => event.stopPropagation()} onMouseDown={onRootMouseDown}>
    {open && <section className="group-chat-panel" role="dialog" aria-label="Messages">
      <header>
        {header}
        <button type="button" className="gc-icon gc-close" aria-label="Minimize chat" title="Minimize" onClick={() => minimize(true)}><Minus size={16}/></button>
      </header>
      {!username ? <div className="group-chat-empty">
        <MessageCircle size={26} aria-hidden="true"/>
        <p>Sign in to message people, see who's online and send invites.</p>
        <button type="button" className="gc-primary" onClick={() => { setOpen(false); onSignIn() }}>Sign in</button>
      </div> : <>
        {elsewhereNewest && pane.kind === 'thread' && <button type="button" className="gc-alert" onClick={() => setPane({ kind: 'thread', key: elsewhereNewest.thread ?? GROUP })}>
          <span className="gc-alert-dot" aria-hidden="true"/>You have a new message! <small>from {elsewhereNewest.username}</small>
        </button>}
        {(pane.kind === 'list' || pane.kind === 'people') && <div className="gc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={pane.kind === 'list'} className={pane.kind === 'list' ? 'is-active' : ''} onClick={() => setPane({ kind: 'list' })}>Chats{unreadTotal > 0 && <b>{unreadTotal}</b>}</button>
          <button type="button" role="tab" aria-selected={pane.kind === 'people'} className={pane.kind === 'people' ? 'is-active' : ''} onClick={() => setPane({ kind: 'people' })}>People <em>{online.length}</em></button>
        </div>}

        {pane.kind === 'list' && <div className="gc-scroll">
          {threads.map(item => {
            const names = othersIn(item.key, username)
            return <button type="button" key={item.key || 'group'} className={`gc-row${item.unread ? ' has-unread' : ''}`} onClick={() => setPane({ kind: 'thread', key: item.key })}>
              <Avatar name={names[0] ?? 'everyone'} group={item.key === GROUP ? 0 : names.length} status={names.length === 1 ? presenceStatus(people.get(names[0]), now) : undefined}/>
              <span className="gc-row-text">
                <strong>{titleFor(item.key)}{item.key !== GROUP && <Lock size={10} aria-label="Private"/>}</strong>
                <small>{item.last ? `${item.last.username === username ? 'You' : item.last.username}: ${item.last.meta?.invite ? `invite to ${item.last.meta.invite.label}` : item.last.text}` : item.key === GROUP ? 'Everyone signed in can see this' : 'No messages yet'}</small>
              </span>
              <span className="gc-row-side">
                {item.last && <time>{compactAgo(item.last.at, now)}</time>}
                {item.unread > 0 && <b className="gc-count">{item.unread}</b>}
              </span>
            </button>
          })}
          <button type="button" className="gc-new" onClick={() => { setPicked([]); setTypedName(''); setPane({ kind: 'new' }) }}><Plus size={14}/> New private chat</button>
        </div>}

        {pane.kind === 'people' && <div className="gc-scroll">
          {canInvite && <p className="gc-hint">You're in <b>{module!.label}</b>. Invite someone online to join you.</p>}
          <h3 className="gc-section">Online <span>{others.length}</span></h3>
          {!others.length ? <p className="gc-hint">No one else is online right now.</p> : others.map(personRow)}
          {recentOthers.length > 0 && <>
            <h3 className="gc-section">Recently active</h3>
            {recentOthers.map(personRow)}
          </>}
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
            const status = presenceStatus(people.get(name), now)
            return <button type="button" key={name} className={`gc-pick${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setPicked(current => on ? current.filter(item => item !== name) : current.length >= 7 ? current : [...current, name])}>
              <span className="gc-check">{on && <Check size={12}/>}</span>{name}{status !== 'offline' && <i className={`gc-dot is-${status} is-inline`} aria-label={status === 'active' ? 'Online' : 'Idle'}/>}
            </button>
          })}
          <button type="button" className="gc-primary gc-start" disabled={!picked.length} onClick={() => openThread(picked)}>Start chat{picked.length > 1 ? ` with ${picked.length} people` : ''}</button>
        </div>}

        {pane.kind === 'thread' && <>
          {confirmClear && <div className="gc-confirm" role="alertdialog" aria-label="Delete chat">
            <p>{pane.key === GROUP ? 'Clear every message in the Everyone chat? This removes them for everyone.' : 'Delete this chat? Every message in it is removed for everyone in the chat.'}</p>
            <span>
              <button type="button" className="gc-mini" onClick={() => setConfirmClear(false)} disabled={clearing}>Cancel</button>
              <button type="button" className="gc-mini is-danger" onClick={() => void clearChat(pane.key)} disabled={clearing}>{clearing ? 'Deleting…' : pane.key === GROUP ? 'Clear chat' : 'Delete chat'}</button>
            </span>
          </div>}
          {pane.key !== GROUP && canInvite && <div className="gc-invitebar"><span>{module!.label}</span><button type="button" className="gc-mini is-accent" disabled={sending} onClick={() => void invite(othersIn(pane.key, username))}><Gamepad2 size={13}/> {inviteNote}</button></div>}
          <div className="group-chat-list" ref={listRef} onScroll={event => { const el = event.currentTarget; stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
            {!shown.length ? <p className="group-chat-hint">{pane.key === GROUP ? 'No messages yet. Say hi!' : `Private chat with ${titleFor(pane.key)}. Only you ${othersIn(pane.key, username).length > 1 ? 'all' : 'two'} can see it.`}</p> : shown.map((item, index) => {
              const mine = item.username === username
              const grouped = index > 0 && shown[index - 1].username === item.username && item.at - shown[index - 1].at < 180000 && !item.meta?.invite
              const card = item.meta?.invite
              return <div key={item.id} className={`group-chat-msg${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}`}>
                {!grouped && <div className="group-chat-meta"><strong style={{ color: mine ? undefined : `hsl(${hueFor(item.username)} 70% var(--gc-name-l))` }}>{mine ? 'You' : item.username}</strong><time>{timeLabel(item.at)}</time></div>}
                {card ? <div className="gc-card">
                  <span><Gamepad2 size={14}/> {mine ? `You sent an invite to ${card.label}` : `${item.username} invited you to ${card.label}`}</span>
                  {card.code && <small>Room {card.code}</small>}
                  {!mine && <button type="button" onClick={() => { onJoinInvite(card); setOpen(false) }}>Join</button>}
                </div> : <p data-gc-text>{item.text}</p>}
                {lastMine?.id === item.id && <small className={`gc-receipt${seenBy.length ? ' is-seen' : ''}`} title={seenBy.length ? `Seen by ${seenBy.join(', ')}` : 'Not seen yet'}>{seenBy.length ? <CheckCheck size={12} aria-hidden="true"/> : <Check size={12} aria-hidden="true"/>}{receipt}</small>}
                {(isAdmin || mine) && <button type="button" className="group-chat-del" aria-label="Remove message" title="Remove message" onClick={() => void remove(item.id)}><Trash2 size={12}/></button>}
              </div>
            })}
          </div>
          {notice && !error && <small className="gc-notice">{notice}</small>}
          <form className="group-chat-form" onSubmit={send}>
            <textarea value={draft} maxLength={500} rows={1} placeholder={pane.key === GROUP ? 'Message everyone…' : `Message ${titleFor(pane.key)}…`} aria-label="Message" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={onComposerKey}/>
            <button type="submit" aria-label="Send" disabled={!draft.trim() || sending}><Send size={14}/></button>
          </form>
          {error && <small className="group-chat-error">{error}</small>}
        </>}
      </>}
    </section>}
    <button type="button" className={`gc-pill${alerting ? ' is-alert' : ''}${open ? ' is-open' : ''}`} aria-expanded={open}
      aria-label={alerting ? `You have a new message from ${newest?.username ?? 'someone'}. Open chat.` : open ? 'Minimize chat' : `Open chat${onlineCount !== null ? `, ${onlineCount} online` : ''}`}
      onClick={() => open ? minimize(true) : alerting ? openNewest() : setOpen(true)}>
      <span className="gc-pill-icon"><MessageCircle size={15}/></span>
      {alerting ? <span className="gc-pill-text"><strong>You have a new message!</strong>{newest && <small>from {newest.username}</small>}</span> : <>
        <span className="gc-pill-label">Chat</span>
        {onlineCount !== null && <span className="gc-pill-online"><i className="gc-dot is-active is-inline" aria-hidden="true"/>{onlineCount} online</span>}
      </>}
      {unreadTotal > 0 && <b className="gc-pill-count">{unreadTotal > 99 ? '99+' : unreadTotal}</b>}
    </button>
    <span className="gc-live-region" role="status" aria-live="polite">{alerting && newest ? `You have a new message from ${newest.username}.` : ''}</span>
  </div>
}
