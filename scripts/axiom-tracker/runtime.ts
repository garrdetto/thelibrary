import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

if (existsSync('.env')) {
  try { process.loadEnvFile('.env') } catch { }
}

export const trackerConfig = {
  maxPairAgeMs: 5 * 60 * 60 * 1000,
  discoveryIntervalMs: 20_000,
  snapshotIntervalMs: 10_000,
  scoringIntervalMs: 10_000,
  runnerScanIntervalMs: 60_000,
  walletSwapIntervalMs: 30_000,
  maxCandidates: 30,
  minVolume5m: 15_000,
  minTxns5m: 150,
  minLiquidityUsd: 8_000,
  minBuyRatio: 0.45,
  runnerMarketCap: 500_000,
  runnerMultiple: 3,
  axiomPages: Math.max(1, Math.min(12, Number(process.env.AXIOM_PAGES) || 6)),
  debugWebSockets: process.env.AXIOM_DEBUG_WS === '1',
  headless: process.env.AXIOM_HEADLESS !== '0',
  collector: (['browser', 'extension', 'off'].includes(process.env.AXIOM_COLLECTOR ?? '') ? process.env.AXIOM_COLLECTOR : 'browser') as 'browser' | 'extension' | 'off',
  extensionPort: Number(process.env.AXIOM_EXTENSION_PORT) || 8791,
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export function createLogger(component: string) {
  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (level === 'debug' && process.env.AXIOM_DEBUG !== '1') return
    const line = JSON.stringify({ time: new Date().toISOString(), level, component, message, ...fields })
    if (level === 'error' || level === 'warn') console.error(line)
    else console.log(line)
  }
  return {
    info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
    debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  }
}

export type Logger = ReturnType<typeof createLogger>

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 12_000, retries = 2, ...request } = init
  let attempt = 0
  while (true) {
    try {
      const response = await fetch(url, { ...request, signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'User-Agent': 'axiom-radar/1.0', ...request.headers } })
      if (response.status === 429 || response.status >= 500) throw new HttpError(response.status, `HTTP ${response.status}`)
      if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status}`)
      return await response.json() as T
    } catch (error) {
      const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500
      if (!retryable || attempt >= retries) throw error
      const backoff = (error instanceof HttpError && error.status === 429 ? 4_000 : 1_000) * 2 ** attempt
      await sleep(backoff + Math.random() * 500)
      attempt += 1
    }
  }
}

export function runLoop(name: string, intervalMs: number, task: () => Promise<void>, logger: Logger, signal: AbortSignal) {
  return (async () => {
    let failures = 0
    while (!signal.aborted) {
      const started = Date.now()
      try {
        await task()
        failures = 0
      } catch (error) {
        failures += 1
        logger.error(`${name} cycle failed`, { error: errorMessage(error), failures })
      }
      const backoff = failures ? Math.min(intervalMs * 2 ** Math.min(failures, 4), 5 * 60_000) : intervalMs
      await sleep(Math.max(250, backoff - (Date.now() - started)), signal)
    }
  })()
}

export function isMainModule(moduleUrl: string) {
  return Boolean(process.argv[1]) && moduleUrl.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()
}

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
