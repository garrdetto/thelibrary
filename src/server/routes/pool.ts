import { z } from 'zod'
import type { Env } from '../env'
import { binary, json, parseStored, readJson, requireSameOrigin } from '../http'
import { requireUser } from '../auth'
import { IMAGE_MODEL, base64ToBytes, gemini, imageTypes } from '../gemini'
import { isRecordResetPassword } from '../records'

const practiceModes = z.enum(['practice', 'nine-practice'])

export async function poolPractice(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Sign in to view practice high scores.')
  if (request.method === 'POST') {
    requireSameOrigin(request)
    const input = z.object({ id: z.string().uuid(), mode: practiceModes, milliseconds: z.number().int().min(1000).max(2147483647) }).parse(await readJson(request, 500))
    await env.DB.prepare('INSERT INTO pool_practice_records (id, user_id, username, mode, milliseconds, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(input.id, user.id, user.username, input.mode, input.milliseconds, Date.now()).run()
    return json({ saved: true })
  }
  if (request.method === 'DELETE') {
    requireSameOrigin(request)
    const input = z.object({ mode: practiceModes, password: z.string().min(1).max(128) }).parse(await readJson(request, 500))
    if (!await isRecordResetPassword(input.password)) return json({ error: 'Incorrect reset password.' }, 403)
    await env.DB.prepare('DELETE FROM pool_practice_records WHERE mode = ?').bind(input.mode).run()
    return json({ reset: true })
  }
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
  const mode = practiceModes.parse(new URL(request.url).searchParams.get('mode') ?? 'practice')
  const rows = await env.DB.prepare('SELECT username, milliseconds, created_at FROM pool_practice_records WHERE mode = ? ORDER BY milliseconds ASC, created_at ASC, id ASC LIMIT 10')
    .bind(mode).all<{ username: string; milliseconds: number; created_at: number }>()
  return json({ records: rows.results.map(row => ({ username: row.username, milliseconds: row.milliseconds, date: new Date(row.created_at).toISOString() })) })
}

async function playerCheck(request: Request, env: Env) {
  const user = await requireUser(request, env, 'Your session expired. Sign in again to access your saved settings.')
  if (request.method !== 'GET' && request.headers.get('X-Pool-Player') !== user.username) {
    return { user, conflict: json({ error: 'Your player account changed in another tab. Refresh before saving settings.' }, 409) }
  }
  return { user, conflict: null }
}

const color = z.string().regex(/^#[a-f0-9]{6}$/i)
const appearanceSchema = z.object({
  theme: z.enum(['club', 'glow', 'electric', 'spectrum', 'retro', 'forest', 'ocean', 'rose', 'slate']),
  frameColor: color, felt: color, railColor: color.optional(), imageColor: color.optional(), roomColor: color.optional(), cueShaftColor: color.optional(), cueButtColor: color.optional(),
  cuePreset: z.enum(['plain', 'custom', 'money', 'brewers', 'badgers', 'bucks', 'cubs', 'stars', 'diamonds', 'checker', 'stripes', 'circuit', 'hearts', 'lightning']).optional(),
  reducedMotion: z.boolean().optional(),
  effects: z.record(z.string().max(30), z.object({ fade: z.boolean(), electric: z.boolean(), lighting: z.boolean().optional(), pulse: z.boolean().optional(), chase: z.boolean().optional(), sparkles: z.boolean().optional(), aurora: z.boolean().optional(), spotlight: z.boolean().optional() })).refine(value => Object.keys(value).length <= 12),
})

export async function poolPreferences(request: Request, env: Env) {
  const { user, conflict } = await playerCheck(request, env)
  if (conflict) return conflict
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT appearance FROM pool_preferences WHERE user_id = ?').bind(user.id).first<{ appearance: string }>()
    return json({ appearance: parseStored(row?.appearance, null) })
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const appearance = appearanceSchema.parse(await readJson(request, 8192))
  await env.DB.prepare('INSERT INTO pool_preferences (user_id, appearance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET appearance = excluded.appearance')
    .bind(user.id, JSON.stringify(appearance)).run()
  return json({ saved: true })
}

const artStyle = 'Use a simple flat clipart or vector illustration style with bold clean outlines and solid colors. Never photorealistic, never a photo, no 3D rendering, no realistic textures or lighting.'

export async function poolCueOverlay(request: Request, env: Env) {
  const { user, conflict } = await playerCheck(request, env)
  if (conflict) return conflict
  const key = `cue/${user.id}`
  if (request.method === 'GET') {
    const stored = await env.FILES.getWithMetadata<{ mime?: string }>(key, 'arrayBuffer')
    if (!stored.value) return json({ error: 'No cue overlay saved.' }, 404)
    return binary(stored.value, 'image/png')
  }
  requireSameOrigin(request)
  if (request.method === 'POST') {
    const input = z.object({ prompt: z.string().trim().min(3).max(500), theme: z.string().max(80), color: color, style: z.enum(['logos', 'wrap']).default('logos') }).parse(await readJson(request, 2000))
    const result = await gemini(env).models.generateContent({
      model: IMAGE_MODEL,
      contents: input.style === 'wrap'
        ? `Create one continuous, edge-to-edge decorative artwork for a full pool cue butt wrap. ${artStyle} The design must completely fill the entire frame with no empty background, borders, frames or margins. Compose it as a long horizontal band: keep every important shape inside the middle third of the image height and let the shapes flow left to right across the whole width, with the top and bottom thirds simply continuing the same background design. No cue, scenery perspective, text, letters or watermarks. Base the palette around ${input.color}, in the ${input.theme} theme. Treat the following as design ideas only: ${input.prompt}`
        : `Create a flat graphic decal tile for a pool cue wrap. ${artStyle} Show exactly two small, complete logo-like icons, one centered in the left half and one centered in the right half, with generous empty margins, on a perfectly uniform pure magenta (#ff00ff) chroma-key background. No cue, scenery, text, shadows, gradients or background decoration. Do not use magenta inside the icons. Keep icon colors opaque and distinct; for donuts use different colored frosting and visible holes filled with the magenta background. These icons will be repeated many times at small size in offset rows over cue base color ${input.color}, in the ${input.theme} theme. Treat the following as icon ideas only: ${input.prompt}`,
      config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: input.style === 'wrap' ? { aspectRatio: '21:9', imageSize: '2K' } : { aspectRatio: '16:9', imageSize: '2K' } },
    })
    const part = result.candidates?.[0]?.content?.parts?.find(item => item.inlineData?.mimeType?.startsWith('image/'))?.inlineData
    if (!part?.data || !imageTypes.includes(part.mimeType ?? '')) return json({ error: 'No pattern was returned. Try again with a different description.' }, 502)
    return binary(base64ToBytes(part.data), part.mimeType!)
  }
  if (request.method === 'DELETE') {
    await env.FILES.delete(key)
    return json({ saved: true })
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405)
  if (request.headers.get('content-type') !== 'image/png') return json({ error: 'Upload a PNG image.' }, 415)
  if (Number(request.headers.get('content-length')) > 2 * 1024 * 1024) return json({ error: 'Image must be smaller than 2 MB.' }, 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > 2 * 1024 * 1024) return json({ error: 'Image must be smaller than 2 MB.' }, 413)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return json({ error: 'Invalid PNG image.' }, 400)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 2400 || height > 1024) return json({ error: 'Image must be at most 2400 pixels wide and 1024 pixels tall.' }, 400)
  await env.FILES.put(key, bytes, { metadata: { mime: 'image/png' } })
  return json({ saved: true })
}
