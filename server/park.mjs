import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { createPark, deserializePark, serializePark, applyCommand, stepPark, encodeDynamic, encodeGuests, guestDetail, rideCommentsDetail, registerCustomRides, SCENARIOS } from './park/index.mjs'

const MAX_ROOMS = 12
const TICK_MS = 50
const DYN_EVERY = 5
const CROWD_GUESTS = 2000
const CHAT_INTERVAL = 700
const COMMANDS_PER_SECOND = 25
const RIDE_REFRESH_MS = 60_000

let ridesFetchedAt = 0
let ridesPending = null
let ridesOrigin = null

/** Registers the site's published custom rides (admin Ride Creator) so saves and commands that use them work online. */
function syncCustomRides(origin, force = false) {
  if (origin) ridesOrigin = origin
  if (!ridesOrigin) return Promise.resolve()
  if (!force && ridesPending && Date.now() - ridesFetchedAt < RIDE_REFRESH_MS) return ridesPending
  ridesFetchedAt = Date.now()
  ridesPending = fetch(`${ridesOrigin}/api/park-rides`, { signal: AbortSignal.timeout(6000) })
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (data?.rides) registerCustomRides(data.rides) })
    .catch(() => { ridesFetchedAt = 0 })
  return ridesPending
}

export function attachPark(io, origins) {
  const ns = io.of('/park')
  const rooms = new Map()
  const members = new Map()
  const ridesTimer = setInterval(() => { if (ns.sockets.size) void syncCustomRides(null) }, RIDE_REFRESH_MS)
  ridesTimer.unref?.()

  ns.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin
      const trusted = origins.length ? origins : ['https://thelibrary.garrdetto.workers.dev']
      if (!trusted.includes(origin)) return next(new Error('This site is not authorized.'))
      const ticket = z.string().regex(/^[a-f0-9]{64}$/).parse(socket.handshake.auth.ticket)
      const response = await fetch(`${origin}/api/park?action=redeem`, { method: 'POST', headers: { Authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(8000) })
      if (!response.ok) return next(new Error('Sign in again to connect.'))
      socket.data.account = await response.json()
      await syncCustomRides(origin)
      next()
    } catch { next(new Error('Unable to verify your park session.')) }
  })

  const summary = room => ({ id: room.id, name: room.name, mode: room.mode, scenario: room.scenario, host: room.host, started: room.started, max: room.max, players: playersOf(room) })
  const playersOf = room => [...room.players.values()].map(p => ({ id: p.id, name: p.name, park: p.park, host: p.id === room.host }))
  const publishRooms = () => ns.emit('rooms', [...rooms.values()].map(summary))

  function system(room, text) {
    const line = { id: room.chatSeq++, from: '', text, system: true }
    room.chat.push(line); if (room.chat.length > 40) room.chat.shift()
    ns.to(room.id).emit('chat', line)
  }

  function sendInit(room, socket) {
    const player = room.players.get(socket.id)
    socket.emit('init', { full: serializePark(room.state), park: player?.park ?? 0, players: playersOf(room), host: room.host === socket.id, chat: room.chat })
  }

  function closeRoom(room, message) {
    clearInterval(room.timer)
    ns.to(room.id).emit('room-closed', message)
    for (const id of room.players.keys()) { const s = ns.sockets.get(id); s?.leave(room.id); members.delete(id) }
    rooms.delete(room.id)
    publishRooms()
  }

  function leave(socket) {
    const roomId = members.get(socket.id)
    if (!roomId) return
    members.delete(socket.id)
    const room = rooms.get(roomId)
    socket.leave(roomId)
    socket.emit('room', null)
    if (!room) return
    const player = room.players.get(socket.id)
    room.players.delete(socket.id)
    if (!room.players.size) { closeRoom(room, 'Everyone left the park.'); return }
    if (room.host === socket.id) room.host = room.players.keys().next().value
    if (player) system(room, `${player.name} left.`)
    ns.to(room.id).emit('players', playersOf(room))
    if (!room.started) ns.to(room.id).emit('room', summary(room))
    publishRooms()
  }

  function loop(room) {
    if (!room.started || !room.state) return
    try {
      const steps = room.state.speed
      for (let k = 0; k < steps; k++) stepPark(room.state)
      room.tick++
      if (room.tick % DYN_EVERY === 0) {
        const dyn = encodeDynamic(room.state, room.newsSent)
        if (dyn.news.length) room.newsSent = dyn.news[dyn.news.length - 1].id
        const crowded = room.state.guests.length > CROWD_GUESTS
        const sendGuests = !crowded || room.tick % (DYN_EVERY * 2) === 0
        const guests = sendGuests ? encodeGuests(room.state.guests) : null
        ns.to(room.id).compress(crowded).emit('dyn', guests ? { ...dyn, guests: Buffer.from(guests.buffer, guests.byteOffset, guests.byteLength) } : dyn)
      }
    } catch (error) {
      console.error('Park simulation failed', error)
      closeRoom(room, 'The park simulation hit an error and the session ended. Sorry about that.')
    }
  }

  function makeRoom(socket, mode, scenario, state) {
    const id = `park_${randomUUID().slice(0, 8)}`
    const account = socket.data.account
    const room = { id, name: `${account.username}'s ${mode === 'coop' ? 'park' : 'rivalry'}`, mode, scenario, host: socket.id, players: new Map(), started: mode === 'coop', state, max: 4, chat: [], chatSeq: 1, tick: 0, newsSent: state?.newsSeq ? state.newsSeq - 1 : 0, timer: null }
    room.timer = setInterval(() => loop(room), TICK_MS)
    room.timer.unref?.()
    rooms.set(id, room)
    return room
  }

  function addPlayer(room, socket, park) {
    const account = socket.data.account
    room.players.set(socket.id, { id: socket.id, account: account.id, name: account.username, park })
    members.set(socket.id, room.id)
    socket.join(room.id)
  }

  const createInput = z.object({ mode: z.enum(['coop', 'versus']), scenario: z.string().max(32), save: z.string().max(180000).optional() }).strict()

  ns.on('connection', socket => {
    const account = socket.data.account
    for (const other of ns.sockets.values()) if (other.id !== socket.id && other.data.account?.id === account.id) { leave(other); other.disconnect(true) }
    socket.data.commands = { windowStart: Date.now(), count: 0 }
    socket.data.chatAt = 0
    socket.emit('rooms', [...rooms.values()].map(summary))

    socket.on('create', (raw, ack) => {
      if (typeof ack !== 'function') return
      const parsed = createInput.safeParse(raw)
      if (!parsed.success) return ack({ error: 'Choose a valid park setup.' })
      if (rooms.size >= MAX_ROOMS) return ack({ error: 'The server is hosting as many parks as it can. Try again later.' })
      leave(socket)
      const { mode, scenario, save } = parsed.data
      try {
        if (mode === 'coop') {
          let state
          if (save) {
            const data = JSON.parse(gunzipSync(Buffer.from(save, 'base64'), { maxOutputLength: 6_000_000 }).toString('utf8'))
            state = deserializePark(data)
            if (state.parks.length !== 1) return ack({ error: 'Only single-park saves can be hosted in co-op.' })
          } else {
            if (!SCENARIOS[scenario] || SCENARIOS[scenario].versus) return ack({ error: 'Choose a scenario.' })
            state = createPark(scenario, { mode: 'coop' })
          }
          state.mode = 'coop'
          const room = makeRoom(socket, 'coop', state.scenario, state)
          addPlayer(room, socket, 0)
          system(room, `${account.username} opened the park.`)
          sendInit(room, socket)
        } else {
          const room = makeRoom(socket, 'versus', 'twinValleys', null)
          addPlayer(room, socket, 0)
          socket.emit('room', summary(room))
        }
        publishRooms()
        ack({ ok: true })
      } catch {
        ack({ error: 'That park could not be opened.' })
      }
    })

    socket.on('join', (raw, ack) => {
      if (typeof ack !== 'function') return
      const parsed = z.object({ id: z.string().max(40) }).strict().safeParse(raw)
      const room = parsed.success ? rooms.get(parsed.data.id) : null
      if (!room) return ack({ error: 'That park is no longer open.' })
      if (room.players.has(socket.id)) return ack({ ok: true })
      if (room.players.size >= room.max) return ack({ error: 'That park is full.' })
      if (room.mode === 'versus' && room.started) return ack({ error: 'That match has already started.' })
      leave(socket)
      addPlayer(room, socket, 0)
      system(room, `${account.username} joined.`)
      if (room.started) { sendInit(room, socket); ns.to(room.id).emit('players', playersOf(room)) }
      else ns.to(room.id).emit('room', summary(room))
      publishRooms()
      ack({ ok: true })
    })

    socket.on('start', (_raw, ack) => {
      if (typeof ack !== 'function') return
      const room = rooms.get(members.get(socket.id))
      if (!room || room.mode !== 'versus' || room.started) return ack({ error: 'There is no match waiting to start.' })
      if (room.host !== socket.id) return ack({ error: 'Only the host can start the match.' })
      if (room.players.size < 2) return ack({ error: 'At least two tycoons are needed.' })
      const players = [...room.players.values()]
      players.forEach((p, i) => { p.park = i })
      room.state = createPark('twinValleys', { mode: 'versus', players: players.length, parkNames: players.map(p => `${p.name}'s Park`) })
      room.started = true
      room.newsSent = room.state.newsSeq - 1
      for (const p of players) { const s = ns.sockets.get(p.id); if (s) sendInit(room, s) }
      system(room, 'The match has begun. Highest company value at the end of year two wins!')
      publishRooms()
      ack({ ok: true })
    })

    socket.on('command', (raw, ack) => {
      if (typeof ack !== 'function') return
      const room = rooms.get(members.get(socket.id))
      const player = room?.players.get(socket.id)
      if (!room?.started || !player) return ack({ ok: false, error: 'You are not in a running park.' })
      const now = Date.now(), rate = socket.data.commands
      if (now - rate.windowStart > 1000) { rate.windowStart = now; rate.count = 0 }
      if (++rate.count > COMMANDS_PER_SECOND) return ack({ ok: false, error: 'Slow down a little.' })
      if (!raw || typeof raw !== 'object' || typeof raw.t !== 'string' || raw.t.length > 16) return ack({ ok: false, error: 'Unknown action.' })
      let size = 0
      try { size = JSON.stringify(raw).length } catch { return ack({ ok: false, error: 'Unknown action.' }) }
      if (size > 2000) return ack({ ok: false, error: 'That action is too large.' })
      if (raw.t === 'speed' && room.mode === 'versus' && room.host !== socket.id) return ack({ ok: false, error: 'Only the host can change the speed in versus.' })
      let result
      try { result = applyCommand(room.state, raw, player.park) } catch (error) { console.error('Park command failed', raw?.t, error); return ack({ ok: false, error: 'That action could not be completed.' }) }
      if (result.ok) ns.to(room.id).emit('cmd', { cmd: raw, park: player.park, nextId: room.state.nextId, structVersion: room.state.structVersion })
      ack(result)
    })

    socket.on('guest', (raw, ack) => {
      if (typeof ack !== 'function') return
      const room = rooms.get(members.get(socket.id))
      const id = Number(raw?.id)
      if (!room?.state || !Number.isInteger(id)) return ack({ guest: null })
      ack({ guest: guestDetail(room.state, id) })
    })

    socket.on('ride-comments', (raw, ack) => {
      if (typeof ack !== 'function') return
      const room = rooms.get(members.get(socket.id))
      const id = Number(raw?.id)
      if (!room?.state || !Number.isInteger(id)) return ack({ comments: null })
      ack({ comments: rideCommentsDetail(room.state, id) })
    })

    socket.on('export', (_raw, ack) => {
      if (typeof ack !== 'function') return
      const room = rooms.get(members.get(socket.id))
      if (!room?.state) return ack({ error: 'There is no park to save.' })
      ack({ data: serializePark(room.state) })
    })

    socket.on('resync', () => {
      const room = rooms.get(members.get(socket.id))
      if (room?.state) sendInit(room, socket)
    })

    socket.on('chat', raw => {
      const room = rooms.get(members.get(socket.id))
      const text = typeof raw?.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      if (!room || !text || Date.now() - socket.data.chatAt < CHAT_INTERVAL) return
      socket.data.chatAt = Date.now()
      const line = { id: room.chatSeq++, from: account.username, text }
      room.chat.push(line); if (room.chat.length > 40) room.chat.shift()
      ns.to(room.id).emit('chat', line)
    })

    socket.on('leave-room', () => { leave(socket); socket.emit('rooms', [...rooms.values()].map(summary)) })
    socket.on('disconnect', () => leave(socket))
  })

  return {
    statusOf(accountId) {
      for (const room of rooms.values()) for (const p of room.players.values()) if (p.account === accountId) return room.started ? 'playing' : 'lobby'
      return null
    },
  }
}
