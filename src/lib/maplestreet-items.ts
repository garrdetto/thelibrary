import type { CatalogFunc, CatalogRoom } from '../../modules-src/maplestreet/shared/Catalog'
import type { CustomItemRecord, Vector3Like } from '../../modules-src/maplestreet/shared/CustomItems'

export type { CustomItemRecord, Vector3Like }

export type PublishInput = {
  model: File
  name: string
  price: number
  scale: Vector3Like
  room: CatalogRoom
  func: CatalogFunc
  indoor: boolean
  solid: boolean
  yaw: number
  w: number
  d: number
  h: number
}

const ENDPOINT = '/api/maplestreet-items'

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error ?? 'Something went wrong. Please try again.'
  } catch {
    return 'Something went wrong. Please try again.'
  }
}

export async function fetchStoreItems(): Promise<CustomItemRecord[]> {
  const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { items: CustomItemRecord[] }).items
}

export async function publishStoreItem(input: PublishInput): Promise<CustomItemRecord> {
  const form = new FormData()
  form.append('model', input.model, input.model.name)
  form.append('name', input.name)
  form.append('price', String(input.price))
  form.append('scale', JSON.stringify({ x: input.scale.x, y: input.scale.y, z: input.scale.z }))
  form.append('room', input.room)
  form.append('func', input.func)
  form.append('indoor', String(input.indoor))
  form.append('solid', String(input.solid))
  form.append('yaw', String(input.yaw))
  form.append('w', String(input.w))
  form.append('d', String(input.d))
  form.append('h', String(input.h))
  const response = await fetch(ENDPOINT, { method: 'POST', body: form, credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { item: CustomItemRecord }).item
}

export async function updateStoreItem(id: string, changes: { active?: boolean; name?: string; price?: number }): Promise<CustomItemRecord> {
  const response = await fetch(ENDPOINT, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...changes }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { item: CustomItemRecord }).item
}
