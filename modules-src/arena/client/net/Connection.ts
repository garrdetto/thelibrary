import { io, type Socket } from 'socket.io-client'
import {
  ARENA_NAMESPACE,
  ARENA_SEND_HZ,
  ArenaEvent,
  type ArenaDamage,
  type ArenaDeath,
  type ArenaMatch,
  type ArenaModeId,
  type ArenaPlayer,
  type ArenaPose,
  type ArenaRespawn,
  type ArenaRoom,
  type ArenaShootRequest,
  type ArenaShot,
  type ArenaState,
  type ArenaWelcome,
} from '../../../../server/arena/protocol.mjs'

export interface ArenaConnection {
  readonly selfId: () => string | null
  readonly team: () => 0 | 1 | null
  readonly room: () => ArenaRoom | null
  send(pose: ArenaPose): void
  shoot(request: ArenaShootRequest): void
  close(): void
}

export interface ConnectionHandlers {
  status(text: string): void
  welcome(welcome: ArenaWelcome): void
  match(match: ArenaMatch): void
  full(): void
  offline(): void
  players(list: ArenaPlayer[]): void
  self(player: ArenaPlayer): void
  left(id: string): void
  shot(shot: ArenaShot): void
  damage(damage: ArenaDamage): void
  death(death: ArenaDeath): void
  respawn(respawn: ArenaRespawn): void
}

export interface JoinOptions {
  name: string
  mode: ArenaModeId
  code: string | null
}

const DEFAULT_SERVER = 'https://thelibrary-production.up.railway.app'

function origin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

export function serverAddress(search: string): string | null {
  const params = new URLSearchParams(search)
  if (params.has('solo')) return null
  if (params.has('server')) return origin(params.get('server'))
  return origin(import.meta.env.VITE_POOL_SERVER_URL) ?? DEFAULT_SERVER
}

export function connectArena(address: string, join: JoinOptions, handlers: ConnectionHandlers): ArenaConnection {
  const socket: Socket = io(`${address}${ARENA_NAMESPACE}`, { transports: ['websocket'], reconnectionAttempts: 5 })
  let id: string | null = null
  let team: 0 | 1 | null = null
  let room: ArenaRoom | null = null
  let lastSent = 0
  let lastTick = 0
  let lastPhase = ''

  handlers.status('Connecting…')
  socket.on('connect', () => socket.emit(ArenaEvent.join, { name: join.name, mode: room?.mode ?? join.mode, code: room?.code ?? join.code }))
  socket.on(ArenaEvent.welcome, (data: ArenaWelcome) => {
    id = data.id
    team = data.team
    room = data.room
    lastTick = 0
    lastPhase = data.match.phase
    handlers.status(data.team === 0 ? 'Online · Blue team' : 'Online · Red team')
    handlers.welcome(data)
    handlers.match(data.match)
  })
  socket.on(ArenaEvent.full, () => {
    handlers.status('That match is full')
    handlers.full()
  })
  socket.on(ArenaEvent.match, (match: ArenaMatch) => {
    lastPhase = match.phase
    handlers.match(match)
  })
  socket.on(ArenaEvent.state, (state: ArenaState) => {
    if (!state || !Array.isArray(state.players) || state.tick <= lastTick) return
    lastTick = state.tick
    const others: ArenaPlayer[] = []
    for (const player of state.players) {
      if (player.id === id) handlers.self(player)
      else others.push(player)
    }
    handlers.players(others)
    if (state.match && state.match.phase === lastPhase) handlers.match(state.match)
  })
  socket.on(ArenaEvent.left, (data: { id: string }) => handlers.left(data.id))
  socket.on(ArenaEvent.shot, (shot: ArenaShot) => handlers.shot(shot))
  socket.on(ArenaEvent.damage, (damage: ArenaDamage) => handlers.damage(damage))
  socket.on(ArenaEvent.death, (death: ArenaDeath) => handlers.death(death))
  socket.on(ArenaEvent.respawn, (respawn: ArenaRespawn) => handlers.respawn(respawn))
  socket.on('disconnect', () => { id = null; team = null; handlers.status('Offline') })
  socket.on('connect_error', () => {
    handlers.status('Multiplayer offline')
    handlers.offline()
  })

  return {
    selfId: () => id,
    team: () => team,
    room: () => room,
    send(pose) {
      const now = performance.now()
      if (!id || now - lastSent < 1000 / ARENA_SEND_HZ) return
      lastSent = now
      socket.volatile.emit(ArenaEvent.move, pose)
    },
    shoot(request) {
      if (id) socket.emit(ArenaEvent.shoot, request)
    },
    close: () => socket.close(),
  }
}
