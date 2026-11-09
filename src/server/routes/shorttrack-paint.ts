import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { claude, stoppedForSafety, textOf, toolInput } from '../claude.js'
import { looksLikeCode } from '../code-guard.js'
import { PAINT_DAILY_LIMIT, PAINT_MODEL, PAINT_REFUSAL, PAINT_SYSTEM, PAINT_TOOL, RESEARCH_SYSTEM, fieldRequest, paintTool } from '../shorttrack-paint.js'
import { SCHEME_LIMITS, sanitizeScheme } from '../../../modules-src/shorttrack/shared/PaintScheme'
import type { CustomScheme } from '../../../modules-src/shorttrack/shared/PaintScheme'
import { fieldRef, FIELD_REFS } from '../../../modules-src/shorttrack/shared/FieldRefs'

const schemeIds = z.enum(FIELD_REFS.map(f => f.scheme) as [string, ...string[]])
const input = z.union([
  z.object({ prompt: z.string().trim().min(2).max(SCHEME_LIMITS.prompt) }).strict(),
  z.object({ action: z.literal('field'), scheme: schemeIds, notes: z.string().trim().max(400).optional() }).strict(),
  z.object({ action: z.literal('field-clear'), scheme: schemeIds }).strict(),
])

let tableReady: Promise<unknown> | null = null
function ensureTables(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS shorttrack_paint_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS shorttrack_paint_requests_user_at ON shorttrack_paint_requests (user_id, at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS shorttrack_field_schemes (scheme TEXT PRIMARY KEY, design TEXT NOT NULL, research TEXT, updated_at INTEGER NOT NULL)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

type PaintAnswer = { status?: string; message?: string; scheme?: unknown }

async function design(env: Env, content: string) {
  let response
  try {
    response = await claude(env, {
      model: PAINT_MODEL,
      system: PAINT_SYSTEM,
      messages: [{ role: 'user', content }],
      maxTokens: 8000,
      tools: [paintTool],
      forceTool: PAINT_TOOL,
      timeoutMs: 120000,
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'The paint designer is busy right now. Try again in a moment.')
  }
  if (stoppedForSafety(response)) return { refused: true as const, message: PAINT_REFUSAL }
  const answer = toolInput<PaintAnswer>(response, PAINT_TOOL)
  const message = typeof answer?.message === 'string' && !looksLikeCode(answer.message) ? answer.message.slice(0, 160) : ''
  if (!answer || answer.status !== 'ok') return { refused: true as const, message: message || PAINT_REFUSAL }
  const scheme = sanitizeScheme(answer.scheme)
  if (!scheme) throw new HttpError(502, 'That design came back empty. Try describing it another way.')
  return { refused: false as const, scheme, message }
}

/** Looks the real car up on the web and describes its paint in detail, for the designer to recreate. */
async function research(env: Env, ref: string) {
  try {
    const response = await claude(env, {
      model: PAINT_MODEL,
      system: RESEARCH_SYSTEM,
      messages: [{ role: 'user', content: `Describe the paint scheme of ${ref}.` }],
      maxTokens: 2500,
      webSearch: 4,
      timeoutMs: 120000,
    })
    const text = textOf(response)
    return looksLikeCode(text) ? '' : text.slice(0, 6000)
  } catch {
    return ''
  }
}

async function fieldDesigns(env: Env) {
  const rows = await env.DB.prepare('SELECT scheme, design, research, updated_at FROM shorttrack_field_schemes').all<{ scheme: string; design: string; research: string | null; updated_at: number }>()
  const designs: Record<string, CustomScheme> = {}
  const info: Record<string, { updatedAt: number; research: string }> = {}
  for (const row of rows.results) {
    if (!fieldRef(row.scheme)) continue
    let parsed: unknown = null
    try { parsed = JSON.parse(row.design) } catch { parsed = null }
    const clean = sanitizeScheme(parsed)
    if (!clean) continue
    designs[row.scheme] = clean
    info[row.scheme] = { updatedAt: row.updated_at, research: row.research ?? '' }
  }
  return { designs, info }
}

/**
 * GET `?field=1`: the AI field's designed schemes (public; the admin also gets the research notes).
 * POST `{prompt}`: a signed-in driver's paint scheme from Claude Opus. Car paint requests only.
 * POST `{action:'field', scheme}` (admin): research the real car the AI field scheme recreates, design it, store it.
 * POST `{action:'field-clear', scheme}` (admin): go back to the hand-made scheme.
 */
export async function shorttrackPaint(request: Request, env: Env) {
  await ensureTables(env)
  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('field') !== '1') return json({ error: 'Not found.' }, 404)
    const { designs, info } = await fieldDesigns(env)
    const user = await currentUser(request, env)
    return json({ designs, ...(user?.isAdmin ? { info } : {}) }, 200, { 'Cache-Control': 'no-store' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to use the AI paint designer.')
  const parsed = input.safeParse(await readJson(request, 2000))
  if (!parsed.success) return json({ error: `Describe the paint scheme in 2 to ${SCHEME_LIMITS.prompt} characters.` }, 400)
  const body = parsed.data

  if ('action' in body) {
    if (!user.isAdmin) return json({ error: 'Only the administrator can repaint the AI field.' }, 403)
    if (body.action === 'field-clear') {
      await env.DB.prepare('DELETE FROM shorttrack_field_schemes WHERE scheme = ?').bind(body.scheme).run()
      return json({ cleared: true })
    }
    const ref = fieldRef(body.scheme)!
    if (body.notes && looksLikeCode(body.notes)) return json({ error: 'Notes are plain words about the paint only.' }, 400)
    const notes = await research(env, ref.ref)
    const result = await design(env, fieldRequest(ref, notes, body.notes ?? ''))
    if (result.refused) return json({ error: result.message || 'The designer could not paint that car.' }, 502)
    await env.DB.prepare('INSERT INTO shorttrack_field_schemes (scheme, design, research, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(scheme) DO UPDATE SET design = excluded.design, research = excluded.research, updated_at = excluded.updated_at')
      .bind(body.scheme, JSON.stringify(result.scheme), notes, Date.now()).run()
    return json({ scheme: result.scheme, message: result.message, research: notes })
  }

  const { prompt } = body
  if (looksLikeCode(prompt)) return json({ refused: true, message: PAINT_REFUSAL })
  const since = Date.now() - 86400000
  if (!user.isAdmin) {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM shorttrack_paint_requests WHERE user_id = ? AND at > ?').bind(user.id, since).first<{ n: number }>()
    if ((used?.n ?? 0) >= PAINT_DAILY_LIMIT) return json({ error: `You have used today's ${PAINT_DAILY_LIMIT} AI paint designs. Try again tomorrow.` }, 429)
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO shorttrack_paint_requests (user_id, at) VALUES (?, ?)').bind(user.id, Date.now()),
    env.DB.prepare('DELETE FROM shorttrack_paint_requests WHERE at < ?').bind(since - 86400000),
  ])
  const result = await design(env, `<request>\n${prompt.replace(/<\/?request>/gi, '')}\n</request>`)
  return result.refused ? json({ refused: true, message: result.message }) : json({ scheme: result.scheme, message: result.message })
}
