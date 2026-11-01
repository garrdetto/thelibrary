export type SaveSummary = { slot: number; name: string; scenario: string; updated: string; summary: { cash: number; guests: number; rating: number; date: string; mode: string } }

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/park${query}`, { credentials: 'same-origin', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, ...init })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'The park service is unavailable right now.')
  return body
}

export type ParkScore = { username: string; parkName: string; value: number; date: string; savedAt: string; viewable: boolean }
export type ParkView = { username: string; parkName: string; scenario: string; savedAt: string; data: string }
export type ParkScoreBoard = { scenario: string; records: ParkScore[]; personalBest: number | null; signedIn: boolean }

export const parkApi = {
  scores: (scenario: string) => call<ParkScoreBoard>(undefined, `?scores=${encodeURIComponent(scenario)}`),
  submitScore: (scenario: string, parkName: string, value: number, data?: string) => call<ParkScoreBoard>({ method: 'POST', body: JSON.stringify({ action: 'score', scenario, parkName, value: Math.round(value), data }) }),
  view: (scenario: string, player: string) => call<ParkView>(undefined, `?view=${encodeURIComponent(scenario)}&player=${encodeURIComponent(player)}`),
  saves: () => call<{ saves: SaveSummary[] }>(undefined, '?saves=1'),
  load: (slot: number) => call<{ data: string; name: string }>(undefined, `?slot=${slot}`),
  save: (slot: number, name: string, data: string, summary: SaveSummary['summary'], scenario: string) => call<{ saved: boolean }>({ method: 'POST', body: JSON.stringify({ action: 'save', slot, name, data, summary, scenario }) }),
  remove: (slot: number) => call<{ deleted: boolean }>({ method: 'POST', body: JSON.stringify({ action: 'delete', slot }) }),
  ticket: () => call<{ ticket: string }>({ method: 'POST', body: JSON.stringify({ action: 'ticket' }) }),
}
