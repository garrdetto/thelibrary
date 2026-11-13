import { randomUUID } from 'node:crypto'
import {
  ARENA_ACTIONS,
  ARENA_MAX_HEALTH,
  ARENA_MAX_PLAYERS,
  ARENA_NAMESPACE,
  ARENA_RESPAWN_MS,
  ARENA_SPAWNS,
  ARENA_TICK_HZ,
  ArenaEvent,
} from '../shared/protocol.mjs'
import { WEAPONS, roundsPerSecond } from '../shared/weapons.mjs'

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

function spawnFor(team, index) {
  const list = ARENA_SPAWNS[team]
  return list[index % list.length]
}

export function attachArena(io, origins = [], options = {}) {
  const ns = io.of(ARENA_NAMESPACE)
  const players = new Map()
  const respawnMs = options.respawnMs ?? ARENA_RESPAWN_MS
  const tickHz = options.tickHz ?? ARENA_TICK_HZ
  const timers = new Set()
  let tick = 0
  let spawnCounter = 0

  if (origins.length) {
    ns.use((socket, next) => (origins.includes(socket.handshake.headers.origin) ? next() : next(new Error('This site is not authorized.'))))
  }

  const teamCounts = () => [...players.values()].reduce((counts, player) => { counts[player.team]++; return counts }, [0, 0])
  const later = (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, ms)
    timers.add(timer)
  }

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

  const respawn = player => {
    const spawn = spawnFor(player.team, spawnCounter++)
    Object.assign(player, { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, pitch: 0, health: ARENA_MAX_HEALTH, alive: true, action: 'idle', spawnedAt: Date.now() })
    ns.emit(ArenaEvent.respawn, { id: player.id, ...spawn, health: player.health })
  }

  const allowShot = (player, weapon) => {
    const now = Date.now()
    player.shots = player.shots.filter(at => now - at < 1000)
    const limit = Math.ceil(roundsPerSecond(WEAPONS[weapon]) * RATE_SLACK) + 1
    if (player.shots.length >= limit) return false
    player.shots.push(now)
    return true
  }

  ns.on('connection', socket => {
    socket.on(ArenaEvent.join, payload => {
      if (players.has(socket.id)) return
      if (players.size >= ARENA_MAX_PLAYERS) { socket.emit(ArenaEvent.full); return }
      const requested = typeof payload?.name === 'string' ? payload.name : ''
      const name = NAME_PATTERN.test(requested) ? requested : `Guest-${randomUUID().slice(0, 5)}`
      const [blue, red] = teamCounts()
      const team = blue <= red ? 0 : 1
      const spawn = spawnFor(team, spawnCounter++)
      const player = {
        id: randomUUID(),
        socketId: socket.id,
        name,
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
      }
      players.set(socket.id, player)
      socket.data.playerId = player.id
      socket.emit(ArenaEvent.welcome, { id: player.id, team, spawn, tickHz, players: [...players.values()].map(publicPlayer) })
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
      shooter.weapon = shot.weapon
      socket.broadcast.emit(ArenaEvent.shot, { shooter: shooter.id, weapon: shot.weapon, origin: shot.origin, end: shot.end })
      if (!shot.hit) return
      const target = [...players.values()].find(player => player.id === shot.hit)
      if (!target || target === shooter || !target.alive || target.team === shooter.team) return
      const verdict = judgeHit(shooter, target, shot)
      if (!verdict) return
      target.health = Math.max(0, target.health - verdict.amount)
      ns.emit(ArenaEvent.damage, { target: target.id, attacker: shooter.id, weapon: shot.weapon, amount: verdict.amount, health: target.health, headshot: verdict.headshot })
      if (target.health > 0) return
      target.alive = false
      target.action = 'idle'
      target.deaths++
      shooter.kills++
      ns.emit(ArenaEvent.death, { id: target.id, by: shooter.id, weapon: shot.weapon })
      later(() => { if (players.get(target.socketId) === target) respawn(target) }, respawnMs)
    })

    socket.on('disconnect', () => {
      const player = players.get(socket.id)
      if (!player) return
      players.delete(socket.id)
      ns.emit(ArenaEvent.left, { id: player.id })
    })
  })

  const timer = setInterval(() => {
    tick++
    if (players.size) ns.volatile.emit(ArenaEvent.state, { tick, time: Date.now(), players: [...players.values()].map(publicPlayer) })
  }, 1000 / tickHz)
  timer.unref?.()

  return {
    ns,
    players,
    close() {
      clearInterval(timer)
      for (const pending of timers) clearTimeout(pending)
      timers.clear()
    },
  }
}
