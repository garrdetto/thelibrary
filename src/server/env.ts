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
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { metadata?: unknown }): Promise<void>
  delete(key: string): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}

export type Env = {
  DB: D1Database
  FILES: KVNamespace
  ADMIN_PASSWORD?: string
  GEMINI_API_KEY?: string
}
