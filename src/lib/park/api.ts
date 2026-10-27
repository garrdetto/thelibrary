export type SaveSummary = { slot: number; name: string; scenario: string; updated: string; summary: { cash: number; guests: number; rating: number; date: string; mode: string } }

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/park${query}`, { credentials: 'same-origin', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, ...init })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'The park service is unavailable right now.')
  return body
}

export const parkApi = {
  saves: () => call<{ saves: SaveSummary[] }>(undefined, '?saves=1'),
  load: (slot: number) => call<{ data: string; name: string }>(undefined, `?slot=${slot}`),
  save: (slot: number, name: string, data: string, summary: SaveSummary['summary'], scenario: string) => call<{ saved: boolean }>({ method: 'POST', body: JSON.stringify({ action: 'save', slot, name, data, summary, scenario }) }),
  remove: (slot: number) => call<{ deleted: boolean }>({ method: 'POST', body: JSON.stringify({ action: 'delete', slot }) }),
  ticket: () => call<{ ticket: string }>({ method: 'POST', body: JSON.stringify({ action: 'ticket' }) }),
}
