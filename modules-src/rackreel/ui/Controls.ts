/** Turns the one-line control hints ("E — board the boat · Hold left-click to draw · W/S speed") into rows of keycaps and labels for the controls panel on the left. Renderer-free. */

export interface ControlRow {
  /** Keycap labels; `LMB` / `RMB` are mouse buttons; empty for a plain status line. */
  keys: string[]
  text: string
}

const SINGLE = /^(Space|Shift|Esc|Tab|[A-Z]|\d)\b\s*(?:—\s*|to\s+)?(.*)$/
const PAIR = /^([A-Z])\/([A-Z])\s+(.*)$/

function capital(s: string): string {
  const t = s.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

export function parseControl(segment: string): ControlRow {
  let s = segment.trim()
  const arrows = /arrow keys/i.test(s)
  if (arrows) s = s.replace(/\s*(?:·\s*)?arrow keys\s*/i, ' ').trim()
  let m = /^(hold\s+)?R or right-click\s+(?:to\s+)?(.*)$/i.exec(s)
  if (m) return { keys: ['R', 'RMB'], text: capital(`${m[1] ? 'hold to ' : ''}${m[2]}`) }
  m = /^(hold\s+)?left-click\s+(?:to\s+)?(.*)$/i.exec(s)
  if (m) return { keys: ['LMB'], text: capital(`${m[1] ? 'hold to ' : ''}${m[2]}`) }
  m = /^(hold\s+)?right-click\s+(?:to\s+)?(.*)$/i.exec(s)
  if (m) return { keys: ['RMB'], text: capital(`${m[1] ? 'hold to ' : ''}${m[2]}`) }
  m = /^click the view (?:for\s+)?(.*)$/i.exec(s)
  if (m) return { keys: ['LMB', ...(arrows ? ['←', '↑', '↓', '→'] : [])], text: capital(m[1]) }
  m = /^press\s+(\d|[A-Z])\s+(?:for\s+)?(.*)$/i.exec(s)
  if (m) return { keys: [m[1].toUpperCase()], text: capital(m[2]) }
  m = PAIR.exec(s)
  if (m) return { keys: [m[1], m[2]], text: capital(m[3]) }
  m = SINGLE.exec(s)
  if (m && m[2]) return { keys: [m[1]], text: capital(m[2]) }
  if (arrows) return { keys: ['←', '↑', '↓', '→'], text: capital(s || 'look around') }
  return { keys: [], text: s }
}

export function parseControls(prompt: string): ControlRow[] {
  return prompt.split(' · ').map((p) => p.trim()).filter(Boolean).map(parseControl)
}
