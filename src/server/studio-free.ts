import type { Env } from './env.js'
import { HttpError } from './http.js'
import type { OpenAIMessage } from './studio-openai.js'

export const FREE_TEXT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
const FREE_MAX_TOKENS = 4096

export function freeTextAvailable(env: Env) {
  return Boolean(env.AI)
}

function freeFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Workers AI studio text failure', message.slice(0, 500))
  if (/4006|daily free allocation|neurons/i.test(message)) throw new HttpError(429, 'Today’s free assistant allowance is used up. It resets at midnight UTC.')
  if (/3040|capacity|429|rate limit|too many/i.test(message)) throw new HttpError(429, 'The assistant is busy right now. Please wait a moment and retry.')
  throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
}

export async function freeChat(env: Env, request: { messages: OpenAIMessage[]; maxTokens: number; json?: { name: string; schema: Record<string, unknown> } }): Promise<{ text: string; refused: boolean }> {
  if (!env.AI) throw new HttpError(503, 'The assistant is unavailable right now. Please try again shortly.')
  const inputs = {
    messages: request.messages,
    max_tokens: Math.min(request.maxTokens, FREE_MAX_TOKENS),
    ...(request.json ? { response_format: { type: 'json_schema', json_schema: request.json.schema } } : {}),
  }
  let output: unknown
  for (const delay of [0, 1500]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    try {
      output = await env.AI.run(FREE_TEXT_MODEL, inputs)
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (delay || !/3040|capacity|429|rate limit|too many|timed? ?out/i.test(message)) freeFailure(error)
    }
  }
  const response = (output as { response?: unknown } | null)?.response
  const text = typeof response === 'string' ? response.trim() : response && typeof response === 'object' ? JSON.stringify(response) : ''
  return { text, refused: false }
}
