import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import type { SessionUser, UserRow } from '../auth.js'
import { MUSIC_GRANT, MUSIC_TRACK_PREFIX, cleanGrants, musicTrackGrants } from '../../lib/access.js'
import { MUSIC_ARTIST_MAX, MUSIC_MAX_BYTES, MUSIC_MAX_LABEL, MUSIC_TITLE_MAX } from '../../lib/music.js'
import type { MusicListener, MusicTrack } from '../../lib/music.js'

type TrackRow = { id: string; title: string; artist: string; bytes: number; duration: number; position: number; created_at: number }

const trackId = z.string().uuid()
const fileKey = (id: string) => `music/${id}`

const patchInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), id: trackId, title: z.string().trim().min(1).max(MUSIC_TITLE_MAX), artist: z.string().trim().max(MUSIC_ARTIST_MAX) }).strict(),
  z.object({ action: z.literal('order'), ids: z.array(trackId).max(500) }).strict(),
])
const deleteInput = z.object({ id: trackId }).strict()

async function ensureTable(env: Env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS music_tracks (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT \'\', bytes INTEGER NOT NULL, duration REAL NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)').run()
}

async function allTracks(env: Env): Promise<TrackRow[]> {
  const rows = await env.DB.prepare('SELECT * FROM music_tracks ORDER BY position, created_at').all<TrackRow>()
    .catch(error => { if (String(error).includes('no such table')) return { results: [] as TrackRow[] }; throw error })
  return rows.results
}

const toTrack = (row: TrackRow): MusicTrack => ({ id: row.id, title: row.title, artist: row.artist, duration: row.duration, bytes: row.bytes })

function tracksFor(user: SessionUser | null, rows: TrackRow[]) {
  if (!user?.grants.includes(MUSIC_GRANT)) return []
  const picked = new Set(musicTrackGrants(user.grants))
  const chosen = rows.filter(row => picked.has(row.id))
  return picked.size && chosen.length ? chosen : rows
}

function looksLikeMp3(bytes: Uint8Array) {
  if (bytes.length < 4) return false
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}

function requireAdmin(user: SessionUser | null) {
  if (!user?.isAdmin) throw new HttpError(403, 'Administrator access required.')
  return user
}

async function serveFile(request: Request, env: Env, user: SessionUser | null, id: string) {
  if (!trackId.safeParse(id).success) return json({ error: 'Track not found.' }, 404)
  if (!user) return json({ error: 'Sign in to listen.' }, 401)
  const rows = await allTracks(env)
  const allowed = user.isAdmin ? rows : tracksFor(user, rows)
  if (!allowed.some(row => row.id === id)) return json({ error: 'Track not found.' }, 404)
  const { value } = await env.FILES.getWithMetadata(fileKey(id), 'arrayBuffer')
  if (!value) return json({ error: 'Track not found.' }, 404)
  const size = value.byteLength
  const headers: Record<string, string> = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }
  const range = request.headers.get('range')
  if (!range) return new Response(value, { headers: { ...headers, 'Content-Length': String(size) } })
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  let start = match?.[1] ? Number(match[1]) : NaN
  let end = match?.[2] ? Number(match[2]) : size - 1
  if (match && !match[1] && match[2]) { start = Math.max(0, size - Number(match[2])); end = size - 1 }
  if (!match || !Number.isFinite(start) || start >= size || end < start) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  end = Math.min(end, size - 1)
  return new Response(value.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
}

async function listeners(env: Env): Promise<MusicListener[]> {
  const rows = await env.DB.prepare('SELECT * FROM users WHERE pages LIKE ? ORDER BY username').bind('%"music%').all<UserRow>()
  return rows.results.flatMap(row => {
    const grants = cleanGrants(parseStored<unknown>(row.pages, []))
    if (!grants.includes(MUSIC_GRANT)) return []
    const picked = musicTrackGrants(grants)
    return [{ id: row.id, username: row.username, tracks: picked.length ? picked : 'all' as const }]
  })
}

