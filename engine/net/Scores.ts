/** Leaderboard client: tlScores.submit to /api/module-scores with the tl-score-saved notice, and the tl-lap notice for lap boards. */
import { HubBridge } from './HubBridge'

export interface SubmitOptions {
  key?: string
}

function runId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  }
}

const sent = new Set<string>()

export const Scores = {
  async submit(module: string, value: number, options: SubmitOptions = {}): Promise<boolean> {
    const rounded = Math.round(Number(value))
    if (!Number.isFinite(rounded) || rounded <= 0) return false
    const key = `${module}:${options.key ?? runId()}`
    if (sent.has(key)) return false
    sent.add(key)
    try {
      const response = await fetch('/api/module-scores', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'score', module, value: rounded, run: runId() }),
      })
      HubBridge.post({ type: 'tl-score-saved', module, saved: response.ok })
      return response.ok
    } catch {
      HubBridge.post({ type: 'tl-score-saved', module, saved: false })
      return false
    }
  },

  lapSaved(track: string, mode?: string): void {
    HubBridge.post({ type: 'tl-lap', track, mode })
  },

  installGlobal(): void {
    const target = window as unknown as { tlScores?: { submit: typeof Scores.submit } }
    target.tlScores ??= { submit: (module, value, options) => Scores.submit(module, value, options) }
  },
}
