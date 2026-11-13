import type { WeaponId } from './weapons.mjs'

export declare const ARENA_NAMESPACE: '/arena'
export declare const ARENA_MAX_PLAYERS: number
export declare const ARENA_TICK_HZ: number
export declare const ARENA_SEND_HZ: number
export declare const ARENA_MAX_HEALTH: number
export declare const ARENA_RESPAWN_MS: number
export type ArenaAction = 'idle' | 'firing' | 'reloading' | 'switching'
export declare const ARENA_ACTIONS: readonly ArenaAction[]
export declare const ArenaEvent: Readonly<{
  join: 'arena:join'
  welcome: 'arena:welcome'
  move: 'arena:move'
  state: 'arena:state'
  left: 'arena:left'
  full: 'arena:full'
  shoot: 'arena:shoot'
  shot: 'arena:shot'
  damage: 'arena:damage'
  death: 'arena:death'
  respawn: 'arena:respawn'
}>

export interface ArenaSpawn {
  x: number
  y: number
  z: number
  yaw: number
}
export declare const ARENA_SPAWNS: readonly [readonly ArenaSpawn[], readonly ArenaSpawn[]]

export interface ArenaPose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  action: ArenaAction
  weapon: WeaponId
}

export interface ArenaPlayer extends ArenaPose {
  id: string
  name: string
  team: 0 | 1
  health: number
  alive: boolean
  kills: number
  deaths: number
}

export interface ArenaState {
  tick: number
  time: number
  players: ArenaPlayer[]
}

export interface ArenaShootRequest {
  weapon: WeaponId
  origin: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  hit?: string | null
}

export interface ArenaShot {
  shooter: string
  weapon: WeaponId
  origin: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
}

export interface ArenaDamage {
  target: string
  attacker: string
  weapon: WeaponId
  amount: number
  health: number
  headshot: boolean
}

export interface ArenaDeath {
  id: string
  by: string
  weapon: WeaponId
}

export interface ArenaRespawn extends ArenaSpawn {
  id: string
  health: number
}
