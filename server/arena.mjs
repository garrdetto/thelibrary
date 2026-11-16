import { randomUUID } from 'node:crypto'
import {
  ARENA_ACTIONS,
  ARENA_CODE_PATTERN,
  ARENA_COUNTDOWN_MS,
  ARENA_INTERMISSION_MS,
  ARENA_MAX_HEALTH,
  ARENA_MODES,
  ARENA_NAMESPACE,
  ARENA_RESPAWN_MS,
  ARENA_SPAWNS,
  ARENA_TICK_HZ,
  ArenaEvent,
} from './arena/protocol.mjs'
import { WEAPONS, roundsPerSecond } from './arena/weapons.mjs'

const NAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/
const BOUNDS = { x: 40, yMin: -40, yMax: 40, z: 64 }
const EYE_HEIGHT = 1.7
const HEAD_HEIGHT = 1.45
const HIT_RADIUS = 1.5
const RAY_TOLERANCE = 0.75
const ORIGIN_TOLERANCE = 3
const RATE_SLACK = 1.3

const finite = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
const round = value => Math.round(value * 1000) / 1000

function cleanVector(value, limit = 400) {
  if (!value || typeof value !== 'object') return null
  const { x, y, z } = value
  return finite(x, limit) && finite(y, limit) && finite(z, limit) ? { x, y, z } : null
}

export function cleanPose(pose) {
  if (!pose || typeof pose !== 'object') return null
  const { x, y, z, yaw } = pose
  if (!finite(x, BOUNDS.x) || !finite(z, BOUNDS.z) || !finite(yaw, 1000)) return null
  if (typeof y !== 'number' || !Number.isFinite(y) || y < BOUNDS.yMin || y > BOUNDS.yMax) return null
  const pitch = finite(pose.pitch, Math.PI) ? pose.pitch : 0
  const action = ARENA_ACTIONS.includes(pose.action) ? pose.action : 'idle'
  const weapon = Object.hasOwn(WEAPONS, pose.weapon) ? pose.weapon : null
  return { x, y, z, yaw, pitch, action, ...(weapon ? { weapon } : {}) }
}

export function cleanShot(request) {
  if (!request || typeof request !== 'object') return null
  if (!Object.hasOwn(WEAPONS, request.weapon)) return null
  const origin = cleanVector(request.origin)
  const direction = cleanVector(request.direction, 2)
  const end = cleanVector(request.end)
  if (!origin || !direction || !end) return null
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (length < 0.5 || length > 1.5) return null
  const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length }
  const hit = typeof request.hit === 'string' && request.hit.length <= 64 ? request.hit : null
  return { weapon: request.weapon, origin, direction: unit, end, hit }
}

export function cleanJoin(payload) {
  const requested = typeof payload?.name === 'string' ? payload.name : ''
  const name = NAME_PATTERN.test(requested) ? requested : null
  const mode = typeof payload?.mode === 'string' && Object.hasOwn(ARENA_MODES, payload.mode) ? payload.mode : 'open'
  const code = typeof payload?.code === 'string' && ARENA_CODE_PATTERN.test(payload.code) ? payload.code : null
  return { name, mode, code }
}

export function distanceToRay(point, origin, direction) {
  const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z
  const along = dx * direction.x + dy * direction.y + dz * direction.z
  if (along < 0) return { along, off: Math.hypot(dx, dy, dz) }
  const px = dx - direction.x * along, py = dy - direction.y * along, pz = dz - direction.z * along
  return { along, off: Math.hypot(px, py, pz) }
}

export function judgeHit(shooter, target, shot) {
  const weapon = WEAPONS[shot.weapon]
  const eye = { x: shooter.x, y: shooter.y + EYE_HEIGHT, z: shooter.z }
  if (Math.hypot(shot.origin.x - eye.x, shot.origin.y - eye.y, shot.origin.z - eye.z) > ORIGIN_TOLERANCE) return null
  const { along, off } = distanceToRay(shot.end, shot.origin, shot.direction)
  if (along < 0 || along > weapon.range + 1 || off > RAY_TOLERANCE) return null
  const horizontal = Math.hypot(shot.end.x - target.x, shot.end.z - target.z)
  const height = shot.end.y - target.y
  if (horizontal > HIT_RADIUS || height < -0.4 || height > 2.4) return null
  const headshot = height >= HEAD_HEIGHT
  return { headshot, amount: Math.round(weapon.damage * (headshot ? weapon.headMultiplier : 1)) }
}

