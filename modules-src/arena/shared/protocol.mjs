export const ARENA_NAMESPACE = '/arena'
export const ARENA_MAX_PLAYERS = 8
export const ARENA_SEND_HZ = 10

export const ArenaEvent = Object.freeze({
  join: 'arena:join',
  welcome: 'arena:welcome',
  move: 'arena:move',
  state: 'arena:state',
  left: 'arena:left',
  full: 'arena:full',
})
