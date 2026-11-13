export const WEAPON_IDS = Object.freeze(['assault', 'battle'])

export const WEAPONS = Object.freeze({
  assault: Object.freeze({
    id: 'assault',
    name: 'Assault Rifle',
    mode: 'auto',
    damage: 8,
    headMultiplier: 1.5,
    roundInterval: 0.1,
    burst: 1,
    burstDelay: 0,
    spread: 0.032,
    moveSpread: 0.02,
    magazine: 32,
    reload: 2.0,
    range: 120,
    recoil: Object.freeze({ pitch: 0.012, yaw: 0.006, recover: 9 }),
  }),
  battle: Object.freeze({
    id: 'battle',
    name: 'Battle Rifle',
    mode: 'burst',
    damage: 12,
    headMultiplier: 2,
    roundInterval: 0.07,
    burst: 3,
    burstDelay: 0.36,
    spread: 0.006,
    moveSpread: 0.006,
    magazine: 36,
    reload: 2.2,
    range: 200,
    recoil: Object.freeze({ pitch: 0.009, yaw: 0.003, recover: 11 }),
  }),
})

export function roundsPerSecond(weapon) {
  return weapon.burst / ((weapon.burst - 1) * weapon.roundInterval + Math.max(weapon.roundInterval, weapon.burstDelay))
}
