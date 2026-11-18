export const MUSIC_ACCESS_EVENT = 'tl-access-changed'
export const MUSIC_MAX_BYTES = 24 * 1024 * 1024
export const MUSIC_MAX_LABEL = '24 MB'
export const MUSIC_TITLE_MAX = 120
export const MUSIC_ARTIST_MAX = 80

export type MusicTrack = { id: string; title: string; artist: string; duration: number; bytes: number }
export type MusicListener = { id: string; username: string; tracks: string[] | 'all' }

export function musicFileUrl(id: string) {
  return `/api/music?file=${encodeURIComponent(id)}`
}

export function formatTrackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function titleFromFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.mp3$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const split = base.split(' - ')
  if (split.length >= 2) return { artist: split[0].trim().slice(0, MUSIC_ARTIST_MAX), title: split.slice(1).join(' - ').trim().slice(0, MUSIC_TITLE_MAX) || 'Untitled' }
  return { artist: '', title: base.slice(0, MUSIC_TITLE_MAX) || 'Untitled' }
}
