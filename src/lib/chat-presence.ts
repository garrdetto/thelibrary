export type ChatPresence = { username: string; activity: string | null; online: boolean; lastSeen: number; activeAt: number; since: number }
export type PresenceStatus = 'active' | 'idle' | 'offline'

export const IDLE_AFTER = 5 * 60 * 1000

export function presenceStatus(person: ChatPresence | undefined, now: number): PresenceStatus {
  if (!person?.online) return 'offline'
  return now - person.activeAt < IDLE_AFTER ? 'active' : 'idle'
}

export function shortDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}

export function agoLabel(at: number, now: number) {
  const span = shortDuration(now - at)
  return span === 'just now' ? span : `${span} ago`
}

export function lastActiveLabel(person: ChatPresence | undefined, now: number) {
  if (!person) return 'Not seen recently'
  const status = presenceStatus(person, now)
  if (status === 'active') return 'Active now'
  if (status === 'idle') return `Idle ${shortDuration(now - person.activeAt)}`
  return `Active ${agoLabel(Math.max(person.activeAt, person.lastSeen), now)}`
}

export function placeLabel(person: ChatPresence | undefined, labels: Record<string, string>, now: number) {
  if (!person) return ''
  const place = !person.activity || person.activity === 'home' ? 'Browsing the library' : labels[person.activity] ?? 'Browsing the library'
  if (!person.online) return place === 'Browsing the library' ? 'Last on the library page' : `Last ${place.replace(/^In /, 'in ')}`
  const span = shortDuration(now - person.since)
  return span === 'just now' ? place : `${place} · ${span}`
}

export function isTabActive(lastInput: number) {
  if (typeof document === 'undefined' || document.hidden || !document.hasFocus()) return false
  return Date.now() - lastInput < IDLE_AFTER || document.activeElement?.tagName === 'IFRAME'
}
