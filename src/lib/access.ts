export const studioGrants = ['chat', 'image', 'lyrics', 'voice'] as const
export const RADAR_GRANT = 'axiom-radar'
export const MUSIC_GRANT = 'music'
export const MUSIC_TRACK_PREFIX = 'music:'
export const MODULE_PREFIX = 'module:'
export const GRANT_LIMIT = 300

export const grantPattern = /^(chat|image|lyrics|voice|axiom-radar|music|music:[0-9a-f-]{36}|module:[a-z0-9-]{1,32})$/

export function cleanGrants(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter((grant): grant is string => typeof grant === 'string' && grantPattern.test(grant)))].slice(0, GRANT_LIMIT)
}

export function musicTrackGrants(grants: readonly string[]) {
  return grants.filter(grant => grant.startsWith(MUSIC_TRACK_PREFIX)).map(grant => grant.slice(MUSIC_TRACK_PREFIX.length))
}

export function moduleGrants(grants: readonly string[]) {
  return grants.filter(grant => grant.startsWith(MODULE_PREFIX)).map(grant => grant.slice(MODULE_PREFIX.length))
}
