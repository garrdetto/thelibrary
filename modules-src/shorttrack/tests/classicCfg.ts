import type { CarCfg } from '../sim/car'
import type { TrackCfg } from '../sim/track'

export const classicCfg = (): TrackCfg & CarCfg & Record<string, number> => ({
  L: 180, R: 62, W: 16, APRON: 7, turnBank: 24, straightBank: 6, bankIn: 60, bankOut: 40,
  g: 9.81, grip: 1.05, apronGrip: 0.82, offTrack: 0.7, concreteTurn: 0.1, concreteSpeed: 0.8, contactSlow: 0.4,
  packBoost: 0.02, power: 360, maxAccel: 11, drag: 0.0009, roll: 0.3, engineBrake: 4.6, brake: 7, reverseMax: 6,
  scrub: 0.0065, slideScrub: 0.5, wheelbase: 2.8, steerLow: 0.47, steerSpeed: 0.07, steerRampIn: 8, steerRampOut: 6,
  carScale: 1.15, spinThreshold: 1.6, spinRate: 0.8, wallRest: 0.22, carRest: 0.15, carBounce: 0.7, damageScale: 0.7,
  paceSpeed: 31.0, aiPaceSpeed: 30.5, cautionSpeed: 29, cautionTime: 25, aiDecel: 5.5, maxCars: 20,
})
