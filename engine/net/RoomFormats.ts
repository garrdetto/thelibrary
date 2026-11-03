/** PeerJS room-code formats already in production; each module keeps its own prefix, alphabet, length and wire case. */

export interface RoomFormat {
  prefix: string
  alphabet: string
  length: number
  wireCase: 'lower' | 'upper'
}

const SIX = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const ROOM_FORMATS = {
  sandlot: { prefix: 'sandlot-', alphabet: SIX, length: 6, wireCase: 'lower' },
  chess: { prefix: 'tl-chess-', alphabet: SIX, length: 6, wireCase: 'lower' },
  checkers: { prefix: 'tl-checkers-', alphabet: SIX, length: 6, wireCase: 'lower' },
  maplestreet: { prefix: 'tl-maplestreet-', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 6, wireCase: 'lower' },
  fairway: { prefix: 'tl-fairway-', alphabet: SIX, length: 6, wireCase: 'lower' },
  shorttrack: { prefix: 'sts-oval-race-', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ', length: 5, wireCase: 'upper' },
} as const satisfies Record<string, RoomFormat>
