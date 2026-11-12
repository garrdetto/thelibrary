import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, binary, json, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'
import type { SessionUser } from '../auth'
import { NO_CODE_MESSAGE, looksLikeCode } from '../code-guard'
import { DESIGN_MODELS, SPEECH_MODELS, elevenLabs, elevenLabsConfigured, listAccountVoices, readPreviews } from '../elevenlabs'

type VoiceRow = { id: string; user_id: string; voice_id: string; name: string; description: string; created_at: number }

let tableReady: Promise<unknown> | null = null

/** Migration 0034, also created on first use. */
function ensureVoiceTable(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS voice_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      voice_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS voice_designs_user_idx ON voice_designs (user_id, created_at)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

const voiceId = z.string().trim().regex(/^[A-Za-z0-9_-]{6,64}$/)
const voiceName = z.string().trim().min(1).max(60)
const voiceDescription = z.string().trim().min(20, 'Describe the voice in at least 20 characters.').max(1000)
const previewText = z.string().trim().min(100, 'Preview text needs at least 100 characters.').max(1000).optional()
const unit = z.number().min(0).max(1)

const voiceInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('design'), description: voiceDescription, text: previewText, model: z.enum(DESIGN_MODELS).default('eleven_multilingual_ttv_v2'),
    loudness: z.number().min(-1).max(1).default(0.5), guidance: z.number().min(0).max(100).default(5), seed: z.number().int().min(0).max(2147483647).optional(), enhance: z.boolean().default(false),
  }).strict(),
  z.object({ action: z.literal('remix'), voiceId, description: voiceDescription, text: previewText, guidance: z.number().min(0).max(100).default(2), seed: z.number().int().min(0).max(2147483647).optional() }).strict(),
  z.object({ action: z.literal('save'), generatedVoiceId: voiceId, name: voiceName, description: voiceDescription, replaceVoiceId: voiceId.optional() }).strict(),
  z.object({ action: z.literal('edit'), voiceId, name: voiceName, description: voiceDescription }).strict(),
  z.object({
    action: z.literal('speak'), voiceId, text: z.string().trim().min(1).max(2500), model: z.enum(SPEECH_MODELS).default('eleven_multilingual_v2'),
    stability: unit.default(0.5), similarity: unit.default(0.75), style: unit.default(0), speed: z.number().min(0.7).max(1.2).default(1),
  }).strict(),
  z.object({ action: z.literal('delete'), voiceId }).strict(),
])

function publicVoice(row: VoiceRow) {
  return { voiceId: row.voice_id, name: row.name, description: row.description, createdAt: new Date(row.created_at).toISOString() }
}

async function voiceUser(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in to use the Voice Generator.')
  if (!user.pages.includes('voice')) throw new HttpError(403, 'Ask the administrator for Voice Generator access.')
  return user
}

async function ownVoice(env: Env, user: SessionUser, id: string) {
  const row = await env.DB.prepare('SELECT * FROM voice_designs WHERE voice_id = ?').bind(id).first<VoiceRow>()
  if (row && row.user_id === user.id) return row
  if (user.isAdmin) return row
  throw new HttpError(404, 'That voice isn’t in your Voice Generator.')
}

