import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, clientIp, json, readJson, requireSameOrigin } from '../http'
import {
  ADMIN_LEVEL, ADMIN_USERNAME, OWNER_LEVEL, isOwnerRow, clearCounter, countDaily, currentUser, describeWait, endSession, hashPin, lockedFor, overDailyLimit,
  randomHex, recordFailure, requireUser, safeEqual, sha256, startSession, studioPages, toSessionUser,
} from '../auth'
import type { AccountSettings, UserRow } from '../auth'

const USER_FAILURE_LIMIT = 5
const NETWORK_FAILURE_LIMIT = 25
const NEW_ACCOUNTS_PER_NETWORK = 10
const reservedNames = new Set(['admin', 'administrator', 'moderator', 'system', 'server', 'root', 'support'])

const usernameField = z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_-]+$/).transform(value => value.toLowerCase())
const usernameMessage = 'Use a username of 3–20 letters, numbers, underscores or hyphens.'

export async function issueTicket(env: Env, userId: string, username: string, prefix: string) {
  const token = randomHex(32)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tickets WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO tickets (hash, user_id, username, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(prefix + token), userId, username, Date.now() + 60000),
  ])
  return token
}

export async function redeemTicket(request: Request, env: Env, prefix: string) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Invalid session.')
  const hash = await sha256(prefix + token)
  const ticket = await env.DB.prepare('SELECT user_id, username FROM tickets WHERE hash = ? AND expires_at > ?').bind(hash, Date.now()).first<{ user_id: string; username: string }>()
  await env.DB.prepare('DELETE FROM tickets WHERE hash = ?').bind(hash).run()
  if (!ticket) throw new HttpError(401, 'Session expired. Sign in again.')
  return ticket
}

async function signIn(request: Request, env: Env, input: { username: string; password: string }) {
  const network = `ip:${clientIp(request)}`
  const account = `user:${input.username}`
  const wait = await lockedFor(env, [account, network])
  if (wait) return json({ error: `Too many wrong passwords. Try again in ${describeWait(wait)}.` }, 429)
  const existing = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(input.username).first<UserRow>()
  const fail = async () => {
    await recordFailure(env, account, USER_FAILURE_LIMIT)
    await recordFailure(env, network, NETWORK_FAILURE_LIMIT)
    return json({ error: 'Invalid password.' }, 401)
  }

  if (existing ? isOwnerRow(existing) : input.username === ADMIN_USERNAME) {
    if (!env.ADMIN_PASSWORD) return json({ error: 'The administrator account is not set up yet.' }, 503)
    if (!safeEqual(input.password, env.ADMIN_PASSWORD)) return fail()
    const owner = existing ?? await env.DB.prepare('SELECT * FROM users WHERE is_admin = ? LIMIT 1').bind(OWNER_LEVEL).first<UserRow>()
    let id = owner?.id
    if (!id) {
      id = crypto.randomUUID()
      await env.DB.prepare('INSERT INTO users (id, username, is_admin, created_at) VALUES (?, ?, ?, ?)').bind(id, ADMIN_USERNAME, OWNER_LEVEL, Date.now()).run()
    } else if (owner?.is_admin !== OWNER_LEVEL) {
      await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(OWNER_LEVEL, id).run()
    }
    await clearCounter(env, account)
    return json({ username: owner?.username ?? ADMIN_USERNAME }, 200, { 'Set-Cookie': await startSession(request, env, id) })
  }

  if (input.password.length < 3) return json({ error: 'Your password must be at least 3 characters.' }, 400)

  if (existing) {
    if (existing.pin_hash && existing.pin_salt) {
      if (!safeEqual(await hashPin(input.password, existing.pin_salt), existing.pin_hash)) return fail()
    } else {
      const salt = randomHex(16)
      await env.DB.prepare('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?').bind(await hashPin(input.password, salt), salt, existing.id).run()
    }
    await clearCounter(env, account)
    return json({ username: existing.username, created: false }, 200, { 'Set-Cookie': await startSession(request, env, existing.id) })
  }

  if (reservedNames.has(input.username)) return json({ error: 'That username is reserved. Choose another username.' }, 400)
  const creationKey = `create:${clientIp(request)}`
  if (await overDailyLimit(env, creationKey, NEW_ACCOUNTS_PER_NETWORK)) return json({ error: 'Too many new accounts from this network today. Try again tomorrow.' }, 429)
  const id = crypto.randomUUID()
  const salt = randomHex(16)
  try {
    await env.DB.prepare('INSERT INTO users (id, username, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, input.username, await hashPin(input.password, salt), salt, Date.now()).run()
  } catch {
    return fail()
  }
  await countDaily(env, creationKey)
  return json({ username: input.username, created: true }, 200, { 'Set-Cookie': await startSession(request, env, id) })
}

export async function poolAccount(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    const ticket = await redeemTicket(request, env, 'pool:')
    return json({ id: ticket.user_id, username: ticket.username })
  }
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    return json({ username: user?.username ?? null })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = z.object({ action: z.enum(['login', 'logout', 'ticket']) }).passthrough().parse(await readJson(request, 2048))
  if (input.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': await endSession(request, env) })
  if (input.action === 'ticket') {
    const user = await requireUser(request, env, 'Sign in to connect to the lobby.')
    return json({ ticket: await issueTicket(env, user.id, user.username, 'pool:') })
  }
  const credentials = z.object({ username: usernameField, password: z.string().min(1).max(128) }).safeParse(input)
  if (!credentials.success) return json({ error: usernameMessage }, 400)
  return signIn(request, env, credentials.data)
}

export async function workspaceAccess(request: Request, env: Env) {
  const user = await currentUser(request, env)
  return json({ username: user?.username ?? null, isAdmin: user?.isAdmin ?? false, isOwner: user?.isOwner ?? false, pages: user?.pages ?? [], settings: user?.settings ?? {} })
}

const settingsInput = z.object({ theme: z.string().max(40).optional(), lobbySound: z.boolean().optional() }).strict()

export async function accountSettings(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in to save your preferences.')
  if (request.method === 'GET') return json({ settings: user.settings })
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const update = settingsInput.parse(await readJson(request, 1024))
  const settings: AccountSettings = { ...user.settings, ...update }
  await env.DB.prepare('UPDATE users SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), user.id).run()
  return json({ settings })
}

const adminInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), id: z.string().uuid(), username: usernameField, pages: z.array(z.enum(studioPages)).max(3) }).strict(),
  z.object({ action: z.literal('set-admin'), id: z.string().uuid(), admin: z.boolean() }).strict(),
  z.object({ action: z.literal('reset-password'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }).strict(),
])

