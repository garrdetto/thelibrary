import type { CueDesign } from '../lib/cue-design'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { Bell, BellOff, ChevronDown, MessageCircle, SendHorizontal, Trophy, Users, X } from 'lucide-react'
import type { PoolActivity, PoolBridge, PoolChatMessage, PoolGameState, PoolInvite, PoolMatch, PoolPlayer, PoolPoint, PoolSeat, PoolShot, PoolSnapshot, PoolStatus, PoolToast, RaceInvite } from '../lib/pool-network'

const defaultPoolServerUrl = 'https://thelibrary-production.up.railway.app'
const soundStorageKey = 'pool-sound'
const idleTimeout = 5 * 60 * 1000
const toastDuration = 4500
const joinTimeout = 8000
const joinTimeoutMessage = 'The game server didn’t respond. It may be running an outdated version. Please try again shortly.'
const usernamePattern = /^[a-zA-Z0-9_-]{3,20}$/
const chatLimit = 120
export const ballColors = ['#f8f4df', '#edbc18', '#1957b9', '#c52c30', '#753698', '#ed7923', '#16744a', '#862c35', '#151b20']
const chatMaxLength = 280
const statusLabels: Record<PoolStatus, string> = { available: 'Available', 'in-game': 'In game', away: 'Away' }
type Connection = 'Connecting' | 'Connected' | 'Reconnecting' | 'Connection failed' | 'Signed in elsewhere'

function readStorage(key: string) {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}

function writeStorage(key: string, value: string) {
  try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key) } catch { return }
}

function playChallengeChime(context: AudioContext) {
  if (context.state === 'suspended') void context.resume()
  const start = context.currentTime + .02
  for (const [offset, frequency] of [[0, 1318.5], [.13, 1975.5]]) {
    const oscillator = context.createOscillator(), gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(.14, start + offset + .015)
    gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .55)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + .6)
  }
}

export function presenceLabel(player: PoolPlayer) {
  if (player.status === 'in-game') return 'Playing pool'
  if (player.game === 'racing' && player.playing) return 'Racing now'
  const place = player.game === 'pool' ? 'Pool lobby' : player.game === 'racing' ? 'Racing lobby' : 'Online'
  return player.status === 'away' ? `Away · ${place}` : place
}

