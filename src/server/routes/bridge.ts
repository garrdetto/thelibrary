import { z } from 'zod'
import type { Env } from '../env.js'
import { json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { NOTICE_PLACES, saveWithKnockouts } from '../score-notices.js'
import { designCost, designProblem, levelPoints, starsFor } from '../../../modules-src/bridge/shared/Design'
import type { Design } from '../../../modules-src/bridge/shared/Design'
import { LEVEL_COUNT, getLevel } from '../../../modules-src/bridge/shared/Levels'
import { materialByIndex, materialIndex } from '../../../modules-src/bridge/shared/Materials'

const BOARD = 'bridge'
const coordinate = z.number().int().min(-20).max(40)
const packedBeam = z.tuple([coordinate, coordinate, coordinate, coordinate, z.number().int().min(0).max(materialByIndex.length - 1)])
const levelNumber = z.number().int().min(1).max(LEVEL_COUNT)

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('solve'), level: levelNumber, beams: z.array(packedBeam).max(600) }),
])

let tableReady: Promise<unknown> | null = null

function ensureTable(env: Env) {
  tableReady ??= env.DB.prepare(`CREATE TABLE IF NOT EXISTS bridge_progress (
    user_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    design TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, level)
  )`).run().catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

type Row = { level: number; cost: number; stars: number }

function unpack(beams: z.infer<typeof packedBeam>[]): Design {
  return { beams: beams.map(([x1, y1, x2, y2, m]) => ({ x1, y1, x2, y2, m: materialByIndex[m] })) }
}

function packDesign(design: Design): number[][] {
  return design.beams.map(beam => [beam.x1, beam.y1, beam.x2, beam.y2, materialIndex[beam.m]])
}

async function summary(env: Env, userId: string) {
  const rows = await env.DB.prepare('SELECT level, cost, stars FROM bridge_progress WHERE user_id = ?').bind(userId).all<Row>()
  const progress: Record<number, { cost: number; stars: number }> = {}
  let points = 0
  let stars = 0
  for (const row of rows.results) {
    if (row.level < 1 || row.level > LEVEL_COUNT) continue
    progress[row.level] = { cost: row.cost, stars: row.stars }
    points += levelPoints(getLevel(row.level), row.cost)
    stars += row.stars
  }
  return { progress, points, stars }
}

export async function bridge(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false, progress: {}, points: 0, stars: 0 })
    await ensureTable(env)
    const level = new URL(request.url).searchParams.get('level')
    if (level) {
      const index = levelNumber.parse(Number(level))
      const row = await env.DB.prepare('SELECT design FROM bridge_progress WHERE user_id = ? AND level = ?').bind(user.id, index).first<{ design: string }>()
      return json({ level: index, beams: row ? parseStored<number[][]>(row.design, []) : null })
    }
    return json({ signedIn: true, ...await summary(env, user.id) })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your bridges.')
  await ensureTable(env)
  const input = actions.parse(await readJson(request, 60_000))
  const level = getLevel(input.level)
  const design = unpack(input.beams)
  const problem = designProblem(level, design)
  if (problem) return json({ error: problem }, 400)
  const cost = designCost(design)
  const stars = starsFor(level, cost)
  if (!stars) return json({ error: 'That bridge is over budget.' }, 400)
  const previous = await env.DB.prepare('SELECT cost FROM bridge_progress WHERE user_id = ? AND level = ?').bind(user.id, input.level).first<{ cost: number }>()
  const improved = !previous || cost < previous.cost
  if (improved) {
    await env.DB.prepare(`INSERT INTO bridge_progress (user_id, level, cost, stars, design, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, level) DO UPDATE SET cost = excluded.cost, stars = excluded.stars, design = excluded.design, updated_at = excluded.updated_at`)
      .bind(user.id, input.level, cost, stars, JSON.stringify(packDesign(design)), Date.now())
      .run()
  }
  const result = await summary(env, user.id)
  if (improved && result.points > 0) {
    await saveWithKnockouts(env, {
      game: BOARD,
      scorer: user,
      top: () => env.DB.prepare(`SELECT id, user_id FROM module_scores WHERE module = ? ORDER BY value DESC, created_at ASC, id ASC LIMIT ${NOTICE_PLACES}`).bind(BOARD),
    }, () => env.DB.prepare(`INSERT INTO module_scores (id, user_id, username, module, value, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, username = excluded.username`)
      .bind(`${user.id}:bridge`, user.id, user.username, BOARD, result.points, Date.now())
      .run())
  }
  return json({ saved: improved, cost, levelStars: stars, ...result })
}
