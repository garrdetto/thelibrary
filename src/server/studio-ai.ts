import { HarmBlockThreshold, HarmCategory } from '@google/genai'
import type { Content, GenerateContentConfig, GenerateContentResponse, Part } from '@google/genai'
import type { Env } from './env'
import { HttpError } from './http'
import { TEXT_MODEL, gemini } from './gemini'
import { openAIChat, openAIKey, studioProvider } from './studio-openai'
import type { OpenAIMessage } from './studio-openai'
import { freeChat, freeTextAvailable } from './studio-free'

export const STUDIO_TEXT_MODEL = TEXT_MODEL
export const STUDIO_FALLBACK_TEXT_MODEL = 'gemini-2.5-flash'
const RETRY_DELAYS = [1200, 3000]

export type StudioImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
export type StudioBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: StudioImageType; data: string }
export type StudioMessage = { role: 'user' | 'assistant'; content: string | StudioBlock[] }
export type StudioSchema = { name: string; schema: Record<string, unknown> }

export type StudioRequest = {
  system: string
  messages: StudioMessage[]
  maxTokens: number
  json?: StudioSchema
  webSearch?: boolean
  relaxedSafety?: boolean
}
export type StudioReply = { text: string; data: unknown; refused: boolean }

const BLOCKED_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'RECITATION'])

export function studioReady(env: Env) {
  const provider = studioProvider(env)
  if (provider === 'openai' || (!provider && freeTextAvailable(env))) return
  gemini(env)
}

export function blockedResponse(result: GenerateContentResponse) {
  return Boolean(result.promptFeedback?.blockReason) || BLOCKED_FINISH.has(String(result.candidates?.[0]?.finishReason ?? ''))
}

export function geminiFailure(error: unknown): never {
  if (error instanceof HttpError) throw error
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 0
  const message = error instanceof Error ? error.message : ''
  console.error('Gemini API error', status, message.slice(0, 500))
  if (status === 429) throw new HttpError(429, 'The assistant is busy right now. Please wait a moment and retry.')
  if (status === 401 || status === 403 || /api key/i.test(message)) throw new HttpError(503, 'AI features are not set up correctly. Ask the site owner to check the Gemini API key.')
  throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
}

export function errorStatus(error: unknown) {
  if (error instanceof HttpError) return error.status
  return typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 0
}

export function retryable(error: unknown) {
  const status = errorStatus(error)
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true
  const message = error instanceof Error ? error.message : ''
  return !status && /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate limit|quota|timed? ?out|fetch failed/i.test(message)
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetries<T>(task: () => Promise<T>, delays = RETRY_DELAYS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= delays.length || !retryable(error)) throw error
      await wait(delays[attempt] * (0.75 + Math.random() * 0.5))
    }
  }
}

function toContents(messages: StudioMessage[]): Content[] {
  return messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: typeof message.content === 'string'
      ? [{ text: message.content }]
      : message.content.map((block): Part => block.type === 'text' ? { text: block.text } : { inlineData: { mimeType: block.mimeType, data: block.data } }),
  }))
}

function readJson(text: string) {
  try { return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return null }
}

function toOpenAI(system: string, messages: StudioMessage[]): OpenAIMessage[] {
  return [{ role: 'system', content: system }, ...messages.map((message): OpenAIMessage => ({
    role: message.role,
    content: typeof message.content === 'string' || message.role === 'assistant'
      ? (typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      : message.content.map(block => block.type === 'text' ? { type: 'text' as const, text: block.text } : { type: 'image_url' as const, image_url: { url: `data:${block.mimeType};base64,${block.data}` } }),
  }))]
}

export async function askStudio(env: Env, request: StudioRequest): Promise<StudioReply> {
  const system = request.json ? `${request.system}\nReply with only the JSON object described by the response schema (the ${request.json.name} fields), with no other text.` : request.system
  const provider = studioProvider(env)
  const reply = (result: { text: string; refused: boolean }): StudioReply => ({ text: result.text, data: request.json && result.text ? readJson(result.text) : null, refused: result.refused })
  const free = async () => {
    try {
      return reply(await freeChat(env, { messages: toOpenAI(system, request.messages), maxTokens: request.maxTokens, json: request.json }))
    } catch (error) {
      if (!request.messages.some(message => typeof message.content !== 'string')) throw error
      const textOnly = request.messages.map(message => ({ ...message, content: typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }))
      return reply(await freeChat(env, { messages: toOpenAI(system, textOnly), maxTokens: request.maxTokens, json: request.json }))
    }
  }
  if (!provider && freeTextAvailable(env)) return free()
  try {
    return await askPaid(env, request, system, provider)
  } catch (error) {
    if (!freeTextAvailable(env)) throw error
    console.error('Paid studio AI failed, using Workers AI', errorStatus(error))
    return free()
  }
}

async function askPaid(env: Env, request: StudioRequest, system: string, provider: 'gemini' | 'openai' | null): Promise<StudioReply> {
  if (provider === 'openai') {
    const reply = await openAIChat(env, { messages: toOpenAI(system, request.messages), maxTokens: request.maxTokens, json: request.json })
    return { text: reply.text, data: request.json && reply.text ? readJson(reply.text) : null, refused: reply.refused }
  }
  const ai = gemini(env)
  const config: GenerateContentConfig = {
    systemInstruction: system,
    maxOutputTokens: request.maxTokens,
    ...(request.json ? { responseMimeType: 'application/json', responseJsonSchema: request.json.schema } : {}),
    ...(request.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(request.relaxedSafety ? { safetySettings: [HarmCategory.HARM_CATEGORY_HARASSMENT, HarmCategory.HARM_CATEGORY_HATE_SPEECH, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH })) } : {}),
  }
  const contents = toContents(request.messages)
  let result: GenerateContentResponse
  try {
    result = await withRetries(() => ai.models.generateContent({ model: STUDIO_TEXT_MODEL, contents, config }))
  } catch (error) {
    if (!retryable(error)) geminiFailure(error)
    console.error('Gemini text busy, trying fallback', errorStatus(error))
    try {
      result = await withRetries(() => ai.models.generateContent({ model: STUDIO_FALLBACK_TEXT_MODEL, contents, config }), [2000])
    } catch (fallbackError) {
      if (!openAIKey(env)) geminiFailure(fallbackError)
      const reply = await openAIChat(env, { messages: toOpenAI(system, request.messages), maxTokens: request.maxTokens, json: request.json })
      return { text: reply.text, data: request.json && reply.text ? readJson(reply.text) : null, refused: reply.refused }
    }
  }
  const text = (result.candidates?.[0]?.content?.parts ?? []).filter(part => part.text && !part.thought).map(part => part.text).join('').trim()
  return { text, data: request.json && text ? readJson(text) : null, refused: !text && blockedResponse(result) }
}

export function alternate(messages: { role: 'user' | 'assistant'; content: string }[]): StudioMessage[] {
  const merged: { role: 'user' | 'assistant'; content: string }[] = []
  for (const message of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === message.role) last.content = `${last.content}\n\n${message.content}`
    else merged.push({ ...message })
  }
  while (merged.length && merged[0].role !== 'user') merged.shift()
  return merged
}

export function asStudioImage(mime: string | null | undefined): StudioImageType | null {
  const type = (mime || 'image/png').toLowerCase()
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/gif' ? type : null
}
