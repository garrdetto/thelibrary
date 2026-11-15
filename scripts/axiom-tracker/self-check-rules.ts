/** The loops the Radar cannot do without, and how long each may go quiet before the tracker restarts itself. */
export const coreLoops: Record<string, number> = { discovery: 6 * 60_000, scoring: 4 * 60_000, 'site-publisher': 4 * 60_000, 'runner-alerts': 4 * 60_000 }
export const settleMs = 5 * 60_000
export const guardQuietMs = 5 * 60_000

export type HeartbeatRow = { component: string; updated_at: number }

/** Core loops that reported after this process started and have since gone quiet for longer than they are allowed. */
export function stalledLoops(heartbeats: HeartbeatRow[], now: number, startedAt: number) {
  if (now - startedAt < settleMs) return []
  const seen = new Map(heartbeats.map(row => [row.component, row.updated_at]))
  return Object.entries(coreLoops).filter(([component, limit]) => {
    const at = seen.get(component)
    return at !== undefined && at >= startedAt && now - at > limit
  }).map(([component]) => component)
}

export type GuardState = { at?: number; lastAction?: { at: number; reason: string; outcome: string } | null }

/** What the Radar shows about the Windows guard that starts the tracker and brings it back, from the note it leaves on each check. */
export function guardStatus(state: GuardState | null, now: number): { status: 'ok' | 'waiting'; detail: string } {
  if (!state?.at) return { status: 'waiting', detail: 'Not installed: run pnpm axiom:autostart so the tracker starts with Windows and comes back if it stops' }
  const minutes = Math.round((now - state.at) / 60_000)
  if (now - state.at > guardQuietMs) return { status: 'waiting', detail: `The Windows guard has not checked in for ${minutes} minutes: run pnpm axiom:autostart again` }
  const last = state.lastAction
  const seconds = Math.max(0, Math.round((now - state.at) / 1000))
  return { status: 'ok', detail: `Windows checked the tracker ${seconds}s ago${last ? `; last stepped in ${new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${last.reason}: ${last.outcome})` : '; it has not had to step in'}` }
}
