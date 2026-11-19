import type { Env } from './env.js'
import { HttpError } from './http.js'
import { aiOutputBytes, sniffMime } from './clipart.js'

export const STUDIO_FLUX_MODEL = '@cf/black-forest-labs/flux-2-klein-9b'

export type StudioAspect = '1:1' | '16:9' | '9:16'

const SIZES: Record<StudioAspect, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
}

export class FluxRefused extends Error {}

function fluxFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Workers AI studio image failure', message.slice(0, 500))
  if (/4006|daily free allocation|neurons|quota/i.test(message)) throw new HttpError(429, 'Today’s free image allowance is used up. It resets at midnight UTC.')
  if (/3040|capacity|429|rate limit|too many/i.test(message)) throw new HttpError(429, 'The image service is busy right now. Please wait a moment and retry.')
  if (/3030|nsfw|safety|flagged/i.test(message)) throw new FluxRefused('That picture can not be made here. Try a different description.')
  throw new Error('Workers AI could not generate this image.')
}

export function fluxAvailable(env: Env) {
  return Boolean(env.AI)
}

export async function fluxImage(env: Env, prompt: string, aspect: StudioAspect, source?: { bytes: Uint8Array; mime: string } | null) {
  if (!env.AI) throw new HttpError(503, 'The image service is unavailable right now. Please try again shortly.')
  const size = SIZES[aspect]
  const form = new FormData()
  form.append('prompt', prompt.slice(0, 2000))
  form.append('width', String(size.width))
  form.append('height', String(size.height))
  if (source) form.append('input_image_0', new Blob([source.bytes as Uint8Array<ArrayBuffer>], { type: source.mime }), 'source')
  const encoded = new Response(form)
  let bytes: Uint8Array
  try {
    bytes = await aiOutputBytes(await env.AI.run(STUDIO_FLUX_MODEL, { multipart: { body: encoded.body, contentType: encoded.headers.get('content-type') ?? 'multipart/form-data' } }))
  } catch (error) {
    if (error instanceof HttpError || error instanceof FluxRefused) throw error
    fluxFailure(error)
  }
  const mime = sniffMime(bytes)
  if (!mime) throw new Error('Workers AI returned an unreadable image.')
  return { bytes, mime }
}
