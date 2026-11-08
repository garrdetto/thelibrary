/** Leaderboard client: tlScores.submit/progress to /api/module-scores with the tl-score-saved notice, and the tl-lap notice for lap boards. In-progress runs are checkpointed to the server and kept in a local outbox until saved, so a run still reaches the board when the page closes, the network drops or the device shuts off. */
import { HubBridge } from './HubBridge'

export interface SubmitOptions {
  key?: string
}

interface Run {
  module: string
  run: string
  value: number
  saved: number
  sentAt: number
  timer: ReturnType<typeof setTimeout> | 0
}

interface OutboxItem {
  module: string
  value: number
  at: number
}

type Outbox = Record<string, OutboxItem>

const STORE = 'tl-score-outbox'
const CHECKPOINT_MS = 15_000
const LOCAL_MS = 1_000
const MAX_AGE = 14 * 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const runs = new Map<string, Run>()
const current = new Map<string, string>()
let localAt = 0
let localTimer: ReturnType<typeof setTimeout> | 0 = 0
let flushing = false
let installed = false

function runId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
  }
}

function clean(value: number): number {
  const rounded = Math.round(Number(value))
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0
}

function readOutbox(): Outbox {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return data && typeof data === 'object' ? (data as Outbox) : {}
  } catch {
    return {}
  }
}

function storeOutbox(data: Outbox): void {
  if (Object.keys(data).length) localStorage.setItem(STORE, JSON.stringify(data))
  else localStorage.removeItem(STORE)
}

function writeOutbox(): void {
  localAt = Date.now()
  if (localTimer) clearTimeout(localTimer)
  localTimer = 0
  try {
    const data = readOutbox()
    const now = Date.now()
    for (const [id, item] of Object.entries(data)) if (!item || now - item.at > MAX_AGE) delete data[id]
    for (const r of runs.values()) {
      if (r.value > r.saved) data[r.run] = { module: r.module, value: r.value, at: now }
      else delete data[r.run]
    }
    storeOutbox(data)
  } catch {
    /* storage unavailable */
  }
}

function forget(run: string): void {
  try {
    const data = readOutbox()
    if (!data[run]) return
    delete data[run]
    storeOutbox(data)
  } catch {
    /* storage unavailable */
  }
}

function scheduleLocal(): void {
  if (Date.now() - localAt >= LOCAL_MS) writeOutbox()
  else if (!localTimer) localTimer = setTimeout(writeOutbox, LOCAL_MS)
}

async function post(module: string, value: number, run: string): Promise<{ ok: boolean; retry: boolean }> {
  try {
    const response = await fetch('/api/module-scores', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'score', module, value, run }),
    })
    return { ok: response.ok, retry: response.status >= 500 || response.status === 429 }
  } catch {
    return { ok: false, retry: true }
  }
}

async function send(r: Run): Promise<boolean> {
  const value = r.value
  r.sentAt = Date.now()
  const result = await post(r.module, value, r.run)
  if (result.ok || !result.retry) {
    r.saved = Math.max(r.saved, value)
    if (r.value <= r.saved) forget(r.run)
  }
  HubBridge.post({ type: 'tl-score-saved', module: r.module, saved: result.ok })
  return result.ok
}

function track(module: string, options: SubmitOptions): { key: string; run: Run; keyed: boolean } {
  const keyed = Boolean(options.key)
  let tag = keyed ? String(options.key) : current.get(module)
  if (!tag) {
    tag = runId()
    current.set(module, tag)
  }
  const key = `${module}:${tag}`
  let r = runs.get(key)
  if (!r) {
    r = { module, run: UUID.test(tag) ? tag.toLowerCase() : runId(), value: 0, saved: 0, sentAt: 0, timer: 0 }
    runs.set(key, r)
  }
  return { key, run: r, keyed }
}

function flushLive(): void {
  writeOutbox()
  for (const r of runs.values()) {
    if (r.value <= r.saved) continue
    if (r.timer) clearTimeout(r.timer)
    r.timer = 0
    void send(r)
  }
}

function flushOutbox(): void {
  if (flushing) return
  const live = new Set([...runs.values()].map((r) => r.run))
  const jobs: Promise<void>[] = []
  for (const [run, item] of Object.entries(readOutbox())) {
    if (live.has(run) || !item || !UUID.test(run) || Date.now() - item.at > MAX_AGE) continue
    jobs.push(
      post(item.module, clean(item.value), run).then((result) => {
        if (result.ok || !result.retry) forget(run)
        if (result.ok) HubBridge.post({ type: 'tl-score-saved', module: item.module, saved: true })
      }),
    )
  }
  if (!jobs.length) return
  flushing = true
  void Promise.all(jobs).finally(() => {
    flushing = false
  })
}

function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('pagehide', flushLive)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLive()
  })
  window.addEventListener('online', () => {
    flushLive()
    flushOutbox()
  })
  setTimeout(flushOutbox, 1_500)
}

export const Scores = {
  /** Records the running value of an unfinished run; it is checkpointed to the board and saved when the page closes. */
  progress(module: string, value: number, options: SubmitOptions = {}): void {
    install()
    const rounded = clean(value)
    if (!rounded) return
    const r = track(module, options).run
    if (rounded <= r.value) return
    r.value = rounded
    scheduleLocal()
    if (r.timer) return
    const wait = r.sentAt ? Math.max(0, CHECKPOINT_MS - (Date.now() - r.sentAt)) : CHECKPOINT_MS
    r.timer = setTimeout(() => {
      r.timer = 0
      if (r.value > r.saved) void send(r)
    }, wait)
  },

  /** Saves a finished run. Without a key it closes the module's current run, so the next progress starts a new one. */
  async submit(module: string, value: number, options: SubmitOptions = {}): Promise<boolean> {
    install()
    const rounded = clean(value)
    const { key, run: r, keyed } = track(module, options)
    if (!keyed) {
      runs.delete(key)
      current.delete(module)
    }
    if (r.timer) clearTimeout(r.timer)
    r.timer = 0
    if (!rounded) {
      forget(r.run)
      return false
    }
    r.value = Math.max(r.value, rounded)
    if (r.value <= r.saved) return false
    const doneKey = `done:${r.run}`
    if (!keyed) runs.set(doneKey, r)
    writeOutbox()
    const ok = await send(r)
    if (!keyed && r.value <= r.saved) runs.delete(doneKey)
    return ok
  },

  lapSaved(track: string, mode?: string): void {
    HubBridge.post({ type: 'tl-lap', track, mode })
  },

  installGlobal(): void {
    install()
    const target = window as unknown as { tlScores?: { submit: typeof Scores.submit; progress: typeof Scores.progress } }
    target.tlScores ??= {
      submit: (module, value, options) => Scores.submit(module, value, options),
      progress: (module, value, options) => Scores.progress(module, value, options),
    }
  },
}
