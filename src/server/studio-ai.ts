import { HarmBlockThreshold, HarmCategory } from '@google/genai'
import type { Content, GenerateContentConfig, GenerateContentResponse, Part } from '@google/genai'
import type { Env } from './env'
import { HttpError } from './http'
import { TEXT_MODEL, gemini } from './gemini'

export const STUDIO_TEXT_MODEL = TEXT_MODEL

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

export async function askStudio(env: Env, request: StudioRequest): Promise<StudioReply> {
  const ai = gemini(env)
  const system = request.json ? `${request.system}\nReply with only the JSON object described by the response schema (the ${request.json.name} fields), with no other text.` : request.system
  const config: GenerateContentConfig = {
    systemInstruction: system,
    maxOutputTokens: request.maxTokens,
    ...(request.json ? { responseMimeType: 'application/json', responseJsonSchema: request.json.schema } : {}),
    ...(request.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(request.relaxedSafety ? { safetySettings: [HarmCategory.HARM_CATEGORY_HARASSMENT, HarmCategory.HARM_CATEGORY_HATE_SPEECH, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT].map(category => ({ category, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH })) } : {}),
  }
  let result: GenerateContentResponse
  try {
    result = await ai.models.generateContent({ model: STUDIO_TEXT_MODEL, contents: toContents(request.messages), config })
  } catch (error) { geminiFailure(error) }
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