async function deleteFiles(env: Env, prefix: string) {
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ prefix, cursor })
    for (const key of page.keys) await env.FILES.delete(key.name)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
}

export async function workspaceAdmin(request: Request, env: Env) {
  const actor = await currentUser(request, env)
  if (!actor?.isAdmin) return json({ error: 'Administrator access required.' }, 403)
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM users ORDER BY username').all<UserRow>()
    return json({ users: rows.results.map(row => {
      const user = toSessionUser(row)
      return { id: user.id, username: user.username, pages: user.pages, isAdmin: user.isAdmin, isOwner: user.isOwner, needsPassword: !user.isOwner && !row.pin_hash, createdAt: row.created_at }
    }), viewerIsOwner: actor.isOwner })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const parsed = adminInput.safeParse(await readJson(request, 2048))
  if (!parsed.success) return json({ error: usernameMessage }, 400)
  const input = parsed.data
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(input.id).first<UserRow>()
  if (!target) return json({ error: 'Account not found.' }, 404)
  const targetIsOwner = isOwnerRow(target)
  const targetIsAdmin = targetIsOwner || target.is_admin === ADMIN_LEVEL
  if (targetIsOwner && !actor.isOwner) return json({ error: 'Only the owner can change the owner account.' }, 403)
  if (targetIsOwner && input.action !== 'update') return json({ error: 'The owner account cannot be reset, demoted or deleted.' }, 400)
  if (targetIsAdmin && !actor.isOwner) return json({ error: 'Only the owner can change another administrator.' }, 403)

  if (input.action === 'update') {
    if (input.username === ADMIN_USERNAME && !targetIsOwner || reservedNames.has(input.username)) return json({ error: 'That username is reserved.' }, 400)
    const clash = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').bind(input.username, target.id).first<{ id: string }>()
    if (clash) return json({ error: 'That username is already taken.' }, 409)
    if (targetIsOwner) {
      await env.DB.prepare('UPDATE users SET username = ?, is_admin = ? WHERE id = ?').bind(input.username, OWNER_LEVEL, target.id).run()
      return json({ ok: true })
    }
    await env.DB.prepare('UPDATE users SET username = ?, pages = ? WHERE id = ?').bind(input.username, JSON.stringify(input.pages), target.id).run()
    return json({ ok: true })
  }
  if (input.action === 'set-admin') {
    if (!actor.isOwner) return json({ error: 'Only the owner can add or remove administrators.' }, 403)
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(input.admin ? ADMIN_LEVEL : 0, target.id).run()
    return json({ ok: true })
  }
  if (input.action === 'reset-password') {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pin_hash = NULL, pin_salt = NULL WHERE id = ?').bind(target.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
      env.DB.prepare('DELETE FROM login_failures WHERE key = ?').bind(`user:${target.username}`),
    ])
    return json({ ok: true })
  }
  await env.DB.batch([
    'DELETE FROM sessions WHERE user_id = ?',
    'DELETE FROM tickets WHERE user_id = ?',
    'DELETE FROM pool_preferences WHERE user_id = ?',
    'DELETE FROM pool_practice_records WHERE user_id = ?',
    'DELETE FROM racing_profiles WHERE user_id = ?',
    'DELETE FROM racing_laps WHERE user_id = ?',
    'DELETE FROM module_scores WHERE user_id = ?',
    'DELETE FROM creations WHERE user_id = ?',
    'DELETE FROM lyric_corrections WHERE user_id = ?',
    'DELETE FROM lyric_presets WHERE user_id = ?',
    'DELETE FROM users WHERE id = ?',
  ].map(sql => env.DB.prepare(sql).bind(target.id)))
  await deleteFiles(env, `cue/${target.id}`)
  await deleteFiles(env, `skin/${target.id}/`)
  await deleteFiles(env, `image/${target.id}/`)
  return json({ ok: true })
}
