import { admin, AuthError, getUser } from '@netlify/identity'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'

const resetId = 'fresh-game-accounts-2026-10-19'
const testerEmail = 'test@players.invalid'
const testerPassword = 'garrett2341'

export function isTesterLogin(username: string, password: string) {
  return `${username}@players.invalid` === testerEmail && password === testerPassword
}

export async function ensureTesterAccount() {
  try {
    await admin.createUser({ email: testerEmail, password: testerPassword, data: { user_metadata: { full_name: 'test', password_configured: true } } })
    return
  } catch (error) {
    if (!(error instanceof AuthError)) throw error
  }
  let page = 1
  while (true) {
    const users = await admin.listUsers({ page, perPage: 100 })
    const tester = users.find(user => user.email?.toLowerCase() === testerEmail)
    if (tester) {
      await admin.updateUser(tester.id, { password: testerPassword, confirm: true })
      return
    }
    if (users.length < 100) throw new Error('Tester account unavailable.')
    page += 1
  }
}

export async function ensureAccountReset() {
  if (Netlify.context?.deploy.context !== 'production') return
  const database = getDatabase()
  const completed = await database.sql`SELECT completed_at FROM account_resets WHERE id = ${resetId}`
  if (completed[0]?.completed_at) return
  await database.sql`INSERT INTO account_resets (id) VALUES (${resetId}) ON CONFLICT DO NOTHING`
  const client = await database.pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(726194031) AS locked')
    if (lock.rows[0]?.locked !== true) throw new Error('Account reset is in progress.')
    const result = await client.query('SELECT cutoff, completed_at FROM account_resets WHERE id = $1', [resetId])
    if (result.rows[0].completed_at) return
    const cutoff = new Date(result.rows[0].cutoff).getTime()
    let page = 1
    while (true) {
      const users = await admin.listUsers({ page, perPage: 100 })
      const previous = users.filter(user => {
        const created = Date.parse(user.createdAt ?? '')
        if (!Number.isFinite(created)) throw new Error('Account creation date unavailable.')
        return created <= cutoff
      })
      for (const user of previous) {
        try { await admin.deleteUser(user.id) } catch (error) {
          if (!(error instanceof AuthError) || error.status !== 404) throw error
        }
      }
      if (previous.length) continue
      if (users.length < 100) break
      page += 1
    }
    for (const name of ['pool-cue-overlays', 'racing-skins']) {
      const store = getStore({ name, consistency: 'strong' })
      for await (const page of store.list({ paginate: true })) {
        for (const blob of page.blobs) await store.delete(blob.key)
      }
    }
    await client.query('DELETE FROM pool_preferences')
    await client.query('DELETE FROM racing_profiles')
    await client.query('DELETE FROM racing_tickets')
    await client.query('DELETE FROM racing_laps')
    await client.query('UPDATE account_resets SET completed_at = NOW() WHERE id = $1', [resetId])
    await client.query('COMMIT')
    committed = true
  } finally {
    try {
      if (!committed) await client.query('ROLLBACK')
    } finally {
      client.release()
      await database.pool.end()
    }
  }
}

export async function getGameUser() {
  await ensureAccountReset()
  const session = await getUser()
  if (!session) return null
  try { return await admin.getUser(session.id) } catch (error) {
    if (error instanceof AuthError && (error.status === 404 || error.status === 401)) return null
    throw error
  }
}
