export type BotMode = 'sniper' | 'copytrade'
export type BotLevel = 'debug' | 'info' | 'success' | 'warning' | 'error'
export type BotEventType = 'detection' | 'quote' | 'simulation' | 'broadcast' | 'trade' | 'error' | 'status' | 'info' | 'heartbeat' | 'pong'
export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized'

export interface BotEvent {
  timestamp: string
  level: BotLevel
  event_type: BotEventType
  mint: string | null
  signature: string | null
  latency_ms: number | null
  message: string
}

export interface BotSettings {
  mode: BotMode
  target_wallet: string
  buy_amount_sol: number
  slippage_bps: number
  dry_run: boolean
}

export interface BotStatus {
  running: boolean
  started_at: number | null
  uptime_s: number
  settings: BotSettings
  max_buy_amount_sol: number
  trades_executed: number
  recent_trades: BotEvent[]
  recent_events: BotEvent[]
  subscribers: number
  wallet?: { address: string | null; balance_sol: number | null; error?: string }
}

export interface StreamHello {
  event_type: 'hello'
  running: boolean
  settings: BotSettings
  trades_executed: number
  backlog: BotEvent[]
}

export interface StartParams {
  mode?: BotMode
  targetWallet?: string | null
  target_wallet?: string | null
  buyAmountSol?: number
  buy_amount_sol?: number
  slippagePercent?: number
  slippageBps?: number
  slippage_bps?: number
  dryRun?: boolean
  dry_run?: boolean
}

export interface StreamOptions {
  onHello?: (hello: StreamHello) => void
  onStatusChange?: (status: StreamStatus) => void
  onError?: (error: Error) => void
  includeHeartbeats?: boolean
  maxBackoffMs?: number
  staleAfterMs?: number
}

export interface StreamHandle {
  close(): void
  readonly connected: boolean
}

export declare const WS_AUTH_FAILED: 4401

export declare class SolanaBotError extends Error {
  status: number
  detail: unknown
  constructor(message: string, status: number, detail: unknown)
}

export declare class SolanaBotClient {
  baseUrl: string
  password: string
  constructor(baseUrl: string, password: string, opts?: { fetchImpl?: typeof fetch; WebSocketImpl?: typeof WebSocket; timeoutMs?: number })
  health(): Promise<{ status: 'ok' }>
  getStatus(): Promise<BotStatus & { wallet: NonNullable<BotStatus['wallet']> }>
  startBot(params?: StartParams): Promise<BotStatus & { ok: true }>
  stopBot(): Promise<BotStatus & { ok: true }>
  streamUrl(): string
  connectStream(onEvent: (event: BotEvent) => void, opts?: StreamOptions): StreamHandle
}

export default SolanaBotClient