async function removeVoice(env: Env, id: string) {
  try { await elevenLabs(env, `/v1/voices/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 30000 }) }
  catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error }
  await env.DB.prepare('DELETE FROM voice_designs WHERE voice_id = ?').bind(id).run()
}

export async function voice(request: Request, env: Env) {
  const user = await voiceUser(request, env)
  await ensureVoiceTable(env)
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM voice_designs WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all<VoiceRow>()
    const configured = elevenLabsConfigured(env)
    let account: Awaited<ReturnType<typeof listAccountVoices>> | null = null
    if (user.isAdmin && configured) {
      try {
        const mine = new Set(rows.results.map(row => row.voice_id))
        account = (await listAccountVoices(env)).filter(item => !mine.has(item.voiceId))
      } catch { account = null }
    }
    return json({ configured, voices: rows.results.map(publicVoice), account, canManageAccount: user.isAdmin })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const parsed = voiceInput.safeParse(await readJson(request, 8000))
  if (!parsed.success) {
    const message = parsed.error.issues.map(issue => issue.message).find(text => /at least \d+ characters\.$/.test(text) && /^(Describe|Preview)/.test(text))
    return json({ error: message ?? 'Please check your input and try again.' }, 400)
  }
  const input = parsed.data
  const texts = 'description' in input ? [input.description] : []
  if ('text' in input && input.text) texts.push(input.text)
  if ('name' in input) texts.push(input.name)
  if (texts.some(text => looksLikeCode(text))) return json({ error: NO_CODE_MESSAGE.voice }, 422)

  if (input.action === 'design') {
    const response = await elevenLabs(env, '/v1/text-to-voice/design?output_format=mp3_44100_128', {
      json: {
        voice_description: input.description, model_id: input.model, loudness: input.loudness, guidance_scale: input.guidance, should_enhance: input.enhance,
        ...(input.text ? { text: input.text } : { auto_generate_text: true }), ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    })
    return json(readPreviews(await response.json()))
  }

  if (input.action === 'remix') {
    await ownVoice(env, user, input.voiceId)
    const response = await elevenLabs(env, `/v1/text-to-voice/${encodeURIComponent(input.voiceId)}/remix?output_format=mp3_44100_128`, {
      json: {
        voice_description: input.description, guidance_scale: input.guidance,
        ...(input.text ? { text: input.text } : { auto_generate_text: true }), ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    })
    return json(readPreviews(await response.json()))
  }

  if (input.action === 'save') {
    if (input.replaceVoiceId) await ownVoice(env, user, input.replaceVoiceId)
    const response = await elevenLabs(env, '/v1/text-to-voice', { json: { voice_name: input.name, voice_description: input.description, generated_voice_id: input.generatedVoiceId, labels: { source: 'myworkhelper' } } })
    const created = await response.json() as { voice_id?: string }
    if (!created.voice_id) throw new HttpError(503, 'ElevenLabs didn’t return the new voice. Please try again.')
    const row: VoiceRow = { id: crypto.randomUUID(), user_id: user.id, voice_id: created.voice_id, name: input.name, description: input.description, created_at: Date.now() }
    await env.DB.prepare('INSERT INTO voice_designs (id, user_id, voice_id, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.user_id, row.voice_id, row.name, row.description, row.created_at).run()
    let replaced = false
    if (input.replaceVoiceId && input.replaceVoiceId !== created.voice_id) {
      try { await removeVoice(env, input.replaceVoiceId); replaced = true } catch { replaced = false }
    }
    return json({ voice: publicVoice(row), replaced })
  }

  if (input.action === 'edit') {
    const row = await ownVoice(env, user, input.voiceId)
    const form = new FormData()
    form.append('name', input.name)
    form.append('description', input.description)
    await elevenLabs(env, `/v1/voices/${encodeURIComponent(input.voiceId)}/edit`, { method: 'POST', body: form, timeoutMs: 30000 })
    if (row) await env.DB.prepare('UPDATE voice_designs SET name = ?, description = ? WHERE voice_id = ?').bind(input.name, input.description, input.voiceId).run()
    return json({ voice: { voiceId: input.voiceId, name: input.name, description: input.description, createdAt: new Date(row?.created_at ?? Date.now()).toISOString() } })
  }

  if (input.action === 'speak') {
    await ownVoice(env, user, input.voiceId)
    const response = await elevenLabs(env, `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
      json: { text: input.text, model_id: input.model, voice_settings: { stability: input.stability, similarity_boost: input.similarity, style: input.style, speed: input.speed, use_speaker_boost: true } },
      timeoutMs: 180000,
    })
    return binary(new Uint8Array(await response.arrayBuffer()), 'audio/mpeg')
  }

  await ownVoice(env, user, input.voiceId)
  await removeVoice(env, input.voiceId)
  return json({ ok: true })
}
