import type { Env } from './env'
import { HttpError } from './http'
import type { StudioAspect } from './studio-image'

export const OPENAI_TEXT_MODEL = 'gpt-5-mini'
export const OPENAI_IMAGE_MODEL = 'gpt-image-1'

const OPENAI_BASE = 'https://api.openai.com/v1'

export class OpenAIRefused extends Error {}

type OpenAIBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string | OpenAIBlock[] }

export type OpenAIChatRequest = {
  messages: OpenAIMessage[]
  maxTokens: number
  json?: { name: string; schema: Record<string, unknown> }
}

function looksLikeOpenAIKey(value: string | undefined) {
  return Boolean(value && value.trim().startsWith('sk-'))
}

export function openAIKey(env: Env) {
  if (env.OPENAI_API_KEY?.trim()) return env.OPENAI_API_KEY.trim()
  if (looksLikeOpenAIKey(env.GEMINI_API_KEY)) return env.GEMINI_API_KEY!.trim()
  return ''
}

export function studioProvider(env: Env): 'gemini' | 'openai' | null {
  const geminiKey = env.GEMINI_API_KEY?.trim()
  if (geminiKey && !looksLikeOpenAIKey(geminiKey)) return 'gemini'
  if (openAIKey(env)) return 'openai'
  return null
}

function textModel(env: Env) {
  return env.OPENAI_TEXT_MODEL?.trim() || OPENAI_TEXT_MODEL
}

function imageModel(env: Env) {
  return env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_IMAGE_MODEL
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string; code?: string } }
    return { message: body.error?.message ?? '', code: body.error?.code ?? '' }
  } catch { return { message: '', code: '' } }
}

export function openAIFailure(status: number, message: string): never {
  console.error('OpenAI API error', status, message.slice(0, 500))
  if (status === 429) throw new HttpError(429, 'The assistant is busy right now. Please wait a moment and retry.')
  if (status === 401 || status === 403) throw new HttpError(503, 'AI features are not set up correctly. Ask the site owner to check the OpenAI API key.')
  throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
}

async function call(env: Env, path: string, init: RequestInit) {
  const key = openAIKey(env)
  if (!key) throw new HttpError(503, 'AI features are not set up yet. Ask the site owner to add an API key.')
  let response: Response | null = null
  for (const delay of [0, 1500, 4000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay * (0.75 + Math.random() * 0.5)))
    try {
      response = await fetch(`${OPENAI_BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(110000) })
    } catch (error) {
      openAIFailure(0, error instanceof Error ? error.message : '')
    }
    if (response.status !== 429 && response.status < 500) break
    const code = response.status === 429 ? (await response.clone().json().catch(() => null) as { error?: { code?: string } } | null)?.error?.code : ''
    if (code === 'insufficient_quota') break
  }
  return response!
}

export async function openAIChat(env: Env, request: OpenAIChatRequest): Promise<{ text: string; refused: boolean }> {
  const model = textModel(env)
  const body = {
    model,
    messages: request.messages,
    max_completion_tokens: request.maxTokens,
    ...(/^gpt-5/.test(model) ? { reasoning_effort: 'low' } : {}),
    ...(request.json ? { response_format: { type: 'json_schema', json_schema: { name: request.json.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'reply', schema: request.json.schema, strict: false } } } : {}),
  }
  const response = await call(env, '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    const error = await readError(response)
    if (error.code === 'content_policy_violation' || error.code === 'moderation_blocked') return { text: '', refused: true }
    openAIFailure(response.status, error.message)
  }
  const result = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] }
  const choice = result.choices?.[0]
  const text = (choice?.message?.content ?? '').trim()
  return { text, refused: !text && (Boolean(choice?.message?.refusal) || choice?.finish_reason === 'content_filter') }
}

const SIZES: Record<StudioAspect, string> = { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' }

function decode(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function openAIImage(env: Env, prompt: string, aspect: StudioAspect, source?: { bytes: Uint8Array; mime: string } | null) {
  let response: Response
  if (source) {
    const form = new FormData()
    form.append('model', imageModel(env))
    form.append('prompt', prompt.slice(0, 32000))
    form.append('size', SIZES[aspect])
    const extension = source.mime.split('/')[1] || 'png'
    form.append('image', new Blob([new Uint8Array(source.bytes)], { type: source.mime }), `source.${extension}`)
    response = await call(env, '/images/edits', { method: 'POST', body: form })
  } else {
    response = await call(env, '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: imageModel(env), prompt: prompt.slice(0, 32000), size: SIZES[aspect], n: 1 }) })
  }
  if (!response.ok) {
    const error = await readError(response)
    if (error.code === 'moderation_blocked' || error.code === 'content_policy_violation') throw new OpenAIRefused('That picture can not be made here. Try a different description.')
    openAIFailure(response.status, error.message)
  }
  const result = await response.json() as { data?: { b64_json?: string }[] }
  const data = result.data?.[0]?.b64_json
  return data ? { bytes: decode(data), mime: 'image/png' } : null
}
