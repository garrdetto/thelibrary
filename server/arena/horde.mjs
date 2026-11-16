import { WEAPONS } from './weapons.mjs'

export const HORDE = Object.freeze({
  ammo: 2000,
  raiderHealth: 64,
  batDamage: 20,
  reach: 1.55,
  windup: 0.42,
  swing: 0.2,
  recover: 0.65,
  maxAlive: 56,
  minSpawnDistance: 24,
  breakSeconds: 120,
})

export const SPRINT_SPEED = 9.5

export function spawnRate(seconds) {
  const t = Math.max(0, seconds)
  return 0.3 + 0.6 * (t / 60) + 2.9 * (t / 120) ** 3
}

export function spawnedBy(seconds, step = 0.05) {
  let total = 0
  for (let t = 0; t < seconds; t += step) total += spawnRate(t) * step
  return total
}

export function raiderSpeed(seconds) {
  const t = Math.max(0, seconds)
  return 2.4 + 7.4 * (t / 130) ** 1.6
}

export function bestKillRate() {
  const rifle = WEAPONS.battle
  const headBurst = rifle.burst * rifle.damage * rifle.headMultiplier
  const burstsPerKill = Math.ceil(HORDE.raiderHealth / headBurst)
  const burstTime = (rifle.burst - 1) * rifle.roundInterval + Math.max(rifle.roundInterval, rifle.burstDelay)
  const burstsPerMagazine = Math.floor(rifle.magazine / rifle.burst)
  const magazineTime = burstsPerMagazine * burstTime + rifle.reload
  return burstsPerMagazine / burstsPerKill / magazineTime
}

export function burstsToKill(part) {
  const rifle = WEAPONS.battle
  const perBurst = rifle.burst * rifle.damage * (part === 'head' ? rifle.headMultiplier : 1)
  return Math.ceil(HORDE.raiderHealth / perBurst)
}
