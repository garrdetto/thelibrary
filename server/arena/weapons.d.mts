export type WeaponId = 'assault' | 'battle'
export type FireMode = 'auto' | 'burst'

export interface WeaponSpec {
  id: WeaponId
  name: string
  mode: FireMode
  damage: number
  headMultiplier: number
  roundInterval: number
  burst: number
  burstDelay: number
  spread: number
  moveSpread: number
  magazine: number
  reload: number
  range: number
  recoil: { pitch: number; yaw: number; recover: number }
}

export declare const WEAPON_IDS: readonly WeaponId[]
export declare const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>>
export declare function roundsPerSecond(weapon: WeaponSpec): number
