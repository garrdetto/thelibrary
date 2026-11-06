import type { CarStatus, CustomCarRecord, CustomCarSpec } from '../../modules-src/shorttrack/shared/CustomCars'

export type { CarStatus, CustomCarRecord, CustomCarSpec }

const ENDPOINT = '/api/shorttrack-cars'

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error ?? 'Something went wrong. Please try again.'
  } catch {
    return 'Something went wrong. Please try again.'
  }
}

export async function fetchCars(): Promise<CustomCarRecord[]> {
  const response = await fetch(`${ENDPOINT}?drafts=1`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { cars: CustomCarRecord[] }).cars
}

/** Publishes a new car, or with `id` saves a new name, spec, status and (optionally) model over an existing one. */
export async function publishCar(input: { id?: string; name: string; spec: CustomCarSpec; model: Blob | null; status: 'draft' | 'published' }): Promise<CustomCarRecord> {
  const form = new FormData()
  if (input.id) form.append('id', input.id)
  form.append('name', input.name)
  form.append('spec', JSON.stringify(input.spec))
  if (input.model) form.append('model', input.model, 'car.glb')
  form.append('status', input.status)
  const response = await fetch(ENDPOINT, { method: 'POST', body: form, credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { car: CustomCarRecord }).car
}

export async function updateCar(id: string, changes: { status?: CarStatus; name?: string; spec?: CustomCarSpec }): Promise<CustomCarRecord> {
  const response = await fetch(ENDPOINT, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...changes }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return ((await response.json()) as { car: CustomCarRecord }).car
}

/** Downloads a saved car's model as a file the editor can open and save again. */
export async function fetchCarModel(record: CustomCarRecord): Promise<File> {
  const response = await fetch(record.modelUrl, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('That car’s model could not be downloaded.')
  return new File([await response.blob()], `${record.id}.glb`, { type: 'model/gltf-binary' })
}
