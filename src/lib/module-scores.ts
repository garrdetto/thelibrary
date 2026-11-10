export const scoredModules = {
  '2048': { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 4, max: 20_000_000, note: 'Saved as you play, so a board you leave unfinished still counts, and finalized when it fills up or you start a new board.' },
  helicopter: { title: 'Longest Flights', metric: 'Distance', order: 'desc', unit: 'meters', min: 1, max: 10_000_000, note: 'Saved as you fly, so a flight cut short by closing the page or losing connection still counts, and finalized when the chopper crashes.' },
  botwreck: { title: 'Wreck Scores', metric: 'Wreck score', order: 'desc', unit: 'points', min: 1, max: 100_000_000, note: 'Saved as you drive, so a run cut short still counts, and finalized when you respawn, return to the build bay or leave the module.' },
  alphabet: { title: 'Fastest Alphabets', metric: 'Time', order: 'asc', unit: 'ms', min: 300, max: 600_000, note: 'Saved when you finish Z with every letter correct.' },
  wpm: { title: 'Fastest Typists', metric: 'WPM', order: 'desc', unit: 'wpm', min: 1, max: 400, note: 'Saved when the one-minute timer runs out.' },
  tetradrop: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 50_000_000, note: 'Saved as you play, so a round you leave unfinished still counts, and finalized when the stack reaches the top or you start a new round.' },
  bubbles: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 50_000_000, note: 'Saved as you play, so a round you leave unfinished still counts, and finalized when the bubbles reach the floor or you start a new round.' },
  memory: { title: 'Fastest Clears', metric: 'Time', order: 'asc', unit: 'ms', min: 1_000, max: 3_600_000, note: 'Saved when the last pair of the 6 × 6 grid is matched.' },
  simon: { title: 'Longest Sequences', metric: 'Sequence', order: 'desc', unit: 'steps', min: 1, max: 1_000, note: 'Saved when you miss a step.' },
  sudoku: { title: 'Fastest Solves', metric: 'Time', order: 'asc', unit: 'ms', min: 10_000, max: 86_400_000, note: 'Saved when a Hard puzzle is solved without hints.' },
  recall: { title: 'Fastest Clears', metric: 'Time', order: 'asc', unit: 'ms', min: 2_000, max: 3_600_000, note: 'The clock starts when the cards flip face down after the five-second look and stops on the last of the ten pairs.' },
  minesweeper: { title: 'Fastest Clears', metric: 'Time', order: 'asc', unit: 'ms', min: 1_000, max: 3_600_000, note: 'Saved when an Intermediate field (16 × 16, 40 mines) is cleared.' },
  mathrush: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 1_000_000, note: 'Saved when the sixty-second timer runs out.' },
  rackreel: { title: 'Trophy Room', metric: 'Trophy points', order: 'desc', unit: 'points', min: 1, max: 1_200, note: 'Trophy-class fish and game only, scored against the all-time record for the species (1,000 ties the record). Saved when you land the fish or tag the animal.' },
  demoderby: { title: 'Best Heats', metric: 'Points', order: 'desc', unit: 'points', min: 1, max: 1_000_000, note: 'Hits landed, knockouts, time survived and 1,000 for the win. Saved as you drive, so a heat cut short still counts, and finalized when you are knocked out or the heat ends.' },
  darts: { title: 'Best Count Up', metric: 'Total', order: 'desc', unit: 'points', min: 1, max: 1_440, note: 'Solo Count Up over eight rounds (24 darts) on Normal or Hard steadiness. Saved when the eighth round ends.' },
  foodchain: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 100_000_000, note: 'Saved as you swim, so a dive you leave unfinished still counts, and finalized when your last life is eaten.' },
  keep: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 100_000_000, note: 'Saved as you defend, so a siege you leave unfinished still counts, and finalized when the wall falls.' },
  giant: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 10_000_000, note: 'One ninety-second round. Saved as you toss, and finalized when the clock runs out.' },
  cookies: { title: 'Biggest Bakes', metric: 'Cookies', order: 'desc', unit: 'points', min: 1, max: 1_000_000_000_000_000, note: 'Total cookies baked in one five-minute bake-off, spent or not. Saved as you bake, and finalized when the ovens switch off.' },
  hotdog: { title: 'Richest Carts', metric: 'Cash', order: 'desc', unit: 'dollars', min: 1, max: 10_000_000, note: 'Cash on hand after the thirtieth day. Saved when the season ends.' },
  pingpong: { title: 'Longest Rallies', metric: 'Rally', order: 'desc', unit: 'hits', min: 2, max: 10_000, note: 'The longest rally in a match against the CPU, counting both players\' hits. Saved as you play, and finalized at match point.' },
  blockhead: { title: 'High Scores', metric: 'Score', order: 'desc', unit: 'points', min: 1, max: 100_000_000, note: 'Saved as you play, so a siege you leave unfinished still counts, and finalized when the last player falls or you start a new siege.' },
} as const

export type ScoredModuleId = keyof typeof scoredModules

export type ModuleScore = { username: string; value: number; date: string }

export type ModuleScoreBoard = { module: ScoredModuleId; records: ModuleScore[]; personalBest: number | null; signedIn: boolean }

export function isScoredModule(value: string): value is ScoredModuleId {
  return Object.prototype.hasOwnProperty.call(scoredModules, value)
}

export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  const seconds = ((ms % 60_000) / 1000).toFixed(3)
  return minutes ? `${minutes}:${seconds.padStart(6, '0')}` : `${seconds} s`
}

export function formatScore(module: ScoredModuleId, value: number) {
  const unit = scoredModules[module].unit
  if (unit === 'meters') return `${value.toLocaleString()} m`
  if (unit === 'ms') return formatDuration(value)
  if (unit === 'wpm') return `${value.toLocaleString()} wpm`
  if (unit === 'dollars') return `$${value.toLocaleString()}`
  if (unit === 'hits') return `${value.toLocaleString()} hits`
  return value.toLocaleString()
}