export function usePoolLobby(accountName: string | null = null, accountReady = true, activity: PoolActivity = 'pool') {
  const [connection, setConnection] = useState<Connection>('Connecting')
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [match, setMatch] = useState<PoolMatch | null>(null)
  const [players, setPlayers] = useState<PoolPlayer[]>([])
  const [pendingInvites, setPendingInvites] = useState<Record<string, string>>({})
  const [invitations, setInvitations] = useState<PoolInvite[]>([])
  const [raceInvites, setRaceInvites] = useState<RaceInvite[]>([])
  const [toasts, setToasts] = useState<PoolToast[]>([])
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)
  const [open, setOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [gameState, setGameState] = useState<PoolGameState | null>(null)
  const [opponentCue, setOpponentCue] = useState<CueDesign | null>(null)
  const [socketId, setSocketId] = useState('')
  const [messages, setMessages] = useState<PoolChatMessage[]>([])
  const socket = useRef<Socket | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const toastId = useRef(0)
  const joinTimer = useRef<number | undefined>(undefined)
  const preferences = useRef({ savedName: '', soundOn: true, dismissed: false })
  const state = useRef({ name, match, connected: false, pending: false, authority: false, sequence: 0, game: null as PoolGameState | null, socketId: '' })
  const bridge = useRef<PoolBridge>({
    play: null, sync: null, reset: null, placeCue: null, opponentAim: null,
    sendCueDesign: design => new Promise(resolve => {
      if (!state.current.match || !socket.current?.connected) { resolve(false); return }
      socket.current.timeout(2500).emit('cue-design', design, (error: Error | null, response?: { saved: boolean }) => resolve(!error && response?.saved === true))
    }),
    sendAim: (aim, pull, cuePosition) => { if (state.current.match) socket.current?.volatile.emit('cue-aim', { aim, pull, ...(cuePosition ? { cuePosition } : {}) }) },
    sendCuePosition: point => { if (state.current.match && socket.current?.connected) socket.current.emit('cue-position', point) },
    canShoot: () => {
      const current = state.current
      if (!current.match) return true
      return current.connected && !current.pending && Boolean(current.game) && !current.game?.winner && current.game?.activeTurnPlayerID === current.socketId
    },
    sendShot: shot => { state.current.pending = true; socket.current?.emit('shot', shot) },
    sendSettled: (balls, details) => { if (state.current.authority) socket.current?.emit('settled', { sequence: state.current.sequence, balls, ...details }) },
  })

  const toast = useCallback((message: string, tone: PoolToast['tone'] = 'info') => {
    const id = ++toastId.current
    setToasts(current => [...current.slice(-3), { id, message, tone }])
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), toastDuration)
  }, [])

  const chime = useCallback(() => {
    if (!preferences.current.soundOn) return
    try {
      audio.current ??= new AudioContext()
      playChallengeChime(audio.current)
    } catch { return }
  }, [])

  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext()
        if (audio.current.state === 'suspended') void audio.current.resume()
      } catch { return }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); void audio.current?.close(); audio.current = null }
  }, [])

  const stopJoinTimer = useCallback(() => { window.clearTimeout(joinTimer.current); joinTimer.current = undefined }, [])

  const requestUsername = useCallback((username: string) => {
    window.clearTimeout(joinTimer.current)
    setJoining(true)
    joinTimer.current = window.setTimeout(() => {
      joinTimer.current = undefined
      setJoining(false); setJoinError(joinTimeoutMessage); setOpen(true)
    }, joinTimeout)
    socket.current?.emit('set-username', username)
  }, [])

  useEffect(() => {
    if (!accountReady || !accountName) return
    const stored = accountName
    const sound = readStorage(soundStorageKey) !== 'off'
    preferences.current = { savedName: stored, soundOn: sound, dismissed: false }
    setSavedName(stored)
    setSoundOn(sound)
    void fetch('/api/account-settings').then(response => response.ok ? response.json() : null).then(result => {
      const saved = result?.settings?.lobbySound
      if (typeof saved !== 'boolean') return
      preferences.current.soundOn = saved
      writeStorage(soundStorageKey, saved ? 'on' : 'off')
      setSoundOn(saved)
    }).catch(() => undefined)
    const url = import.meta.env.VITE_POOL_SERVER_URL || defaultPoolServerUrl
    const client = io(url, { autoConnect: true, reconnectionAttempts: 10, auth: callback => {
      void fetch('/api/pool-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ticket' }) })
        .then(async response => {
          if (!response.ok) throw new Error('Sign in again to connect.')
          const result = await response.json()
          callback({ ticket: result.ticket })
        }).catch(() => { setConnection('Connection failed'); setJoinError('Unable to verify your account. Sign in again or retry.'); callback({ ticket: '' }) })
    } })
    socket.current = client
    const endMatch = () => { setOpponentCue(null); bridge.current.opponentAim = null; state.current.match = null; state.current.game = null; state.current.pending = false; state.current.authority = false; setMatch(null); setGameState(null); bridge.current.reset?.() }
    const clearPendingBy = (predicate: (key: string, id: string) => boolean) => setPendingInvites(current => Object.fromEntries(Object.entries(current).filter(([key, id]) => !predicate(key, id))))
    client.on('connect', () => {
      state.current.connected = true; state.current.socketId = client.id ?? ''
      setSocketId(client.id ?? '')
      setConnection('Connected')
      const remembered = preferences.current.savedName
      if (remembered) requestUsername(remembered)
      else if (!preferences.current.dismissed) setOpen(true)
    })
    client.on('disconnect', reason => {
      const wasJoined = Boolean(state.current.name)
      state.current.connected = false; state.current.pending = true; state.current.name = ''
      if (state.current.match) endMatch()
      stopJoinTimer()
      setName(''); setPlayers([]); setPendingInvites({}); setInvitations([]); setRaceInvites([]); setJoining(false); setMessages([])
      if (reason === 'io server disconnect') return
      setConnection('Reconnecting')
      if (wasJoined) toast('Connection lost. Reconnecting to the lobby…', 'warning')
    })
    client.on('connect_error', () => setConnection('Connection failed'))
    client.io.on('reconnect_failed', () => { setConnection('Connection failed'); toast('Cannot reach the game server right now. Solo practice is still available.', 'warning') })
    client.on('session-replaced', (message: string) => { setConnection('Signed in elsewhere'); toast(message, 'warning') })
    client.on('username-accepted', ({ username }: { username: string }) => {
      stopJoinTimer()
      const returning = preferences.current.savedName.toLowerCase() === username.toLowerCase() && !state.current.name
      state.current.name = username; state.current.pending = false
      preferences.current.savedName = username
      setName(username); setSavedName(username); setJoining(false); setJoinError(''); setOpen(false)
      toast(returning ? `Welcome back, ${username}.` : `You're in the lobby as ${username}.`, 'success')
    })
    client.on('username-rejected', ({ reason, message }: { reason: string; message: string }) => {
      stopJoinTimer()
      setJoining(false); setJoinError(message)
      if (reason === 'invalid' || reason === 'blocked') { preferences.current.savedName = ''; setSavedName('') }
      if (reason !== 'in-game') setOpen(true)
    })
    client.on('players', (value: PoolPlayer[]) => {
      setPlayers(value)
      const online = new Set(value.filter(player => player.status !== 'in-game').map(player => player.username.toLowerCase()))
      clearPendingBy(key => !online.has(key))
    })
    client.on('notice', (value: string) => toast(value))
    client.on('invite-sent', ({ id, to }: { id: string; to: string }) => setPendingInvites(current => ({ ...current, [to.toLowerCase()]: id })))
    client.on('invite-error', ({ to, message }: { to: string; message: string }) => { clearPendingBy(key => key === to.toLowerCase()); toast(message, 'warning') })
    client.on('invite-declined', ({ id, by }: { id: string; by: string }) => { clearPendingBy((key, inviteId) => inviteId === id || key === by.toLowerCase()); toast(`Challenge declined. ${by} passed this time.`, 'warning') })
    client.on('invite-expired', ({ id, to }: { id: string; to: string }) => { clearPendingBy((_, inviteId) => inviteId === id); toast(`${to || 'Your opponent'} didn't answer in time.`) })
    client.on('invite-cancelled', ({ id, message }: { id: string; message?: string }) => {
      clearPendingBy((_, inviteId) => inviteId === id)
      setInvitations(current => current.filter(invite => invite.id !== id))
      if (message) toast(message)
    })
    client.on('invite-received', ({ id, from, expiresIn }: { id: string; from: string; expiresIn: number }) => {
      setInvitations(current => [...current.filter(invite => invite.from !== from), { id, from, expiresIn, expiresAt: Date.now() + expiresIn }])
      chime()
    })
    client.on('race-invite', ({ id, from, track, expiresIn }: { id: string; from: string; track: RaceInvite['track']; expiresIn: number }) => {
      setRaceInvites(current => [...current.filter(invite => invite.id !== id), { id, from, track: track === 'oval' ? 'oval' : 'circuit', expiresIn, expiresAt: Date.now() + expiresIn }])
      chime()
    })
    client.on('race-invite-closed', ({ id }: { id: string }) => setRaceInvites(current => current.filter(invite => invite.id !== id)))
    client.on('game-start', (value: PoolMatch & { state?: PoolGameState }) => {
      setOpponentCue(null); bridge.current.opponentAim = null
      const next = { id: value.id, players: value.players, turn: value.turn }
      state.current.match = next; state.current.game = value.state ?? null; state.current.pending = false; state.current.authority = false
      setMatch(next); setGameState(value.state ?? null); setInvitations([]); setPendingInvites({}); setMessages([]); bridge.current.reset?.()
      toast(`Game on: ${value.players.join(' vs ')}. ${value.turn} breaks.`, 'success')
    })
    client.on('cue-design', (design: CueDesign) => setOpponentCue(design))
    client.on('cue-aim', (aim: { aim: number; pull: number; cuePosition?: PoolPoint }) => {
      bridge.current.opponentAim = aim
      if (aim.cuePosition) bridge.current.placeCue?.(aim.cuePosition)
    })
    client.on('cue-position', (point: PoolPoint) => bridge.current.placeCue?.(point))
    client.on('shot-rejected', (message: string) => { state.current.pending = false; state.current.authority = false; toast(message, 'warning') })
    client.on('shot', (value: PoolShot & { sequence: number; striker: string }) => {
      state.current.pending = true; state.current.sequence = value.sequence; state.current.authority = value.striker === state.current.name
      bridge.current.play?.(value)
    })
    client.on('sync', (value: { balls: PoolSnapshot; turn: string }) => {
      bridge.current.sync?.(value.balls); state.current.pending = false; state.current.authority = false
      if (state.current.match) { const next = { ...state.current.match, turn: value.turn }; state.current.match = next; setMatch(next) }
    })
    client.on('game-state', (value: PoolGameState) => {
      if (value.activeTurnPlayerID !== state.current.game?.activeTurnPlayerID || value.winner) bridge.current.opponentAim = null
      const opponentId = value.players.find(player => player.id !== state.current.socketId)?.id
      if (opponentId && value.cueDesigns?.[opponentId]) setOpponentCue(value.cueDesigns[opponentId])
      const finished = Boolean(value.winner) && !state.current.game?.winner
      state.current.game = value
      setGameState(value)
      if (state.current.match) {
        const turn = value.players.find(seat => seat.id === value.activeTurnPlayerID)?.username ?? state.current.match.turn
        const next = { ...state.current.match, turn }
        state.current.match = next; setMatch(next)
      }
      if (finished) toast(value.result, value.winnerID === state.current.socketId ? 'success' : 'warning')
    })
    client.on('receive-chat-message', (value: PoolChatMessage) => setMessages(current => current.some(item => item.id === value.id) ? current : [...current.slice(1 - chatLimit), value]))
    client.on('room-ended', (value: string) => { endMatch(); setMessages([]); toast(value) })
    return () => { stopJoinTimer(); client.removeAllListeners(); client.io.removeAllListeners(); client.disconnect(); socket.current = null }
  }, [toast, chime, requestUsername, stopJoinTimer, accountName, accountReady])

  useEffect(() => {
    if (!name) return
    let lastActivity = Date.now(), away = false
    const report = (status: 'available' | 'away') => { away = status === 'away'; socket.current?.emit('set-status', status) }
    const activity = () => { lastActivity = Date.now(); if (away) report('available') }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const
    for (const event of events) window.addEventListener(event, activity, { passive: true })
    const timer = window.setInterval(() => { if (!away && Date.now() - lastActivity >= idleTimeout) report('away') }, 10000)
    return () => { for (const event of events) window.removeEventListener(event, activity); window.clearInterval(timer) }
  }, [name])

  useEffect(() => {
    if (name) socket.current?.emit('set-activity', activity)
  }, [name, activity])

  useEffect(() => {
    if (!invitations.length && !raceInvites.length) return
    const prune = <T extends PoolInvite>(current: T[]) => current.some(invite => invite.expiresAt <= Date.now()) ? current.filter(invite => invite.expiresAt > Date.now()) : current
    const timer = window.setInterval(() => { setInvitations(prune); setRaceInvites(prune) }, 1000)
    return () => window.clearInterval(timer)
  }, [invitations.length, raceInvites.length])

  const join = () => {
    const username = accountName ?? ''
    if (!usernamePattern.test(username)) { setJoinError('Use 3–20 letters, numbers, underscores or hyphens.'); return }
    setJoinError('')
    requestUsername(username)
  }
  const invite = (username: string) => {
    const key = username.toLowerCase()
    if (key in pendingInvites || !name || match) return
    setPendingInvites(current => ({ ...current, [key]: '' }))
    socket.current?.emit('send-invite', { username })
  }
  const respond = (id: string, accept: boolean) => {
    socket.current?.emit('respond-invite', { id, accept })
    setInvitations(current => current.filter(item => item.id !== id))
  }
  const dismissRaceInvite = (id: string) => setRaceInvites(current => current.filter(item => item.id !== id))
  const toggleSound = () => {
    const next = !preferences.current.soundOn
    preferences.current.soundOn = next
    writeStorage(soundStorageKey, next ? 'on' : 'off')
    setSoundOn(next)
    if (next) chime()
    void fetch('/api/account-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lobbySound: next }) }).catch(() => undefined)
  }
  const sendChat = (value: string) => {
    const text = value.trim().slice(0, chatMaxLength)
    if (!text || !name || !socket.current?.connected) return false
    socket.current.emit('send-chat-message', { text })
    return true
  }
  const reconnect = () => { setConnection('Connecting'); if (socket.current?.connected) requestUsername(accountName ?? ''); else socket.current?.connect() }
  const dismissToast = (id: number) => setToasts(current => current.filter(item => item.id !== id))
  const self = players.find(player => player.username === name)
  return {
    bridge, opponentCue, connection, name, savedName, match, players, self, pendingInvites, invitations, raceInvites, toasts, joinError, joining, open, soundOn, gameState, socketId, messages,
    setOpen: (value: boolean) => { setOpen(value); if (value) setJoinError(''); else if (!name) preferences.current.dismissed = true },
    join, invite, respond, dismissRaceInvite, toggleSound, reconnect, dismissToast, sendChat,
    leave: () => socket.current?.emit('leave'),
  }
}

