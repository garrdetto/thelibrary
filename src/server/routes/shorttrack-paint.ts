import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { requireUser } from '../auth.js'
import { claude, stoppedForSafety, toolInput } from '../claude.js'
import { looksLikeCode } from '../code-guard.js'
import { PAINT_DAILY_LIMIT, PAINT_MODEL, PAINT_REFUSAL, PAINT_SYSTEM, PAINT_TOOL, paintTool } from '../shorttrack-paint.js'
import { SCHEME_LIMITS, sanitizeScheme } from '../../../modules-src/shorttrack/shared/PaintScheme'

const input = z.object({ prompt: z.string().trim().min(2).max(SCHEME_LIMITS.prompt) }).strict()

let tableReady: Promise<unknown> | null = null
function ensureTable(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS shorttrack_paint_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS shorttrack_paint_requests_user_at ON shorttrack_paint_requests (user_id, at)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

type PaintAnswer = { status?: string; message?: string; scheme?: unknown }

/** POST `{prompt}`: a signed-in driver's paint scheme from Claude Opus. Car paint requests only. */
export async function shorttrackPaint(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to use the AI paint designer.')
  const parsed = input.safeParse(await readJson(request, 2000))
  if (!parsed.success) return json({ error: `Describe the paint scheme in 2 to ${SCHEME_LIMITS.prompt} characters.` }, 400)
  const { prompt } = parsed.data
  if (looksLikeCode(prompt)) return json({ refused: true, message: PAINT_REFUSAL })

  await ensureTable(env)
  const since = Date.now() - 86400000
  if (!user.isAdmin) {
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM shorttrack_paint_requests WHERE user_id = ? AND at > ?').bind(user.id, since).first<{ n: number }>()
    if ((used?.n ?? 0) >= PAINT_DAILY_LIMIT) return json({ error: `You have used today's ${PAINT_DAILY_LIMIT} AI paint designs. Try again tomorrow.` }, 429)
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO shorttrack_paint_requests (user_id, at) VALUES (?, ?)').bind(user.id, Date.now()),
    env.DB.prepare('DELETE FROM shorttrack_paint_requests WHERE at < ?').bind(since - 86400000),
  ])

  let response
  try {
    response = await claude(env, {
      model: PAINT_MODEL,
      system: PAINT_SYSTEM,
      messages: [{ role: 'user', content: `<request>\n${prompt.replace(/<\/?request>/gi, '')}\n</request>` }],
      maxTokens: 6000,
      tools: [paintTool],
      forceTool: PAINT_TOOL,
      timeoutMs: 100000,
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'The paint designer is busy right now. Try again in a moment.')
  }
  if (stoppedForSafety(response)) return json({ refused: true, message: PAINT_REFUSAL })
  const answer = toolInput<PaintAnswer>(response, PAINT_TOOL)
  const message = typeof answer?.message === 'string' && !looksLikeCode(answer.message) ? answer.message.slice(0, 160) : ''
  if (!answer || answer.status !== 'ok') return json({ refused: true, message: message || PAINT_REFUSAL })
  const scheme = sanitizeScheme(answer.scheme)
  if (!scheme) return json({ error: 'That design came back empty. Try describing it another way.' }, 502)
  return json({ scheme, message })
}
