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

export async function publishStoreVehicle(input: { name: string; spec: CustomVehicleSpec; model: Blob; wheel: Blob | null; status: 'draft' | 'published' }): Promise<CustomVehicleRecord> {
  const form = new FormData()
  form.append('name', input.name)
  form.append('spec', JSON.stringify(input.spec))
  form.append('model', input.model, 'vehicle.glb')
  if (input.wheel) form.append('wheel', input.wheel, 'wheel.glb')
  form.append('status', input.status)
  const response = await fetch(ENDPOINT, { method: 'POST', body: form, credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { vehicle: CustomVehicleRecord }).vehicle
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

export type SuggestedPoint = { x: number; y: number } | null
export type SuggestedBox = { x0: number; y0: number; x1: number; y1: number } | null
export type SuggestedParts = { seat: { side: SuggestedPoint; top: SuggestedPoint }; head: { side: SuggestedPoint; front: SuggestedPoint }; tail: { side: SuggestedPoint; rear: SuggestedPoint }; hitch: { side: SuggestedPoint }; boxes?: { frontDoor: SuggestedBox; rearDoor: SuggestedBox; hood: SuggestedBox; trunk: SuggestedBox } }

export async function suggestVehicleParts(input: { kind: string; views: { side: string; top: string; front: string; rear: string } }): Promise<SuggestedParts> {
  const response = await fetch('/api/maplestreet-suggest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SuggestedParts
}
