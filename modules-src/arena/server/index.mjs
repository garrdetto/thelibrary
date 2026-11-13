import { createServer } from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import { attachArena } from './arena.mjs'

export const ARENA_SERVER_VERSION = 'vector-arena v1'

export function createArenaServer({ origins = [], arenaOptions = {} } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.get('/', (_req, res) => res.type('text').send('Vector Arena server is running.'))
  app.get('/health', (_req, res) => res.type('text').send('ok'))
  app.get('/version', (_req, res) => res.type('text').send(ARENA_SERVER_VERSION))
  app.use((_req, res) => res.status(404).type('text').send('Not found'))

  const http = createServer(app)
  const io = new Server(http, {
    cors: origins.length ? { origin: origins } : { origin: true },
    allowRequest: (req, done) => done(null, !origins.length || origins.includes(req.headers.origin)),
    maxHttpBufferSize: 16384,
  })
  const arena = attachArena(io, origins, arenaOptions)
  return {
    app,
    http,
    io,
    arena,
    listen: port => new Promise(resolve => http.listen(port, () => resolve(http.address().port))),
    close: () => new Promise(resolve => { arena.close(); io.close(() => resolve()) }),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  const server = createArenaServer({ origins })
  const port = await server.listen(Number(process.env.PORT) || 3010)
  console.log(`Vector Arena server on port ${port} (${ARENA_SERVER_VERSION})${origins.length ? '' : ' — open to every origin; set FRONTEND_ORIGIN in production'}`)
}
