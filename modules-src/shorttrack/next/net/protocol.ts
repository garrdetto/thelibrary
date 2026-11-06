/**
 * PeerJS room protocol for Short Track Showdown (host relay, peer ids `sts-oval-race-<CODE>`). A guest's `hello`
 * carries `pv`; the host refuses any other version with `{t:'version', pv}` and closes the connection, so peers
 * running different physics never share a race. Bump this whenever the wire format or the simulation changes.
 */
export const PROTOCOL_VERSION = 1

export const ROOM_PREFIX = 'sts-oval-race-'

export function helloAccepted(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as { pv?: unknown }).pv === PROTOCOL_VERSION
}

export const VERSION_MISMATCH = 'That room is running a different version of Short Track Showdown. Reload both pages to race together.'
