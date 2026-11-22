export type VehicleId = 'car' | 'van' | 'pickup' | 'minibus' | 'icecream' | 'bus' | 'boxtruck' | 'dump' | 'fire' | 'tanker' | 'crane' | 'monster' | 'tractor'

export type VehicleSpec = {
  id: VehicleId
  name: string
  mass: number
  length: number
  height: number
  wheelRadius: number
  axles: number[]
  speed: number
  accel: number
  body: string
  trim: string
  shape: 'car' | 'van' | 'pickup' | 'bus' | 'truck' | 'tanker' | 'crane' | 'monster' | 'tractor' | 'icecream' | 'fire' | 'dump'
}

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  car: { id: 'car', name: 'Hatchback', mass: 1_200, length: 4, height: 1.4, wheelRadius: 0.34, axles: [-1.3, 1.3], speed: 6, accel: 4, body: '#3d8bfd', trim: '#dbe8ff', shape: 'car' },
  van: { id: 'van', name: 'Delivery van', mass: 2_400, length: 5, height: 2.1, wheelRadius: 0.36, axles: [-1.7, 1.6], speed: 5.5, accel: 3.5, body: '#f2f2f0', trim: '#2fae66', shape: 'van' },
  pickup: { id: 'pickup', name: 'Pickup', mass: 2_800, length: 5.4, height: 1.8, wheelRadius: 0.4, axles: [-1.9, 1.7], speed: 5.5, accel: 3.5, body: '#c43d32', trim: '#2b2b2b', shape: 'pickup' },
  icecream: { id: 'icecream', name: 'Ice cream truck', mass: 4_000, length: 5.6, height: 2.6, wheelRadius: 0.4, axles: [-1.9, 1.8], speed: 5, accel: 3, body: '#fff3f8', trim: '#ff7fb4', shape: 'icecream' },
  minibus: { id: 'minibus', name: 'Minibus', mass: 5_000, length: 6.4, height: 2.6, wheelRadius: 0.42, axles: [-2.3, 2.1], speed: 5, accel: 3, body: '#ffcc33', trim: '#2b2b2b', shape: 'bus' },
  tractor: { id: 'tractor', name: 'Tractor', mass: 6_000, length: 4.4, height: 2.8, wheelRadius: 0.75, axles: [-1.3, 1.3], speed: 3.5, accel: 2.5, body: '#3f9b3a', trim: '#f2c230', shape: 'tractor' },
  monster: { id: 'monster', name: 'Monster truck', mass: 6_500, length: 5.6, height: 3.2, wheelRadius: 0.95, axles: [-1.9, 1.9], speed: 6, accel: 4, body: '#7a3cff', trim: '#ffd23b', shape: 'monster' },
  boxtruck: { id: 'boxtruck', name: 'Box truck', mass: 9_000, length: 7.6, height: 3.4, wheelRadius: 0.48, axles: [-2.9, 2.6], speed: 4.5, accel: 2.5, body: '#e9ecef', trim: '#2f6fd6', shape: 'truck' },
  bus: { id: 'bus', name: 'City bus', mass: 12_000, length: 10, height: 3.2, wheelRadius: 0.5, axles: [-3.4, 3.4], speed: 4.5, accel: 2.5, body: '#2fae66', trim: '#f6f6f6', shape: 'bus' },
  dump: { id: 'dump', name: 'Dump truck', mass: 16_000, length: 8, height: 3.4, wheelRadius: 0.58, axles: [-3, 0.2, 2.8], speed: 4, accel: 2.2, body: '#f2a51a', trim: '#4a4a4a', shape: 'dump' },
  fire: { id: 'fire', name: 'Fire engine', mass: 18_000, length: 9.6, height: 3.3, wheelRadius: 0.55, axles: [-3.5, -2.2, 3.3], speed: 5, accel: 2.5, body: '#d7261e', trim: '#f2f2f2', shape: 'fire' },
  tanker: { id: 'tanker', name: 'Fuel tanker', mass: 24_000, length: 11, height: 3.4, wheelRadius: 0.55, axles: [-4.6, -3.4, 2.2, 4.2], speed: 4, accel: 2, body: '#d9dde2', trim: '#2a6bd1', shape: 'tanker' },
  crane: { id: 'crane', name: 'Crane truck', mass: 32_000, length: 12, height: 3.6, wheelRadius: 0.6, axles: [-4.8, -3.4, 2, 3.4, 4.8], speed: 3.5, accel: 1.8, body: '#f5c518', trim: '#333', shape: 'crane' },
}

export function convoyMass(ids: readonly VehicleId[]): number {
  return Math.max(...ids.map(id => VEHICLES[id].mass))
}
