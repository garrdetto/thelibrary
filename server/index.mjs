import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { z } from 'zod'
import { attachRacing } from './racing.mjs'
import { attachPark } from './park.mjs'

const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
const trustedOrigins = origins.length ? origins : ['https://thelibrary.garrdetto.workers.dev']
const version = 'pool-lobby 8-ball v47'
const routes = { '/': 'Pool lobby server is running.', '/health': 'ok', '/version': version }
const http = createServer((req, res) => { const body = routes[req.url]; res.writeHead(body ? 200 : 404); res.end(body ?? 'Not found') })
const io = new Server(http, { cors: { origin: trustedOrigins }, allowRequest: (req, done) => done(null, trustedOrigins.includes(req.headers.origin)), maxHttpBufferSize: 196608, perMessageDeflate: { threshold: 8192 } })

const racing = attachRacing(io, origins, {
  changed: () => broadcastPlayers(),
  invite: ({ account, ...invite }) => {
    for (const user of users.values()) if (user.account !== account) io.to(user.socketId).emit('race-invite', invite)
  },
  closed: id => io.to(LOBBY).emit('race-invite-closed', { id }),
})

attachPark(io, origins)

const LOBBY = 'lobby'
const INVITE_TTL = 30000
const MAX_OUTGOING_INVITES = 3
const CHAT_INTERVAL = 700
const CHAT_HISTORY = 30
const SOLIDS = [1, 2, 3, 4, 5, 6, 7]
const STRIPES = [9, 10, 11, 12, 13, 14, 15]
const users = new Map()
const invitations = new Map()
const rooms = new Map()

