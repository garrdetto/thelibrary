import type { Env } from './env'
import { HttpError } from './http'

const API_BASE = 'https://api.elevenlabs.io'

export const DESIGN_MODELS = ['eleven_multilingual_ttv_v2', 'eleven_ttv_v3'] as const
export const SPEECH_MODELS = ['eleven_multilingual_v2', 'eleven_v4', 'eleven_flash_v2_5'] as const

export type VoicePreview = { generatedVoiceId: string; audio: string; mediaType: string; duration: number }
export type AccountVoice = { voiceId: string; name: string; description: string; category: string; previewUrl: string | null }

export function elevenLabsConfigured(env: Env) {
  return Boolean(env.ELEVENLABS_API_KEY)
}

function elevenLabsKey(env: Env) {
  if (!env.ELEVENLABS_API_KEY) throw new HttpError(503, 'The Voice Generator isn’t set up yet. Ask the site owner to add an ElevenLabs API key.')
  return env.ELEVENLABS_API_KEY
}

export async function elevenLabs(env: Env, path: string, init: { method?: string; json?: unknown; body?: BodyInit; timeoutMs?: number } = {}) {
  const key = elevenLabsKey(env)
  const headers: Record<string, string> = { 'xi-api-key': key }
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 120000),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new HttpError(504, 'ElevenLabs took too long to answer. Please try again.')
    throw new HttpError(503, 'ElevenLabs is unavailable right now. Please try again shortly.')
  }
  if (response.ok) return response
  const detail = await response.text().catch(() => '')
  console.error('ElevenLabs API error', response.status, detail.slice(0, 500))
  if (/quota_exceeded|insufficient|credits?/i.test(detail)) throw new HttpError(402, 'Your ElevenLabs account is out of credits for this. Top up or try a shorter text.')
  if (response.status === 401 || response.status === 403) throw new HttpError(503, 'The Voice Generator isn’t set up correctly. Check the ElevenLabs API key and its permissions.')
  if (response.status === 404) throw new HttpError(404, 'That voice no longer exists in ElevenLabs.')
  if (response.status === 409) throw new HttpError(409, 'ElevenLabs is still working on the last request. Wait a moment and try again.')
  if (response.status === 429) throw new HttpError(429, 'ElevenLabs is busy right now. Please wait a moment and retry.')
  if (response.status === 400 || response.status === 422) throw new HttpError(422, 'ElevenLabs couldn’t use that request. Try a clearer voice description or different preview text.')
  throw new HttpError(503, 'ElevenLabs is unavailable right now. Please try again shortly.')
}

type PreviewResponse = { previews?: { audio_base_64?: string; generated_voice_id?: string; media_type?: string; duration_secs?: number }[]; text?: string }

export function readPreviews(result: PreviewResponse) {
  const previews: VoicePreview[] = (result.previews ?? [])
    .filter(item => item.audio_base_64 && item.generated_voice_id)
    .map(item => ({ generatedVoiceId: item.generated_voice_id!, audio: item.audio_base_64!, mediaType: item.media_type || 'audio/mpeg', duration: item.duration_secs ?? 0 }))
  if (!previews.length) throw new HttpError(422, 'ElevenLabs returned no previews. Try a different description.')
  return { previews, text: result.text ?? '' }
}

export async function listAccountVoices(env: Env): Promise<AccountVoice[]> {
  const response = await elevenLabs(env, '/v1/voices', { timeoutMs: 30000 })
  const result = await response.json() as { voices?: { voice_id: string; name?: string; description?: string | null; category?: string; preview_url?: string | null }[] }
  return (result.voices ?? [])
    .filter(voice => voice.category !== 'premade')
    .map(voice => ({ voiceId: voice.voice_id, name: voice.name ?? 'Untitled voice', description: voice.description ?? '', category: voice.category ?? 'generated', previewUrl: voice.preview_url ?? null }))
}
