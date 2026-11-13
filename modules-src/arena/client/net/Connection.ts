import { io, type Socket } from 'socket.io-client'
import {
  ARENA_NAMESPACE,
  ARENA_SEND_HZ,
  ArenaEvent,
  type ArenaDamage,
  type ArenaDeath,
  type ArenaPlayer,
  type ArenaPose,
  type ArenaRespawn,
  type ArenaShootRequest,
  type ArenaShot,
  type ArenaSpawn,
  type ArenaState,
} from '../../../../server/arena/protocol.mjs'

export interface ArenaConnection {
  readonly selfId: () => string | null
  readonly team: () => 0 | 1 | null
  send(pose: ArenaPose): void
  shoot(request: ArenaShootRequest): void
  close(): void
}

export interface ConnectionHandlers {
  status(text: string): void
  welcome(team: 0 | 1, spawn: ArenaSpawn): void
  players(list: ArenaPlayer[]): void
  self(player: ArenaPlayer): void
  left(id: string): void
  shot(shot: ArenaShot): void
  damage(damage: ArenaDamage): void
  death(death: ArenaDeath): void
  respawn(respawn: ArenaRespawn): void
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

export function connectArena(address: string, name: string, handlers: ConnectionHandlers): ArenaConnection {
  const socket: Socket = io(`${address}${ARENA_NAMESPACE}`, { transports: ['websocket'], reconnectionAttempts: 5 })
  let id: string | null = null
  let team: 0 | 1 | null = null
  let lastSent = 0
  let lastTick = 0

  handlers.status('Connecting…')
  socket.on('connect', () => socket.emit(ArenaEvent.join, { name }))
  socket.on(ArenaEvent.welcome, (data: { id: string; team: 0 | 1; spawn: ArenaSpawn }) => {
    id = data.id
    team = data.team
    lastTick = 0
    handlers.status(data.team === 0 ? 'Online · Blue team' : 'Online · Red team')
    handlers.welcome(data.team, data.spawn)
  })
  socket.on(ArenaEvent.full, () => handlers.status('The arena is full'))
  socket.on(ArenaEvent.state, (state: ArenaState) => {
    if (!state || !Array.isArray(state.players) || state.tick <= lastTick) return
    lastTick = state.tick
    const others: ArenaPlayer[] = []
    for (const player of state.players) {
      if (player.id === id) handlers.self(player)
      else others.push(player)
    }
    handlers.players(others)
  })
  socket.on(ArenaEvent.left, (data: { id: string }) => handlers.left(data.id))
  socket.on(ArenaEvent.shot, (shot: ArenaShot) => handlers.shot(shot))
  socket.on(ArenaEvent.damage, (damage: ArenaDamage) => handlers.damage(damage))
  socket.on(ArenaEvent.death, (death: ArenaDeath) => handlers.death(death))
  socket.on(ArenaEvent.respawn, (respawn: ArenaRespawn) => handlers.respawn(respawn))
  socket.on('disconnect', () => { id = null; team = null; handlers.status('Offline') })
  socket.on('connect_error', () => handlers.status('Multiplayer offline · solo practice'))

  return {
    selfId: () => id,
    team: () => team,
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
