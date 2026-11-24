export const hostActions = ['start', 'restart', 'open-pulse'] as const
export type HostAction = (typeof hostActions)[number]

export const hostActionLabels: Record<HostAction, string> = {
  start: 'Turn on',
  restart: 'Restart',
  'open-pulse': 'Open Pulse',
}

export type HostApp = { name: string; status: string; uptimeMs: number; restarts: number; memoryMb: number | null }

/** What the watchdog on the tracker's PC reports to the site every few seconds. */
export type HostReport = {
  at: number
  host: string
  daemon: boolean
  probeAnswered: boolean
  apps: HostApp[]
  lastAction: { at: number; reason: string; outcome: string } | null
}

export type HostCommandStatus = 'pending' | 'running' | 'done' | 'failed' | 'expired'

export type HostCommand = {
  id: string
  action: HostAction
  openPulse: boolean
  requestedAt: number
  status: HostCommandStatus
  startedAt: number | null
  finishedAt: number | null
  output: string | null
}

export type HostComponent = { component: string; status: string; detail: string | null; updatedAt: number }

export type HostView = {
  now: number
  online: boolean
  reportedAt: number | null
  report: HostReport | null
  command: HostCommand | null
  feed: { at: number | null; coins: number; components: HostComponent[] }
}

/** A command the PC has not picked up within this long is dropped, so an old click never fires hours later. */
export const hostCommandLifetimeMs = 5 * 60_000
/** The watchdog checks in every 5 seconds while it runs and starts again every 2 minutes, so 3 minutes of silence means it is not running. */
export const hostOnlineWindowMs = 3 * 60_000

/** Whether the tracker is reading Axiom Pulse, from its `extension-intake` heartbeat. */
export function pulseFeeding(components: HostComponent[], now = Date.now()) {
  const intake = components.find(entry => entry.component === 'extension-intake')
  return Boolean(intake && intake.status === 'ok' && now - intake.updatedAt < 2 * 60_000)
}

/** The command to hand the PC: a pending one that is still fresh. */
export function pendingCommand(command: HostCommand | null, now = Date.now()) {
  if (!command || command.status !== 'pending') return null
  return now - command.requestedAt <= hostCommandLifetimeMs ? command : null
}

/** The stored command as the page should show it, with a stale unclaimed one marked expired. */
export function shownCommand(command: HostCommand | null, now = Date.now()): HostCommand | null {
  if (!command) return null
  if (command.status === 'pending' && now - command.requestedAt > hostCommandLifetimeMs) return { ...command, status: 'expired' }
  return command
}
