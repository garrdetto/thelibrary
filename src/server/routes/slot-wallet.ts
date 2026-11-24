import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, readJson, requireSameOrigin } from '../http.js'
import { ADMIN_LEVEL, currentUser, isOwnerRow } from '../auth.js'
import type { UserRow } from '../auth.js'
import { loadVaultProfile, saveVaultProfile } from '../sunvault.js'
import { SlotEngine } from '../../../modules-src/sunvault/engine/slotEngine'

export const MAX_GIFT_CENTS = 100_000_000

const giftInput = z.object({
  action: z.literal('add'),
  id: z.string().uuid(),
  cents: z.number().int().min(1).max(MAX_GIFT_CENTS),
}).strict()

async function loadTarget(request: Request, env: Env, id: string | null) {
  const actor = await currentUser(request, env)
  if (!actor?.isAdmin) throw new HttpError(403, 'Administrator access required.')
  if (!id || !z.string().uuid().safeParse(id).success) throw new HttpError(400, 'Choose an account.')
  const target = await env.DB.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').bind(id).first<Pick<UserRow, 'id' | 'username' | 'is_admin'>>()
  if (!target) throw new HttpError(404, 'Account not found.')
  const targetIsAdmin = isOwnerRow(target) || target.is_admin === ADMIN_LEVEL
  const canChange = actor.isOwner || !targetIsAdmin || target.id === actor.id
  return { target, canChange }
}

export async function slotWallet(request: Request, env: Env) {
  if (request.method === 'GET') {
    const { target, canChange } = await loadTarget(request, env, new URL(request.url).searchParams.get('id'))
    const profile = await loadVaultProfile(env, target.id)
    return json({ balance: SlotEngine.fromState(profile.state).snapshot().balance, canChange })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const parsed = giftInput.safeParse(await readJson(request, 512))
  if (!parsed.success) return json({ error: 'Enter an amount from $0.01 to $1,000,000.' }, 400)
  const { target, canChange } = await loadTarget(request, env, parsed.data.id)
  if (!canChange) return json({ error: 'Only the owner can change another administrator.' }, 403)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const profile = await loadVaultProfile(env, target.id)
    const engine = SlotEngine.fromState(profile.state)
    const balance = engine.addCredits(parsed.data.cents).balance
    try {
      await saveVaultProfile(env, { ...profile, state: engine.toState() })
      return json({ ok: true, added: parsed.data.cents, balance })
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error
    }
  }
  return json({ error: 'They are spinning right now. Try again in a moment.' }, 409)
}
