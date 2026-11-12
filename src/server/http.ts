export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const baseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export function json(body: unknown, status = 200, extra?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...baseHeaders, ...extra } })
}

export function binary(data: ArrayBuffer | Uint8Array<ArrayBuffer>, contentType: string, extra?: Record<string, string>) {
  return new Response(data, { headers: { ...baseHeaders, 'Content-Type': contentType, ...extra } })
}

export function requireSameOrigin(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'This request is not allowed.')
}

export async function readText(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Your request is too long. Please shorten it.')
  const raw = await request.text()
  if (raw.length > limit) throw new HttpError(413, 'Your request is too long. Please shorten it.')
  return raw
}

export async function readJson(request: Request, limit: number): Promise<unknown> {
  return JSON.parse(await readText(request, limit))
}

export function parseStored<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function clientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}
