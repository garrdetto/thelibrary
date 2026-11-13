import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { readDartsSettings, resetDartsSettings, saveDartsSettings } from '../darts-settings.js'
import { CLASSIC_METER_MODES, DART_FINISHES, FLIGHT_SLOTS, METER_FIELDS, sanitizeSettings } from '../../../modules-src/darts/shared/Settings'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const finite = z.number().finite()
const meterShape = Object.fromEntries(METER_FIELDS.map(field => [field.key, finite.optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>

const settingsSchema = z.object({
  meter: z.object({ ...meterShape, classic: z.enum(CLASSIC_METER_MODES as [string, ...string[]]).optional() }).strict().optional(),
  defaults: z.object({
    board: z.enum(['steel', 'spider']).optional(),
    cpuLevel: z.enum(['pub', 'league', 'county', 'pro']).optional(),
    doubleOutSteel: z.boolean().optional(),
    doubleOutSoft: z.boolean().optional(),
    doubleBull: z.boolean().optional(),
  }).strict().optional(),
  steel: z.record(z.string().max(24), hex).optional(),
  spider: z.record(z.string().max(24), hex).optional(),
  darts: z.object({
    flightColors: z.array(hex).max(FLIGHT_SLOTS).optional(),
    steelTint: hex.optional(),
    steelFinish: z.enum(DART_FINISHES as [string, ...string[]]).optional(),
    softBarrel: hex.optional(),
    softShaft: hex.optional(),
    softTip: hex.optional(),
    softFlight: hex.optional(),
    softFinish: z.enum(DART_FINISHES as [string, ...string[]]).optional(),
    softPlayerFlights: z.boolean().optional(),
  }).strict().optional(),
}).strict()

const input = z.union([
  z.object({ action: z.literal('save'), settings: settingsSchema }).strict(),
  z.object({ action: z.literal('reset') }).strict(),
])

/**
 * GET (public): the live Darts settings merged over the defaults, `updatedAt`, and `admin` for the administrator.
 * POST (admin, same-origin) `{action:'save', settings}` publishes them; `{action:'reset'}` goes back to the defaults.
 */
export async function dartsSettings(request: Request, env: Env) {
  if (request.method === 'GET') {
    const { settings, updatedAt } = await readDartsSettings(env)
    const user = await currentUser(request, env)
    return json({ settings, updatedAt, admin: user?.isAdmin === true }, 200, { 'Cache-Control': 'no-store' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in as the administrator to change the Darts settings.')
  if (!user.isAdmin) return json({ error: 'Only the administrator can change the Darts settings.' }, 403)
  const parsed = input.safeParse(await readJson(request, 12000))
  if (!parsed.success) return json({ error: 'Those Darts settings could not be read.' }, 400)
  if (parsed.data.action === 'reset') return json({ settings: await resetDartsSettings(env), updatedAt: null })
  const settings = sanitizeSettings(parsed.data.settings)
  const updatedAt = await saveDartsSettings(env, settings)
  return json({ settings, updatedAt })
}
