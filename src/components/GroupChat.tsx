import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { MessageCircle, Send, Trash2, X } from 'lucide-react'

type ChatMessage = { id: number; username: string; text: string; at: number }

const SEEN_KEY = 'tl_chat_seen'
const readSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0 } catch { return 0 } }
const writeSeen = (id: number) => { try { localStorage.setItem(SEEN_KEY, String(id)) } catch { /* storage unavailable */ } }

function timeLabel(at: number) {
  const date = new Date(at)
  const today = new Date()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return date.toDateString() === today.toDateString() ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

function hueFor(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

export function GroupChat({ username, onSignIn }: { username: string | null; onSignIn: () => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [latest, setLatest] = useState(0)
  const [seen, setSeen] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const lastId = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => { setSeen(readSeen()) }, [])

  const merge = useCallback((incoming: ChatMessage[], replace = false) => {
    setMessages(current => {
      const map = new Map((replace ? [] : current).map(item => [item.id, item]))
      for (const item of incoming) map.set(item.id, item)
      const next = [...map.values()].sort((a, b) => a.id - b.id).slice(-200)
      lastId.current = next.length ? next[next.length - 1].id : lastId.current
      return next
    })
  }, [])

  const poll = useCallback(async (full = false) => {
    if (!username) return
    try {
      const response = await fetch(`/api/group-chat${full || !lastId.current ? '' : `?after=${lastId.current}`}`, { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json() as { messages: ChatMessage[]; latest: number; isAdmin: boolean }
      merge(data.messages, full)
      setLatest(data.latest)
      setIsAdmin(data.isAdmin)
      if (full) lastId.current = data.latest
    } catch { /* offline: try again next tick */ }
  }, [username, merge])

  useEffect(() => {
    if (!username) { setMessages([]); setLatest(0); lastId.current = 0; return }
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async (full: boolean) => {
      await poll(full)
      if (stopped) return
      const delay = document.hidden ? 30000 : openRef.current ? 2500 : 10000
      timer = setTimeout(() => void tick(false), delay)
    }
    void tick(true)
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void tick(false) } }
    document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [username, poll])

  useEffect(() => { if (open && username) void poll(false) }, [open, username, poll])

  useEffect(() => {
    if (!open || !latest) return
    writeSeen(latest)
    setSeen(latest)
  }, [open, latest])

  useEffect(() => {
    const list = listRef.current
    if (open && list && stickBottom.current) list.scrollTop = list.scrollHeight
  }, [messages, open])

  const unread = Boolean(username) && latest > seen && messages.some(item => item.id > seen && item.username !== username)

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/group-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', text }) })
      const data = await response.json() as { message?: ChatMessage; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Message not sent.')
      setDraft('')
      stickBottom.current = true
      if (data.message) { merge([data.message]); setLatest(id => Math.max(id, data.message!.id)) }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Message not sent.')
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

  return <div className={`group-chat${open ? ' is-open' : ''}`}>
    {open && <section className="group-chat-panel" role="dialog" aria-label="Group chat">
      <header>
        <span><MessageCircle size={15}/> Group chat</span>
        <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={16}/></button>
      </header>
      {!username ? <div className="group-chat-empty">
        <p>Sign in to read and send messages.</p>
        <button type="button" className="group-chat-signin" onClick={() => { setOpen(false); onSignIn() }}>Sign in</button>
      </div> : <>
        <div className="group-chat-list" ref={listRef} onScroll={event => { const el = event.currentTarget; stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
          {!messages.length ? <p className="group-chat-hint">No messages yet. Say hi!</p> : messages.map((item, index) => {
            const mine = item.username === username
            const grouped = index > 0 && messages[index - 1].username === item.username && item.at - messages[index - 1].at < 180000
            return <div key={item.id} className={`group-chat-msg${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}`}>
              {!grouped && <div className="group-chat-meta"><strong style={{ color: mine ? undefined : `hsl(${hueFor(item.username)} 80% 70%)` }}>{mine ? 'You' : item.username}</strong><time>{timeLabel(item.at)}</time></div>}
              <p>{item.text}</p>
              {isAdmin && <button type="button" className="group-chat-del" aria-label="Remove message" title="Remove message" onClick={() => void remove(item.id)}><Trash2 size={12}/></button>}
            </div>
          })}
        </div>
        <form className="group-chat-form" onSubmit={send}>
          <textarea value={draft} maxLength={500} rows={1} placeholder="Message everyone…" aria-label="Message" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={onKey}/>
          <button type="submit" aria-label="Send" disabled={!draft.trim() || sending}><Send size={15}/></button>
        </form>
        {error && <small className="group-chat-error">{error}</small>}
      </>}
    </section>}
    <button type="button" className={`group-chat-toggle${unread ? ' has-unread' : ''}`} aria-label={unread ? 'Group chat, new messages' : 'Group chat'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <X size={20}/> : <MessageCircle size={21}/>}
      {unread && !open && <i aria-hidden="true"/>}
    </button>
  </div>
}
