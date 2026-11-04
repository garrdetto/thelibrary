/** The game clock. Normally the real time; the page can shift it for previews (the server always uses real time). */
let offset = 0

export function setClockOffset(ms: number): void {
  offset = ms
}

export function now(): Date {
  return new Date(Date.now() + offset)
}
