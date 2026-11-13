import type { AssetStatus } from '../../modules-src/maplestreet/shared/Assets'
import type { CustomVehicleRecord, CustomVehicleSpec } from '../../modules-src/maplestreet/shared/CustomVehicles'

export type { AssetStatus, CustomVehicleRecord, CustomVehicleSpec }

const ENDPOINT = '/api/maplestreet-vehicles'

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error ?? 'Something went wrong. Please try again.'
  } catch {
    return 'Something went wrong. Please try again.'
  }
}

export async function fetchStoreVehicles(): Promise<CustomVehicleRecord[]> {
  const response = await fetch(`${ENDPOINT}?drafts=1`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { vehicles: CustomVehicleRecord[] }).vehicles
}

/** Publishes a new vehicle, or with `id` saves a new model, name, spec and status over an existing one. */
export async function publishStoreVehicle(input: { id?: string; name: string; spec: CustomVehicleSpec; model: Blob; wheel: Blob | null; hd?: Blob | null; status: 'draft' | 'published' }): Promise<CustomVehicleRecord> {
  const form = new FormData()
  if (input.id) form.append('id', input.id)
  form.append('name', input.name)
  form.append('spec', JSON.stringify(input.spec))
  form.append('model', input.model, 'vehicle.glb')
  if (input.wheel) form.append('wheel', input.wheel, 'wheel.glb')
  if (input.hd) form.append('hd', input.hd, 'hd.glb')
  form.append('status', input.status)
  const response = await fetch(ENDPOINT, { method: 'POST', body: form, credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { vehicle: CustomVehicleRecord }).vehicle
}

/** Downloads a published vehicle's model (with its wheel and HD texture pack) as files the editor can open and re-publish. */
export async function fetchStoreVehicleFiles(record: CustomVehicleRecord): Promise<{ model: File; wheel: File | null; hd: File | null }> {
  const load = async (url: string, name: string) => {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('That vehicle’s model could not be downloaded.')
    const type = response.headers.get('content-type') ?? 'model/gltf-binary'
    const ext = type.includes('json') || /\.gltf(\?|$)/i.test(url) ? 'gltf' : 'glb'
    return new File([await response.blob()], `${name}.${ext}`, { type })
  }
  const [model, wheel, hd] = await Promise.all([
    load(record.modelUrl, record.id),
    record.wheelUrl ? load(record.wheelUrl, `${record.id}-wheel`) : Promise.resolve(null),
    record.hdUrl ? load(record.hdUrl, `${record.id}-hd`).catch(() => null) : Promise.resolve(null),
  ])
  return { model, wheel, hd }
}

export async function updateStoreVehicle(id: string, changes: { active?: boolean; status?: AssetStatus; name?: string; spec?: CustomVehicleSpec }): Promise<CustomVehicleRecord> {
  const response = await fetch(ENDPOINT, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...changes }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { vehicle: CustomVehicleRecord }).vehicle
}

export async function deleteStoreVehicle(id: string): Promise<void> {
  const response = await fetch(ENDPOINT, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  if (!response.ok) throw new Error(await readError(response))
}

export type SuggestedPoint = { x: number; y: number } | null
export type SuggestedBox = { x0: number; y0: number; x1: number; y1: number } | null
export type SuggestedParts = { seat: { side: SuggestedPoint; top: SuggestedPoint }; head: { side: SuggestedPoint; front: SuggestedPoint }; tail: { side: SuggestedPoint; rear: SuggestedPoint }; hitch: { side: SuggestedPoint }; boxes?: { frontDoor: SuggestedBox; rearDoor: SuggestedBox; hood: SuggestedBox; trunk: SuggestedBox } }

export async function suggestVehicleParts(input: { kind: string; views: { side: string; top: string; front: string; rear: string } }): Promise<SuggestedParts> {
  const response = await fetch('/api/maplestreet-suggest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SuggestedParts
}
