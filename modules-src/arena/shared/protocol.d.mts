export declare const ARENA_NAMESPACE: '/arena'
export declare const ARENA_MAX_PLAYERS: number
export declare const ARENA_SEND_HZ: number
export declare const ArenaEvent: Readonly<{
  join: 'arena:join'
  welcome: 'arena:welcome'
  move: 'arena:move'
  state: 'arena:state'
  left: 'arena:left'
  full: 'arena:full'
}>

export interface ArenaPose {
  x: number
  y: number
  z: number
  yaw: number
}

export interface ArenaPlayer extends ArenaPose {
  id: string
  name: string
  team: 0 | 1
}
