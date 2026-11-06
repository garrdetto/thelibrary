import type { MeshyAiModel, MeshyJob, MeshyStatus, MeshyTarget } from './meshy'

const ENDPOINT = '/api/meshy'

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error ?? 'Something went wrong. Please try again.'
  } catch {
    return 'Something went wrong. Please try again.'
  }
}

async function get<T>(query: string): Promise<T> {
  const response = await fetch(`${ENDPOINT}${query}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as T
}

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as T
}

export type MeshySource = { jobId: string } | { itemId: string } | { vehicleId: string } | { rideId: string } | { carId: string }

export const meshyStatus = () => get<MeshyStatus>('?status=1')
export const meshyJobs = () => get<{ jobs: MeshyJob[]; connected: boolean }>('')
export const meshyText = (input: { target: MeshyTarget; prompt: string; negativePrompt: string; aiModel: MeshyAiModel; count: number; polycount?: number }) => post<{ ids: string[] }>({ action: 'text', ...input })
export const meshyImage = (input: { target: MeshyTarget; image: string; texture: boolean; aiModel: MeshyAiModel; prompt: string; polycount?: number }) => post<{ ids: string[] }>({ action: 'image', ...input })
export const meshyRefine = (jobId: string, texturePrompt: string) => post<{ ids: string[] }>({ action: 'refine', jobId, texturePrompt })
export const meshyRemesh = (target: MeshyTarget, source: MeshySource, polycount: number) => post<{ ids: string[] }>({ action: 'remesh', target, source, polycount })
export const meshyRetexture = (target: MeshyTarget, source: MeshySource, prompt: string) => post<{ ids: string[] }>({ action: 'retexture', target, source, prompt })
export const meshyCancel = (jobId: string) => post<{ ok: true }>({ action: 'cancel', jobId })
export const meshyHide = (jobId: string) => post<{ ok: true }>({ action: 'hide', jobId })

export async function meshyModelFile(jobId: string, name = 'meshy-model.glb'): Promise<File> {
  const response = await fetch(`${ENDPOINT}?model=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(await readError(response))
  return new File([await response.blob()], name, { type: 'model/gltf-binary' })
}
