import type { Env } from './env.js'
import { RATING_START, elo } from '../../modules-src/bushleague/shared/Online'
import type { RatingChange } from '../../modules-src/bushleague/shared/Online'

let tablesReady: Promise<unknown> | null = null

/** Migration 0022, also created on first use. */
export function ensureBushleagueTables(env: Env) {
  tablesReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bushleague_ratings (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS bushleague_ratings_rating_idx ON bushleague_ratings (rating DESC)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bushleague_matches (
      id TEXT PRIMARY KEY,
      away_user TEXT,
      home_user TEXT,
      away_team TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_score INTEGER NOT NULL,
      home_score INTEGER NOT NULL,
      winner_side INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ranked INTEGER NOT NULL,
      innings INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS bushleague_matches_created_idx ON bushleague_matches (created_at)'),
  ]).catch(error => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

export async function ratingOf(env: Env, userId: string): Promise<number> {
  await ensureBushleagueTables(env)
  const row = await env.DB.prepare('SELECT rating FROM bushleague_ratings WHERE user_id = ?').bind(userId).first<{ rating: number }>()
  return row?.rating ?? RATING_START
}

export interface MatchSeat {
  userId?: string
  name: string
  team: string
}

export interface MatchResult {
  id: string
  seats: [MatchSeat, MatchSeat]
  score: [number, number]
  winner: 0 | 1
  reason: string
  ranked: boolean
  innings: number
}

/** Stores the result and, for ranked matchups between two members, moves both Elo ratings. Returns each side's change. */
export async function recordMatch(env: Env, result: MatchResult): Promise<[RatingChange | null, RatingChange | null]> {
  await ensureBushleagueTables(env)
  const now = Date.now()
  const [away, home] = result.seats
  const statements = [
    env.DB.prepare('INSERT INTO bushleague_matches (id, away_user, home_user, away_team, home_team, away_score, home_score, winner_side, reason, ranked, innings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(result.id, away.userId ?? null, home.userId ?? null, away.team, home.team, result.score[0], result.score[1], result.winner, result.reason, result.ranked ? 1 : 0, result.innings, now),
  ]
  let changes: [RatingChange | null, RatingChange | null] = [null, null]
  if (result.ranked && away.userId && home.userId && away.userId !== home.userId) {
    const [awayBefore, homeBefore] = await Promise.all([ratingOf(env, away.userId), ratingOf(env, home.userId)])
    const [awayAfter, homeAfter] = elo(awayBefore, homeBefore, result.winner === 0 ? 1 : 0)
    changes = [{ before: awayBefore, after: awayAfter }, { before: homeBefore, after: homeAfter }]
    const upsert = 'INSERT INTO bushleague_ratings (user_id, username, rating, wins, losses, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, rating = excluded.rating, wins = wins + excluded.wins, losses = losses + excluded.losses, updated_at = excluded.updated_at'
    statements.push(
      env.DB.prepare(upsert).bind(away.userId, away.name, awayAfter, result.winner === 0 ? 1 : 0, result.winner === 0 ? 0 : 1, now),
      env.DB.prepare(upsert).bind(home.userId, home.name, homeAfter, result.winner === 1 ? 1 : 0, result.winner === 1 ? 0 : 1, now),
    )
  }
  await env.DB.batch(statements)
  return changes
}

type BoardRow = { username: string; rating: number; wins: number; losses: number }

export async function ratingsBoard(env: Env, userId: string | null) {
  await ensureBushleagueTables(env)
  const [rows, mine] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(u.username, r.username) AS username, r.rating, r.wins, r.losses FROM bushleague_ratings r
      LEFT JOIN users u ON u.id = r.user_id ORDER BY r.rating DESC, r.updated_at ASC LIMIT 20`).all<BoardRow>(),
    userId ? env.DB.prepare('SELECT rating, wins, losses FROM bushleague_ratings WHERE user_id = ?').bind(userId).first<{ rating: number; wins: number; losses: number }>() : Promise.resolve(null),
  ])
  return {
    ratings: rows.results.map(row => ({ username: row.username, rating: row.rating, wins: row.wins, losses: row.losses })),
    mine: userId ? (mine ?? { rating: RATING_START, wins: 0, losses: 0 }) : null,
    signedIn: Boolean(userId),
  }
}