export type Lobby = ReturnType<typeof usePoolLobby>

function StatusDot({ status }: { status: PoolStatus }) {
  return <span className={`pool-status-dot is-${status}`} aria-hidden="true"/>
}

export function PoolLobby({ lobby }: { lobby: Lobby }) {
  return <div className={`pool-lobby ${lobby.match || lobby.joinError ? '' : 'is-empty'}`}>
    {lobby.match && <button className="pool-lobby-button" onClick={lobby.leave}>Leave game</button>}
    {lobby.joinError && <p className="pool-join-error" role="alert">{lobby.joinError}</p>}
    <div className="pool-toasts" role="status" aria-live="polite">
      {lobby.toasts.map(item => <div key={item.id} className={`pool-toast is-${item.tone}`}><span>{item.message}</span><button aria-label="Dismiss notification" onClick={() => lobby.dismissToast(item.id)}><X size={13}/></button></div>)}
    </div>
  </div>
}

function groupBalls(seat: PoolSeat) {
  return seat.group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : seat.group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : []
}

function HudBall({ number, potted }: { number: number; potted?: boolean }) {
  return <span className={`pool-mini-ball ${number > 8 ? 'striped' : ''} ${potted ? 'is-potted' : ''}`} style={{ '--ball-color': ballColors[number > 8 ? number - 8 : number] } as CSSProperties} aria-hidden="true"><b>{number}</b></span>
}

