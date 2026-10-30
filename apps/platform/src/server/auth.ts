import type { Env } from './env'
import { HttpError, parseStored } from './http'

export const ADMIN_USERNAME = 'stoegbauer'
export const studioPages = ['chat', 'image', 'lyrics'] as const
export type StudioPage = (typeof studioPages)[number]
export type AccountSettings = { theme?: string; lobbySound?: boolean }

export type UserRow = {
  id: string
  username: string
  pin_hash: string | null
  pin_salt: string | null
  is_admin: number
  pages: string
  settings: string
  created_at: number
}

export type SessionUser = {
  id: string
  username: string
  isAdmin: boolean
  pages: StudioPage[]
  settings: AccountSettings
}

const encoder = new TextEncoder()
const SESSION_DAYS = 180

function toHex(buffer: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

export function randomHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(text: string) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

export function safeEqual(left: string, right: string) {
  const a = encoder.encode(left), b = encoder.encode(right)
  let difference = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

export async function hashPin(pin: string, saltHex: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100000 }, key, 256)
  return toHex(bits)
}

export function toSessionUser(row: UserRow): SessionUser {
  const isAdmin = row.is_admin === 1 && row.username === ADMIN_USERNAME
  const granted = parseStored<string[]>(row.pages, [])
  return {
    id: row.id,
    username: row.username,
    isAdmin,
    pages: isAdmin ? [...studioPages] : studioPages.filter(page => granted.includes(page)),
    settings: parseStored<AccountSettings>(row.settings, {}),
  }
}

function sessionToken(request: Request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)tl_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `tl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = sessionToken(request)
  if (!token) return null
  const row = await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(token), Date.now()).first<UserRow>()
  return row ? toSessionUser(row) : null
}

export async function requireUser(request: Request, env: Env, message = 'Sign in to continue.') {
  const user = await currentUser(request, env)
  if (!user) throw new HttpError(401, message)
  return user
}

export async function startSession(request: Request, env: Env, userId: string) {
  const token = randomHex(32)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, Date.now() + SESSION_DAYS * 86400000),
  ])
  return sessionCookie(request, token, SESSION_DAYS * 86400)
}

export async function endSession(request: Request, env: Env) {
  const token = sessionToken(request)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return sessionCookie(request, '', 0)
}

const LOCK_BASE = 15 * 60000
const LOCK_MAX = 24 * 3600000
const FAILURE_MEMORY = 24 * 3600000

type Counter = { failures: number; updated_at: number; locked_until: number }

async function readCounter(env: Env, key: string) {
  return env.DB.prepare('SELECT failures, updated_at, locked_until FROM login_failures WHERE key = ?').bind(key).first<Counter>()
}

async function writeCounter(env: Env, key: string, failures: number, lockedUntil: number) {
  await env.DB.prepare('INSERT INTO login_failures (key, failures, updated_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, updated_at = excluded.updated_at, locked_until = excluded.locked_until')
    .bind(key, failures, Date.now(), lockedUntil).run()
}

export async function lockedFor(env: Env, keys: string[]) {
  let until = 0
  for (const key of keys) {
    const counter = await readCounter(env, key)
    if (counter && counter.locked_until > until) until = counter.locked_until
  }
  return Math.max(0, until - Date.now())
}

export async function recordFailure(env: Env, key: string, limit: number) {
  const counter = await readCounter(env, key)
  const stale = !counter || Date.now() - counter.updated_at > FAILURE_MEMORY && counter.locked_until < Date.now()
  const failures = (stale ? 0 : counter.failures) + 1
  const lockedUntil = failures % limit === 0 ? Date.now() + Math.min(LOCK_MAX, LOCK_BASE * 2 ** (failures / limit - 1)) : stale ? 0 : counter.locked_until
  await writeCounter(env, key, failures, lockedUntil)
}

export async function clearCounter(env: Env, key: string) {
  await env.DB.prepare('DELETE FROM login_failures WHERE key = ?').bind(key).run()
}

export async function overDailyLimit(env: Env, key: string, limit: number) {
  const counter = await readCounter(env, key)
  return Boolean(counter && Date.now() - counter.updated_at < FAILURE_MEMORY && counter.failures >= limit)
}

export async function countDaily(env: Env, key: string) {
  const counter = await readCounter(env, key)
  const fresh = counter && Date.now() - counter.updated_at < FAILURE_MEMORY
  await writeCounter(env, key, (fresh ? counter.failures : 0) + 1, 0)
}

export function describeWait(milliseconds: number) {
  const minutes = Math.ceil(milliseconds / 60000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}
