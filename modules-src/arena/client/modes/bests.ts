const bests = new Map<string, number>()
const requested = new Set<string>()

export function loadBest(board: string): void {
  if (requested.has(board)) return
  requested.add(board)
  void fetch(`/api/module-scores?module=${encodeURIComponent(board)}`, { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then((data: { personalBest?: number | null } | null) => {
      const value = data?.personalBest
      if (typeof value === 'number' && value > (bests.get(board) ?? 0)) bests.set(board, value)
    })
    .catch(() => undefined)
}

export function personalBest(board: string): number | null {
  return bests.get(board) ?? null
}

export function saveBest(board: string, value: number): number {
  const best = Math.max(value, bests.get(board) ?? 0)
  bests.set(board, best)
  return best
}
