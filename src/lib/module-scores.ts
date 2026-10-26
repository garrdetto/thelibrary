export const scoredModules = {
  '2048': { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 4, max: 20_000_000, note: 'Saved when a board fills up or when you start a new board.' },
  helicopter: { title: 'Longest Flights', metric: 'Distance', order: 'desc', unit: 'meters', min: 1, max: 10_000_000, note: 'Saved every time the chopper crashes.' },
  botwreck: { title: 'Wreck Scores', metric: 'Wreck score', order: 'desc', unit: 'points', min: 1, max: 100_000_000, note: 'Saved when you respawn, return to the build bay or leave the module.' },
} as const

export type ScoredModuleId = keyof typeof scoredModules

export type ModuleScore = { username: string; value: number; date: string }

export type ModuleScoreBoard = { module: ScoredModuleId; records: ModuleScore[]; personalBest: number | null; signedIn: boolean }

export function isScoredModule(value: string): value is ScoredModuleId {
  return Object.prototype.hasOwnProperty.call(scoredModules, value)
}

export function formatScore(module: ScoredModuleId, value: number) {
  if (module === 'helicopter') return `${value.toLocaleString()} m`
  return value.toLocaleString()
}
