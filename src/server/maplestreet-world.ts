import { WorldServer, type WorldStorage } from '../../modules-src/maplestreet/shared/WorldServer'
import type { Identity } from '../../modules-src/maplestreet/shared/RoomLogic'
import type { Env } from './env'

type DurableStorage = {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
}
type DurableState = { storage: DurableStorage; blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }
type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

const PUT_BATCH = 100

function parseIdentity(header: string | null): Identity | null {
  try {
    const value = JSON.parse(header ?? '') as Identity
    return typeof value.key === 'string' && typeof value.name === 'string' ? { key: value.key, name: value.name, member: Boolean(value.member) } : null
  } catch {
    return null
  }
}

export class MapleStreetWorld {
  private readonly world: WorldServer

  constructor(state: DurableState, _env: Env) {
    const storage: WorldStorage = {
      get: key => state.storage.get(key),
      list: prefix => state.storage.list({ prefix }),
      async put(entries) {
        const keys = Object.keys(entries)
        for (let start = 0; start < keys.length; start += PUT_BATCH) {
          const batch: Record<string, unknown> = {}
          for (const key of keys.slice(start, start + PUT_BATCH)) batch[key] = entries[key]
          await state.storage.put(batch)
        }
      },
    }
    this.world = new WorldServer(storage)
    void state.blockConcurrencyWhile(() => this.world.ready())
  }

  async fetch(request: Request) {
    if (new URL(request.url).pathname === '/status') {
      await this.world.ready()
      return Response.json(this.world.status(), { headers: { 'cache-control': 'no-store' } })
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 })
    const identity = parseIdentity(request.headers.get('x-maple-identity'))
    if (!identity) return new Response('Missing identity.', { status: 400 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    const connection = await this.world.connect({ send: data => server.send(data), close: (code, reason) => server.close(code, reason) }, identity)
    server.addEventListener('message', event => connection.onMessage(event.data as string | ArrayBuffer))
    const closed = () => {
      connection.onClose()
      try { server.close(1000, 'bye') } catch { /* already closed */ }
    }
    server.addEventListener('close', closed)
    server.addEventListener('error', closed)
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
  }
}
