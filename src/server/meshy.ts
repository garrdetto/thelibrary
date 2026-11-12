import type { MeshyJob, MeshyJobKind, MeshyJobStatus, MeshyTarget } from '../lib/meshy'
import type { Env } from './env'
import { HttpError } from './http'

const DEFAULT_BASE = 'https://api.meshy.ai/openapi'
const TABLE = `CREATE TABLE IF NOT EXISTS meshy_jobs (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, task_id TEXT NOT NULL, parent_id TEXT, prompt TEXT NOT NULL,
  options TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, thumbnail_url TEXT, model_bytes INTEGER, error TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

export const MESHY_MODEL_KEY = (jobId: string) => `meshy-model/${jobId}`
export const MESHY_MODEL_MAX_BYTES = 24 * 1024 * 1024

/** Where each job kind lives in Meshy's API. */
export const TASK_PATHS: Record<MeshyJobKind, string> = {
  preview: '/v2/text-to-3d',
  refine: '/v2/text-to-3d',
  image: '/v1/image-to-3d',
  remesh: '/v1/remesh',
  retexture: '/v1/retexture',
  rig: '/v1/rigging',
  animate: '/v1/animations',
}

export const meshyConfigured = (env: Env) => Boolean(env.MESHY_API_KEY?.trim())
const base = (env: Env) => (env.MESHY_API_BASE?.trim() || DEFAULT_BASE).replace(/\/$/, '')

/** Meshy's raw errors never reach the browser: each status becomes a plain message. */
function friendlyError(status: number) {
  if (status === 401 || status === 403) return new HttpError(502, 'Meshy rejected the API key. Check MESHY_API_KEY in Cloudflare.')
  if (status === 402) return new HttpError(402, 'There aren’t enough Meshy credits for that.')
  if (status === 404) return new HttpError(404, 'Meshy no longer has that task.')
  if (status === 409) return new HttpError(409, 'That task can’t be changed right now.')
  if (status === 429) return new HttpError(429, 'Meshy is busy. Wait a moment and try again.')
  if (status === 400 || status === 422) return new HttpError(400, 'Meshy couldn’t use that input. Try a different prompt, image or model.')
  return new HttpError(503, 'Meshy is unavailable right now. Please try again shortly.')
}

export async function meshyFetch<T>(env: Env, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = env.MESHY_API_KEY?.trim()
  if (!key) throw new HttpError(503, 'Meshy isn’t connected yet.')
  let response: Response
  try {
    response = await fetch(`${base(env)}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new HttpError(503, 'Meshy is unavailable right now. Please try again shortly.')
  }
  if (!response.ok) {
    console.error('Meshy request failed', init.method ?? 'GET', path.replace(/\/[A-Za-z0-9-]{16,}$/, '/<id>'), response.status)
    throw friendlyError(response.status)
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

/** The .glb a finished task produced: text, image, remesh and retexture tasks list it under model_urls; rigging and animation tasks under result. */
export function taskModelUrl(task: MeshyTask): string | undefined {
  return task.model_urls?.glb ?? task.result?.rigged_character_glb_url ?? task.result?.animation_glb_url
}

export type MeshyTask = {
  id: string
  status: MeshyJobStatus
  progress?: number
  model_urls?: { glb?: string }
  result?: { rigged_character_glb_url?: string; animation_glb_url?: string }
  thumbnail_url?: string
  consumed_credits?: number
  task_error?: { message?: string } | null
}

type JobRow = {
  id: string
  kind: MeshyJobKind
  target: MeshyTarget
  task_id: string
  parent_id: string | null
  prompt: string
  options: string
  status: MeshyJobStatus
  progress: number
  credits: number
  thumbnail_url: string | null
  model_bytes: number | null
  error: string | null
  created_by: string
  created_at: number
  updated_at: number
}

let tableReady: Promise<unknown> | null = null
export function ensureJobsTable(env: Env) {
  tableReady ??= env.DB.prepare(TABLE).run().catch(error => { tableReady = null; throw error })
  return tableReady
}

export const isFinal = (status: string) => status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED'

export function toJob(row: JobRow): MeshyJob {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    parentId: row.parent_id,
    prompt: row.prompt,
    status: row.status,
    progress: row.progress,
    credits: row.credits,
    thumbnailUrl: row.thumbnail_url,
    modelReady: (row.model_bytes ?? 0) > 0,
    modelBytes: row.model_bytes,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listJobRows(env: Env, limit = 60): Promise<JobRow[]> {
  await ensureJobsTable(env)
  const rows = await env.DB.prepare('SELECT * FROM meshy_jobs WHERE hidden = 0 ORDER BY created_at DESC LIMIT ?').bind(limit).all<JobRow>()
  return rows.results
}

export async function getJobRow(env: Env, id: string): Promise<JobRow | null> {
  await ensureJobsTable(env)
  return env.DB.prepare('SELECT * FROM meshy_jobs WHERE id = ?').bind(id).first<JobRow>()
}

export async function insertJob(env: Env, job: { id: string; kind: MeshyJobKind; target: MeshyTarget; taskId: string; parentId: string | null; prompt: string; options: unknown; credits: number; createdBy: string }) {
  await ensureJobsTable(env)
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO meshy_jobs (id, kind, target, task_id, parent_id, prompt, options, status, progress, credits, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)`)
    .bind(job.id, job.kind, job.target, job.taskId, job.parentId, job.prompt, JSON.stringify(job.options), job.credits, job.createdBy, now, now)
    .run()
}

export async function setJob(env: Env, id: string, changes: Partial<{ status: MeshyJobStatus; progress: number; credits: number; thumbnail_url: string | null; model_bytes: number | null; error: string | null; hidden: number }>) {
  const keys = Object.keys(changes) as (keyof typeof changes)[]
  if (!keys.length) return
  const sets = [...keys.map(k => `${k} = ?`), 'updated_at = ?']
  await env.DB.prepare(`UPDATE meshy_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...keys.map(k => changes[k] ?? null), Date.now(), id).run()
}

/** Removes a job's row and stored model; jobs made from it keep their own task ids and models and just lose the parent link. */
export async function deleteJob(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE meshy_jobs SET parent_id = NULL WHERE parent_id = ?').bind(id),
    env.DB.prepare('DELETE FROM meshy_jobs WHERE id = ?').bind(id),
  ])
  await env.FILES.delete(MESHY_MODEL_KEY(id))
}

