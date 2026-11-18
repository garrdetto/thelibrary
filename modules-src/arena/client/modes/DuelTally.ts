export interface DuelLine {
  kills: number
  deaths: number
  shots: number
  hits: number
}

export class DuelTally {
  private line: DuelLine = { kills: 0, deaths: 0, shots: 0, hits: 0 }
  private counting = false

  get active(): boolean {
    return this.counting
  }

  start(): void {
    this.line = { kills: 0, deaths: 0, shots: 0, hits: 0 }
    this.counting = true
  }

  shot(): void { if (this.counting) this.line.shots++ }
  hit(): void { if (this.counting) this.line.hits++ }
  kill(): void { if (this.counting) this.line.kills++ }
  death(): void { if (this.counting) this.line.deaths++ }

  summary(): string {
    const { kills, deaths, shots, hits } = this.line
    const accuracy = shots ? `${Math.round((Math.min(hits, shots) / shots) * 100)}%` : '—'
    return `K/D ${(kills / Math.max(1, deaths)).toFixed(2)} · accuracy ${accuracy}`
  }

  finish(won: boolean): void {
    if (!this.counting) return
    this.counting = false
    const line = { ...this.line, hits: Math.min(this.line.hits, this.line.shots) }
    if (!line.shots && !line.kills && !line.deaths) return
    void fetch('/api/arena-stats', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'match', run: crypto.randomUUID(), won, ...line }),
    }).then(response => {
      if (response.ok && window.parent !== window) window.parent.postMessage({ type: 'tl-arena-duel' }, location.origin)
    }).catch(() => {})
  }
}
