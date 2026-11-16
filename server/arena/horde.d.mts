export declare const HORDE: Readonly<{
  ammo: number
  raiderHealth: number
  batDamage: number
  reach: number
  windup: number
  swing: number
  recover: number
  maxAlive: number
  minSpawnDistance: number
  breakSeconds: number
}>
export declare const SPRINT_SPEED: number
export declare function spawnRate(seconds: number): number
export declare function spawnedBy(seconds: number, step?: number): number
export declare function raiderSpeed(seconds: number): number
export declare function bestKillRate(): number
export declare function burstsToKill(part: 'head' | 'body'): number
