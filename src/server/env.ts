export type D1Result<T> = { results: T[] }

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<{ meta: { changes: number } }>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}

export interface KVNamespace {
  getWithMetadata<M>(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: M | null }>
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { metadata?: unknown; expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export interface WorkersAi {
  run(model: string, inputs: unknown): Promise<unknown>
}

export type Env = {
  DB: D1Database
  FILES: KVNamespace
  /** Cloudflare Workers AI binding (free daily allowance), used by the clipart generator. */
  AI?: WorkersAi
  MAPLE_WORLD?: DurableObjectNamespace
  FOX_LAKE_WORLD?: DurableObjectNamespace
  ANGLER_LAKE?: DurableObjectNamespace
  BUSHLEAGUE_MATCH?: DurableObjectNamespace
  HOOD_LOT?: DurableObjectNamespace
  DARTS_ROOM?: DurableObjectNamespace
  ADMIN_PASSWORD?: string
  GEMINI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  SITE_CHANGES_GITHUB_TOKEN?: string
  SITE_CHANGES_SECRET?: string
  SITE_CHANGES_REPO?: string
  /** Label of the self-hosted GitHub Actions runner on the admin's laptop (default msi-laptop). */
  SITE_CHANGES_RUNNER_LABEL?: string
  ANTHROPIC_ADMIN_KEY?: string
  ELEVENLABS_API_KEY?: string
  MESHY_API_KEY?: string
  /** Public HTTPS origin of the self-hosted Axiom Radar tracker API (a Cloudflare Tunnel hostname). */
  AXIOM_RADAR_ORIGIN?: string
  /** Shared secret the tracker API requires (same value as the worker's AXIOM_RADAR_TOKEN). */
  AXIOM_RADAR_TOKEN?: string
  /** Development only: point the Meshy client at a local stand-in. */
  MESHY_API_BASE?: string
}
