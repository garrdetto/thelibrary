import type { VehicleModel } from '../sim/world'

/**
 * PeerJS room protocol for Short Track Showdown (host relay, peer ids `sts-oval-race-<CODE>`). A guest's `hello`
 * carries `pv` and `ph` (the vehicle model, `classic` when missing); the host refuses any other version or model with
 * `{t:'version', pv, ph}` and closes the connection, so peers running different physics never share a race. Bump this
 * whenever the wire format or the simulation changes.
 */
export const PROTOCOL_VERSION = 2

export const ROOM_PREFIX = 'sts-oval-race-'

export function helloAccepted(message: unknown, physics: VehicleModel = 'classic'): boolean {
  if (typeof message !== 'object' || message === null) return false
  const m = message as { pv?: unknown; ph?: unknown }
  return m.pv === PROTOCOL_VERSION && (m.ph ?? 'classic') === physics
}

export const VERSION_MISMATCH = 'That room is running a different version of Short Track Showdown. Reload both pages to race together.'

export const PHYSICS_MISMATCH = 'That room is using the other vehicle physics. Open both pages with the same link to race together.'