/** Whether the site-change run that created a job is still queued or running (and may still use the job). */
export async function creatorRunActive(env: Env, createdBy: string) {
  const runId = createdBy.match(/^site-change:([0-9a-f-]{36})$/i)?.[1]
  if (!runId) return false
  try {
    const row = await env.DB.prepare('SELECT status FROM site_changes WHERE id = ?').bind(runId.toLowerCase()).first<{ status: string }>()
    return row?.status === 'queued' || row?.status === 'running'
  } catch {
    return false
  }
}

/** Downloads a finished task's .glb into KV so it outlives Meshy's expiring links. */
export async function storeTaskModel(env: Env, jobId: string, url: string): Promise<number> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new HttpError(503, 'Couldn’t download the model from Meshy. Try again shortly.')
  }
  if (!response.ok) throw new HttpError(502, 'Meshy’s download link has expired. Run the step again to get a fresh model.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MESHY_MODEL_MAX_BYTES) throw new HttpError(413, 'Meshy’s model is too large to store. Remesh it to a lower polycount first.')
  await env.FILES.put(MESHY_MODEL_KEY(jobId), bytes, { metadata: { mime: 'model/gltf-binary', bytes: bytes.byteLength } })
  return bytes.byteLength
}

/** Pulls the latest status for an unfinished job from Meshy and stores the model when it's done. */
export async function refreshJob(env: Env, row: JobRow): Promise<JobRow> {
  if (isFinal(row.status) && (row.status !== 'SUCCEEDED' || row.model_bytes || row.kind === 'preview')) return row
  let task: MeshyTask
  try {
    task = await meshyFetch<MeshyTask>(env, `${TASK_PATHS[row.kind]}/${encodeURIComponent(row.task_id)}`)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      await setJob(env, row.id, { status: 'FAILED', error: 'Meshy no longer has this task.' })
      return { ...row, status: 'FAILED', error: 'Meshy no longer has this task.' }
    }
    return row
  }
  const next: Partial<JobRow> = {
    status: task.status,
    progress: Math.max(0, Math.min(100, Math.round(task.progress ?? (task.status === 'SUCCEEDED' ? 100 : row.progress)))),
    thumbnail_url: task.thumbnail_url ?? row.thumbnail_url,
    credits: typeof task.consumed_credits === 'number' ? task.consumed_credits : row.credits,
    error: task.status === 'FAILED' ? 'Meshy couldn’t finish this model. Meshy refunds failed tasks.' : null,
  }
  const glb = taskModelUrl(task)
  if (task.status === 'SUCCEEDED' && row.kind !== 'preview' && !row.model_bytes && glb) {
    try {
      next.model_bytes = await storeTaskModel(env, row.id, glb)
    } catch (error) {
      next.error = error instanceof HttpError ? error.message : 'Couldn’t store the model.'
    }
  }
  await setJob(env, row.id, next as Parameters<typeof setJob>[2])
  return { ...row, ...next }
}

/** Gets (and stores) the model of any finished job, including previews, on demand. */
export async function ensureJobModel(env: Env, row: JobRow): Promise<void> {
  if (row.model_bytes) return
  if (row.status !== 'SUCCEEDED') throw new HttpError(409, 'That model isn’t finished yet.')
  const task = await meshyFetch<MeshyTask>(env, `${TASK_PATHS[row.kind]}/${encodeURIComponent(row.task_id)}`)
  const glb = taskModelUrl(task)
  if (!glb) throw new HttpError(404, 'Meshy didn’t return a .glb for that task.')
  const bytes = await storeTaskModel(env, row.id, glb)
  await setJob(env, row.id, { model_bytes: bytes })
}
