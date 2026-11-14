import { z } from 'zod'
import type { Env } from '../env.js'
import { json } from '../http.js'
import { currentUser } from '../auth.js'
import { emptyRadarPayload } from '../../lib/axiom-radar-types.js'

const mintQuery = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
const streamHeaders = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Content-Type-Options': 'nosniff' }

function trackerOrigin(env: Env) {
  const origin = env.AXIOM_RADAR_ORIGIN?.trim()
  if (!origin) return null
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' ? parsed : null
  } catch {
    return null
  }
}

/**
 * GET (admin): `/api/admin/axiom/data` returns the radar payload (or `?mint=` token detail) and `/api/admin/axiom/stream`
 * relays the tracker's server-sent events. Both proxy to the self-hosted tracker at `AXIOM_RADAR_ORIGIN` with the
 * `AXIOM_RADAR_TOKEN` secret; the tracker never sees the visitor's session.
 */
export async function axiomRadar(request: Request, env: Env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'This request is not allowed.' }, 403)
  const user = await currentUser(request, env)
  if (!user?.isAdmin) return json({ error: 'Administrator access required.' }, 403)

  const url = new URL(request.url)
  const isStream = url.pathname.endsWith('/stream')
  const mint = url.searchParams.get('mint')
  if (mint !== null && !mintQuery.safeParse(mint).success) return json({ error: 'Invalid token address.' }, 400)

  const origin = trackerOrigin(env)
  const token = env.AXIOM_RADAR_TOKEN?.trim()
  if (!origin || !token) {
    const message = 'The tracker is not connected to this site yet. Set the AXIOM_RADAR_ORIGIN variable and the AXIOM_RADAR_TOKEN secret (see AXIOM_RADAR.md).'
    if (isStream) return json({ error: message }, 503)
    return mint === null ? json(emptyRadarPayload(message)) : json({ error: message }, 503)
  }

  const target = new URL(url.pathname, origin)
  if (mint !== null) target.searchParams.set('mint', mint)
  try {
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: isStream ? 'text/event-stream' : 'application/json' },
      signal: isStream ? request.signal : AbortSignal.timeout(10_000),
    })
    if (isStream) {
      if (!upstream.ok || !upstream.body) return json({ error: 'The tracker stream is unavailable.' }, 503)
      return new Response(upstream.body, { status: 200, headers: streamHeaders })
    }
    if (!upstream.ok) {
      if (mint !== null && upstream.status === 404) return json({ error: 'Token not tracked.' }, 404)
      return mint === null ? json(emptyRadarPayload('The tracker refused the request. Check that AXIOM_RADAR_TOKEN matches on both sides.')) : json({ error: 'Token details are unavailable.' }, 503)
    }
    return json(await upstream.json())
  } catch {
    const message = 'The tracker could not be reached. Check that the worker and the Cloudflare Tunnel are running.'
    return isStream || mint !== null ? json({ error: message }, 503) : json(emptyRadarPayload(message))
  }
}