const usernamePattern = /^[a-zA-Z0-9_-]{3,20}$/
const blockedFragments = ['fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'asshole', 'dickhead', 'cocksuck', 'motherf', 'nigg', 'faggot', 'retard', 'rapist', 'nazi', 'hitler', 'porn', 'penis', 'vagina', 'wank', 'twat', 'kike', 'chink', 'tranny', 'pedophile', 'bollock', 'jizz', 'kkk']
const blockedNames = new Set(['ass', 'cum', 'dick', 'cock', 'spic', 'fag', 'fags', 'dyke', 'rape', 'admin', 'moderator', 'system', 'server'])
const leet = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' }
const collapse = value => value.replace(/(.)\1+/g, '$1')
function isBlockedUsername(name) {
  const normalized = name.toLowerCase().replace(/[01345789]/g, character => leet[character] ?? character).replace(/[_-]/g, '')
  const collapsed = collapse(normalized)
  if (blockedNames.has(normalized) || blockedNames.has(collapsed)) return true
  return blockedFragments.some(fragment => normalized.includes(fragment) || (collapse(fragment).length >= 4 && collapsed.includes(collapse(fragment))))
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const shot = z.object({ shotVector: point.refine(p => Math.abs(Math.hypot(p.x, p.y) - 1) < .001), power: z.number().min(0.01).max(100), english: point.refine(p => Math.hypot(p.x, p.y) <= 1.001), cuePosition: point.optional() }).strict()
const snapshot = z.array(z.object({ number: z.number().int().min(0).max(15), x: z.number().min(0).max(1000), y: z.number().min(0).max(580), pocketed: z.boolean() }).strict()).length(16).refine(balls => new Set(balls.map(b => b.number)).size === 16 && !balls.find(b => b.number === 0)?.pocketed)
const usernameInput = z.string().trim().max(40)
const statusInput = z.enum(['available', 'away'])
const activityInput = z.enum(['pool', 'racing', 'site'])
const inviteInput = z.object({ username: z.string().trim().min(1).max(20) }).strict()
const responseInput = z.object({ id: z.string().uuid(), accept: z.boolean() }).strict()
const chatInput = z.object({ text: z.string().max(600) }).strict()
const settledInput = z.object({ sequence: z.number().int(), balls: snapshot, scratch: z.boolean(), firstContact: z.number().int().min(1).max(15).nullable(), railAfterContact: z.boolean(), offTable: z.boolean(), order: z.array(z.number().int().min(1).max(15)).max(15).default([]) }).strict()

const chatMask = new RegExp(blockedFragments.map(fragment => fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
const cleanChat = text => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280).replace(chatMask, match => '*'.repeat(match.length))
const lobbyHistory = []
function chatMessage(type, scope, text, from) {
  return { id: randomUUID(), type, scope, from, text, at: Date.now() }
}
function lobbyChat(type, text, from) {
  const message = chatMessage(type, 'lobby', text, from)
  lobbyHistory.push(message)
  if (lobbyHistory.length > CHAT_HISTORY) lobbyHistory.shift()
  io.to(LOBBY).except([...rooms.keys()]).emit('receive-chat-message', message)
}
const tableChat = (room, type, text, from) => io.to(room.id).emit('receive-chat-message', chatMessage(type, 'table', text, from))

const groupBalls = group => group === 'solids' ? SOLIDS : group === 'stripes' ? STRIPES : []
const opponentOf = (room, id) => room.players.find(player => player !== id)
const nameOf = id => users.get(id)?.username ?? 'A player'
function gameState(room) {
  return {
    roomId: room.id,
    cueDesigns: room.cueDesigns,
    ballInHand: room.ballInHand,
    ballInHandRegion: room.ballInHand ? room.sequence === 0 ? 'kitchen' : 'table' : null,
    foul: room.foul,
    tableStatus: room.tableStatus,
    activeTurnPlayerID: room.winner ? null : room.turn,
    players: room.players.map(id => ({ id, username: room.names[id], group: room.groups[id], remaining: groupBalls(room.groups[id]).filter(number => !room.pocketed.has(number)) })),
    eightOnTable: !room.pocketed.has(8),
    winner: room.winner ? room.names[room.winner] : null,
    winnerID: room.winner,
    result: room.result,
  }
}
function validCuePlacement(room, placement) {
  const pockets = [[83, 83], [500, 73], [917, 83], [83, 497], [500, 507], [917, 497]]
  return Boolean(room.balls && (room.sequence !== 0 || placement.x <= 290) && placement.x >= 92 && placement.x <= 908 && placement.y >= 92 && placement.y <= 488 && !pockets.some(([x, y]) => Math.hypot(placement.x - x, placement.y - y) < 36) && !room.balls.some(ball => ball.number !== 0 && !ball.pocketed && Math.hypot(placement.x - ball.x, placement.y - ball.y) < 25))
}
const emitState = room => io.to(room.id).emit('game-state', gameState(room))

function finishGame(room, winner, result) {
  room.winner = winner; room.result = result
  tableChat(room, 'system', result)
}

function scoreShot(room, striker, potted, details) {
  const { scratch, firstContact, railAfterContact, offTable } = details
  const opponent = opponentOf(room, striker)
  const strikerName = room.names[striker], opponentName = room.names[opponent]
  const group = room.groups[striker]
  const remainingBefore = groupBalls(group).filter(number => !room.pocketed.has(number))
  const targets = group ? remainingBefore.length ? remainingBefore : [8] : [...SOLIDS, ...STRIPES]
  const foul = scratch ? 'Scratch' : offTable ? 'Ball left the table' : firstContact === null ? 'No object ball contact' : room.sequence > 1 && !targets.includes(firstContact) ? 'Wrong first contact' : !potted.length && !railAfterContact ? 'No pot or cushion after contact' : null
  room.foul = foul
  room.ballInHand = foul ? opponent : null
  for (const number of potted) room.pocketed.add(number)
  if (potted.includes(8)) {
    if (foul) return finishGame(room, opponent, `${strikerName} fouled on the 8-ball (${foul}). ${opponentName} wins.`)
    if (group && remainingBefore.length === 0) return finishGame(room, striker, `${strikerName} cleared their group and sank the 8-ball. ${strikerName} wins!`)
    return finishGame(room, opponent, `${strikerName} potted the 8-ball with group balls still on the table. ${opponentName} wins.`)
  }
  const objects = potted.filter(number => number !== 8)
  let keepsTurn = false
  if (room.tableStatus === 'OPEN' && !foul && objects.length && room.sequence > 1) {
    const assigned = objects[0] < 8 ? 'solids' : 'stripes'
    room.groups[striker] = assigned
    room.groups[opponent] = assigned === 'solids' ? 'stripes' : 'solids'
    room.tableStatus = 'ASSIGNED'
    keepsTurn = true
    tableChat(room, 'system', `${strikerName} takes ${assigned}. ${opponentName} has ${room.groups[opponent]}.`)
  } else if (room.tableStatus === 'OPEN' && !foul && objects.length) {
    keepsTurn = true
    tableChat(room, 'system', 'Break pots keep the table open. The next legal pot assigns solids and stripes.')
  } else if (!foul && group) keepsTurn = objects.some(number => groupBalls(group).includes(number))
  if (foul) tableChat(room, 'system', `${strikerName}: ${foul}. ${opponentName} has ball in hand.`)
  room.turn = keepsTurn ? striker : opponent
}

const findUserByName = name => [...users.values()].find(user => user.username.toLowerCase() === name.toLowerCase())
function presenceOf(user) {
  if (user.room) return { game: 'pool', playing: true }
  const racingStatus = racing.statusOf(user.account)
  if (racingStatus === 'racing') return { game: 'racing', playing: true }
  if (racingStatus === 'lobby' || user.activity === 'racing') return { game: 'racing', playing: false }
  return { game: user.activity === 'pool' ? 'pool' : null, playing: false }
}
const playerList = () => [...users.values()].map(user => ({ username: user.username, status: user.status, ...presenceOf(user) })).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }))
let broadcastQueued = false
function broadcastPlayers() {
  if (broadcastQueued) return
  broadcastQueued = true
  setTimeout(() => { broadcastQueued = false; io.to(LOBBY).emit('players', playerList()) }, 40)
}

function createRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  let id
  do id = `room_${[...randomBytes(5)].map(byte => alphabet[byte % alphabet.length]).join('')}`
  while (rooms.has(id))
  return id
}

function dropInvite(id, outcome) {
  const invite = invitations.get(id)
  if (!invite) return null
  clearTimeout(invite.timer)
  invitations.delete(id)
  const sender = users.get(invite.from), recipient = users.get(invite.to)
  if (outcome === 'expired') {
    io.to(invite.from).emit('invite-expired', { id, to: recipient?.username ?? '' })
    io.to(invite.to).emit('invite-cancelled', { id })
  }
  if (outcome === 'cancelled') {
    io.to(invite.from).emit('invite-cancelled', { id, to: recipient?.username ?? '', message: recipient ? `${recipient.username} is no longer available.` : 'That player left the lobby.' })
    io.to(invite.to).emit('invite-cancelled', { id, message: sender ? `${sender.username}'s challenge was withdrawn.` : undefined })
  }
  return invite
}

function cancelInvitesFor(socketId, except) {
  for (const [id, invite] of invitations) if (id !== except && (invite.from === socketId || invite.to === socketId)) dropInvite(id, 'cancelled')
}

function startRoom(challengerSocket, opponentSocket) {
  const challenger = users.get(challengerSocket.id), opponent = users.get(opponentSocket.id)
  const id = createRoomId()
  const rack = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 13, 6, 14, 7, 15]
  const balls = [{ number: 0, x: 290, y: 290, pocketed: false }]
  let rackIndex = 0
  for (let row = 0; row < 5; row++) for (let col = 0; col <= row; col++) balls.push({ number: rack[rackIndex++], x: 660 + row * ((9.975 * 1.07 * .975 * 2 + .6) * Math.sqrt(3) / 2), y: 290 + (col - row / 2) * (9.975 * 1.07 * .975 * 2 + .6), pocketed: false })
  const room = { id, ballInHand: challengerSocket.id, foul: null, balls, cueDesigns: {}, players: [challengerSocket.id, opponentSocket.id], names: { [challengerSocket.id]: challenger.username, [opponentSocket.id]: opponent.username }, turn: challengerSocket.id, sequence: 0, pending: false, started: 0, tableStatus: 'OPEN', groups: { [challengerSocket.id]: null, [opponentSocket.id]: null }, pocketed: new Set(), winner: null, result: '' }
  rooms.set(id, room)
  for (const socket of [challengerSocket, opponentSocket]) {
    const user = users.get(socket.id)
    user.status = 'in-game'; user.room = id; socket.data.room = id
    socket.join(id)
    cancelInvitesFor(socket.id)
  }
  io.to(id).emit('game-start', { id, roomId: id, players: [challenger.username, opponent.username], turn: challenger.username, state: gameState(room) })
  emitState(room)
  tableChat(room, 'system', `${challenger.username} and ${opponent.username} sat down at the table. The table is open. ${challenger.username} breaks.`)
  broadcastPlayers()
}

