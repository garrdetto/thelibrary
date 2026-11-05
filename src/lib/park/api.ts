export type SaveSummary = { parkId: string; name: string; scenario: string; updated: string; summary: { cash: number; netWorth?: number; companyValue?: number; guests: number; rating: number; date: string; mode: string } }

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/park${query}`, { credentials: 'same-origin', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, ...init })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'The park service is unavailable right now.')
  return body
}

export type ParkScore = { parkId: string; username: string; parkName: string; value: number; date: string; savedAt: string; shot: string | null; viewable: boolean }
export type ParkView = { username: string; parkName: string; scenario: string; savedAt: string; data: string }
export type ParkMillionScore = { parkId: string; username: string; parkName: string; seconds: number; day: number; month: number; year: number; value: number; rating: number; approx: boolean; reachedAt: string; shot: string | null; viewable: boolean }
export type ParkScoreBoard = { scenario: string; records: ParkScore[]; million?: ParkMillionScore[]; signedIn: boolean }

export const parkApi = {
  scores: (scenario: string) => call<ParkScoreBoard>(undefined, `?scores=${encodeURIComponent(scenario)}`),
  submitScore: (parkId: string, scenario: string, parkName: string, value: number, data?: string) => call<ParkScoreBoard>({ method: 'POST', body: JSON.stringify({ action: 'score', parkId, scenario, parkName, value: Math.round(value), data }) }),
  submitShot: (parkId: string, scenario: string, mime: string, image: string) => call<ParkScoreBoard>({ method: 'POST', body: JSON.stringify({ action: 'shot', parkId, scenario, mime, image }) }),
  view: (scenario: string, parkId: string) => call<ParkView>(undefined, `?view=${encodeURIComponent(scenario)}&park=${encodeURIComponent(parkId)}`),
  saves: () => call<{ saves: SaveSummary[] }>(undefined, '?saves=1'),
  load: (parkId: string) => call<{ data: string; name: string }>(undefined, `?load=${encodeURIComponent(parkId)}`),
  save: (parkId: string, name: string, data: string, summary: SaveSummary['summary'], scenario: string) => call<{ saved: boolean; parkId: string }>({ method: 'POST', body: JSON.stringify({ action: 'save', parkId, name, data, summary, scenario }) }),
  remove: (parkId: string) => call<{ deleted: boolean }>({ method: 'POST', body: JSON.stringify({ action: 'delete', parkId }) }),
  ticket: () => call<{ ticket: string }>({ method: 'POST', body: JSON.stringify({ action: 'ticket' }) }),
}
