import type { BridgeStatus, GsproSession, GsproShot, ShotInput } from '@/lib/gspro/types'

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'The analyzer could not be reached. Please try again.')
  return result
}

const post = <T>(body: unknown) => call<T>('/api/gspro', { method: 'POST', body: JSON.stringify(body) })

export type LiveResult = { shots: GsproShot[]; bridge: BridgeStatus; session: GsproSession | null; now: number }
export type CoachResult = { headline: string; tips: { title: string; detail: string; drill?: string }[] }
export type CoachInput = { scope: string; handed: 'RH' | 'LH'; clubs: { club: string; shots: number; carryEstimated: boolean; metrics: Record<string, { mean: number; sd: number } | null> }[] }

export const gsproApi = {
  live: (since: number) => call<LiveResult>(`/api/gspro?live&since=${since}`),
  sessions: () => call<{ sessions: GsproSession[] }>('/api/gspro?sessions'),
  shots: (scope: { session?: string; days?: number }) => call<{ shots: GsproShot[] }>(scope.session ? `/api/gspro?shots&session=${encodeURIComponent(scope.session)}` : `/api/gspro?shots&days=${scope.days ?? 90}`),
  status: () => call<{ bridge: BridgeStatus }>('/api/gspro'),
  createKey: () => post<{ key: string; bridge: BridgeStatus }>({ action: 'create-key' }),
  revokeKey: () => post<{ bridge: BridgeStatus }>({ action: 'revoke-key' }),
  newSession: () => post<{ ok: true }>({ action: 'new-session' }),
  importShots: (label: string, shots: ShotInput[], sessionId?: string) => post<{ sessionId: string; added: number }>({ action: 'import', data: { label, shots, sessionId } }),
  updateShot: (id: number, change: { club?: string | null; excluded?: boolean }) => post<{ shot: GsproShot }>({ action: 'update-shot', id, ...change }),
  renameSession: (id: string, label: string) => post<{ ok: true }>({ action: 'rename-session', id, label }),
  deleteSession: (id: string) => post<{ ok: true }>({ action: 'delete-session', id }),
  coach: (data: CoachInput) => post<CoachResult>({ action: 'coach', data }),
}
