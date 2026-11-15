import type { TrackerDatabase } from './db.js'

const schema = 'CREATE TABLE IF NOT EXISTS research_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'

/** When the studied-coin research was last cleared, or 0 if it never was. History before this is not learned from again. */
export function researchResetAt(database: TrackerDatabase) {
  database.exec(schema)
  const row = database.prepare("SELECT value FROM research_meta WHERE key = 'reset_at'").get() as { value: string } | undefined
  return row ? Number(row.value) || 0 : 0
}

export function markResearchReset(database: TrackerDatabase, now = Date.now()) {
  database.exec(schema)
  database.prepare("INSERT INTO research_meta (key, value) VALUES ('reset_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(now))
}
