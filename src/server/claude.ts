import type { Env } from './env'
import { HttpError } from './http'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const WEB_SEARCH_TOOL = 'web_search_20260318'

export const CHAT_MODEL = 'claude-sonnet-5-5'
export const LYRICS_MODEL = 'claude-opus-5-5'
export const IMAGE_DIRECTOR_MODEL = 'claude-sonnet-5-5'
export const RESEARCH_MODEL = 'claude-sonnet-5-5'

export type ClaudeImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
export type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ClaudeImageType; data: string } }
export type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeBlock[] }
export type ClaudeTool = { name: string; description: string; input_schema: Record<string, unknown> }

type ResponseBlock = { type: string; text?: string; name?: string; input?: unknown }
type ClaudeResponse = { content?: ResponseBlock[]; stop_reason?: string }

export type ClaudeRequest = {
  model: string
  system: string
  messages: ClaudeMessage[]
  maxTokens: number
  tools?: ClaudeTool[]
  forceTool?: string
  webSearch?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export function claudeReady(env: Env) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'AI features are not set up yet. Ask the site owner to add a Claude API key.')
  return env.ANTHROPIC_API_KEY
}

function modelFor(env: Env, fallback: string) {
  if (fallback === CHAT_MODEL && env.CLAUDE_CHAT_MODEL) return env.CLAUDE_CHAT_MODEL
  if (fallback === LYRICS_MODEL && env.CLAUDE_LYRICS_MODEL) return env.CLAUDE_LYRICS_MODEL
  return fallback
}

export async function claude(env: Env, request: ClaudeRequest): Promise<ClaudeResponse> {
  const key = claudeReady(env)
  const tools: unknown[] = [...(request.tools ?? [])]
  if (request.webSearch) tools.push({ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: request.webSearch })
  const body = {
    model: modelFor(env, request.model),
    max_tokens: request.maxTokens,
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: request.messages,
    ...(tools.length ? { tools } : {}),
    ...(request.forceTool ? { tool_choice: { type: 'tool', name: request.forceTool } } : {}),
  }
  const timeout = AbortSignal.timeout(request.timeoutMs ?? 90000)
  let response: Response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
      signal: request.signal ? AbortSignal.any([timeout, request.signal]) : timeout,
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new HttpError(504, 'The assistant took too long to answer. Please try again.')
    throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Claude API error', response.status, detail.slice(0, 500))
    if (response.status === 429 || response.status === 529) throw new HttpError(429, 'The assistant is busy right now. Please wait a moment and retry.')
    if (response.status === 401 || response.status === 403) throw new HttpError(503, 'AI features are not set up correctly. Ask the site owner to check the Claude API key.')
    if (response.status === 400 && /credit|billing|balance/i.test(detail)) throw new HttpError(503, 'AI features are paused. Ask the site owner to check the Claude account balance.')
    throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
  }
  return await response.json() as ClaudeResponse
}

export function textOf(response: ClaudeResponse) {
  return (response.content ?? []).filter(block => block.type === 'text' && block.text).map(block => block.text).join('').trim()
}

export function toolInput<T>(response: ClaudeResponse, name: string): T | null {
  const block = (response.content ?? []).find(item => item.type === 'tool_use' && item.name === name)
  return block?.input ? block.input as T : null
}

export function stoppedForSafety(response: ClaudeResponse) {
  return response.stop_reason === 'refusal'
}

export function asClaudeImage(mime: string | null | undefined): ClaudeImageType | null {
  const type = (mime || 'image/png').toLowerCase()
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/gif' ? type : null
}

export function alternate(messages: { role: 'user' | 'assistant'; content: string }[]): ClaudeMessage[] {
  const merged: { role: 'user' | 'assistant'; content: string }[] = []
  for (const message of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === message.role) last.content = `${last.content}\n\n${message.content}`
    else merged.push({ ...message })
  }
  while (merged.length && merged[0].role !== 'user') merged.shift()
  return merged
}