function PoolHud({ lobby }: { lobby: Lobby }) {
  const game = lobby.gameState
  if (!lobby.match || !game) return null
  return <div className="pool-hud" aria-label="Game scoreboard">
    {game.players.map(seat => {
      const active = game.activeTurnPlayerID === seat.id
      const mine = seat.id === lobby.socketId
      const label = seat.group ? `${seat.group === 'solids' ? 'Solids' : 'Stripes'} · ${seat.remaining.length} left` : 'Open table'
      return <div key={seat.id} className={`pool-hud-player ${active ? 'is-active' : ''} ${game.winnerID === seat.id ? 'is-winner' : ''}`} aria-current={active ? 'true' : undefined}>
        <div className="pool-hud-name"><i aria-hidden="true"/><strong>{seat.username}{mine ? ' (you)' : ''}</strong>{game.winnerID === seat.id ? <Trophy size={15} aria-label="Winner"/> : active ? <span>{mine ? 'Your shot' : 'Shooting'}</span> : null}</div>
        <small>{label}</small>
        {seat.group
          ? <div className="pool-hud-balls" aria-label={seat.remaining.length ? `Remaining balls: ${seat.remaining.join(', ')}` : 'Group cleared. Shooting for the 8-ball.'}>{seat.remaining.length ? groupBalls(seat).map(number => <HudBall key={number} number={number} potted={!seat.remaining.includes(number)}/>) : game.eightOnTable && <><HudBall number={8}/><em>On the 8</em></>}</div>
          : <div className="pool-hud-open">Any ball. First legal pot picks the group.</div>}
      </div>
    })}
    {game.winner && <p className="pool-hud-result" role="status">{game.result}</p>}
  </div>
}

