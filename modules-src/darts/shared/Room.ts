/** Online room helpers shared by the page and the DartsRoom Durable Object: room codes, limits and timings. */

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_SEATS = 4
/** How long the darts stay in the board after a turn before the next player steps up. */
export const TURN_PAUSE_MS = 1600
export const LEG_PAUSE_MS = 3200
/** A player who has not thrown for this long loses the rest of the turn. */
export const TURN_TIMEOUT_MS = 45_000
/** How long a dropped player's seat is held before they are removed from the match. */
export const RECONNECT_MS = 90_000

export function roomCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length]
  return code
}

export function isRoomCode(value: string): boolean {
  return value.length === ROOM_CODE_LENGTH && [...value].every((char) => ROOM_ALPHABET.includes(char))
}
