import { WORLD_GENERATION, WorldServer, type WorldStorage } from '../../modules-src/maplestreet/shared/WorldServer'
import type { Identity } from '../../modules-src/maplestreet/shared/RoomLogic'
import { registerCustomItems } from '../../modules-src/maplestreet/shared/CustomItems'
import type { Env } from './env'
import { listStoreItems } from './maplestreet-items'
import { registerCustomVehicles } from '../../modules-src/maplestreet/shared/CustomVehicles'
import { listStoreVehicles } from './maplestreet-vehicles'

type DurableState = { blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }
type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

const PUT_BATCH = 50
const TABLE = 'CREATE TABLE IF NOT EXISTS maplestreet_world (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'

/** Whether any saved lot or account of the current world mentions `text` (such as a quoted `custom:<id>` catalog id). */
export async function worldMentions(env: Env, text: string) {
  await env.DB.prepare(TABLE).run()
  const row = await env.DB.prepare('SELECT key FROM maplestreet_world WHERE key LIKE ? AND instr(value, ?) > 0 LIMIT 1').bind(`${WORLD_GENERATION}%`, text).first<{ key: string }>()
  return row !== null
}

function d1Storage(env: Env): WorldStorage {
  let ready: Promise<unknown> | null = null
  const table = () => (ready ??= env.DB.prepare(TABLE).run())
  return {
    async get<T>(key: string) {
      await table()
      const row = await env.DB.prepare('SELECT value FROM maplestreet_world WHERE key = ?').bind(key).first<{ value: string }>()
      return row ? (JSON.parse(row.value) as T) : undefined
    },
    async list<T>(prefix: string) {
      await table()
      const rows = await env.DB.prepare('SELECT key, value FROM maplestreet_world WHERE key >= ? AND key < ?').bind(prefix, `${prefix}\uffff`).all<{ key: string; value: string }>()
      return new Map(rows.results.map(row => [row.key, JSON.parse(row.value) as T]))
    },
    async put(entries) {
      await table()
      const now = Date.now()
      const statements = Object.entries(entries).map(([key, value]) => env.DB.prepare('INSERT INTO maplestreet_world (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, JSON.stringify(value), now))
      for (let start = 0; start < statements.length; start += PUT_BATCH) await env.DB.batch(statements.slice(start, start + PUT_BATCH))
    },
  }
}

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

  constructor(state: DurableState, private readonly env: Env) {
    const storage = d1Storage(env)
    this.world = new WorldServer(storage)
    void state.blockConcurrencyWhile(async () => {
      registerCustomItems(await listStoreItems(env))
      registerCustomVehicles(await listStoreVehicles(env))
      await this.world.ready()
    })
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === '/catalog' && request.method === 'POST') {
      registerCustomItems(await listStoreItems(this.env))
      registerCustomVehicles(await listStoreVehicles(this.env))
      return Response.json({ ok: true })
    }
    if (path === '/save' && request.method === 'POST') {
      await this.world.ready()
      await this.world.save()
      return Response.json({ ok: true })
    }
    if (path === '/status') {
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
