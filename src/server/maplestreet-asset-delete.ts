import type { Env } from './env.js'
import { HttpError, json } from './http.js'
import { refreshWorldCatalog, saveWorld } from './maplestreet-admin.js'
import { deleteAsset, getAsset } from './maplestreet-assets.js'
import { worldMentions } from './maplestreet-world.js'

const OWNED_MESSAGE = {
  item: 'Players have already placed this item in their houses, so it can’t be deleted. Retire it instead: it leaves the Buy catalog and houses that own it keep it.',
  vehicle: 'Players already own this vehicle, so it can’t be deleted. Retire it instead: it leaves the dealer lot and traffic and owners keep it in their garage.',
} as const

/**
 * Deletes a Fox Plains item or vehicle with its KV files. Drafts never reached
 * players, so they always go. A published or retired one goes only when no saved
 * lot or account in the shared world refers to it, checked after the world has
 * saved what it holds in memory.
 */
export async function deleteMapleAsset(env: Env, kind: 'item' | 'vehicle', id: string, fileKeys: string[]) {
  const asset = await getAsset(env, kind, id)
  if (!asset) return json({ error: kind === 'item' ? 'Item not found.' : 'Vehicle not found.' }, 404)
  const live = asset.status !== 'draft'
  if (live) {
    await saveWorld(env)
    if (await worldMentions(env, `"custom:${id}"`)) throw new HttpError(409, OWNED_MESSAGE[kind])
  }
  if (!await deleteAsset(env, kind, id)) return json({ error: kind === 'item' ? 'Item not found.' : 'Vehicle not found.' }, 404)
  await Promise.all(fileKeys.map(key => env.FILES.delete(key)))
  if (live) await refreshWorldCatalog(env)
  return json({ ok: true, id })
}
