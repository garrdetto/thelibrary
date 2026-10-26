import { GoogleGenAI } from '@google/genai'
import type { Env } from './env'
import { HttpError } from './http'

export const TEXT_MODEL = 'gemini-3-flash-preview'
export const IMAGE_MODEL = 'gemini-3.1-flash-image'

export function gemini(env: Env) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, 'AI features are not set up yet. Ask the site owner to add a Gemini API key.')
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 55000 } })
}

export function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
  return btoa(binary)
}

export const imageTypes = ['image/png', 'image/jpeg', 'image/webp']
