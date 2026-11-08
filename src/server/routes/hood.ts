import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { claimLot, homeOf, lotOwner, streetCount, streetLots } from '../hood.js'
import { hoodLotStub, type HoodIdentity } from '../hood-lot.js'
import { MAX_SIMS } from '../../../modules-src/hood/shared/Lot'
import { sanitizeLook } from '../../../modules-src/hood/shared/Look'
import { LOTS_PER_STREET, MAX_STREETS, lotAddress, streetName } from '../../../modules-src/hood/shared/Street'

const streetParam = z.coerce.number().int().min(0).max(MAX_STREETS - 1)
const lotParam = z.coerce.number().int().min(0).max(LOTS_PER_STREET - 1)
const connectParams = z.object({
  street: streetParam,
  lot: lotParam,
  sim: z.string().regex(/^s\d{1,2}$/).optional(),
  guest: z.string().regex(/^[A-Za-z0-9]{12,64}$/).optional(),
})
const lookSchema = z.object({
  skin: z.number().int().min(0).max(20), hair: z.number().int().min(0).max(20), hairStyle: z.string().max(12),
  top: z.number().int().min(0).max(20), bottom: z.number().int().min(0).max(20), build: z.string().max(12), height: z.number().min(0.8).max(1.2),
})
const claimSchema = z.object({
  action: z.literal('claim'),
  street: streetParam,
  lot: lotParam,
  household: z.object({
    name: z.string().min(1).max(30),
    sims: z.array(z.object({ name: z.string().min(1).max(30), look: lookSchema })).min(1).max(MAX_SIMS),
  }),
})

/** `/api/hood`: GET lists a street of The Hood; POST `claim` moves a new household in; a WebSocket upgrade walks onto a lot. */
export async function hood(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return connect(request, env, url)

  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    const home = user ? await homeOf(env, user.id) : null
    const { streets, open } = await streetCount(env)
    const requested = url.searchParams.get('street')
    const street = requested !== null ? streetParam.parse(requested) : home?.street ?? open
    const lots = await streetLots(env, street, user?.id ?? null)
    return json({
      me: { signedIn: !!user, name: user?.username ?? null, home },
      street, name: streetName(street), streets: Math.max(streets, street + 1), open,
      lots: lots.map((lot, index) => ({ ...(lot ?? { owner: null, home: false, visitors: 0, shell: null, mine: false }), lot: index, address: lotAddress(street, index) })),
    })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'This request is not allowed.')
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to move into The Hood.')
  const body = claimSchema.parse(await readJson(request, 8000))
  const result = await claimLot(env, user.id, user.username, body.street, body.lot, body.household.name, body.household.sims.map(sim => ({ name: sim.name, look: sanitizeLook(sim.look) })))
  if (!result.ok) throw new HttpError(409, result.reason === 'has-home' ? 'You already have a home in The Hood.' : 'Someone just moved into that lot. Pick another one.')
  return json({ ok: true, home: { street: body.street, lot: body.lot } })
}

async function connect(request: Request, env: Env, url: URL) {
  if (!env.HOOD_LOT) throw new HttpError(503, 'The Hood is not available right now.')
  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'This request is not allowed.')
  const parsed = connectParams.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) throw new HttpError(400, 'Please reload the page and try again.')
  const params = parsed.data
  if (!(await lotOwner(env, params.street, params.lot))) throw new HttpError(404, 'That lot is for sale.')
  const user = await currentUser(request, env)
  let identity: HoodIdentity
  if (user) identity = { key: `member:${user.id}`, name: user.username, street: params.street, lot: params.lot, sim: params.sim, home: await homeOf(env, user.id) }
  else {
    if (!params.guest) throw new HttpError(400, 'Please reload the page and try again.')
    identity = { key: `guest:${params.guest}`, name: `Guest-${params.guest.slice(0, 5)}`, street: params.street, lot: params.lot, home: null }
  }
  const stub = hoodLotStub(env, params.street, params.lot)!
  const headers = new Headers(request.headers)
  headers.set('x-hood-identity', JSON.stringify(identity))
  return stub.fetch(new Request(new URL(`/connect?street=${params.street}&lot=${params.lot}`, url), { headers }))
}
