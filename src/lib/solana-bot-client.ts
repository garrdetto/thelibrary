import { z } from 'zod'

export const botModes = ['sniper', 'copytrade'] as const
export type BotMode = (typeof botModes)[number]
export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized'

export const WS_AUTH_FAILED = 4401

const eventTypes = ['detection', 'quote', 'simulation', 'broadcast', 'trade', 'error', 'status', 'info'] as const
const levels = ['debug', 'info', 'success', 'warning', 'error'] as const

export const botEventSchema = z.object({
  timestamp: z.string(),
  level: z.enum(levels).catch('info'),
  event_type: z.enum(eventTypes).catch('info'),
  mint: z.string().max(64).nullable().catch(null),
  signature: z.string().max(128).nullable().catch(null),
  latency_ms: z.number().nullable().catch(null),
  message: z.string().max(2000),
})
export type BotEvent = z.infer<typeof botEventSchema>

export const botSettingsSchema = z.object({
  mode: z.enum(botModes),
  target_wallet: z.string(),
  buy_amount_sol: z.number(),
  slippage_bps: z.number(),
  dry_run: z.boolean(),
})
export type BotSettings = z.infer<typeof botSettingsSchema>

const eventList = z.array(z.unknown()).transform(items => items.flatMap(item => {
  const parsed = botEventSchema.safeParse(item)
  return parsed.success ? [parsed.data] : []
}))

export const botStatusSchema = z.object({
  running: z.boolean(),
  started_at: z.number().nullable(),
  uptime_s: z.number(),
  settings: botSettingsSchema,
  max_buy_amount_sol: z.number(),
  trades_executed: z.number(),
  recent_trades: eventList,
  recent_events: eventList,
  wallet: z.object({
    address: z.string().nullable(),
    balance_sol: z.number().nullable(),
    error: z.string().optional(),
  }).optional(),
})
export type BotStatus = z.infer<typeof botStatusSchema>

const helloSchema = z.object({
  event_type: z.literal('hello'),
  running: z.boolean(),
  settings: botSettingsSchema,
  trades_executed: z.number(),
  backlog: eventList,
})
export type StreamHello = z.infer<typeof helloSchema>

export type StartParams = {
  mode: BotMode
  targetWallet: string | null
  buyAmountSol: number
  slippagePercent: number
  dryRun: boolean
}

export class SolanaBotError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SolanaBotError'
    this.status = status
  }
}

export type StreamOptions = {
  onHello?: (hello: StreamHello) => void
  onStatusChange?: (status: StreamStatus) => void
  maxBackoffMs?: number
  staleAfterMs?: number
}

export type StreamHandle = { close: () => void }

const errorBody = z.object({ detail: z.union([z.string(), z.array(z.object({ msg: z.string(), loc: z.array(z.union([z.string(), z.number()])).optional() }))]) })

export function normalizeBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export class SolanaBotClient {
  readonly baseUrl: string
  private readonly password: string

  constructor(baseUrl: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.password = password
  }

  private async request<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let response: Response
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        mode: 'cors',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${this.password}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      throw new SolanaBotError(error instanceof DOMException && error.name === 'AbortError' ? 'The bot API took too long to answer.' : 'Could not reach the bot API. Check the URL, that it is running, and that ALLOWED_ORIGINS includes this site.', 0)
    } finally {
      clearTimeout(timer)
    }
    let data: unknown = null
    try { data = await response.json() } catch { data = null }
    if (!response.ok) {
      const parsed = errorBody.safeParse(data)
      const detail = parsed.success
        ? typeof parsed.data.detail === 'string' ? parsed.data.detail : parsed.data.detail.map(item => `${item.loc?.at(-1) ?? 'field'}: ${item.msg}`).join('; ')
        : `The bot API answered ${response.status}.`
      throw new SolanaBotError(response.status === 401 ? 'Wrong dashboard password.' : detail, response.status)
    }
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new SolanaBotError('The bot API sent an answer this page does not understand.', response.status)
    return parsed.data
  }

  getStatus() {
    return this.request('GET', '/api/status', botStatusSchema)
  }

  startBot(params: StartParams) {
    return this.request('POST', '/api/start', botStatusSchema, {
      mode: params.mode,
      target_wallet: params.mode === 'copytrade' ? params.targetWallet?.trim() || null : null,
      buy_amount_sol: params.buyAmountSol,
      slippage_bps: Math.round(params.slippagePercent * 100),
      dry_run: params.dryRun,
    })
  }

  stopBot() {
    return this.request('POST', '/api/stop', botStatusSchema)
  }

  streamUrl() {
    const url = new URL(`${this.baseUrl}/ws/stream`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', this.password)
    return url.toString()
  }

  connectStream(onEvent: (event: BotEvent) => void, options: StreamOptions = {}): StreamHandle {
    const { onHello, onStatusChange, maxBackoffMs = 30_000, staleAfterMs = 45_000 } = options
    let socket: WebSocket | null = null
    let attempt = 0
    let stopped = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let staleTimer: ReturnType<typeof setTimeout> | undefined

    const armStale = () => {
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => socket?.close(4000, 'stale'), staleAfterMs)
    }
    const schedule = () => {
      if (stopped) return
      const delay = Math.min(maxBackoffMs, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6)
      attempt += 1
      onStatusChange?.('reconnecting')
      reconnectTimer = setTimeout(open, delay)
    }
    const open = () => {
      if (stopped) return
      onStatusChange?.(attempt === 0 ? 'connecting' : 'reconnecting')
      try {
        socket = new WebSocket(this.streamUrl())
      } catch {
        schedule()
        return
      }
      socket.onopen = () => { attempt = 0; armStale(); onStatusChange?.('open') }
      socket.onmessage = message => {
        armStale()
        let raw: unknown
        try { raw = JSON.parse(String(message.data)) } catch { return }
        const hello = helloSchema.safeParse(raw)
        if (hello.success) { onHello?.(hello.data); return }
        const event = botEventSchema.safeParse(raw)
        if (event.success) onEvent(event.data)
      }
      socket.onclose = event => {
        clearTimeout(staleTimer)
        if (event.code === WS_AUTH_FAILED) { stopped = true; onStatusChange?.('unauthorized'); return }
        if (stopped) { onStatusChange?.('closed'); return }
        schedule()
      }
    }

    open()
    return {
      close() {
        stopped = true
        clearTimeout(reconnectTimer)
        clearTimeout(staleTimer)
        socket?.close(1000, 'closed')
        onStatusChange?.('closed')
      },
    }
  }
}
