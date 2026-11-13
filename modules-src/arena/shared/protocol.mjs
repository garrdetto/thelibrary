export const ARENA_NAMESPACE = '/arena'
export const ARENA_MAX_PLAYERS = 8
export const ARENA_TICK_HZ = 20
export const ARENA_SEND_HZ = 20
export const ARENA_MAX_HEALTH = 100
export const ARENA_RESPAWN_MS = 3000
export const ARENA_ACTIONS = Object.freeze(['idle', 'firing', 'reloading', 'switching'])

export const ArenaEvent = Object.freeze({
  join: 'arena:join',
  welcome: 'arena:welcome',
  move: 'arena:move',
  state: 'arena:state',
  left: 'arena:left',
  full: 'arena:full',
  shoot: 'arena:shoot',
  shot: 'arena:shot',
  damage: 'arena:damage',
  death: 'arena:death',
  respawn: 'arena:respawn',
})

export const ARENA_SPAWNS = Object.freeze([
  Object.freeze([
    { x: 0, y: 4.05, z: -45, yaw: 0 },
    { x: -5, y: 4.05, z: -44, yaw: 0 },
    { x: 5, y: 4.05, z: -44, yaw: 0 },
  ]),
  Object.freeze([
    { x: 0, y: 4.05, z: 45, yaw: Math.PI },
    { x: -5, y: 4.05, z: 44, yaw: Math.PI },
    { x: 5, y: 4.05, z: 44, yaw: Math.PI },
  ]),
])
