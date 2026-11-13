/**
 * Your cars in the lake country's water. They used to drive along the lake bed
 * fully under water; now water drags at a car in proportion to how deep it is,
 * and once it is deep enough to reach the doors the engine floods: the car
 * loses power, and a moment later it is towed back to the last spot where it
 * stood on dry ground, facing away from the water. Trailers and parked cars
 * that roll in are towed out the same way.
 */
import { WATER_LEVEL } from '../../rackreel/world/Terrain'
import type { Terrain } from '../../rackreel/world/Terrain'
import { TOWN_Y, sceneToTown, townToScene } from '../region'
import type { Car, Cars } from './Cars'

/** Water this deep under the car slows it; this deep floods the engine (metres). */
export const WADE_DRAG_DEPTH = 0.25
export const FLOOD_DEPTH = 0.85
const TOW_AFTER = 1.6

interface CarWater {
  dry: { x: number; z: number; yaw: number } | null
  flooded: number
}

export class Wading {
  private readonly state = new Map<Car, CarWater>()
  private readonly _t = { x: 0, y: 0, z: 0 }

  constructor(private readonly terrain: Terrain, private readonly cars: Cars, private readonly toast: (text: string) => void) {}

  /** Water depth under a car (scene metres), 0 on land or anywhere outside the lake country. */
  depthUnder(car: Car): number {
    const p = car.fp.position
    const s = townToScene(p.x, p.y, p.z, this._t)
    if (!this.terrain.inSquare(s.x, s.z)) return 0
    return Math.max(0, WATER_LEVEL - this.terrain.heightAt(s.x, s.z))
  }

  /** True when the car's engine is flooded (no throttle until it is towed out). */
  flooded(car: Car): boolean {
    return (this.state.get(car)?.flooded ?? 0) > 0
  }

  /** One physics step: drag, flooding, and the tow out. */
  step(dt: number): void {
    for (const car of this.cars.list.values()) {
      let w = this.state.get(car)
      if (!w) this.state.set(car, (w = { dry: null, flooded: 0 }))
      const depth = this.depthUnder(car)
      const body = car.fp.body
      if (depth < 0.05) {
        const p = car.fp.position
        const f = car.fp.forward()
        if (Math.abs(car.fp.speed) < 25) w.dry = { x: p.x, z: p.z, yaw: Math.atan2(-f.z, f.x) }
        w.flooded = 0
        continue
      }
      if (depth > WADE_DRAG_DEPTH) {
        const v = body.linvel()
        const k = Math.min(0.9, (depth - WADE_DRAG_DEPTH) * 2.2) * dt * 4
        body.setLinvel({ x: v.x * (1 - k), y: v.y, z: v.z * (1 - k) }, true)
      }
      if (depth >= FLOOD_DEPTH) {
        if (w.flooded === 0 && car === this.cars.driving()) this.toast('The water is over the doors: the engine flooded.')
        w.flooded += dt
        car.fp.input.throttle = 0
        if (w.flooded > TOW_AFTER) this.tow(car, w)
      } else if (w.flooded > 0) {
        w.flooded += dt
        car.fp.input.throttle = 0
        if (w.flooded > TOW_AFTER) this.tow(car, w)
      }
    }
  }

  private tow(car: Car, w: CarWater): void {
    const spot = w.dry ? { ...w.dry, yaw: w.dry.yaw + Math.PI } : this.shore(car)
    w.flooded = 0
    if (!spot) return
    car.fp.towedBy?.unhitch()
    car.fp.unhitch()
    const s = townToScene(spot.x, 0, spot.z, this._t)
    const ground = this.terrain.heightAt(s.x, s.z) - TOWN_Y
    const P = car.fp.preset
    const body = car.fp.body
    body.setTranslation({ x: spot.x, y: ground + P.chassis.hy + P.suspension.rest + 0.5, z: spot.z }, true)
    body.setRotation({ x: 0, y: Math.sin(spot.yaw / 2), z: 0, w: Math.cos(spot.yaw / 2) }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    car.fp.input = { throttle: 0, steer: 0, brake: 1, handbrake: true }
    this.cars.sync(car)
    if (car === this.cars.driving()) this.toast('Towed back to dry ground. Keep the truck out of the deep water.')
  }

  /** The nearest dry, gentle ground to a car with no dry spot on record, facing away from the water. */
  private shore(car: Car): { x: number; z: number; yaw: number } | null {
    const p = car.fp.position
    const s = townToScene(p.x, p.y, p.z)
    for (let r = 6; r <= 160; r += 6) {
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2
        const x = s.x + Math.cos(ang) * r
        const z = s.z + Math.sin(ang) * r
        if (!this.terrain.inBounds(x, z, 4) || this.terrain.heightAt(x, z) < 0.8 || this.terrain.slopeAt(x, z) > 0.3) continue
        const t = sceneToTown(x, 0, z)
        const dx = x - s.x
        const dz = -(z - s.z)
        return { x: t.x, z: t.z, yaw: Math.atan2(-dz, dx) }
      }
    }
    return null
  }

  forget(car: Car): void {
    this.state.delete(car)
  }
}