export function attachArena(io, origins = [], options = {}) {
  const ns = io.of(ARENA_NAMESPACE)
  const players = new Map()
  const rooms = new Map()
  const respawnMs = options.respawnMs ?? ARENA_RESPAWN_MS
  const countdownMs = options.countdownMs ?? ARENA_COUNTDOWN_MS
  const intermissionMs = options.intermissionMs ?? ARENA_INTERMISSION_MS
  const modes = { ...ARENA_MODES, ...(options.modes ?? {}) }
  const tickHz = options.tickHz ?? ARENA_TICK_HZ
  const timers = new Set()
  let tick = 0

  if (origins.length) {
    ns.use((socket, next) => (origins.includes(socket.handshake.headers.origin) ? next() : next(new Error('This site is not authorized.'))))
  }

  const later = (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, ms)
    timers.add(timer)
    return timer
  }
  const cancel = timer => {
    if (!timer) return
    clearTimeout(timer)
    timers.delete(timer)
  }

  const roomPlayers = room => [...players.values()].filter(player => player.room === room)
  const teamCounts = room => roomPlayers(room).reduce((counts, player) => { counts[player.team]++; return counts }, [0, 0])
  const spawnFor = (room, team) => ARENA_SPAWNS[team][room.spawnCounter++ % ARENA_SPAWNS[team].length]

  const createRoom = (mode, code) => {
    const spec = modes[mode]
    const room = {
      id: randomUUID().slice(0, 8),
      mode,
      spec,
      code,
      phase: spec.scoreLimit ? 'waiting' : 'live',
      phaseEndsAt: 0,
      scores: [0, 0],
      winner: null,
      reason: null,
      spawnCounter: 0,
      timer: null,
    }
    rooms.set(room.id, room)
    return room
  }

  const findRoom = (mode, code) => {
    if (code) {
      const existing = [...rooms.values()].find(room => room.code === code)
      return existing ?? createRoom(mode, code)
    }
    const open = [...rooms.values()].find(room => room.mode === mode && !room.code && roomPlayers(room).length < room.spec.capacity && (room.phase === 'waiting' || !room.spec.scoreLimit))
    return open ?? createRoom(mode, null)
  }

  const matchOf = room => ({
    mode: room.mode,
    phase: room.phase,
    players: roomPlayers(room).length,
    capacity: room.spec.capacity,
    scores: [...room.scores],
    scoreLimit: room.spec.scoreLimit,
    remainingMs: room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - Date.now()) : 0,
    winner: room.winner,
    reason: room.reason,
  })

  const publicPlayer = player => ({
    id: player.id,
    name: player.name,
    team: player.team,
    x: round(player.x),
    y: round(player.y),
    z: round(player.z),
    yaw: round(player.yaw),
    pitch: round(player.pitch),
    action: player.action,
    weapon: player.weapon,
    health: player.health,
    alive: player.alive,
    kills: player.kills,
    deaths: player.deaths,
  })

  const announce = room => ns.to(room.id).emit(ArenaEvent.match, matchOf(room))

  const respawn = player => {
    const spawn = spawnFor(player.room, player.team)
    Object.assign(player, { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, pitch: 0, health: ARENA_MAX_HEALTH, alive: true, action: 'idle', spawnedAt: Date.now() })
    cancel(player.respawnTimer)
    player.respawnTimer = null
    ns.to(player.room.id).emit(ArenaEvent.respawn, { id: player.id, ...spawn, health: player.health })
  }

  const setPhase = (room, phase, ms = 0) => {
    cancel(room.timer)
    room.timer = null
    room.phase = phase
    room.phaseEndsAt = ms ? Date.now() + ms : 0
    if (phase === 'countdown') room.timer = later(() => startMatch(room), ms)
    else if (phase === 'live' && ms) room.timer = later(() => finishMatch(room, 'time'), ms)
    else if (phase === 'over') room.timer = later(() => afterMatch(room), ms)
    announce(room)
  }

  const startMatch = room => {
    room.scores = [0, 0]
    room.winner = null
    room.reason = null
    room.spawnCounter = 0
    for (const player of roomPlayers(room)) {
      player.kills = 0
      player.deaths = 0
      respawn(player)
    }
    setPhase(room, 'live', room.spec.timeLimitMs)
  }

  const finishMatch = (room, reason) => {
    if (room.phase !== 'live') return
    const [blue, red] = room.scores
    room.winner = blue === red ? null : blue > red ? 0 : 1
    room.reason = reason
    setPhase(room, 'over', intermissionMs)
  }

  const afterMatch = room => {
    if (!rooms.has(room.id)) return
    room.winner = null
    room.reason = null
    if (roomPlayers(room).length >= room.spec.capacity) setPhase(room, 'countdown', countdownMs)
    else setPhase(room, 'waiting')
  }

  const checkStart = room => {
    if (!room.spec.scoreLimit || room.phase !== 'waiting') return
    if (roomPlayers(room).length >= room.spec.capacity) setPhase(room, 'countdown', countdownMs)
  }

  const allowShot = (player, weapon) => {
    const now = Date.now()
    player.shots = player.shots.filter(at => now - at < 1000)
    const limit = Math.ceil(roundsPerSecond(WEAPONS[weapon]) * RATE_SLACK) + 1
    if (player.shots.length >= limit) return false
    player.shots.push(now)
    return true
  }

  const leave = socket => {
    const player = players.get(socket.id)
    if (!player) return
    players.delete(socket.id)
    cancel(player.respawnTimer)
    const room = player.room
    socket.leave(room.id)
    ns.to(room.id).emit(ArenaEvent.left, { id: player.id })
    const left = roomPlayers(room).length
    if (!left) {
      cancel(room.timer)
      rooms.delete(room.id)
      return
    }
    if (!room.spec.scoreLimit) return
    if (room.phase === 'live') {
      room.reason = 'left'
      room.winner = player.team === 0 ? 1 : 0
      setPhase(room, 'over', intermissionMs)
    } else if (room.phase === 'countdown') {
      setPhase(room, 'waiting')
    } else {
      announce(room)
    }
  }

  ns.on('connection', socket => {
    socket.on(ArenaEvent.join, payload => {
      if (players.has(socket.id)) return
      const request = cleanJoin(payload)
      const room = findRoom(request.mode, request.code)
      if (roomPlayers(room).length >= room.spec.capacity) {
        socket.emit(ArenaEvent.full, { mode: room.mode, code: room.code })
        return
      }
      const [blue, red] = teamCounts(room)
      const team = blue <= red ? 0 : 1
      const spawn = spawnFor(room, team)
      const player = {
        id: randomUUID(),
        socketId: socket.id,
        name: request.name ?? `Guest-${randomUUID().slice(0, 5)}`,
        room,
        team,
        ...spawn,
        pitch: 0,
        action: 'idle',
        weapon: 'assault',
        health: ARENA_MAX_HEALTH,
        alive: true,
        kills: 0,
        deaths: 0,
        shots: [],
        spawnedAt: Date.now(),
        respawnTimer: null,
      }
      players.set(socket.id, player)
      socket.join(room.id)
      socket.data.playerId = player.id
      socket.emit(ArenaEvent.welcome, {
        id: player.id,
        team,
        spawn,
        tickHz,
        room: { id: room.id, mode: room.mode, code: room.code },
        match: matchOf(room),
        players: roomPlayers(room).map(publicPlayer),
      })
      if (room.phase === 'waiting') announce(room)
      checkStart(room)
    })

    socket.on(ArenaEvent.move, pose => {
      const player = players.get(socket.id)
      const clean = cleanPose(pose)
      if (!player || !clean || !player.alive) return
      Object.assign(player, clean)
    })

    socket.on(ArenaEvent.shoot, request => {
      const shooter = players.get(socket.id)
      const shot = cleanShot(request)
      if (!shooter || !shot || !shooter.alive || !allowShot(shooter, shot.weapon)) return
      const room = shooter.room
      shooter.weapon = shot.weapon
      socket.to(room.id).emit(ArenaEvent.shot, { shooter: shooter.id, weapon: shot.weapon, origin: shot.origin, end: shot.end })
      if (!shot.hit || room.phase === 'countdown' || room.phase === 'over') return
      const target = roomPlayers(room).find(player => player.id === shot.hit)
      if (!target || target === shooter || !target.alive || target.team === shooter.team) return
      const verdict = judgeHit(shooter, target, shot)
      if (!verdict) return
      target.health = Math.max(0, target.health - verdict.amount)
      ns.to(room.id).emit(ArenaEvent.damage, { target: target.id, attacker: shooter.id, weapon: shot.weapon, amount: verdict.amount, health: target.health, headshot: verdict.headshot })
      if (target.health > 0) return
      target.alive = false
      target.action = 'idle'
      target.deaths++
      shooter.kills++
      ns.to(room.id).emit(ArenaEvent.death, { id: target.id, by: shooter.id, weapon: shot.weapon })
      target.respawnTimer = later(() => { if (players.get(target.socketId) === target) respawn(target) }, respawnMs)
      if (room.phase !== 'live' || !room.spec.scoreLimit) return
      room.scores[shooter.team]++
      announce(room)
      if (room.scores[shooter.team] >= room.spec.scoreLimit) finishMatch(room, 'score')
    })

    socket.on('disconnect', () => leave(socket))
  })

  const timer = setInterval(() => {
    tick++
    for (const room of rooms.values()) {
      const list = roomPlayers(room)
      if (list.length) ns.to(room.id).volatile.emit(ArenaEvent.state, { tick, time: Date.now(), players: list.map(publicPlayer), match: matchOf(room) })
    }
  }, 1000 / tickHz)
  timer.unref?.()

  return {
    ns,
    players,
    rooms,
    close() {
      clearInterval(timer)
      for (const pending of timers) clearTimeout(pending)
      timers.clear()
    },
  }
}
