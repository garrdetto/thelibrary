/**
 * The aircraft the career knows: id, family and category of each, as plain data so the Worker can read it without bundling
 * the full aircraft JSON. `tests/career.test.ts` checks it against `shared/aircraft/*.json`.
 */
import type { AircraftSpec } from './AircraftSpec'
import { pilotClassOf } from './Career'
import type { LicenceId, PilotClass } from './Career'

export interface HangarEntry {
  id: string
  family: string
  category: AircraftSpec['category']
  /** Licence needed to fly it outside a checkride. */
  requires: LicenceId
}

export const HANGAR: readonly HangarEntry[] = [
  { id: 'halden-wren', family: 'wren', category: 'trainer', requires: 'student' },
  { id: 'arden-duet', family: 'duet', category: 'twin', requires: 'ppl' },
]

export function hangarEntry(id: string): HangarEntry | undefined {
  return HANGAR.find((entry) => entry.id === id)
}

/** Pilot classes of the aircraft in the hangar. */
export const HANGAR_CLASSES: readonly PilotClass[] = [...new Set(HANGAR.map((entry) => pilotClassOf(entry.category)))]