function leaveRoom(socket) {
  const room = rooms.get(socket.data.room)
  if (!room) return
  rooms.delete(room.id)
  for (const id of room.players) {
    const player = io.sockets.sockets.get(id), user = users.get(id)
    if (user) { user.status = 'available'; user.room = null }
    if (player) { player.leave(room.id); player.data.room = null; player.emit('room-ended', id === socket.id ? 'You left the table. Back in the lobby.' : 'Your opponent left. You are back in the lobby.'); for (const message of lobbyHistory) player.emit('receive-chat-message', message) }
  }
  broadcastPlayers()
}

function removeUser(socket, silent = false) {
  leaveRoom(socket)
  cancelInvitesFor(socket.id)
  socket.leave(LOBBY)
  const user = users.get(socket.id)
  if (!users.delete(socket.id)) return
  broadcastPlayers()
  if (!silent) lobbyChat('system', `${user.username} has left.`)
}

io.use(async (socket, next) => {
  try {
    const origin = socket.handshake.headers.origin
    if (!trustedOrigins.includes(origin)) return next(new Error('This site is not authorized.'))
    const ticket = z.string().regex(/^[a-f0-9]{64}$/).parse(socket.handshake.auth?.ticket)
    const response = await fetch(`${origin}/api/pool-account?action=redeem`, { method: 'POST', headers: { Authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) return next(new Error('Sign in again to connect.'))
    socket.data.account = z.object({ id: z.string().min(1), username: z.string().regex(usernamePattern) }).parse(await response.json())
    next()
  } catch { next(new Error('Unable to verify your workspace account.')) }
})

io.on('connection', socket => {
  socket.data.session = socket.data.account.id
  socket.data.room = null
  let lastChat = 0
  let windowStart = Date.now(), events = 0
  socket.use((packet, next) => {
    if (Date.now() - windowStart > 10000) { windowStart = Date.now(); events = 0 }
    if (packet[0] === 'cue-aim' || packet[0] === 'cue-position') return next()
    if (++events > 60) {
      if (packet[0] === 'shot') socket.emit('shot-rejected', 'Too many requests. Wait a moment and try your shot again.')
      return next(new Error('Too many requests'))
    }
    next()
  })
  const notice = message => socket.emit('notice', message)

  const setUsername = raw => {
    const reject = (reason, message) => socket.emit('username-rejected', { reason, message })
    const parsed = usernameInput.safeParse(raw)
    if (!parsed.success || !usernamePattern.test(parsed.data)) return reject('invalid', 'Use 3–20 letters, numbers, underscores or hyphens.')
    const username = socket.data.account.username
    if (parsed.data !== username) return reject('invalid', 'Use your verified account username.')
    if (isBlockedUsername(username)) return reject('blocked', 'That screen name is not allowed. Please choose another.')
    const current = users.get(socket.id)
    if (current?.room) return reject('in-game', 'Finish your current game before changing your name.')
    const holder = findUserByName(username)
    let replaced = false
    if (holder && holder.socketId !== socket.id) {
      const previous = io.sockets.sockets.get(holder.socketId)
      if (!previous || !socket.data.session || previous.data.session !== socket.data.session) return reject('taken', `“${holder.username}” is already taken. Try another name.`)
      replaced = true
      removeUser(previous, true)
      previous.emit('session-replaced', 'You joined the lobby from another tab.')
      previous.disconnect(true)
    }
    const previousName = current?.username
    if (current) { cancelInvitesFor(socket.id); current.username = username }
    else users.set(socket.id, { socketId: socket.id, account: socket.data.account.id, username, status: 'available', activity: socket.data.activity ?? 'site', room: null })
    socket.join(LOBBY)
    socket.emit('username-accepted', { username })
    socket.emit('players', playerList())
    if (!current) for (const message of lobbyHistory) socket.emit('receive-chat-message', message)
    broadcastPlayers()
    if (!current && !replaced) lobbyChat('system', `${username} has joined.`)
    else if (previousName && previousName !== username) lobbyChat('system', `${previousName} is now ${username}.`)
  }
  socket.on('set-username', setUsername)
  socket.on('join', raw => setUsername(typeof raw === 'object' && raw !== null ? raw.username : raw))

  socket.on('set-status', raw => {
    const user = users.get(socket.id), parsed = statusInput.safeParse(raw)
    if (!user || !parsed.success || user.room || user.status === parsed.data) return
    user.status = parsed.data
    broadcastPlayers()
  })

  socket.on('set-activity', raw => {
    const parsed = activityInput.safeParse(raw)
    if (!parsed.success) return
    socket.data.activity = parsed.data
    const user = users.get(socket.id)
    if (!user || user.activity === parsed.data) return
    user.activity = parsed.data
    broadcastPlayers()
  })

  socket.on('send-invite', raw => {
    const user = users.get(socket.id), parsed = inviteInput.safeParse(raw)
    if (!user || !parsed.success) return
    const fail = message => socket.emit('invite-error', { to: parsed.data.username, message })
    if (user.room) return fail('Finish your current game first.')
    const target = findUserByName(parsed.data.username)
    if (!target) return fail('That player is no longer online.')
    if (target.socketId === socket.id) return fail('You cannot challenge yourself.')
    if (target.status === 'in-game') return fail(`${target.username} is already in a game.`)
    const outgoing = [...invitations.values()].filter(invite => invite.from === socket.id)
    if (outgoing.some(invite => invite.to === target.socketId)) return fail(`Your challenge to ${target.username} is still pending.`)
    if (outgoing.length >= MAX_OUTGOING_INVITES) return fail('Wait for a reply before sending more challenges.')
    const id = randomUUID()
    invitations.set(id, { id, from: socket.id, to: target.socketId, timer: setTimeout(() => dropInvite(id, 'expired'), INVITE_TTL) })
    io.to(target.socketId).emit('invite-received', { id, from: user.username, expiresIn: INVITE_TTL })
    socket.emit('invite-sent', { id, to: target.username, expiresIn: INVITE_TTL })
  })

  socket.on('respond-invite', raw => {
    const parsed = responseInput.safeParse(raw)
    if (!parsed.success) return
    const invite = invitations.get(parsed.data.id)
    if (!invite || invite.to !== socket.id) return notice('This challenge is no longer available.')
    dropInvite(invite.id)
    const challenger = io.sockets.sockets.get(invite.from), challengerUser = users.get(invite.from), user = users.get(socket.id)
    if (!challenger || !challengerUser || !user) return notice('That player left the lobby.')
    if (!parsed.data.accept) return challenger.emit('invite-declined', { id: invite.id, by: user.username })
    if (user.room || challengerUser.room) { challenger.emit('invite-cancelled', { id: invite.id, to: user.username, message: 'One of you is already at a table.' }); return notice(`${challengerUser.username} is already in a game.`) }
    startRoom(challenger, socket)
  })

  socket.on('send-chat-message', raw => {
    const user = users.get(socket.id), parsed = chatInput.safeParse(typeof raw === 'string' ? { text: raw } : raw)
    if (!user || !parsed.success) return
    const text = cleanChat(parsed.data.text)
    if (!text) return
    if (Date.now() - lastChat < CHAT_INTERVAL) return notice('You are sending messages too quickly.')
    lastChat = Date.now()
    const room = rooms.get(socket.data.room)
    if (room) tableChat(room, 'player', text, user.username)
    else lobbyChat('player', text, user.username)
  })

  socket.on('cue-design', (raw, acknowledge) => {
    const reply = saved => { if (typeof acknowledge === 'function') acknowledge({ saved }) }
    const room = rooms.get(socket.data.room)
    if (!room || !room.players.includes(socket.id)) { reply(false); return }
    const parsed = z.object({ shaftColor: z.string().regex(/^#[a-f0-9]{6}$/i), buttColor: z.string().regex(/^#[a-f0-9]{6}$/i), preset: z.enum(['plain', 'custom', 'money', 'brewers', 'badgers', 'bucks', 'cubs', 'stars', 'diamonds', 'checker', 'stripes', 'circuit', 'hearts', 'lightning']), overlay: z.string().max(150000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).nullable() }).strict().safeParse(raw)
    if (!parsed.success) { reply(false); return }
    room.cueDesigns[socket.id] = parsed.data
    socket.to(room.id).emit('cue-design', parsed.data)
    emitState(room)
    reply(true)
  })
  socket.on('cue-position', raw => {
    const room = rooms.get(socket.data.room)
    if (!room || !room.players.includes(socket.id) || room.turn !== socket.id || room.ballInHand !== socket.id || room.pending || room.winner) return
    const parsed = point.safeParse(raw)
    if (!parsed.success || !validCuePlacement(room, parsed.data)) return
    const cue = room.balls.find(ball => ball.number === 0)
    Object.assign(cue, parsed.data)
    socket.to(room.id).emit('cue-position', parsed.data)
  })
  socket.on('cue-aim', raw => {
    const room = rooms.get(socket.data.room)
    if (!room || room.turn !== socket.id || room.pending || room.winner || Date.now() - (socket.data.lastCueAim ?? 0) < 75) return
    const parsed = z.object({ aim: z.number().finite().min(-100).max(100), pull: z.number().min(0).max(150), cuePosition: point.optional() }).strict().safeParse(raw)
    if (!parsed.success) return
    socket.data.lastCueAim = Date.now()
    if (parsed.data.cuePosition && (room.ballInHand !== socket.id || !validCuePlacement(room, parsed.data.cuePosition))) return
    socket.to(room.id).volatile.emit('cue-aim', parsed.data)
  })
  socket.on('shot', raw => {
    const room = rooms.get(socket.data.room), parsed = shot.safeParse(raw)
    if (room?.winner) return socket.emit('shot-rejected', 'This game is over. Leave the table to play again.')
    if (!room || room.turn !== socket.id || room.pending || !parsed.success) return socket.emit('shot-rejected', 'Shot rejected. Wait for your turn.')
    const placement = parsed.data.cuePosition
    if (room.ballInHand === socket.id) {
      if (!placement || !validCuePlacement(room, placement)) return socket.emit('shot-rejected', 'Place the cue ball on clear felt before shooting.')
    } else if (placement) return socket.emit('shot-rejected', 'Cue placement requires ball in hand.')
    room.ballInHand = null
    room.pending = true; room.started = Date.now(); room.sequence++
    io.to(room.id).emit('shot', { ...parsed.data, sequence: room.sequence, striker: users.get(socket.id)?.username })
  })

  socket.on('settled', raw => {
    const room = rooms.get(socket.data.room)
    const parsed = settledInput.safeParse(raw)
    if (!room || !room.pending || room.turn !== socket.id || !parsed.success || parsed.data.sequence !== room.sequence) return
    const { sequence, order } = parsed.data
    const balls = parsed.data.balls.map(ball => room.pocketed.has(ball.number) ? { ...ball, pocketed: true } : ball)
    const fresh = balls.filter(ball => ball.pocketed && ball.number !== 0 && !room.pocketed.has(ball.number)).map(ball => ball.number)
    const potted = [...new Set([...order.filter(number => fresh.includes(number)), ...fresh])]
    room.pending = false
    room.balls = balls
    scoreShot(room, socket.id, potted, parsed.data)
    io.to(room.id).emit('sync', { sequence, balls, turn: room.names[room.turn] })
    emitState(room)
  })

  socket.on('leave', () => leaveRoom(socket))
  socket.on('disconnect', () => removeUser(socket))
})

setInterval(() => {
  for (const room of rooms.values()) if (room.pending && Date.now() - room.started > 90000) {
    const player = io.sockets.sockets.get(room.turn)
    if (player) leaveRoom(player)
  }
}, 5000).unref()

const port = Number(process.env.PORT || 8080)
http.listen(port, '0.0.0.0', () => {
  console.log(`Server ready on port ${http.address().port} (${version})`)
})
