import { io, type Socket } from 'socket.io-client'
import { ARENA_NAMESPACE, ARENA_SEND_HZ, ArenaEvent, type ArenaPlayer, type ArenaPose } from '../../shared/protocol.mjs'

export interface ArenaConnection {
  readonly selfId: () => string | null
  send(pose: ArenaPose): void
  close(): void
}

export interface ConnectionHandlers {
  status(text: string): void
  welcome(team: 0 | 1): void
  players(list: ArenaPlayer[]): void
  left(id: string): void
}

export function serverAddress(search: string): string | null {
  const value = new URLSearchParams(search).get('server')
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

export function connectArena(address: string, name: string, handlers: ConnectionHandlers): ArenaConnection {
  const socket: Socket = io(`${address}${ARENA_NAMESPACE}`, { transports: ['websocket'], reconnectionAttempts: 5 })
  let id: string | null = null
  let lastSent = 0

  handlers.status('Connecting…')
  socket.on('connect', () => socket.emit(ArenaEvent.join, { name }))
  socket.on(ArenaEvent.welcome, (data: { id: string; team: 0 | 1 }) => {
    id = data.id
    handlers.status('Online')
    handlers.welcome(data.team)
  })
  socket.on(ArenaEvent.full, () => handlers.status('The arena is full'))
  socket.on(ArenaEvent.state, (list: ArenaPlayer[]) => handlers.players(list.filter(player => player.id !== id)))
  socket.on(ArenaEvent.left, (data: { id: string }) => handlers.left(data.id))
  socket.on('disconnect', () => handlers.status('Offline'))
  socket.on('connect_error', () => handlers.status('Could not reach the arena server'))

  return {
    selfId: () => id,
    send(pose) {
      const now = performance.now()
      if (!id || now - lastSent < 1000 / ARENA_SEND_HZ) return
      lastSent = now
      socket.volatile.emit(ArenaEvent.move, pose)
    },
    close: () => socket.close(),
  }
}
