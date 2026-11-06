import type { CustomRideMotion, CustomRidePlatform, CustomRideRecordInput } from '../../server/park/index.mjs'

export const PARK_RIDE_STATUSES = ['draft', 'published', 'retired'] as const
export type ParkRideStatus = (typeof PARK_RIDE_STATUSES)[number]
export type ParkRideCategory = 'gentle' | 'thrill' | 'water' | 'other'

/** How the source model was fitted, kept so the editor can reopen a ride. */
export type ParkRideBake = { scale: number; yaw: number; triangles: number }

export type ParkRideSpec = {
  name: string
  description: string
  category: ParkRideCategory
  size: [number, number]
  height: number
  cost: number
  upkeep: number
  capacity: number
  rideTime: number
  loadTime: number
  price: number
  stats: { e: number; i: number; n: number }
  motion: CustomRideMotion
  platform?: CustomRidePlatform
  bake: ParkRideBake
}

export type ParkRideRecord = {
  id: string
  status: ParkRideStatus
  spec: ParkRideSpec
  meshVersion: number
  meshBytes: number
  thumb: boolean
  source: boolean
  sourceJob: string | null
  createdAt: number
  updatedAt: number
}

/** What players' browsers and the online server register into FLAT_RIDES. */
export type ParkRideCatalogEntry = CustomRideRecordInput

const ENDPOINT = '/api/park-rides'

async function readError(response: Response) {
  try { return ((await response.json()) as { error?: string }).error ?? 'Something went wrong. Please try again.' } catch { return 'Something went wrong. Please try again.' }
}

export const parkRideMeshUrl = (id: string, version: number) => `${ENDPOINT}?mesh=${encodeURIComponent(id)}&v=${version}`
export const parkRideThumbUrl = (id: string, version: number) => `${ENDPOINT}?thumb=${encodeURIComponent(id)}&v=${version}`
export const parkRideSourceUrl = (id: string) => `${ENDPOINT}?source=${encodeURIComponent(id)}`

export async function fetchParkRideCatalog(): Promise<ParkRideCatalogEntry[]> {
  const response = await fetch(ENDPOINT, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { rides: ParkRideCatalogEntry[] }).rides
}

export async function fetchParkRideRecords(): Promise<ParkRideRecord[]> {
  const response = await fetch(`${ENDPOINT}?drafts=1`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { records: ParkRideRecord[] }).records
}

export type SaveParkRide = { id?: string; spec: ParkRideSpec; status: 'draft' | 'published'; mesh?: Blob; thumb?: Blob; source?: File; sourceJob?: string | null }

export async function saveParkRide(input: SaveParkRide): Promise<ParkRideRecord> {
  const form = new FormData()
  if (input.id) form.set('id', input.id)
  form.set('spec', JSON.stringify(input.spec))
  form.set('status', input.status)
  if (input.sourceJob) form.set('sourceJob', input.sourceJob)
  if (input.mesh) form.set('mesh', input.mesh, 'ride.tpr')
  if (input.thumb) form.set('thumb', input.thumb, 'thumb.webp')
  if (input.source) form.set('source', input.source, input.source.name || 'source.glb')
  const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { record: ParkRideRecord }).record
}

export async function setParkRideStatus(id: string, status: ParkRideStatus): Promise<ParkRideRecord> {
  const response = await fetch(ENDPOINT, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { record: ParkRideRecord }).record
}

export async function deleteParkRide(id: string): Promise<void> {
  const response = await fetch(ENDPOINT, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  if (!response.ok) throw new Error(await readError(response))
}

export async function fetchParkRideSource(id: string): Promise<File> {
  const response = await fetch(parkRideSourceUrl(id), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return new File([await response.blob()], `ride-${id}.glb`, { type: 'model/gltf-binary' })
}
