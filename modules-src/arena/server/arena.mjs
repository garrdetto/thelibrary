import { ARENA_MAX_PLAYERS, ARENA_NAMESPACE, ARENA_SEND_HZ, ArenaEvent } from '../shared/protocol.mjs'

const NAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/
const BOUNDS = { x: 40, yMin: -40, yMax: 40, z: 64 }

const finite = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

function cleanPose(pose) {
  if (!pose || typeof pose !== 'object') return null
  const { x, y, z, yaw } = pose
  if (!finite(x, BOUNDS.x) || !finite(z, BOUNDS.z) || !finite(yaw, 1000)) return null
  if (typeof y !== 'number' || !Number.isFinite(y) || y < BOUNDS.yMin || y > BOUNDS.yMax) return null
  return { x, y, z, yaw }
}

export function attachArena(io, origins = []) {
  const ns = io.of(ARENA_NAMESPACE)
  const players = new Map()

  if (origins.length) {
    ns.use((socket, next) => (origins.includes(socket.handshake.headers.origin) ? next() : next(new Error('This site is not authorized.'))))
  }

  const teamCounts = () => [...players.values()].reduce((counts, player) => { counts[player.team]++; return counts }, [0, 0])

  ns.on('connection', socket => {
    socket.on(ArenaEvent.join, payload => {
      if (players.has(socket.id)) return
      if (players.size >= ARENA_MAX_PLAYERS) { socket.emit(ArenaEvent.full); return }
      const requested = typeof payload?.name === 'string' ? payload.name : ''
      const name = NAME_PATTERN.test(requested) ? requested : `Guest-${socket.id.slice(0, 5)}`
      const [blue, red] = teamCounts()
      const team = blue <= red ? 0 : 1
      players.set(socket.id, { id: socket.id, name, team, x: 0, y: 4, z: team === 0 ? -45 : 45, yaw: team === 0 ? 0 : Math.PI })
      socket.emit(ArenaEvent.welcome, { id: socket.id, team })
    })

    socket.on(ArenaEvent.move, pose => {
      const player = players.get(socket.id)
      const clean = cleanPose(pose)
      if (player && clean) Object.assign(player, clean)
    })

    socket.on('disconnect', () => {
      if (players.delete(socket.id)) ns.emit(ArenaEvent.left, { id: socket.id })
    })
  })

  const timer = setInterval(() => {
    if (players.size) ns.volatile.emit(ArenaEvent.state, [...players.values()])
  }, 1000 / ARENA_SEND_HZ)
  timer.unref?.()

  return { ns, players, close: () => clearInterval(timer) }
}
