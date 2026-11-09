import type { Env } from './env.js'
import { safeEqual } from './auth.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIVE = new Set(['queued', 'running'])

async function sign(secret: string, jobId: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`meshy:${jobId}`))
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * A site-change run's Meshy pass: `Bearer sc.<jobId>.<hex>`, where hex is HMAC-SHA256(SITE_CHANGES_SECRET, `meshy:<jobId>`).
 * `.github/site-changes/run.mjs` makes it before Claude starts (Claude never sees SITE_CHANGES_SECRET), and it is only honoured
 * while that site_changes row is queued or running, so it dies with the run. Returns the creator id to record, or null.
 */
export async function siteChangeRun(request: Request, env: Env): Promise<{ id: string } | null> {
  const supplied = request.headers.get('authorization')?.match(/^Bearer\s+sc\.([^.]+)\.([0-9a-f]{64})$/i)
  const secret = env.SITE_CHANGES_SECRET
  if (!supplied || !secret || !UUID.test(supplied[1])) return null
  const jobId = supplied[1].toLowerCase()
  if (!safeEqual(supplied[2].toLowerCase(), await sign(secret, jobId))) return null
  try {
    const row = await env.DB.prepare('SELECT status FROM site_changes WHERE id = ?').bind(jobId).first<{ status: string }>()
    return row && ACTIVE.has(row.status) ? { id: `site-change:${jobId}` } : null
  } catch {
    return null
  }
}
