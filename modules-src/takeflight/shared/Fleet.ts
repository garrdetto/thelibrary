/**
 * Every aircraft the page can fly, parsed once from its JSON (the page and tests; the Worker reads the lighter `Hangar.ts`).
 */
import duet from './aircraft/duet.json'
import sprite from './aircraft/sprite.json'
import vesta from './aircraft/vesta.json'
import wren from './aircraft/wren.json'
import { parseAircraft } from './AircraftSpec'
import type { AircraftSpec } from './AircraftSpec'

export const FLEET: readonly AircraftSpec[] = [parseAircraft(wren), parseAircraft(duet), parseAircraft(sprite), parseAircraft(vesta)]

export function fleetSpec(id: string): AircraftSpec | undefined {
  return FLEET.find((spec) => spec.id === id)
}
