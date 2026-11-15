export const traitKeys = ['top10', 'dev', 'snipers', 'insiders', 'bundlers', 'linked', 'fresh', 'rugScore', 'holders', 'traders', 'liquidity', 'viewers', 'devCreated', 'devMigrated'] as const

export type TraitKey = typeof traitKeys[number]
export type TraitReading = Partial<Record<TraitKey, number | null>>
export type RiseState = { rise: TraitReading; pending: TraitReading }

/** Keeps the highest reading of each number seen so far (holder shares, crowd sizes, the dev's launch record); a missing reading never erases a known one. */
export function worstOf(known: TraitReading, seen: TraitReading | null): TraitReading {
  const next: TraitReading = {}
  for (const key of traitKeys) {
    const before = known[key]
    const value = seen?.[key]
    const best = typeof value === 'number' && Number.isFinite(value) ? (typeof before === 'number' ? Math.max(before, value) : value) : before
    if (typeof best === 'number') next[key] = best
  }
  return next
}

/**
 * What a coin showed up to its highest point. Readings wait in `pending` and only count once the coin makes a new
 * high after them, so anything read while it falls from its peak (after the dump) never reaches `rise`.
 */
export function stepRise(state: RiseState, seen: TraitReading | null, newPeak: boolean): RiseState {
  const pending = worstOf(state.pending, seen)
  if (!newPeak) return { rise: state.rise, pending }
  return { rise: worstOf(state.rise, pending), pending: {} }
}

export function parseTraits(json: string | null | undefined): TraitReading {
  if (!json) return {}
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' ? value as TraitReading : {}
  } catch {
    return {}
  }
}