async function upload(request: Request, env: Env) {
  if (Number(request.headers.get('content-length')) > MUSIC_MAX_BYTES + 64 * 1024) return json({ error: `MP3s can be up to ${MUSIC_MAX_LABEL}.` }, 413)
  const form = await request.formData()
  const file = form.get('file')
  if (!file || typeof file === 'string') return json({ error: 'Choose an MP3 to upload.' }, 400)
  if (file.size > MUSIC_MAX_BYTES) return json({ error: `MP3s can be up to ${MUSIC_MAX_LABEL}.` }, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!looksLikeMp3(bytes)) return json({ error: `${file.name || 'That file'} is not an MP3.` }, 400)
  const fields = z.object({
    title: z.string().trim().min(1).max(MUSIC_TITLE_MAX),
    artist: z.string().trim().max(MUSIC_ARTIST_MAX).default(''),
    duration: z.coerce.number().min(0).max(24 * 3600).catch(0),
  }).safeParse({ title: form.get('title') ?? '', artist: form.get('artist') ?? '', duration: form.get('duration') ?? 0 })
  if (!fields.success) return json({ error: 'Give the track a title of up to 120 characters.' }, 400)
  await ensureTable(env)
  const id = crypto.randomUUID()
  await env.FILES.put(fileKey(id), bytes, { metadata: { type: 'audio/mpeg', bytes: bytes.byteLength } })
  const last = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS top FROM music_tracks').first<{ top: number }>()
  const row: TrackRow = { id, title: fields.data.title, artist: fields.data.artist, bytes: bytes.byteLength, duration: fields.data.duration, position: (last?.top ?? 0) + 1, created_at: Date.now() }
  await env.DB.prepare('INSERT INTO music_tracks (id, title, artist, bytes, duration, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.title, row.artist, row.bytes, row.duration, row.position, row.created_at).run()
  return json({ track: toTrack(row) })
}

async function removeTrack(env: Env, id: string) {
  await ensureTable(env)
  await env.DB.prepare('DELETE FROM music_tracks WHERE id = ?').bind(id).run()
  await env.FILES.delete(fileKey(id))
  const grant = `${MUSIC_TRACK_PREFIX}${id}`
  const rows = await env.DB.prepare('SELECT id, pages FROM users WHERE pages LIKE ?').bind(`%${grant}%`).all<{ id: string; pages: string }>()
  if (rows.results.length) await env.DB.batch(rows.results.map(row => env.DB.prepare('UPDATE users SET pages = ? WHERE id = ?')
    .bind(JSON.stringify(cleanGrants(parseStored<unknown>(row.pages, [])).filter(item => item !== grant)), row.id)))
}

/**
 * `/api/music`: the site-wide music player.
 * GET returns the signed-in account's playlist (`enabled` only when it has the `music` grant; `music:<id>` grants narrow it to those tracks).
 * GET `?file=<id>` streams one MP3 from KV `music/<id>` with byte ranges, to the admin or a listener who has that track.
 * GET `?admin=1` (admin) lists every track and every listener. POST (admin, multipart `file`, `title`, `artist`, `duration`) uploads,
 * PATCH (admin) renames or reorders, DELETE `{id}` (admin) removes a track and its `music:<id>` grants.
 */
export async function music(request: Request, env: Env) {
  const url = new URL(request.url)
  const user = await currentUser(request, env)
  if (request.method === 'GET' || request.method === 'HEAD') {
    const file = url.searchParams.get('file')
    if (file !== null) return serveFile(request, env, user, file)
    if (url.searchParams.get('admin') === '1') {
      requireAdmin(user)
      const [rows, people] = await Promise.all([allTracks(env), listeners(env)])
      return json({ tracks: rows.map(toTrack), listeners: people })
    }
    const enabled = Boolean(user?.grants.includes(MUSIC_GRANT))
    return json({ enabled, tracks: enabled ? tracksFor(user, await allTracks(env)).map(toTrack) : [] })
  }
  requireSameOrigin(request)
  requireAdmin(user)
  if (request.method === 'POST') return upload(request, env)
  if (request.method === 'PATCH') {
    const input = patchInput.parse(await readJson(request, 40000))
    await ensureTable(env)
    if (input.action === 'rename') {
      await env.DB.prepare('UPDATE music_tracks SET title = ?, artist = ? WHERE id = ?').bind(input.title, input.artist, input.id).run()
    } else if (input.ids.length) {
      await env.DB.batch(input.ids.map((id, index) => env.DB.prepare('UPDATE music_tracks SET position = ? WHERE id = ?').bind(index + 1, id)))
    }
    return json({ tracks: (await allTracks(env)).map(toTrack) })
  }
  if (request.method === 'DELETE') {
    const input = deleteInput.parse(await readJson(request, 1000))
    await removeTrack(env, input.id)
    return json({ ok: true })
  }
  return json({ error: 'Method not allowed.' }, 405)
}