export function PoolReconnectButton({ lobby }: { lobby: Lobby }) {
  if (lobby.match) return null
  return <button type="button" className="pool-lobby-button" disabled={lobby.joining} onClick={lobby.reconnect}>{lobby.joining ? 'Joining…' : 'Reconnect lobby'}</button>
}

export function PoolTopBar({ lobby }: { lobby: Lobby }) {
  const connected = lobby.connection === 'Connected'
  const others = lobby.players.filter(player => player.username !== lobby.name)
  const order: Record<PoolStatus, number> = { available: 0, away: 1, 'in-game': 2 }
  const sorted = [...others].sort((a, b) => order[a.status] - order[b.status])
  const hint = !connected ? 'The lobby is offline. Solo practice still works.' : !lobby.name ? 'Join the lobby to see who is around and send challenges.' : lobby.match ? 'You are at a table. Challenges open again when the game ends.' : !sorted.length ? 'The room is quiet. Share this page with a friend to play.' : ''
  return <nav className="pool-topbar" aria-label="Online players">
    <div className="pool-topbar-row">
      <div className="pool-topbar-title"><span className="pool-control-label"><Users size={13}/> ONLINE</span><b>{lobby.name ? lobby.players.length : 0}</b></div>
      <ul className="pool-topbar-players">
        {lobby.name && sorted.map(player => {
          const pending = player.username.toLowerCase() in lobby.pendingInvites
          const disabled = !connected || Boolean(lobby.match) || player.status === 'in-game' || pending
          return <li key={player.username} className={`is-${player.status}`}>
            <span className="pool-online-avatar" aria-hidden="true">{player.username.slice(0, 1).toUpperCase()}<StatusDot status={player.status}/></span>
            <div><strong>{player.username}</strong><small>{presenceLabel(player)}</small></div>
            <button className={pending ? 'is-pending' : ''} disabled={disabled} onClick={() => lobby.invite(player.username)} aria-label={pending ? `Challenge to ${player.username} pending` : player.status === 'in-game' ? `${player.username} is in a game` : `Challenge ${player.username}`}>{pending ? 'Pending…' : player.status === 'in-game' ? 'Playing' : 'Challenge'}</button>
          </li>
        })}
        {hint && <li className="pool-topbar-hint">{hint}</li>}
      </ul>
      {lobby.self && <div className="pool-topbar-self"><StatusDot status={lobby.self.status}/><strong>{lobby.self.username}</strong><span>You · {statusLabels[lobby.self.status]}</span></div>}
      <button className="pool-sound-toggle" onClick={lobby.toggleSound} aria-pressed={lobby.soundOn} title={lobby.soundOn ? 'Mute challenge sound' : 'Unmute challenge sound'} aria-label="Challenge sound">{lobby.soundOn ? <Bell size={15}/> : <BellOff size={15}/>}</button>
    </div>
    <PoolHud lobby={lobby}/>
  </nav>
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export function PoolChat({ lobby }: { lobby: Lobby }) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState('')
  const [seenId, setSeenId] = useState('')
  const log = useRef<HTMLOListElement>(null)
  const lastId = lobby.messages.at(-1)?.id ?? ''
  useEffect(() => { if (open) setSeenId(lastId) }, [open, lastId])
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight }, [open, lobby.messages])
  const unread = open ? 0 : lobby.messages.slice(lobby.messages.findIndex(message => message.id === seenId) + 1).filter(message => message.from !== lobby.name).length
  const canChat = lobby.connection === 'Connected' && Boolean(lobby.name)
  const scope = lobby.match ? 'Table chat' : 'Lobby chat'
  return <section className={`pool-chat ${open ? 'is-open' : ''}`} aria-label={scope}>
    <button type="button" className="pool-chat-toggle" aria-expanded={open} aria-controls="pool-chat-panel" onClick={() => setOpen(value => !value)}>
      <MessageCircle size={15}/><span>{scope}</span>{unread > 0 && <b aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</b>}<ChevronDown size={15} className="pool-chat-chevron"/>
    </button>
    {open && <div id="pool-chat-panel">
      <ol ref={log} className="pool-chat-log" aria-live="polite" aria-relevant="additions">
        {lobby.messages.length ? lobby.messages.map(message => <li key={message.id} className={message.type === 'system' ? 'is-system' : `is-player ${message.from === lobby.name ? 'is-mine' : ''}`}>
          {message.type === 'player' && <strong>{message.from === lobby.name ? 'You' : message.from}</strong>}
          <span>{message.text}</span>
          <time dateTime={new Date(message.at).toISOString()}>{timeFormat.format(message.at)}</time>
        </li>) : <li className="pool-chat-empty">{canChat ? lobby.match ? 'Say hello to your opponent.' : 'No messages yet. Say hello to the room.' : 'Join the lobby to chat.'}</li>}
      </ol>
      <form className="pool-chat-form" onSubmit={event => { event.preventDefault(); if (lobby.sendChat(draft)) setDraft('') }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={chatMaxLength} disabled={!canChat} placeholder={canChat ? lobby.match ? 'Message your opponent…' : 'Message the lobby…' : 'Join the lobby to chat'} aria-label={lobby.match ? 'Message your opponent' : 'Message the lobby'} autoComplete="off"/>
        <button disabled={!canChat || !draft.trim()} aria-label="Send message"><SendHorizontal size={15}/></button>
      </form>
    </div>}
  </section>
}
