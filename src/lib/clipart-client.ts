import type { ClipartSettings, EngineId, SavedPreset } from './clipart'

export type EngineStatus = { id: EngineId; ready: boolean; reason: string }
export type ClipartStatus = { engines: EngineStatus[]; presets: SavedPreset[]; retentionDays: number }
export type ClipartResult = { id: string; url: string; width: number; height: number; requested: { width: number; height: number }; mime: string; engine: EngineId; model: string; usedReference: boolean }
export type GenerateBody = { engine: EngineId; preset: string; settings: ClipartSettings; prompt: string; negative: string; image: string; reference: string | null; sourceWidth: number; sourceHeight: number; seed: number | null; sourceName: string }

export class ClipartError extends Error {
  constructor(message: string, public status: number, public limit: 'quota' | 'busy' | '' = '', public retryAfter = 0, public notConfigured = false) {
    super(message)
  }
}

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, { credentials: 'same-origin', ...init })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ClipartError('The network dropped. The queue will retry.', 0, 'busy', 5)
  }
  const body = await response.json().catch(() => ({})) as { error?: string; limit?: 'quota' | 'busy'; retryAfter?: number; notConfigured?: boolean }
  if (!response.ok) throw new ClipartError(body.error || 'The request failed.', response.status, body.limit ?? (response.status === 429 ? 'busy' : ''), Number(body.retryAfter) || 0, Boolean(body.notConfigured))
  return body as T
}

const post = <T>(body: unknown, signal?: AbortSignal) => call<T>('/api/clipart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

export const fetchClipartStatus = () => call<ClipartStatus>('/api/clipart')
export const requestClipart = (body: GenerateBody, signal?: AbortSignal) => post<ClipartResult>({ action: 'generate', ...body }, signal)
export const saveClipartPreset = (preset: Omit<SavedPreset, 'id'>) => post<{ presets: SavedPreset[]; saved: SavedPreset }>({ action: 'save-preset', ...preset })
export const deleteClipartPreset = (id: string) => post<{ presets: SavedPreset[] }>({ action: 'delete-preset', id })

export async function imageSize(file: Blob) {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

export async function encodeForEngine(file: Blob, maxEdge: number) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(16, Math.round(bitmap.width * scale))
  const height = Math.max(16, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.93)
}

export const EXPORT_FORMATS = [
  { type: 'image/png', label: 'PNG', ext: 'png' },
  { type: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { type: 'image/webp', label: 'WebP', ext: 'webp' },
] as const
export type ExportType = (typeof EXPORT_FORMATS)[number]['type']

export async function convertBlob(blob: Blob, type: ExportType) {
  if (blob.type === type) return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')!
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(out => out ? resolve(out) : reject(new Error('Export failed.')), type, 0.95))
}

export async function fetchResult(url: string) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('That result has expired. Regenerate it.')
  return response.blob()
}

export function exportName(sourceName: string, ext: string) {
  const stem = sourceName.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'image'
  return `${stem}-clipart.${ext}`
}
